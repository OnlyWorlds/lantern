// A sign-in that returns over a token Lantern minted revokes the old one, read live (Atlas 1.94.0's
// twin). Tab A taps Sign in with OnlyWorlds and waits on keel's consent page; tab B (the same
// browser) signs in by email and password, so Lantern holds B's token T1; tab A continues, comes back,
// keeps T2. New build: T1 answers 401 and T2 200. The control (the build before): T1 still 200.
// Every token is recorded from keel's own mint answer and taken back by that id at the end; nothing
// is found by a list or a filter. Credentials and tokens are never printed. Claim the account first.
// Run from tools/lantern: CREW_FILE=<file> node walk/live-replace.mjs [lantern origin] [tag]
import './guard.mjs';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const [, , url = 'https://lantern.onlyworlds.com', tag = 'live'] = process.argv;
const API = 'https://www.onlyworlds.com/api/v2';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith('crew-walk-b ') && l.includes('@')).trim().split(/\s+/);
let failures = 0;
const say = (s) => console.log(`[chromium ${tag}] ${s}`);
const check = (ok, what) => { say(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const alive = async (tok) => (await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(15000) })).status;

const minted = []; // { id, token, door }
async function teardown() {
  for (const m of minted) {
    if (!m.token || !m.id) continue;
    if ((await alive(m.token)) === 200) {
      const r = await fetch(`${API}/account/tokens/${encodeURIComponent(m.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${m.token}` }, signal: AbortSignal.timeout(15000) });
      say(`teardown: ${m.door} token revoked by its recorded id (${r.status}), now ${await alive(m.token)}`);
    } else say(`teardown: ${m.door} token already 401`);
  }
}
setTimeout(() => { say(`FAIL the walk hung past 4 minutes; tearing down`); void teardown().then(() => process.exit(2)); }, 240000).unref();

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
ctx.on('response', async (r) => {
  const u = r.url();
  try {
    if (r.request().method() === 'POST' && u === `${API}/account/tokens` && r.status() === 201) {
      const j = await r.json(); minted.push({ id: j.id, token: j.token, door: 'password' });
    } else if (r.request().method() === 'POST' && u === `${API}/auth/token` && r.ok()) {
      const j = await r.json(); minted.push({ id: j.token_id ?? j.id, token: j.token, door: 'signin' });
    }
  } catch { /* not json */ }
});
const errors = [];
const kept = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('lantern');
  r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('accountToken'); g.onsuccess = () => res(g.result ?? null); };
}));

try {
  const a = await ctx.newPage();
  a.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  say(`build ${await (await fetch(new URL('/version.json', url))).text().catch(() => '?')}`);
  await a.goto('https://www.onlyworlds.com/accounts/login/');
  await a.fill('input[name="login"]', email);
  await a.fill('input[name="password"]', password);
  await Promise.all([a.waitForURL((u) => !u.pathname.startsWith('/accounts/login'), { timeout: 30000 }), a.locator('form button[type="submit"]').first().tap()]);
  await a.goto(new URL('/#/signin', url).href);
  await a.locator('[data-action="signin-onlyworlds"]').tap({ timeout: 30000 });
  const consent = a.locator('button[name="decision"][value="continue"]');
  await consent.waitFor({ timeout: 30000 });
  say('tab A waits on the consent page');

  const bt = await ctx.newPage();
  bt.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await bt.goto(new URL('/#/signin', url).href);
  await bt.getByLabel('Email or username').fill(email);
  await bt.getByLabel('Password').fill(password);
  await bt.getByRole('button', { name: 'Sign in', exact: true }).tap();
  await bt.waitForURL(/#\/(worlds|join)/, { timeout: 30000 });
  const t1 = minted.find((m) => m.door === 'password');
  check(Boolean(t1?.id) && (await kept(bt)) === t1?.token, 'tab B signed in by password; Lantern holds T1 (its id recorded)');
  check((await alive(t1.token)) === 200, 'T1 works');
  await bt.close();

  await consent.tap();
  await a.waitForURL(/#\/(worlds|join)/, { timeout: 30000 });
  const t2 = minted.find((m) => m.door === 'signin');
  check(Boolean(t2?.id), 'tab A came back signed in; keel minted T2 (its id recorded)');
  check((await kept(a)) === t2?.token, 'Lantern holds T2');
  await a.waitForTimeout(4000);
  const s1 = await alive(t1.token);
  const s2 = await alive(t2.token);
  check(s1 === 401, `the replaced T1 no longer works (GET /account ${s1})`);
  check(s2 === 200, `T2 works (GET /account ${s2})`);
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
} catch (e) {
  check(false, `the walk ran through: ${String(e).split('\n')[0]}`);
} finally {
  await b.close().catch(() => {});
  await teardown();
}
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
