// Two pinches from the crew's live walk of the friend rows (S419, Forge/Notes/ui-snapshots/2026-10-16-s419/lwalk):
// an owner's empty online world offers Invite someone (L8 before anything is in it), and Catch says a
// note waits on the PIN, with a way to give it, when the phone holds none (L12). Both engines; keel cut
// off, so nothing is sent.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/owner-empty.mjs [webkit|chromium]
import './guard.mjs';
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

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled/i.test(m.text()) && errors.push(m.text()));
  await page.route('**/api/v2/**', (r) => r.abort());

  await page.goto(`${BASE}/#/new`);
  await page.locator('input[aria-label="World name"]').fill('Empty table');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  const worldId = page.url().match(/#\/w\/([^/?]+)/)[1];
  // The owner's account world, signed in, no PIN on this phone (as first-walk's step 7 makes it).
  await page.evaluate(
    (id) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction('worlds', 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'x'.repeat(40), keyKind: 'write' });
          r.result.transaction('kv', 'readwrite').objectStore('kv').put('ow_a_' + 'w'.repeat(40), 'accountToken');
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    worldId,
  );
  await page.goto(`${BASE}/?owner#/w/${worldId}`);
  await page.waitForSelector('[data-screen="home"]');
  await page.waitForTimeout(800);
  check(tag, /Nothing here yet/.test(await page.locator('[data-screen="home"]').innerText()), 'the world is empty');
  check(tag, (await page.locator('[data-action=invite]').count()) === 1, 'an empty owner\'s world offers Invite someone');
  await page.screenshot({ path: `${OUT}/owner-empty-${tag}-home.png` });

  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  await page.locator('textarea').fill('The ferryman knows');
  await page.getByRole('button', { name: 'Add to Unsorted' }).tap();
  await page.waitForSelector('[data-part="kept"]');
  const kept = await page.locator('[data-part="kept"]').innerText();
  check(tag, /Added to Unsorted: The ferryman knows\. It sends once Lantern has your PIN\./.test(kept), `the note says it waits on the PIN (${JSON.stringify(kept.trim())})`);
  await page.screenshot({ path: `${OUT}/owner-empty-${tag}-kept.png` });
  await page.locator('[data-action=kept-pin]').tap();
  check(tag, await page.locator('input[aria-label="PIN"]').waitFor({ timeout: 5000 }).then(() => true, () => false), 'Enter your PIN opens the PIN sheet');

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
