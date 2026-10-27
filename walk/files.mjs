// keel: the files OnlyWorlds holds on an element, read on its page, as a phone taps it, both
// engines. A world file made to look like the owner's account world; keel routed: GET .../files
// answers for one Character (two files, one an agent's) and an empty list for another, the download
// link answers at the tap, every other call is cut off. Checks: a world on this phone only shows no
// Files; an element with files lists them (label, name, line, an agent's said); one with none shows
// no section; no link is asked before a tap, one at the tap, and the browser gets the file; with no
// signal the tap says so and asks nothing.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/files.mjs [webkit|chromium]
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
const WID = '0f0f0f0f-0000-4000-8000-00000000f393';
const KID = 'f3930000-0000-4000-8000-000000000002';
const HOLDEN = 'f3930000-0000-4000-8000-000000000001';
const WRITE = 'ow_w_' + 'f'.repeat(30);
const MB = 1024 * 1024;
const FILES = [
  { id: 'scan', name: 'Blood Meridian, ch. I-XXIII (scan).pdf', kind: 'pdf', size: 12.4 * MB, label: 'Source',
    added_by: { name: 'crew-walk-a', membership: null, agent: false }, added_at: '2026-10-19T10:00:00Z' },
  { id: 'notes', name: 'The Kid, timeline notes.md', kind: 'md', size: 6 * 1024, label: null,
    added_by: { name: "Quillon's seat", membership: 'm-q', agent: true }, added_at: '2026-10-19T11:00:00Z' },
];
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'The Files Coast' }) },
      { path: 'elements/character/kid.json', data: enc({ id: KID, name: 'The Kid', change_seq: 6 }) },
      { path: 'elements/character/holden.json', data: enc({ id: HOLDEN, name: 'Judge Holden', change_seq: 5 }) },
    ],
    'files',
  ),
);

const patchApp = (page, patch) =>
  page.evaluate(
    ([id, patch]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction(['worlds'], 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, ...patch });
          t.oncomplete = () => {
            r.result.close();
            res(true);
          };
          t.onerror = () => rej(t.error);
        };
      }),
    [WID, patch],
  );

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled/i.test(m.text()) && errors.push('console: ' + m.text()));
  const links = [];
  let fileHits = 0;
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (url.host === 'files.onlyworlds.com') {
      fileHits++;
      return r.fulfill({ status: 200, headers: { 'Content-Disposition': 'attachment; filename="scan.pdf"', 'Content-Type': 'application/pdf' }, body: '%PDF-1.4 walk' });
    }
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    if (req.method() === 'GET' && path === `/character/${KID}/files`) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: FILES }) });
    if (req.method() === 'GET' && path === `/character/${HOLDEN}/files`) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    const dl = path.match(/^\/character\/[^/]+\/files\/([^/]+)\/download$/);
    if (req.method() === 'GET' && dl) {
      links.push(dl[1]);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://files.onlyworlds.com/x/scan.pdf', exp: 0, name: 'scan.pdf', kind: 'pdf', size: 13 }) });
    }
    return r.abort();
  });

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'files.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  const section = page.locator('[data-screen="element"] [data-section="files"]');
  const open = async (id) => {
    await page.goto(`${BASE}/#/w/${WID}/e/${id}`);
    await page.waitForSelector('[data-screen="element"] .el-head', { timeout: 20000 });
  };
  await open(KID);
  await page.waitForTimeout(800);
  check(tag, (await section.count()) === 0, 'a world on this phone only: no Files');
  await patchApp(page, { kind: 'online', apiKey: WRITE, keyKind: 'write', role: 'owner' });
  await page.goto(`${BASE}/?online#/w/${WID}`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });

  await open(KID);
  await section.waitFor({ timeout: 10000 }).catch(() => {});
  const rows = section.locator('[data-file-id]');
  check(tag, (await rows.count()) === 2, `two files listed (${await rows.count()})`);
  const scan = section.locator('[data-file-id="scan"]');
  const scanText = ((await scan.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  check(tag, /^Source/.test(scanText) && scanText.includes('pdf · 12.4 MB · added by crew-walk-a · 2026-10-19'), `the scan's row: "${scanText}"`);
  const notesText = ((await section.locator('[data-file-id="notes"]').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  check(tag, /^File/.test(notesText) && notesText.includes('· an agent'), `an agent's file says so: "${notesText}"`);
  await scan.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/files-${tag}-01-list.png` });
  check(tag, links.length === 0, 'no link asked before a tap');
  const got = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await scan.locator('[data-action="download-file"]').tap();
  const d = await got;
  // Playwright's WebKit on Windows fetches an attachment without a download event: there the proof is
  // the file host asked once with Lantern still on the page; the browser download is Chromium's proof.
  const stayed = (await page.locator('[data-screen="element"]').count()) === 1;
  const came = tag === 'webkit' ? fileHits === 1 && stayed : !!d && stayed;
  check(tag, links.join() === 'scan' && came, `one link at the tap, the file fetched, the page kept (${links.join()}, host ${fileHits}, ${d ? d.suggestedFilename() : 'no download event'})`);

  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  await scan.locator('[data-action="download-file"]').tap();
  await page.waitForTimeout(500);
  const said = await page.locator('.toast').allTextContents().catch(() => []);
  check(tag, said.some((t) => /Files open with signal/.test(t)) && links.length === 1, `no signal: said, nothing asked (${JSON.stringify(said)})`);
  await ctx.setOffline(false);

  await open(HOLDEN);
  await page.waitForTimeout(1000);
  check(tag, (await section.count()) === 0, 'an element with no files: no section');
  check(tag, errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await browser.close();
}

if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
