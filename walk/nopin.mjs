// #294's walk, P2: a member who joined with no PIN on their account, as a phone taps it, both engines.
// A world file made to look like a member's account world on a read key; keel routed as accounts/api.py
// answers: a member's write key is 409 pin_required until the account has a PIN, the member's keys
// are listed, one is taken back with 204; every other call is cut off. Checks: the home says once why
// it reads; "Read only · why" opens the sheet; "try again" with no PIN says so and changes nothing;
// with a PIN it swaps the key, takes the read key back, and the world opens to change.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/nopin.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile } from '@onlyworlds/sdk';

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
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const WID = '0f0f0f0f-0000-4000-8000-00000000a294';
const READ = 'ow_r_' + 'r'.repeat(26) + 'RRRR';
const WRITE = 'ow_w_' + 'w'.repeat(26) + 'WWWW';
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'Temper walk' }) },
      { path: 'elements/character/kid.json', data: enc({ id: 'a2940000-0000-4000-8000-000000000001', name: 'The Kid' }) },
    ],
    'walk',
  ),
);

const idb = (page, store, key, patch) =>
  page.evaluate(
    ([store, key, patch]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction([store], 'readwrite');
          const st = t.objectStore(store);
          if (store === 'kv') st.put(patch, key);
          else {
            const g = st.get(key);
            g.onsuccess = () => st.put({ ...g.result, ...patch });
          }
          t.oncomplete = () => {
            r.result.close();
            res(true);
          };
          t.onerror = () => rej(t.error);
        };
      }),
    [store, key, patch],
  );

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled/i.test(m.text()) && errors.push('console: ' + m.text()));
  // keel's key ids are UUIDs; a decoy read key of the member's, made elsewhere and listed first, ends in the same four.
  const keel = { hasPin: false, keys: [{ id: 'a2940000-0000-4000-8000-0000000000d0', last4: 'RRRR', scope: 'READ' }, { id: 'a2940000-0000-4000-8000-0000000000a1', last4: 'RRRR', scope: 'READ' }], deleted: [], writeMints: 0 };
  const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, async (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '').replace(/\/+$/, '');
    if (path === `/account/worlds/${WID}/keys` && req.method() === 'POST') {
      keel.writeMints++;
      if (!keel.hasPin) return r.fulfill(json(409, { error: { type: 'invalid_request', code: 'pin_required', message: 'Set an account PIN first.', param: null } }));
      keel.keys.push({ id: 'a2940000-0000-4000-8000-0000000000a2', last4: 'WWWW', scope: 'WRITE' });
      return r.fulfill(json(201, { id: 'a2940000-0000-4000-8000-0000000000a2', last4: 'WWWW', scope: 'WRITE', name: '', revoked: false, key: WRITE }));
    }
    if (path === `/account/worlds/${WID}/keys` && req.method() === 'GET') return r.fulfill(json(200, { data: keel.keys }));
    const del = path.match(/\/keys\/([^/]+)$/);
    if (del && req.method() === 'DELETE') {
      keel.deleted.push(del[1]);
      keel.keys = keel.keys.filter((k) => k.id !== del[1]);
      return r.fulfill({ status: 204, body: '' });
    }
    return r.abort();
  });

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'walk.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await idb(page, 'worlds', WID, { kind: 'online', apiKey: READ, keyKind: 'read', keyMint: { id: 'a2940000-0000-4000-8000-0000000000a1', tail: READ.slice(-8) }, role: 'collaborator', memberRole: 'contributor' });
  await idb(page, 'kv', 'accountToken', 'ow_a_walk');
  // As openAccountWorld leaves it for a world that opened to read for want of a PIN.
  await page.evaluate((id) => sessionStorage.setItem('lantern:no-pin-said:' + id, '1'), WID);
  await page.goto(`${BASE}/?online#/w/${WID}`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });

  const toastText = () => page.locator('.toast').allInnerTexts().then((a) => a.join(' | '));
  await page.waitForTimeout(400);
  check(tag, /You can read Temper walk\. Changing it needs a PIN on your account/.test(await toastText()), 'the home says once why it reads');
  const pill = page.getByRole('button', { name: 'Read only · why' });
  check(tag, (await pill.count()) === 1, 'the pill is a button that says there is a why');
  await page.screenshot({ path: `${OUT}/nopin-${tag}-01-home.png` });
  await pill.tap();
  const sheet = page.locator('[role=dialog]');
  await sheet.waitFor();
  check(tag, /You are a contributor in Temper walk/.test(await sheet.innerText()), 'the sheet names the role and the world');
  check(tag, (await page.locator('.toast').count()) === 0, 'the opening line steps aside for the sheet');
  check(tag, (await sheet.getByRole('link', { name: 'Open Account settings' }).getAttribute('href')) === 'https://www.onlyworlds.com/account/settings', 'Account settings is a link to the right page');
  await page.screenshot({ path: `${OUT}/nopin-${tag}-02-sheet.png` });
  await sheet.getByRole('button', { name: 'I set my PIN: try again' }).tap();
  await page.waitForFunction(() => document.querySelector('[role=dialog] .error')?.textContent, null, { timeout: 8000 });
  check(tag, /no PIN yet/.test(await sheet.locator('.error').innerText()), 'still no PIN: said in the sheet');
  check(tag, keel.deleted.length === 0, 'still no PIN: no key taken back');

  keel.hasPin = true;
  await sheet.getByRole('button', { name: 'I set my PIN: try again' }).tap();
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 8000 });
  await page.waitForSelector('[data-screen="home"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  check(tag, /You can change Temper walk now/.test(await toastText()), 'with a PIN: it says so');
  check(tag, (await page.getByRole('button', { name: 'Read only · why' }).count()) === 0 && (await page.getByText('Read only', { exact: true }).count()) === 0, 'with a PIN: no Read only on the home');
  check(tag, JSON.stringify(keel.deleted) === '["a2940000-0000-4000-8000-0000000000a1"]', `the read key Lantern minted taken back, by its id, the decoy kept (${JSON.stringify(keel.deleted)})`);
  await page.screenshot({ path: `${OUT}/nopin-${tag}-03-writes.png` });
  check(tag, errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await browser.close();
}

if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
