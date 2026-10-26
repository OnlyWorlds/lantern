// A player's own notes: on a world whose key only reads (a player's), the
// tab bar's Catch is Note; a note is kept on this phone, listed newest first, shown on the home, and
// removed in two taps; a world that writes keeps Catch. keel is cut off: no write ever goes out.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/notes.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { writeWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const WID = '0f0f0f0f-0000-4000-8000-00000000a07e';
const zip = Buffer.from(
  writeWorldFile([{ path: 'world.json', data: enc({ id: WID, name: 'The Reach' }) }, { path: 'elements/character/mira.json', data: enc({ id: 'a07e0000-0000-4000-8000-000000000001', name: 'Mira' }) }], 'reach'),
);

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // keel cut off (offline mode would cut the local preview off too, with workers blocked); a read
  // the app makes is fine, a write would be a note leaving the phone.
  const sent = [];
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, (r) => {
    if (r.request().method() !== 'GET') sent.push(`${r.request().method()} ${r.request().url()}`);
    return r.abort();
  });

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'reach.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  check(tag, (await page.locator('[data-tab=catch]').innerText()).trim() === 'Catch', 'a world that writes keeps Catch');

  // The same world as a player's: online, a read key, a guest.
  await page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction('worlds', 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, kind: 'online', apiKey: 'ow_r_' + 'p'.repeat(30), keyKind: 'read', role: 'collaborator', memberRole: 'guest' });
          t.oncomplete = () => {
            r.result.close();
            res(true);
          };
        };
      }),
    WID,
  );
  await page.goto(`${BASE}/?player#/w/${WID}`);
  await page.waitForSelector('[data-screen="home"] [data-tab=catch]');
  check(tag, (await page.locator('[data-tab=catch]').innerText()).trim() === 'Note', "a player's tab is Note");
  await page.locator('[data-tab=catch]').tap();
  await page.waitForSelector('[data-screen=notes]');
  for (const t of ['The ferryman lied about the tide.', 'Mira owes Bo a silver coin.']) {
    await page.locator('textarea[aria-label="A note"]').fill(t);
    await page.getByRole('button', { name: 'Save the note' }).tap();
    await page.waitForFunction((x) => [...document.querySelectorAll('.note-card p')].some((p) => p.textContent === x), t);
  }
  const listed = await page.$$eval('.note-card p', (ps) => ps.map((p) => p.textContent));
  check(tag, JSON.stringify(listed) === JSON.stringify(['Mira owes Bo a silver coin.', 'The ferryman lied about the tide.']), `kept, newest first (${JSON.stringify(listed)})`);
  await page.locator('[data-screen=notes]').screenshot({ path: `walk/shots/notes-${tag}-01.png` });
  await page.goto(`${BASE}/?player#/w/${WID}`);
  await page.waitForSelector('[data-action=my-notes]');
  check(tag, /My notes · 2/.test(await page.locator('[data-action=my-notes]').innerText()), 'the home shows them');
  await page.locator('[data-action=my-notes]').tap();
  const rm = page.locator('.note-card').first().locator('[data-action=remove-note]');
  await rm.tap();
  check(tag, /Tap again/.test(await rm.innerText()), 'the first tap on Remove asks');
  await rm.tap();
  await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 1);
  check(tag, true, 'the second removes it');
  check(tag, sent.length === 0, `no write went out (${JSON.stringify(sent)})`);
  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'chromium');
if (only !== 'chromium') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
