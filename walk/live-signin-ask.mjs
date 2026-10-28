// Live receipts for Ask in a sentence and the password sign-in: on the live lantern.onlyworlds.com,
// a crew account signs in with email and password (keel's app login), opens a scratch world
// of its own, and asks it one question through keel's /account/ask. The scratch world and
// its two elements are made over the API first. Every token and world key made here is recorded by the
// id keel answered its mint with, in walk/shots/live-signin-ask/minted.json (ids only, never a secret),
// and the cleanup step (`--cleanup`) revokes those ids alone and reads each back; it never picks a row
// from a list. The scratch world is deleted on the site (its name typed), which takes its keys with it.
//
// Run from tools/lantern: CREW_FILE=<the crew accounts file> node walk/live-signin-ask.mjs [crew-walk-b]
// Credentials are read from CREW_FILE at run time and never printed.
import { chromium } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://www.onlyworlds.com/api/v2';
const AUTH = `${API}/auth/app/v1`;
const SITE = process.env.LANTERN_URL ?? 'https://lantern.onlyworlds.com';
const OUT = path.resolve('walk/shots/live-signin-ask');
fs.mkdirSync(OUT, { recursive: true });

const acct = process.argv.find((a) => a.startsWith('crew-walk-')) ?? 'crew-walk-b';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith(`${acct} `) && l.includes('@')).trim().split(/\s+/);
const pin = lines.find((l) => l.startsWith(`${acct} PIN`)).trim().split(/\s+/)[2];
const MINTED = path.join(OUT, 'minted.json');
const record = (row) => {
  const all = fs.existsSync(MINTED) ? JSON.parse(fs.readFileSync(MINTED, 'utf8')) : [];
  all.push(row);
  fs.writeFileSync(MINTED, JSON.stringify(all, null, 2));
};

async function setupToken(name) {
  const res = await fetch(`${AUTH}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const session = (await res.json()).meta?.session_token;
  if (!session) throw new Error(`login refused: ${res.status}`);
  const t = await fetch(`${API}/account/tokens`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': session }, body: JSON.stringify({ name }),
  });
  const j = await t.json();
  await fetch(`${AUTH}/auth/session`, { method: 'DELETE', headers: { 'X-Session-Token': session } });
  if (!j.token || !j.id) throw new Error(`token refused: ${t.status}`);
  return { token: j.token, id: j.id };
}

const account = (token) => new OwV2Client({ apiKey: token, baseUrl: API });

if (process.argv.includes('--cleanup')) {
  const rows = fs.existsSync(MINTED) ? JSON.parse(fs.readFileSync(MINTED, 'utf8')) : [];
  if (!rows.length) { console.log('cleanup: nothing recorded in', MINTED); process.exit(0); }
  // The cleanup's own token is recorded first, so a run that dies here is still cleaned by the next.
  const own = await setupToken('temper 159 cleanup');
  record({ kind: 'token', id: own.id });
  const auth = { Authorization: `Bearer ${own.token}` };
  const left = [];
  for (const r of rows) {
    const url = r.kind === 'key' ? `${API}/account/worlds/${r.world}/keys/${encodeURIComponent(r.id)}` : `${API}/account/tokens/${encodeURIComponent(r.id)}`;
    const del = await fetch(url, { method: 'DELETE', headers: auth, signal: AbortSignal.timeout(15000) });
    console.log(`${r.kind} ${r.id} revoked by its recorded id: DELETE ${del.status}`);
    if (![204, 404].includes(del.status)) left.push(r);
  }
  // Read back: every recorded token row is revoked (keel lists revoked rows with the flag) or gone.
  const listed = (await (await fetch(`${API}/account/tokens`, { headers: auth, signal: AbortSignal.timeout(15000) })).json()).data ?? [];
  for (const r of rows.filter((x) => x.kind === 'token')) {
    const row = listed.find((t) => t.id === r.id);
    if (row && !row.revoked) { console.log(`FAIL token ${r.id} still live`); left.push(r); }
  }
  const delOwn = await fetch(`${API}/account/tokens/${encodeURIComponent(own.id)}`, { method: 'DELETE', headers: auth, signal: AbortSignal.timeout(15000) });
  const after = await fetch(`${API}/account`, { headers: auth, signal: AbortSignal.timeout(15000) });
  console.log(`cleanup's own token: DELETE ${delOwn.status}, then GET /account ${after.status}`);
  if (after.status !== 401) left.push({ kind: 'token', id: own.id });
  if (left.length) { fs.writeFileSync(MINTED, JSON.stringify(left, null, 2)); console.log('FAIL kept for the next cleanup:', left.map((r) => r.id).join(', ')); process.exit(1); }
  fs.rmSync(MINTED);
  process.exit(0);
}

// 1. The scratch world, over the API.
const setupMint = await setupToken('temper 159 setup');
record({ kind: 'token', id: setupMint.id });
const setup = setupMint.token;
const created = await account(setup).request('POST', '/account/worlds', { body: { name: 'Temper 159 ask walk' } });
const worldId = created.id;
console.log('world', worldId, created.name);
const w = new OwV2Client({ apiKey: created.key, apiPin: pin, baseUrl: API });
await w.create('location', { name: 'Thornwick', description: 'A river town under the hills, known for its bells.' });
await w.create('character', { name: 'Mara Vell', description: 'The blacksmith of Thornwick. She casts the town bells and keeps the forge by the bridge.' });

// 2. Lantern, live, signed in with email and password.
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const asked = [];
page.on('response', async (r) => {
  if (r.url().endsWith('/account/ask')) asked.push(r.status());
  if (r.request().method() !== 'POST' || r.status() !== 201) return;
  const key = r.url().match(/\/account\/worlds\/([^/]+)\/keys\/?$/);
  if (!key && !r.url().startsWith(`${API}/account/tokens`)) return;
  try {
    const j = await r.json();
    if (j.id) record(key ? { kind: 'key', world: key[1], id: j.id } : { kind: 'token', id: j.id });
  } catch { /* not json */ }
});
let n = 0;
const shot = (name) => page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });

await page.goto(`${SITE}/#/signin`);
await page.fill('input[type="email"]', email);
await page.fill('input[aria-label="Password"]', password);
await shot('signin');
await page.click('button[type="submit"]:has-text("Sign in")');
await page.waitForSelector('[data-screen="worlds"]', { timeout: 20000 });
const signedIn = await page.getByText('Temper 159 ask walk').count();
console.log('signed in with email and password; the scratch world listed:', signedIn > 0);
await shot('worlds');

await page.getByText('Temper 159 ask walk').first().click();
await page.waitForFunction((id) => location.hash.includes(id), worldId, { timeout: 30000 });
await page.waitForTimeout(3000);
await shot('world');

await page.goto(`${SITE}/#/w/${worldId}/ask`);
await page.waitForSelector('[data-screen="ask"] input[type="search"]');
await page.fill('[data-screen="ask"] input[type="search"]', 'Who is the blacksmith of Thornwick?');
await page.press('[data-screen="ask"] input[type="search"]', 'Enter');
await page.waitForSelector('[data-answer]', { timeout: 30000 });
const answer = await page.locator('[data-answer]').first();
console.log('answer kind:', await answer.getAttribute('data-answer'));
console.log('answer:', await answer.textContent());
console.log('/account/ask statuses:', asked.join(', ') || 'none');
await shot('ask');
console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
console.log('at', new Date().toISOString());
await browser.close();
console.log(`cleanup: CREW_FILE=... node walk/live-signin-ask.mjs ${acct} --cleanup; then delete the world ${worldId} on the site`);
