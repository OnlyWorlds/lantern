// Sign in with OnlyWorlds read live:
// a crew account signed in on onlyworlds.com (its own form, in the walk's browser) taps the button in
// Lantern, takes the consent page if it shows, and must land on Your worlds signed in with nothing typed
// into Lantern. The token Lantern kept is revoked by its own id (only that one), then must answer 401.
// Atlas 1.87.0's live walk, on a phone. Credentials come from CREW_FILE and are never printed.
// Run from tools/lantern: CREW_FILE=<file> node walk/live-signin-ow.mjs <lantern origin> <out-prefix> [chromium|webkit] [crew-walk-b]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
import { OwV2Client } from '@onlyworlds/sdk';

const [, , lantern = 'https://lantern.onlyworlds.com', out = 'live-signin-ow', engineName = 'chromium', acct = 'crew-walk-b'] = process.argv;
const API = 'https://www.onlyworlds.com/api/v2';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith(`${acct} `) && l.includes('@')).trim().split(/\s+/);
const engine = engineName === 'webkit' ? webkit : chromium;
const b = await engine.launch();
const ctx = await b.newContext({ ...(engine === webkit ? devices['iPhone 13'] : devices['Pixel 7']), serviceWorkers: 'block' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
const keel = [];
p.on('request', (r) => { const u = r.url(); if (u.includes('/signin/') || u.includes('/auth/token')) keel.push(`${r.method()} ${u.replace(/(code|state|code_challenge)=[^&]+/g, '$1=…')}`); });
const report = { lantern, engine: engineName, steps: [] };
const step = (s) => report.steps.push(s);

// 0. The walk's own token, minted and recorded by the id keel answered (a delete runs only on ids this
// walk made and recorded, never on a list's answer; the sign-in code gate's C8).
const walkToken = await new OwV2Client({ baseUrl: API, client: 'lantern' }).signInWithPassword({ email, password, tokenName: 'Lantern walk S470' });
const walkAuth = { Authorization: `Bearer ${walkToken.token}` };

// 1. Signed in on onlyworlds.com, by its own form.
await p.goto('https://www.onlyworlds.com/accounts/login/');
await p.fill('input[name="login"]', email);
await p.fill('input[name="password"]', password);
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/accounts/login'), { timeout: 30000 }), p.locator('form button[type="submit"]').first().click()]);
step(`site signed in: ${new URL(p.url()).pathname}`);

// 2. Lantern, signed out, the sign-in screen.
await p.goto(`${lantern}/#/signin`);
await p.waitForSelector('[data-screen="signin"]', { timeout: 30000 });
await p.waitForTimeout(500);
const button = p.locator('[data-action="signin-onlyworlds"]');
report.button = await button.count();
await p.screenshot({ path: `${out}-1-signin.png` });
if (!report.button) {
  // The control's way out: the walk's own token goes too (a control run left it live once).
  const delWalk = await fetch(`${API}/account/tokens/${walkToken.id}`, { method: 'DELETE', headers: walkAuth });
  const walkAfter = await fetch(`${API}/account`, { headers: walkAuth });
  report.walkTokenRevoked = `DELETE ${delWalk.status}, then GET /account ${walkAfter.status}`;
  console.log(JSON.stringify({ ...report, errors }, null, 2));
  await b.close();
  process.exit(1);
}

// 3. The tap, the consent page the first time, the return.
await button.tap();
await p.waitForURL((u) => u.hostname === 'www.onlyworlds.com' || u.hash === '#/worlds', { timeout: 30000 });
const consent = p.locator('button[name="decision"][value="continue"]');
if (await consent.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
  await p.screenshot({ path: `${out}-2-consent.png` });
  step(`consent page: ${(await p.locator('h1, h2').first().textContent().catch(() => ''))?.trim()}`);
  await consent.tap();
} else {
  step('no consent page (consented before)');
}
const landed = await p.waitForSelector('[data-screen="worlds"]', { timeout: 30000 }).then(() => true, () => false);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}-3-back.png` });
// The token Lantern kept, and keel's id for it as the sign-in's answer gave it (kv accountTokenMint,
// recorded beside the token's last eight characters).
const kv = (key) => p.evaluate((k) => new Promise((res) => {
  const o = indexedDB.open('lantern');
  o.onsuccess = () => {
    const g = o.result.transaction('kv').objectStore('kv').get(k);
    g.onsuccess = () => res(g.result ?? null);
    g.onerror = () => res(null);
  };
  o.onerror = () => res(null);
}), key);
const token = await kv('accountToken');
const mint = await kv('accountTokenMint');
const tokenId = typeof token === 'string' && mint && typeof mint.tail === 'string' && mint.tail.length === 8 && token.endsWith(mint.tail) ? mint.id : null;
Object.assign(report, {
  landed, url: p.url(), tokenKept: Boolean(token?.startsWith('ow_a_')),
  recordLeft: await p.evaluate(() => localStorage.getItem('ow_signin:lantern')),
  buttonAfter: await p.goto(`${lantern}/#/signin`).then(() => p.waitForTimeout(800)).then(() => button.count()),
});
await b.close();

// 4. The token Lantern kept, revoked by the id its mint answered with, then 401. No recorded id (the
// tail does not match, or none was kept) revokes nothing and says so.
if (tokenId) {
  const del = await fetch(`${API}/account/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE', headers: walkAuth });
  const after = await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${token}` } });
  report.revoked = `DELETE ${del.status}, then GET /account ${after.status}`;
} else {
  report.revoked = `nothing revoked: Lantern kept no id beside the token${token ? ' (its tail did not match)' : ''}`;
}
// The walk's own token last, by its recorded id.
const delWalk = await fetch(`${API}/account/tokens/${walkToken.id}`, { method: 'DELETE', headers: walkAuth });
const walkAfter = await fetch(`${API}/account`, { headers: walkAuth });
report.walkTokenRevoked = `DELETE ${delWalk.status}, then GET /account ${walkAfter.status}`;
console.log(JSON.stringify({ ...report, keel, errors }, null, 2));
process.exit(report.landed && report.tokenKept && !report.recordLeft && report.buttonAfter === 0 && /401$/.test(report.revoked ?? '') && /401$/.test(report.walkTokenRevoked) && !errors.length ? 0 : 1);
