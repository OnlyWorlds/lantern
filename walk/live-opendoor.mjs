// The open door, read live on a crew account's own world. A fresh phone follows #/open/<world>
// signed out, signs in by email and password, is asked about the world by name, taps Open, and lands
// on its home; then a link to one of its elements opens at once, with no new key. Records the token
// and the world key keel mints for it, and revokes both by those ids at the end. The build before the
// door (the control) says "That page is not in Lantern." at the first check. Secrets are never printed.
// Run from tools/lantern: CREW_FILE=<crew-walk-accounts.txt> node walk/live-opendoor.mjs [url] [chromium|webkit] [tag] [world name]
import fs from 'node:fs';
import { chromium, webkit, devices } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';

const [, , url = 'https://lantern.onlyworlds.com', engine = 'chromium', tag = 'live', worldName = 'Dashboard ground (crew test)'] = process.argv;
const OUT = 'walk/shots';
fs.mkdirSync(OUT, { recursive: true });
const API = 'https://www.onlyworlds.com/api/v2';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith('crew-walk-b ') && l.includes('@')).trim().split(/\s+/);
const pin = lines.find((l) => l.startsWith('crew-walk-b ') && /\bPIN\b/i.test(l))?.trim().split(/\s+/)[2];
let writer = null;
const walkKeys = [];
const madeIds = [];
let failures = 0;
const check = (ok, what) => { console.log(`[${engine} ${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const limit = () => ({ signal: AbortSignal.timeout(15000) });

const b = await (engine === 'webkit' ? webkit : chromium).launch();
const p = await (await b.newContext({ ...devices[engine === 'webkit' ? 'iPhone 13' : 'Pixel 7'] })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
const tokens = [];
const keys = [];
p.on('response', async (r) => {
  if (r.request().method() !== 'POST' || r.status() !== 201) return;
  try {
    if (r.url().startsWith(`${API}/account/tokens`)) { const j = await r.json(); tokens.push({ id: j.id, token: j.token }); }
    const m = r.url().match(/\/account\/worlds\/([0-9a-f-]{36})\/keys/);
    if (m) { const j = await r.json(); keys.push({ world: m[1], id: j.id }); }
  } catch { /* not json */ }
});
setTimeout(() => { console.log(`[${engine} ${tag}] FAIL the walk hung past 4 minutes; tokens ${tokens.length}, keys ${keys.length}`); process.exit(2); }, 240000).unref();
const hashIs = (h) => p.waitForFunction((x) => location.hash === x, h, { timeout: 20000 }).then(() => true, () => false);
const screen = async () => (await p.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);

try {
  console.log(`[${engine} ${tag}] build`, await (await fetch(new URL('/version.json', url), limit)).text().catch(() => '?'));
  // The world's id, read with a token the walk mints and revokes itself (never printed).
  const own = await new OwV2Client({ baseUrl: API, client: 'lantern' }).signInWithPassword({ email, password, tokenName: 'Lantern walk, open door' });
  tokens.push({ id: own.id, token: own.token });
  const worlds = (await (await fetch(`${API}/account/worlds`, { headers: { Authorization: `Bearer ${own.token}` }, ...limit() })).json()).data;
  const world = worlds.find((w) => w.name === worldName);
  check(Boolean(world), `the account holds "${worldName}"`);
  if (!world) throw new Error('no world');
  // One Character of the walk's own, made before the phone opens the world, so it arrives by the
  // phone's own read; made with a key the walk mints, and deleted by its id at the end.
  const wk = await new OwV2Client({ apiKey: own.token, baseUrl: API, client: 'lantern' }).request('POST', `/account/worlds/${world.id}/keys`, { body: { scope: 'write', name: 'Lantern walk, open door' } });
  walkKeys.push({ world: world.id, id: wk.id });
  writer = new OwV2Client({ apiKey: wk.key, apiPin: pin, baseUrl: API, client: 'lantern' });
  const made = await writer.create('character', { name: 'Ottoline of the Open Door' });
  madeIds.push(made.id);

  // 1. Signed out, the link waits for the sign-in.
  await p.goto(new URL(`/#/open/${world.id}`, url).href);
  const asked = await p.waitForFunction(() => /Sign in to open this world/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true, () => false);
  check(asked, `signed out, the door asks for a sign-in (${await screen()})`);
  if (!asked) throw new Error('no door');
  check((await p.evaluate(() => location.hash)) === '#/open', 'the id leaves the address bar');

  // 2. The sign-in, then the question by name.
  await p.locator('[data-screen="open"] a', { hasText: 'Sign in' }).tap();
  await p.locator('input[aria-label="Email or username"]').fill(email);
  await p.getByLabel('Password').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).tap();
  const named = await p.waitForFunction((n) => document.querySelector('[data-screen="open"]')?.textContent?.includes(`Open ${n} on this phone?`), world.name, { timeout: 30000 }).then(() => true, () => false);
  check(named, `after the sign-in, the door names the world and asks (${await screen()})`);
  check(keys.length === 0, 'no key before Open');
  await p.screenshot({ path: `${OUT}/live-opendoor-${engine}-${tag}-ask.png` });

  // 3. Open: one key, the world's home.
  await p.locator('[data-action="open-world"]').tap();
  check(await hashIs(`#/w/${world.id}`), `Open lands on the world (${await p.evaluate(() => location.hash)})`);
  check(keys.length === 1 && keys[0].world === world.id, `one key made, for this world (${keys.length})`);
  await p.waitForTimeout(4000);

  // 4. A link to one of its elements, now that the world is here: at once, no new key.
  let el = null;
  for (let i = 0; i < 20 && !el; i++) {
    el = await p.evaluate(([w, e]) => new Promise((res) => {
      const r = indexedDB.open(`lantern-world-${w}`);
      r.onsuccess = () => {
        if (!r.result.objectStoreNames.contains('elements')) return res(null);
        const g = r.result.transaction('elements').objectStore('elements').get(e);
        g.onsuccess = () => res(g.result ?? null);
      };
      r.onerror = () => res(null);
    }), [world.id, madeIds[0]]);
    if (!el) await p.waitForTimeout(1000);
  }
  check(Boolean(el), `the world's elements arrived (${el ? el.type : 'none; the home reads: ' + (await screen())})`);
  await p.screenshot({ path: `${OUT}/live-opendoor-${engine}-${tag}-home.png` });
  if (el) {
    await p.goto(new URL(`/?again#/open/${world.id}/element/${el.id}`, url).href);
    check(await hashIs(`#/w/${world.id}/e/${el.id}`), 'a link to its element opens at once');
    const shown = await p.waitForFunction((n) => document.querySelector('[data-screen="element"]')?.textContent?.includes(n), el.name, { timeout: 15000 }).then(() => true, () => false);
    check(shown, 'the element page shows its name');
    check(keys.length === 1, 'no new key');
    await p.screenshot({ path: `${OUT}/live-opendoor-${engine}-${tag}-element.png` });
    await p.goBack();
    check(await hashIs(`#/w/${world.id}`), 'Back from the element is the world\'s home');
  }
} catch (e) {
  console.log(`[${engine} ${tag}] stopped: ${String(e).slice(0, 120)}`);
  failures++;
} finally {
  // Teardown, by the ids this walk recorded: its Character, the world keys (the walk's, Lantern's),
  // then every token.
  for (const id of madeIds) {
    let status = 'deleted';
    try { await writer.delete('character', id); } catch (e) { status = String(e.status ?? e); }
    let after = 'still there';
    try { await writer.get('character', id); } catch (e) { after = String(e.status ?? e); }
    console.log(`[${engine} ${tag}] teardown: the walk's Character by recorded id, ${status}, then ${after}`);
    if (after !== '404' && after !== '410') failures++;
  }
  const own = tokens[0]?.token;
  for (const k of [...walkKeys, ...keys]) {
    const r = await fetch(`${API}/account/worlds/${k.world}/keys/${encodeURIComponent(k.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${own}` }, ...limit() }).catch(() => null);
    console.log(`[${engine} ${tag}] teardown: the world key by recorded id, ${r?.status ?? 'no answer'}`);
  }
  for (const t of tokens.slice().reverse()) {
    const r = await fetch(`${API}/account/tokens/${encodeURIComponent(t.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t.token}` }, ...limit() }).catch(() => null);
    const after = (await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${t.token}` }, ...limit() }).catch(() => null))?.status;
    console.log(`[${engine} ${tag}] teardown: a token by recorded id, ${r?.status ?? 'no answer'}, then ${after}`);
  }
}
check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 15000))]);
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
