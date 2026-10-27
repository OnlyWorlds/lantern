// Atlas's twin: a world whose key keel no longer knows, as a phone taps it, both engines.
// An owner's account world on a write key keel answers as core/auth.py does for a deleted key since
// keel: 401 invalid_credentials, param null. Checks: the home names the cause, never asks for a
// PIN, and offers a new key; Put in a new key refuses a key for another world in the sheet; Make a
// new key mints one from the account and the world reads again on it, the copy kept.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/keyrenew.mjs [webkit|chromium]
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
const WID = '0f0f0f0f-0000-4000-8000-00000000a198';
const OLD = 'ow_w_' + 'o'.repeat(28) + 'OOOO';
const NEW = 'ow_w_' + 'n'.repeat(28) + 'NNNN';
const OTHER = 'ow_w_' + 'x'.repeat(28) + 'XXXX';
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'Kessel' }) },
      { path: 'elements/character/ada.json', data: enc({ id: 'a1980000-0000-4000-8000-000000000001', name: 'Ada' }) },
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

const storedKey = (page) =>
  page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const g = r.result.transaction(['worlds']).objectStore('worlds').get(id);
          g.onsuccess = () => {
            r.result.close();
            res(g.result?.apiKey ?? null);
          };
        };
      }),
    WID,
  );

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled|status of 401/i.test(m.text()) && errors.push('console: ' + m.text()));
  const keel = { live: new Set(), mints: 0, pinAsked: 0 };
  const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    if (path === '/account/worlds') return r.fulfill(json(200, { data: [{ id: WID, name: 'Kessel', role: 'owner', public_read: false, keys: [] }] }));
    if (path === `/account/worlds/${WID}/keys` && req.method() === 'POST') {
      keel.mints++;
      keel.live.add(NEW);
      return r.fulfill(json(201, { id: 'k-new', last4: 'NNNN', scope: 'WRITE', name: '', revoked: false, key: NEW }));
    }
    const key = req.headers()['api-key'] ?? '';
    if (key === OTHER && path === '/world') return r.fulfill(json(200, { id: '99999999-0000-4000-8000-000000000000', name: 'Elsewhere' }));
    if (!keel.live.has(key)) return r.fulfill(json(401, { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'No valid API-Key.', param: null } }));
    if (path === '/world') return r.fulfill(json(200, { id: WID, name: 'Kessel' }));
    if (path === '/changes') return r.fulfill(json(200, { cursor: '1:0:0', changes: [], has_more: false, head: 1, epoch: null }));
    if (path === '/me') return r.fulfill(json(200, { role: 'owner' }));
    return r.abort();
  });

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'walk.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await idb(page, 'worlds', WID, { kind: 'online', apiKey: OLD, keyKind: 'write', role: 'owner' });
  await idb(page, 'kv', 'accountToken', 'ow_a_walk');
  await page.goto(`${BASE}/?online#/w/${WID}`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });

  const banner = page.locator('.banner', { hasText: 'no longer knows this world\'s key' });
  await banner.waitFor({ timeout: 15000 });
  check(tag, /deleted there, or you were removed from it/.test(await banner.innerText()), 'the home names the cause keel gave');
  check(tag, (await page.getByRole('button', { name: /^Enter (your )?PIN/ }).count()) === 0, 'no PIN is asked for a dead key');
  check(tag, (await banner.getByRole('button', { name: 'Make a new key' }).count()) === 1 && (await banner.getByRole('button', { name: 'Put in a new key' }).count()) === 1, 'both ways to a new key are offered');
  await page.screenshot({ path: `${OUT}/keyrenew-${tag}-01-home.png` });

  await banner.getByRole('button', { name: 'Put in a new key' }).tap();
  const sheet = page.locator('[role=dialog]');
  await sheet.waitFor();
  await sheet.locator('input[aria-label="The new key"]').fill(OTHER);
  await sheet.getByRole('button', { name: 'Use this key' }).tap();
  await page.waitForFunction(() => document.querySelector('[role=dialog] .error')?.textContent, null, { timeout: 8000 });
  check(tag, /That key is for another world, "Elsewhere"/.test(await sheet.locator('.error').innerText()), 'a key for another world is refused in the sheet');
  check(tag, (await storedKey(page)) === OLD, 'and nothing changed');
  await page.screenshot({ path: `${OUT}/keyrenew-${tag}-02-refused.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 5000 }).catch(() => {});
  if (await sheet.count()) await page.locator('.sheet-backdrop, .backdrop').first().tap({ position: { x: 10, y: 10 } }).catch(() => {});

  await page.getByRole('button', { name: 'Make a new key' }).tap();
  await page.waitForFunction(() => /has a new key/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 10000 });
  check(tag, keel.mints === 1, 'one key made from the account');
  check(tag, (await storedKey(page)) === NEW, 'the new key is the world\'s');
  await page.waitForSelector('[data-screen="home"]', { timeout: 15000 });
  await page.waitForTimeout(800);
  check(tag, (await page.locator('.banner', { hasText: 'key' }).count()) === 0, 'the refusal is gone once the world reads on the new key');
  // The home prints a type's tile and its count, never the names (a first check read "Ada").
  const tile = page.getByRole('button', { name: /Characters/ }).or(page.locator('a', { hasText: 'Characters' }));
  check(tag, (await tile.count()) > 0 && /1/.test(await tile.first().innerText()), 'the copy on the phone is still there (Characters 1)');
  await page.screenshot({ path: `${OUT}/keyrenew-${tag}-03-renewed.png` });
  check(tag, errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await browser.close();
}

if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
