// The open door, as a phone taps it, both engines, keel played: a link #/open/<world>/element/<id>
// followed signed out waits through the sign-in, the door then names the world and asks, one key is
// made only on Open, and the phone lands on the element. A world already on the phone opens without
// asking; a world the account does not hold, a link cut short and no signal are each said. A pasted
// or shared OnlyWorlds address (the site's link, ow:// text) reaches the same door.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/opendoor.mjs [webkit|chromium]
// The control: the same walk on the build before the door fails at every door check.
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
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

const W = '0aaa0000-0000-4000-8000-0000000000d1';
const E = '0eee0000-0000-4000-8000-0000000000d1';
const OTHER = '0aaa0000-0000-4000-8000-0000000000d2';
const W2 = '0aaa0000-0000-4000-8000-0000000000d3';

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const context = await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  // WebKit on a production origin reports each request this walk aborts as a page error worded "due to access
  // control checks"; Chromium, which reports an unhandled rejection, shows none on the same run.
  page.on('pageerror', (e) => !/due to access control checks/.test(e.message) && errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled|due to access control checks/i.test(m.text()) && errors.push(m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/opendoor-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });
  const screenText = async () => (await page.locator('[data-screen="open"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const hash = () => page.evaluate(() => location.hash);
  const settle = (re) =>
    page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-screen="open"]')?.textContent ?? ''), re.source, { timeout: 8000 }).then(() => true, () => false);

  // keel played: anything not routed below is cut off (the world's own reads after the open).
  const mints = [];
  await page.route('**/api/v2/**', (r) => r.abort());
  await page.route('**/api/v2/account', (r) => r.fulfill(json(200, { id: 'acc-walk', username: 'walker', email: 'w@example.com', date_joined: null })));
  await page.route('**/api/v2/account/worlds', (r) => r.fulfill(json(200, { data: [{ id: W, name: 'Puddleton', role: 'owner' }, { id: W2, name: 'Saltmarsh', role: 'owner' }] })));
  await page.route(`**/api/v2/account/worlds/${W}/keys`, (r) => {
    mints.push(r.request().method());
    return r.fulfill(json(201, { key: 'ow_w_' + 'k'.repeat(40), scope: 'write', id: '0b6f2a4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b' }));
  });

  // 1. Signed out, a link to an element: the ids leave the address bar and the door asks for a sign-in.
  await page.goto(`${BASE}/#/open/${W}/element/${E}`);
  check(tag, await settle(/Sign in to open this world/), `signed out, the door asks for a sign-in (${JSON.stringify(await screenText())})`);
  check(tag, (await hash()) === '#/open', `the ids leave the address bar (${await hash()})`);
  check(tag, mints.length === 0, 'nothing is made on keel');
  await shot('signin');

  // 2. Through the sign-in (a pasted token, the door every engine can walk), the link comes back.
  await page.locator('[data-screen="open"] a', { hasText: 'Sign in' }).tap();
  await page.waitForSelector('[data-screen="signin"]');
  await page.locator('text=I have an account token').tap().catch(() => {});
  const tokenInput = page.locator('input[aria-label="Account token"]');
  await tokenInput.waitFor({ timeout: 5000 });
  await tokenInput.fill('ow_a_' + 'w'.repeat(40));
  await tokenInput.press('Enter');
  check(tag, await settle(/Open Puddleton on this phone\?/), `after the sign-in, the door names the world and asks (${JSON.stringify(await screenText())})`);
  check(tag, mints.length === 0, 'still nothing made on keel before Open');
  await shot('ask');

  // 3. Open, tapped twice at once: one key, and the phone lands on the element.
  await page.evaluate(() => {
    const b = document.querySelector('[data-action="open-world"]');
    b.click();
    b.click();
  });
  const landed = await page.waitForFunction((h) => location.hash === h, `#/w/${W}/e/${E}`, { timeout: 8000 }).then(() => true, () => false);
  check(tag, landed, `Open lands on the element (${await hash()})`);
  await page.waitForTimeout(500);
  check(tag, mints.length === 1 && mints[0] === 'POST', `one key made for two taps (${JSON.stringify(mints)})`);
  await shot('landed');
  // Back from the element stays in the world: its home is under it in history.
  await page.goBack();
  const back = await page.waitForFunction((h) => location.hash === h, `#/w/${W}`, { timeout: 8000 }).then(() => true, () => false);
  check(tag, back, `Back from the element goes to the world's home (${await hash()})`);

  // 4. The world is on the phone now: a link to it opens at once, with no question and no new key.
  await page.goto(`${BASE}/?again#/open/${W}`);
  const home = await page.waitForFunction((h) => location.hash === h, `#/w/${W}`, { timeout: 8000 }).then(() => true, () => false);
  check(tag, home, `a world on the phone opens at once (${await hash()})`);
  check(tag, mints.length === 1, 'and no new key');

  // 4b. Asked about, then put on the phone in another window before Open: Open opens it as it is,
  // with no key made and nothing taken over.
  await page.goto(`${BASE}/?w2#/open/${W2}`);
  check(tag, await settle(/Open Saltmarsh on this phone\?/), 'a second account world is asked about');
  await page.evaluate(
    (id) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction('worlds', 'readwrite');
          t.objectStore('worlds').put({ id, name: 'Saltmarsh', kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'o'.repeat(40), keyKind: 'write', addedAt: new Date().toISOString() });
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    W2,
  );
  await page.locator('[data-action="open-world"]').tap();
  const asIs = await page.waitForFunction((h) => location.hash === h, `#/w/${W2}`, { timeout: 8000 }).then(() => true, () => false);
  check(tag, asIs, `a world put on the phone since the question opens as it is (${await hash()})`);
  const kept = await page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const g = r.result.transaction('worlds').objectStore('worlds').get(id);
          g.onsuccess = () => res(g.result?.apiKey ?? null);
        };
      }),
    W2,
  );
  check(tag, mints.length === 1 && kept === 'ow_w_' + 'o'.repeat(40), `no key made, the copy's own key kept (${mints.length} mints)`);

  // 4c. A pasted OnlyWorlds address (the site's link to an element), from Your worlds: the link screen
  // hands it to the door, which opens the world on the phone at the element, with no new key.
  const SITE = 'https://www.onlyworlds.com/w/';
  const pasteLink = async (text) => {
    await page.goto(`${BASE}/?paste${++n}#/worlds`);
    await page.waitForSelector('[data-screen="worlds"]');
    await page.locator('a', { hasText: 'Open a link' }).tap();
    await page.waitForSelector('[data-screen="join"]');
    await page.locator('input[aria-label="Link"]').fill(text);
    await page.getByRole('button', { name: 'Open the link' }).tap();
  };
  await pasteLink(`${SITE}${W}/character/${E}`);
  const pasted = await page.waitForFunction((h) => location.hash === h, `#/w/${W}/e/${E}`, { timeout: 8000 }).then(() => true, () => false);
  check(tag, pasted, `a pasted site address lands on the element (${await hash()})`);
  check(tag, mints.length === 1, 'and no new key');
  await shot('pasted');
  // The page name in place of the world's id is said in words, and nothing opens.
  await pasteLink(`${SITE}puddleton/character/${E}`);
  const joinErr = () => page.locator('[data-screen="join"] .error').innerText().catch(() => '');
  const slugSaid = await page.waitForFunction(() => /page name/.test(document.querySelector('[data-screen="join"] .error')?.textContent ?? ''), null, { timeout: 5000 }).then(() => true, () => false);
  check(tag, slugSaid && (await hash()) === '#/join', `a world named by its page name is said, nothing opens (${JSON.stringify(await joinErr())})`);
  // An address to a world the account does not hold goes through the door's own question.
  await pasteLink(`Here: ${SITE}${OTHER}.`);
  check(tag, await settle(/not among the worlds of walker/), `a pasted address in a message reaches the door (${JSON.stringify(await screenText())})`);
  // Shared to Lantern from another app (Android's share sheet): the address opens, it is not caught as a note.
  await page.goto(`${BASE}/?title=${encodeURIComponent('Ada')}&text=${encodeURIComponent(`Look at her ${SITE}${W}/character/${E}`)}`);
  const shared = await page.waitForFunction((h) => location.hash === h, `#/w/${W}/e/${E}`, { timeout: 8000 }).then(() => true, () => false);
  check(tag, shared, `a shared address lands on the element (${await hash()})`);

  // 5. A world the account does not hold names the account.
  await page.goto(`${BASE}/?other#/open/${OTHER}`);
  check(tag, await settle(/not among the worlds of walker/), `a world the account does not hold names it (${JSON.stringify(await screenText())})`);

  // 6. A link cut short.
  await page.goto(`${BASE}/?short#/open/0aaa0000-0000-4000`);
  check(tag, await settle(/not complete/), `a link cut short is said (${JSON.stringify(await screenText())})`);

  // 7. No signal, a world not yet here.
  await page.goto(`${BASE}/?offline#/worlds`);
  await page.waitForSelector('[data-screen="worlds"]');
  await context.setOffline(true);
  await page.evaluate((u) => { location.hash = u; }, `#/open/${OTHER}`);
  check(tag, await settle(/needs a connection/), `without signal it says so (${JSON.stringify(await screenText())})`);
  await context.setOffline(false);
  await shot('offline');

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
