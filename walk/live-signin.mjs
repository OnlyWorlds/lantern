// A real sign-in through SDK 4.31: a crew account signs in on Lantern
// with its email, and again with its username; each lands on Your worlds with the phone's own token;
// every "Lantern on" token is then revoked and read back 401. No question is asked, nothing is written.
//
// Run from tools/lantern: CREW_FILE=<the crew accounts file> node walk/live-signin.mjs [crew-walk-b]
// LANTERN_URL picks the build (default the local preview). Credentials are read at run time, never printed.
import { chromium } from 'playwright';
import fs from 'node:fs';

const API = 'https://www.onlyworlds.com/api/v2';
const SITE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const acct = process.argv.find((a) => a.startsWith('crew-walk-')) ?? 'crew-walk-b';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith(`${acct} `) && l.includes('@')).trim().split(/\s+/);

const browser = await chromium.launch();
const tokens = [];
let failed = 0;
for (const login of [email, acct]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${SITE}/#/signin`);
  await page.waitForSelector('[data-screen="signin"]');
  await page.locator('input[aria-label="Email or username"]').fill(login);
  await page.locator('input[aria-label="Password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const landed = await page.waitForURL(/#\/worlds/, { timeout: 30000 }).then(() => true, () => false);
  const err = await page.locator('.error').first().textContent().catch(() => '');
  const token = await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('lantern');
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction('kv', 'readonly');
        const get = tx.objectStore('kv').get('accountToken');
        get.onsuccess = () => resolve(get.result?.value ?? get.result ?? null);
        get.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
    open.onerror = () => resolve(null);
  }));
  const which = login.includes('@') ? 'email' : 'username';
  const ok = landed && typeof token === 'string' && token.startsWith('ow_a_');
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} signed in with the ${which}: ${landed ? 'Your worlds' : `stayed, ${JSON.stringify(err)}`}; token kept: ${typeof token === 'string' && token.startsWith('ow_a_')}; page errors: ${errors.length || 'none'}`);
  if (typeof token === 'string') tokens.push(token);
  await ctx.close();
}
await browser.close();

// Revoke each phone token with itself, and read it back.
for (const token of tokens) {
  const auth = { Authorization: `Bearer ${token}` };
  const list = await (await fetch(`${API}/account/tokens`, { headers: auth })).json();
  const mine = (list.data ?? []).find((t) => token.endsWith(t.last4) && /^Lantern on /.test(t.name ?? ''));
  if (!mine) { console.log('FAIL the token row was not found'); failed++; continue; }
  const del = await fetch(`${API}/account/tokens/${mine.id}`, { method: 'DELETE', headers: auth });
  const after = await fetch(`${API}/account`, { headers: auth });
  console.log(`token "${mine.name}" revoked: DELETE ${del.status}, then GET /account ${after.status}`);
  if (after.status !== 401) failed++;
}
process.exit(failed ? 1 : 0);
