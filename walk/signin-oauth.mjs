// Sign in with OnlyWorlds (Keel #515; contract Forge/Notes/2026-10-25-s470-lantern-sign-in-contract.md),
// on the built app with real taps: Playwright serves https://lantern.onlyworlds.com from the preview
// build (as Pages would, /signin/callback answered by / per public/_redirects) and plays keel's
// /signin/authorize (a 302 back with a code and the state the SDK sent, or keel's Cancel) and
// /api/v2/auth/token (the verifier's S256 must equal the challenge). Workers blocked (WebKit routes
// nothing under a worker). What it cannot see: Pages' own rules and headers (Boss's preview read),
// real keel (the live walk), an installed app's round trip (the Captain's phone).
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/signin-oauth.mjs [webkit|chromium]
import './guard.mjs';
import { createHash } from 'node:crypto';
import { chromium, webkit, devices } from 'playwright';

const LOCAL = process.env.LANTERN_URL ?? 'http://localhost:5181';
const PROD = 'https://lantern.onlyworlds.com';
const CALLBACK = `${PROD}/signin/callback`;
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  // keel, as the sheet says it answers.
  const keel = { mode: 'ok', challenge: '', code: 'c0de-' + tag, calls: [], authorize: [] };
  await ctx.route('https://www.onlyworlds.com/**', async (r) => {
    const u = new URL(r.request().url());
    keel.calls.push(`${r.request().method()} ${u.pathname}`);
    if (u.pathname === '/signin/authorize') {
      keel.authorize.push(u);
      keel.challenge = u.searchParams.get('code_challenge');
      const state = u.searchParams.get('state');
      const back = keel.mode === 'cancel' ? `${CALLBACK}?error=access_denied&state=${state}` : `${CALLBACK}?code=${keel.code}&state=${state}`;
      // keel answers with a 302; Playwright does not route a redirect's next request (it would reach
      // the real host), so the fake hops back from a page instead.
      return r.fulfill({ status: 200, contentType: 'text/html', headers: { 'cache-control': 'no-store' }, body: `<script>location.replace(${JSON.stringify(back)})</script>` });
    }
    if (u.pathname === '/api/v2/auth/token') {
      const b = JSON.parse(r.request().postData());
      const ok = b.code === keel.code && b.client_id === 'lantern' && b.redirect_uri === CALLBACK
        && b64url(createHash('sha256').update(b.code_verifier).digest()) === keel.challenge;
      return ok
        ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'ow_a_' + 'h'.repeat(40), token_type: 'bearer', account: { id: 'acc-1', username: 'wren' } }) })
        : r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid_grant', message: 'x' } }) });
    }
    if (u.pathname === '/api/v2/join/preview') {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reader: 'person', world: { name: 'The Reach', description: 'Salt and debts.' }, invited_by: 'Ada', owner_character: null, role: 'contributor', with_character: false, expires_at: '2030-10-19T00:00:00+00:00' }) });
    }
    if (u.pathname === '/api/v2/account/worlds') {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: '0f0f0f0f-0000-4000-8000-00000000a1a1', name: 'Ilios walk', role: 'owner' }] }) });
    }
    return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found' } }) });
  });
  // lantern.onlyworlds.com from the build, with Pages' one rewrite.
  await ctx.route(`${PROD}/**`, async (r) => {
    const u = new URL(r.request().url());
    const path = u.pathname.replace(/\/$/, '') === '/signin/callback' ? '/' : u.pathname;
    const res = await r.fetch({ url: `${LOCAL}${path}` });
    return r.fulfill({ response: res });
  });
  const kv = (key) => page.evaluate((k) => new Promise((res) => {
    const o = indexedDB.open('lantern');
    o.onsuccess = () => {
      const g = o.result.transaction('kv').objectStore('kv').get(k);
      g.onsuccess = () => res(g.result ?? null);
    };
  }), key);
  const setKv = (key, value) => page.evaluate(([k, v]) => new Promise((res) => {
    const o = indexedDB.open('lantern');
    o.onsuccess = () => {
      const t = o.result.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = () => res(true);
    };
  }), [key, value]);
  const button = () => page.locator('[data-action="signin-onlyworlds"]');

  // L1: not offered off the registered origin; the form's Sign in keeps its fill there.
  await page.goto(`${LOCAL}/#/signin`);
  await page.waitForSelector('[data-screen="signin"]');
  check(tag, (await button().count()) === 0, 'no Sign in with OnlyWorlds on the local build');
  check(tag, await page.locator('form button[type="submit"]').first().evaluate((b) => b.classList.contains('btn-primary')), "the form's Sign in is the main act there");

  // On the registered origin it is the main act, and the form steps down.
  await page.goto(`${PROD}/#/signin`);
  await page.waitForSelector('[data-screen="signin"]');
  check(tag, (await button().count()) === 1 && (await button().evaluate((b) => b.classList.contains('btn-primary'))), 'Sign in with OnlyWorlds first, the main act, on lantern.onlyworlds.com');
  check(tag, await page.locator('form button[type="submit"]').first().evaluate((b) => b.classList.contains('btn-standard')), "the form's Sign in is Standard beside it");
  check(tag, await page.getByText('or with your email or username and password').isVisible(), 'the line before the form');
  check(tag, await page.getByText('It uses the account signed in on onlyworlds.com in this browser.').isVisible(), 'whose account it uses, said before the tap');

  // L2: no signal, no leaving.
  await ctx.setOffline(true);
  await button().tap();
  await page.waitForTimeout(300);
  check(tag, page.url().startsWith(`${PROD}/`) && (await page.locator('[data-part="signin-notice"]').textContent()) === 'Signing in needs signal.', 'offline: the tap says so and stays');
  await ctx.setOffline(false);

  // Cancel at onlyworlds.com: the sentence on the sign-in screen, nothing kept.
  keel.mode = 'cancel';
  keel.calls.length = 0;
  await button().tap();
  await page.waitForSelector('[data-screen="signin"] [data-part="signin-notice"]:not(:empty)', { timeout: 15000 });
  check(tag, (await page.locator('[data-part="signin-notice"]').textContent()) === 'Sign in with OnlyWorlds was cancelled. Nothing changed.', "keel's Cancel is said on the sign-in screen");
  check(tag, (await kv('accountToken')) === null && !keel.calls.includes('POST /api/v2/auth/token'), 'nothing kept, nothing traded');
  check(tag, new URL(page.url()).hash === '#/signin' && !page.url().includes('error='), 'the address is clean');

  // The round trip: the code traded first, the token kept, the address clean, Your worlds.
  keel.mode = 'ok';
  keel.calls.length = 0;
  await button().tap();
  await page.waitForSelector('[data-screen="worlds"]', { timeout: 15000 });
  check(tag, (await page.locator('.toast').textContent().catch(() => '')) === 'Signed in as wren.', 'who it signed in as, said on the return');
  const a = keel.authorize.at(-1);
  check(tag, a.searchParams.get('client_id') === 'lantern' && a.searchParams.get('redirect_uri') === CALLBACK && a.searchParams.get('code_challenge_method') === 'S256', 'authorize names lantern, the registered address, S256');
  const afterAuth = keel.calls.slice(keel.calls.indexOf('GET /signin/authorize') + 1);
  check(tag, afterAuth[0] === 'POST /api/v2/auth/token', `the exchange is the first call to onlyworlds.com on the return (${afterAuth.slice(0, 3).join(', ')})`);
  check(tag, (await kv('accountToken')) === 'ow_a_' + 'h'.repeat(40), 'the token is kept');
  check(tag, new URL(page.url()).pathname === '/' && !/code=|state=/.test(page.url()), `the address is clean (${page.url()})`);
  check(tag, await page.getByText('Ilios walk').first().isVisible(), "Your worlds lists the account's world");
  check(tag, (await page.evaluate(() => localStorage.getItem('ow_signin:lantern'))) === null, 'the record is gone');

  // L9: signed in, no button.
  await page.goto(`${PROD}/#/signin`);
  await page.waitForSelector('[data-screen="signin"]');
  await page.waitForTimeout(300);
  check(tag, (await button().count()) === 0, 'signed in: no Sign in with OnlyWorlds');
  await page.goto(`${PROD}/#/settings`);
  await page.waitForSelector('[data-part="signed-in-as"]');
  check(tag, (await page.locator('[data-part="signed-in-as"]').textContent()).startsWith('Signed in as wren.'), 'Settings names the account');

  // L7: Back after a finished sign-in re-asks onlyworlds.com, which answers a code for a round trip
  // this phone no longer holds: silent, Your worlds, the token unchanged, nothing traded.
  keel.calls.length = 0;
  await page.goto(`${CALLBACK}?code=stale&state=stale`);
  await page.waitForSelector('[data-screen="worlds"]', { timeout: 15000 });
  check(tag, !keel.calls.includes('POST /api/v2/auth/token') && (await kv('accountToken')) === 'ow_a_' + 'h'.repeat(40), 'a return this phone did not start, signed in: silent, nothing traded');

  // A waiting invitation comes back after the round trip.
  await setKv('accountToken', undefined);
  await setKv('pendingJoin', 'ow_j_walkcode0001');
  await page.goto(`${PROD}/#/signin`);
  await page.waitForSelector('[data-action="signin-onlyworlds"]');
  await button().tap();
  await page.waitForFunction(() => location.hash === '#/join', null, { timeout: 15000 });
  check(tag, (await kv('accountToken')) === 'ow_a_' + 'h'.repeat(40), 'an invitation that waited: signed in, then the join screen');
  const joinBtn = page.getByRole('button', { name: /^Join The Reach/ });
  await joinBtn.waitFor({ timeout: 15000 });
  check(tag, (await joinBtn.textContent()) === 'Join The Reach as wren', `the join button names the account (${await joinBtn.textContent()})`);

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

// The S470 gate's G2: a phone whose worker is installed comes back to /signin/callback, and its own
// worker answers from the cache (the build the phone runs), never the host. Chromium only: Playwright
// routes a worker's own requests there, and WebKit routes nothing under a worker.
async function workerWalk() {
  const tag = 'chromium+worker';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  const hostNavs = [];
  let challenge = '';
  await ctx.route('https://www.onlyworlds.com/**', async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/signin/authorize') {
      challenge = u.searchParams.get('code_challenge');
      const back = `${CALLBACK}?code=w0rk&state=${u.searchParams.get('state')}`;
      return r.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back)})</script>` });
    }
    if (u.pathname === '/api/v2/auth/token') {
      const b = JSON.parse(r.request().postData());
      const ok = b.code === 'w0rk' && b64url(createHash('sha256').update(b.code_verifier).digest()) === challenge;
      return ok
        ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'ow_a_' + 'w'.repeat(40), token_type: 'bearer', account: { id: 'acc-2', username: 'bo' } }) })
        : r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid_grant' } }) });
    }
    if (u.pathname === '/api/v2/account/worlds') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await ctx.route(`${PROD}/**`, async (r) => {
    const u = new URL(r.request().url());
    if (r.request().isNavigationRequest()) hostNavs.push(u.pathname);
    const path = u.pathname.replace(/\/$/, '') === '/signin/callback' ? '/' : u.pathname;
    return r.fulfill({ response: await r.fetch({ url: `${LOCAL}${path}` }) });
  });
  await page.goto(`${PROD}/#/signin`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30000 }).catch(() => undefined);
  if (!(await page.evaluate(() => navigator.serviceWorker?.controller != null))) {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30000 });
  }
  check(tag, await page.evaluate(() => navigator.serviceWorker.controller != null), 'the worker controls the page');
  await page.waitForSelector('[data-action="signin-onlyworlds"]');
  hostNavs.length = 0;
  await page.locator('[data-action="signin-onlyworlds"]').tap();
  await page.waitForSelector('[data-screen="worlds"]', { timeout: 20000 });
  check(tag, !hostNavs.some((p) => p.startsWith('/signin')), `the worker answered the callback, the host never saw it (host navigations: ${hostNavs.join(', ') || 'none'})`);
  check(tag, (await page.locator('.toast').textContent().catch(() => '')) === 'Signed in as bo.', 'signed in through the cached shell');
  await browser.close();
}

for (const [engine, tag] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  if (only && only !== tag) continue;
  await walk(engine, tag);
}
if (!only || only === 'chromium') await workerWalk();
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
