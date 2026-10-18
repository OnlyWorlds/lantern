// The frames' cleanup (#388): the scratch world deleted on the site by its id (its name read on the
// delete page first), each phone's own account token revoked (the row whose last four match the
// token the phone holds), the L17 read key gone with the world, the site signed out.
// Every revoke is read back as a 401.
//
//   CREW_FILE=<crew accounts file> FRAMES_STATE=<scratch dir> node walk/frames-cleanup.mjs [--go --keys | --go]
// Without --go it only lists. --go --keys: the world keys and the two tokens; --go: the world and the site session.
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
    return new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get('accountToken'); q.onsuccess = () => res(q.result); });
  });
  await ctx.close();
  return token;
}
const call = (token, method, p) => fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}` } });

const tokens = { owner: await phoneToken('owner'), friend: await phoneToken('friend') };
const rows = {};
for (const [who, t] of Object.entries(tokens)) {
  const r = await call(t, 'GET', '/account/tokens');
  const list = (await r.json()).data ?? [];
  rows[who] = list.filter((x) => !x.revoked && x.last4 === t.slice(-4));
  console.log(who, r.status, "this phone's own token:", rows[who].map((x) => `${x.id} ${x.name} ...${x.last4}`));
}
const w = await call(tokens.owner, 'GET', '/account/worlds');
console.log('b holds', ((await w.json()).data ?? []).map((x) => `${x.id.slice(0, 8)} ${x.name}`));
const keys = await call(tokens.owner, 'GET', `/account/worlds/${state.worldId}/keys`);
const worldKeys = keys.ok ? ((await keys.json()).data ?? []).filter((k) => !k.revoked) : [];
console.log('world keys', keys.status, worldKeys.map((k) => `${k.id} ${k.name ?? ''} ${k.scope ?? ''}`));
if (!GO) process.exit(0);

// The world's keys (the copy's own was revoked when it was made, so every live one is this walk's),
// then each phone's token, the phone's own last.
if (process.argv.includes('--keys')) {
  for (const k of worldKeys) {
    const r = await call(tokens.owner, 'DELETE', `/account/worlds/${state.worldId}/keys/${k.id}`);
    console.log('world key revoked', k.name ?? k.id, r.status);
  }
  for (const [who, t] of Object.entries(tokens)) {
    for (const x of rows[who]) {
      const r = await call(t, 'DELETE', `/account/tokens/${x.id}`);
      console.log('revoke', who, x.name, r.status);
    }
    const check = await call(t, 'GET', '/account/worlds');
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
