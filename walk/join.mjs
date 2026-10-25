// Joining with an invite link (Keel #212), as a phone taps it, both engines. A bad link goes to
// live keel (the real 404). The rest routes keel's join and account answers to a fake shaped by
// keel's tests, since a good link is the owner's to make: shared from a chat, the link opens the
// invite; "Sign in to join" keeps it through the sign-in; already a member is said plainly.
// Run: npm run build && (npx vite preview &) && node walk/join.mjs [webkit|chromium]
import './guard.mjs';
// WebKit logs the viewport's interactive-widget key (Android Chrome's keyboard rule, S404) as unknown: harmless.
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
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
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  // No worker: with one in control, Playwright's WebKit does not route the page's requests, and
  // the fake keel below would be bypassed for the live one (S395). The worker has its own walks.
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  let expect4xx = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !(expect4xx && /Failed to load resource/.test(m.text())) && errors.push(m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/join-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });

  // 1. A bad link, against live keel
  await page.goto(BASE);
  await page.waitForSelector('[data-screen="welcome"]');
  await page.locator('a', { hasText: 'I have an invite link' }).tap();
  await page.waitForSelector('[data-screen="join"]');
  await page.locator('input[aria-label="Invite link"]').fill('https://www.onlyworlds.com/join#ow_j_notarealcode0000');
  expect4xx = true;
  await page.getByRole('button', { name: 'Look at the invite' }).tap();
  await page.waitForFunction(() => document.querySelector('.error')?.textContent, null, { timeout: 15000 });
  const bad = await page.locator('.error').first().innerText();
  check(tag, /does not work/.test(bad), `live keel's 404 is said plainly: ${JSON.stringify(bad)}`);
  await page.locator('input[aria-label="Invite link"]').fill('hello');
  await page.getByRole('button', { name: 'Look at the invite' }).tap();
  check(tag, /not an invite link/.test(await page.locator('.error').first().innerText()), 'text without a code is named as such');

  // 2. The fake keel from here on
  let joinAnswer = json(409, { error: { code: 'already_member', message: 'already' } });
  await page.route('**/api/v2/join/preview', (r) =>
    r.fulfill(json(200, { reader: 'person', world: { name: 'The Reach', description: 'Salt and debts.' }, invited_by: 'Ada', owner_character: null, role: 'guest', with_character: false, expires_at: '2026-10-19T00:00:00+00:00' })),
  );
  await page.route('**/api/v2/account/worlds', (r) => r.fulfill(json(200, { data: [] })));
  // A pasted token is read for which account it is (keel's profile, S470).
  await page.route('**/api/v2/account', (r) => r.fulfill(json(200, { id: 'acc-walk', username: 'walker', email: 'w@example.com', date_joined: null })));
  await page.route('**/api/v2/account/join', (r) => r.fulfill(joinAnswer));

  // Shared from a chat: the message holds the link
  const msg = 'Game on Friday! Join here: https://www.onlyworlds.com/join#ow_j_fromachat';
  await page.goto(`${BASE}/?text=${encodeURIComponent(msg)}`);
  await page.waitForSelector('.invite', { timeout: 15000 });
  const invite = await page.locator('.invite').innerText();
  check(tag, /Ada invites you to The Reach as a player\./.test(invite), `a shared link opens the invite: ${JSON.stringify(invite.split('\n')[0])}`);
  check(tag, /until 19 October/.test(invite), 'it says until when the link works');
  check(tag, (await page.locator('input[aria-label="Invite link"]').inputValue()).includes('ow_j_fromachat'), 'the link is in the field');
  await shot('invite');

  // keel's join page hands the code on in the fragment (Keel #294): a fresh load, then the same
  // link followed from inside the app (a hashchange). Each opens the invite with the code, and
  // the code leaves the address bar, as Atlas's door clears it (its R2).
  for (const [how, url] of [['a fresh load', `${BASE}/?from=keel#/join/ow_j_fromkeel`], ['inside the app', `${BASE}/?from=keel#/join/ow_j_fromkeel2`]]) {
    await page.goto(url);
    await page.waitForFunction((c) => document.querySelector('.invite') && document.querySelector('input[aria-label="Invite link"]')?.value.includes(c), url.split('/').pop(), { timeout: 15000 });
    check(tag, true, `keel's door, ${how}: the invite opens with the code`);
    check(tag, (await page.evaluate(() => location.hash)) === '#/join', `and the code leaves the address bar (${await page.evaluate(() => location.hash)})`);
  }

  // Not signed in: the code waits through the sign-in, and the invite comes back
  await page.getByRole('button', { name: 'Sign in to join' }).tap();
  await page.waitForSelector('[data-screen="signin"]');
  await page.locator('text=I have an account token').tap().catch(() => {});
  const tokenInput = page.locator('input[aria-label="Account token"]');
  await tokenInput.waitFor({ timeout: 5000 });
  await tokenInput.fill('ow_a_' + 'w'.repeat(40));
  await tokenInput.press('Enter');
  await page.waitForSelector('[data-screen="join"] .invite', { timeout: 15000 });
  check(tag, true, 'after the sign-in, the invite is back');
  const joinBtn = page.getByRole('button', { name: 'Join The Reach as walker', exact: true });
  check(tag, (await joinBtn.count()) === 1, 'signed in, the button says Join The Reach as walker (the account, S470)');

  // Already a member (accepting asks no PIN since keel #297, so there is no PIN step to walk)
  await joinBtn.tap();
  await page.waitForFunction(() => [...document.querySelectorAll('.error')].some((e) => /already/.test(e.textContent)), null, { timeout: 10000 });
  check(tag, true, 'already in the world: said plainly');

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
