// Keel #159 and #211's live receipts (S425, the journey day): on the live lantern.onlyworlds.com,
// a crew account signs in with email and password (keel's app login, #211), opens a scratch world
// of its own, and asks it one question through keel's /account/ask (#159). The scratch world and
// its two elements are made over the API first; every token and key made here is listed at the end
// for the cleanup step (`--cleanup <worldId>`), which revokes them.
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

async function setupToken(name) {
  const res = await fetch(`${AUTH}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const session = (await res.json()).meta?.session_token;
  if (!session) throw new Error(`login refused: ${res.status}`);
  const t = await fetch(`${API}/account/tokens`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': session }, body: JSON.stringify({ name }),
  });
  const token = (await t.json()).token;
  await fetch(`${AUTH}/auth/session`, { method: 'DELETE', headers: { 'X-Session-Token': session } });
  if (!token) throw new Error(`token refused: ${t.status}`);
  return token;
}

const account = (token) => new OwV2Client({ apiKey: token, baseUrl: API });

if (process.argv.includes('--cleanup')) {
  const worldId = process.argv[process.argv.indexOf('--cleanup') + 1];
  const token = await setupToken('temper 159 cleanup');
  const c = account(token);
  if (worldId) {
    const keys = await c.request('GET', `/account/worlds/${worldId}/keys`);
    for (const k of keys.data ?? []) {
      await c.request('DELETE', `/account/worlds/${worldId}/keys/${k.id}`);
      console.log('world key revoked', k.id, k.name ?? '');
    }
  }
  const tokens = await c.request('GET', '/account/tokens');
  const mine = (tokens.data ?? []).filter((t) => /^temper 159|^Lantern on /.test(t.name ?? ''));
  // This run's own token goes last, so the loop keeps its credential to the end.
  mine.sort((a, b) => (a.name === 'temper 159 cleanup') - (b.name === 'temper 159 cleanup'));
  for (const t of mine) {
    await c.request('DELETE', `/account/tokens/${t.id}`);
    console.log('account token revoked', t.id, t.name);
  }
  process.exit(0);
}

// 1. The scratch world, over the API.
const setup = await setupToken('temper 159 setup');
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
page.on('response', (r) => { if (r.url().endsWith('/account/ask')) asked.push(r.status()); });
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
console.log(`cleanup: CREW_FILE=... node walk/live-signin-ask.mjs ${acct} --cleanup ${worldId}`);
