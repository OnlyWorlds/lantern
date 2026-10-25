// Sign out revokes the token Lantern made (S476, Atlas 1.93.0's twin; contract
// `Forge/Notes/2026-10-25-s476-lantern-token-revoke-contract.md`), keel played as S475 probed it:
// a password sign-in mints a token with its id; Sign out sends DELETE /account/tokens/{that id} with
// that token as the bearer and says it is revoked; with keel unreachable it says it could not
// confirm; a pasted token is never revoked and keeps today's line.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/revoke.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const TOKEN_ID = '0b6f2a4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
const TOKEN = 'ow_a_' + 'm'.repeat(36) + 'walk1111';
const PASTED = 'ow_a_' + 'p'.repeat(36) + 'walk2222';

/** A played keel: the password door, the profile, the worlds list, and the revoke route. */
function playKeel(page, keel) {
  const json = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
  return page.route(/^https:\/\/www\.onlyworlds\.com\/api\/v2\//, async (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const method = req.method();
    const bearer = (req.headers()['authorization'] ?? '').replace(/^Bearer /, '');
    if (method === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,PATCH', 'access-control-allow-headers': '*' } });
    if (path === '/auth/app/v1/auth/login') return json(r, 200, { status: 200, data: { user: { username: 'ana' } }, meta: { is_authenticated: true, session_token: 'sess-1' } });
    if (path === '/auth/app/v1/auth/session') return json(r, 401, { status: 401, meta: { is_authenticated: false } });
    if (path === '/account/tokens' && method === 'POST') return json(r, 201, { id: TOKEN_ID, name: 'Lantern on a phone', last4: '1111', token: TOKEN });
    const del = path.match(/^\/account\/tokens\/([^/]+)$/);
    if (del && method === 'DELETE') {
      keel.deletes.push({ id: decodeURIComponent(del[1]), bearer });
      if (keel.unreachable) return r.abort('internetdisconnected');
      return r.fulfill({ status: 204, body: '' });
    }
    if (bearer !== TOKEN && bearer !== PASTED) return json(r, 401, { error: { code: 'invalid_credentials' } });
    if (path === '/account') return json(r, 200, { id: 'acc-ana', username: 'ana' });
    if (path === '/account/worlds') return json(r, 200, { data: [] });
    return json(r, 404, { error: { code: 'not_found' } });
  });
}

async function signOutAndRead(page, tag, shot) {
  await page.goto(`${BASE}/#/settings`);
  const out = page.getByRole('button', { name: 'Sign out', exact: true });
  await out.waitFor();
  await out.tap();
  await page.waitForSelector('.toast');
  await page.waitForTimeout(150);
  const line = (await page.locator('.toast').textContent()).trim();
  await page.screenshot({ path: `${OUT}/revoke-${tag}-${shot}.png` });
  return line;
}

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const keel = { deletes: [], unreachable: false };
  await playKeel(page, keel);

  // 1. A password sign-in, then Sign out: revoked, by the id and with the token.
  const signInByPassword = async () => {
    await page.goto(`${BASE}/#/signin`);
    await page.getByLabel('Email or username').fill('ana');
    await page.getByLabel('Password').fill('right');
    await page.getByRole('button', { name: 'Sign in', exact: true }).tap();
    await page.waitForURL(/#\/worlds/, { timeout: 15000 });
  };
  await signInByPassword();
  const l1 = await signOutAndRead(page, tag, '01-revoked');
  check(tag, JSON.stringify(keel.deletes) === JSON.stringify([{ id: TOKEN_ID, bearer: TOKEN }]), `Sign out sent DELETE by the minted id with that token (${JSON.stringify(keel.deletes)})`);
  check(tag, l1 === "Signed out. Lantern's token is revoked on OnlyWorlds. Worlds already on this phone stay.", `and said it is revoked (${l1})`);

  // 2. keel unreachable: signed out all the same, the line says it could not confirm.
  keel.deletes = [];
  await signInByPassword();
  keel.unreachable = true;
  const l2 = await signOutAndRead(page, tag, '02-kept');
  keel.unreachable = false;
  check(tag, keel.deletes.length >= 1 && keel.deletes.every((d) => d.id === TOKEN_ID), `unreachable: the DELETE was tried (${keel.deletes.length})`);
  check(tag, l2 === "Signed out here. Worlds already on this phone stay. Lantern's token may still work: remove it on onlyworlds.com in Account settings under Account tokens.", `and the line says the token may still work (${l2})`);
  await page.waitForTimeout(3500);
  check(tag, (await page.locator('.toast').count()) === 1, 'and stays past the usual moment, to be read');
  const token = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lantern'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('accountToken'); g.onsuccess = () => res(g.result ?? null); }; }));
  check(tag, token === null, 'and the phone is signed out');

  // 3. A pasted token: never revoked, today's line.
  keel.deletes = [];
  await page.goto(`${BASE}/#/signin`);
  await page.getByText('I have an account token').tap().catch(() => undefined);
  await page.getByLabel('Account token').fill(PASTED);
  await page.getByRole('button', { name: 'Sign in with the token' }).tap();
  await page.waitForURL(/#\/worlds/, { timeout: 15000 });
  const l3 = await signOutAndRead(page, tag, '03-pasted');
  check(tag, keel.deletes.length === 0, `a pasted token: no DELETE (${keel.deletes.length})`);
  check(tag, l3 === 'Signed out. Worlds already on this phone stay.', `and today's line (${l3})`);

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'chromium');
if (only !== 'chromium') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
