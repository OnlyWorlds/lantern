// The frames' cleanup (#388): the scratch world deleted on the site by its id (its name read on the
// delete page first), each phone's own account token revoked by the id Lantern recorded from its mint
// (kv accountTokenMint, beside the token's last eight characters; never a row picked from a list), the
// world's keys gone with the world, the site signed out. Every revoke is read back as a 401.
//
//   CREW_FILE=<crew accounts file> FRAMES_STATE=<scratch dir> node walk/frames-cleanup.mjs [--go --keys | --go]
// Without --go it only lists. --go --keys: the two tokens; --go: the world (and its keys) and the site session.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://www.onlyworlds.com/api/v2';
const BASE = 'https://www.onlyworlds.com';
const STATE_DIR = process.env.FRAMES_STATE;
const state = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'state.json'), 'utf8'));
const GO = process.argv.includes('--go');

async function phoneToken(who) {
  const ctx = await chromium.launchPersistentContext(path.join(STATE_DIR, who), { viewport: { width: 412, height: 915 } });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://lantern.onlyworlds.com/#/worlds');
  await page.waitForSelector('[data-screen]');
  const token = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('lantern'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (k) => new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); });
    return { token: await get('accountToken'), mint: await get('accountTokenMint') };
  });
  await ctx.close();
  const { mint } = token;
  const id = typeof token.token === 'string' && mint && typeof mint.tail === 'string' && mint.tail.length === 8 && token.token.endsWith(mint.tail) ? mint.id : null;
  return { token: token.token, id };
}
const call = (token, method, p) => fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}` } });

const phones = { owner: await phoneToken('owner'), friend: await phoneToken('friend') };
for (const [who, ph] of Object.entries(phones)) console.log(who, "this phone's own token, by its recorded id:", ph.id ?? 'none recorded');
const tokens = { owner: phones.owner.token, friend: phones.friend.token };
const w = await call(tokens.owner, 'GET', '/account/worlds');
console.log('b holds', ((await w.json()).data ?? []).map((x) => `${x.id.slice(0, 8)} ${x.name}`));
const keys = await call(tokens.owner, 'GET', `/account/worlds/${state.worldId}/keys`);
const worldKeys = keys.ok ? ((await keys.json()).data ?? []).filter((k) => !k.revoked) : [];
console.log('world keys (listed only: the world\'s delete takes them)', keys.status, worldKeys.map((k) => `${k.id} ${k.name ?? ''} ${k.scope ?? ''}`));
if (!GO) process.exit(0);

// Each phone's token, by the id its mint answered with.
if (process.argv.includes('--keys')) {
  for (const [who, ph] of Object.entries(phones)) {
    if (!ph.id) { console.log('revoke', who, 'nothing: no recorded id beside the token'); continue; }
    const r = await call(ph.token, 'DELETE', `/account/tokens/${encodeURIComponent(ph.id)}`);
    console.log('revoke', who, ph.id, r.status);
    const check = await call(ph.token, 'GET', '/account/worlds');
    console.log(who, 'token now answers', check.status);
  }
  process.exit(0);
}

// The world, on the site (the API has no world delete).
const ctx = await chromium.launchPersistentContext(path.join(STATE_DIR, 'owner-site'), { viewport: { width: 1280, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/account/worlds/${state.worldId}/delete`, { waitUntil: 'load' });
const body = await page.locator('main').innerText();
if (!body.includes('Blood Meridian') || !page.url().includes(state.worldId)) throw new Error(`delete page not as expected: ${page.url()}`);
const inp = page.locator('main form input:visible');
if ((await inp.count()) !== 1) throw new Error('delete form not as expected');
await inp.first().fill('Blood Meridian');
await page.locator('main form button[type=submit]').filter({ hasText: /delete/i }).first().click();
await page.waitForLoadState('load');
console.log('after delete:', page.url());
const gone = await page.goto(`${BASE}/account/worlds/${state.worldId}`, { waitUntil: 'load' });
console.log('world page now', gone?.status());
await page.goto(`${BASE}/account/`, { waitUntil: 'load' });
console.log('b worlds page:', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300));
await page.goto(`${BASE}/accounts/logout/`, { waitUntil: 'load' });
const out = page.locator('form button[type=submit]').filter({ hasText: /sign out|log out/i });
if (await out.count()) { await out.first().click(); await page.waitForLoadState('load'); }
console.log('site signed out:', page.url());
await ctx.close();
