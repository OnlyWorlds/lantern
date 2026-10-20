// #347: the quiet agent mark on an element's page, as a phone taps it, both engines.
// A world file made to look like the owner's account world (a write key); keel routed: GET
// /members names the agent seat, every other call is cut off (so an edit stays waiting). Checks:
// an agent seat's last write reads "Last changed by Skeld, an agent" under the kind; MCP says its
// door; a person's write says nothing; the roster is asked once; an edit of mine takes the mark
// away while it waits.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/agentmark.mjs [webkit|chromium]
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
const WID = '0f0f0f0f-0000-4000-8000-00000000a347';
const SEAT = 'b1c2d3e4-0000-4000-8000-000000000001';
const CHAR = 'a3470000-0000-4000-8000-000000000009';
const HOLDEN = 'a3470000-0000-4000-8000-000000000001';
const KID = 'a3470000-0000-4000-8000-000000000002';
const TOAD = 'a3470000-0000-4000-8000-000000000003';
const WRITE = 'ow_w_' + 'm'.repeat(30);
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'The Drowned Coast' }) },
      { path: 'elements/character/holden.json', data: enc({ id: HOLDEN, name: 'Judge Holden', change_seq: 5, changed_by: SEAT, changed_via: 'seat' }) },
      { path: 'elements/character/kid.json', data: enc({ id: KID, name: 'The Kid', change_seq: 6, changed_by: null, changed_via: 'api' }) },
      { path: 'elements/character/toadvine.json', data: enc({ id: TOAD, name: 'Toadvine', change_seq: 7, changed_by: null, changed_via: 'mcp' }) },
      { path: 'elements/character/boatswain.json', data: enc({ id: CHAR, name: 'The Boatswain' }) },
    ],
    'coast',
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
  const ctx = await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled/i.test(m.text()) && errors.push('console: ' + m.text()));
  let rosterCalls = 0;
  let agentHeader = 0;
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, async (r) => {
    const req = r.request();
    if (req.headers()['x-ow-agent'] !== undefined) agentHeader++;
    const path = new URL(req.url()).pathname.replace('/api/v2', '').replace(/\/+$/, '');
    if (req.method() === 'GET' && path === '/members') {
      rosterCalls++;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
        { id: null, kind: 'owner', role: 'owner', character: null, status: 'active' },
        { id: SEAT, kind: 'agent', role: 'contributor', character: CHAR, status: 'active', name: 'Skeld' },
      ] }) });
    }
    return r.abort();
  });

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'coast.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  const mark = page.locator('[data-screen="element"] [data-role="agent-mark"]');
  // On this phone only, the world file's fields from keel mark nothing.
  await page.goto(`${BASE}/#/w/${WID}/e/${HOLDEN}`);
  await page.waitForSelector('[data-screen="element"] .el-head', { timeout: 20000 });
  check(tag, (await mark.count()) === 0, 'a world on this phone only: no mark');
  await patchApp(page, { kind: 'online', apiKey: WRITE, keyKind: 'write', role: 'owner' });
  // A new document, so the world's session is made again from the patched record.
  await page.goto(`${BASE}/?online#/w/${WID}`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });

  const open = async (id) => {
    await page.goto(`${BASE}/#/w/${WID}/e/${id}`);
    await page.waitForSelector('[data-screen="element"] .el-head', { timeout: 20000 });
  };
  await open(KID);
  await page.waitForTimeout(600);
  check(tag, (await mark.count()) === 0, "a person's last write: no mark");
  await open(TOAD);
  check(tag, (await mark.textContent().catch(() => '')) === 'Last changed by an agent, through MCP', 'MCP says its door');
  await open(HOLDEN);
  await page.waitForFunction(() => /Skeld/.test(document.querySelector('[data-role="agent-mark"]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  check(tag, (await mark.textContent().catch(() => '')) === 'Last changed by Skeld, an agent', 'an agent seat is named from the roster');
  await page.screenshot({ path: `${OUT}/agentmark-${tag}-01-seat.png` });
  check(tag, rosterCalls === 1, `the roster asked once (${rosterCalls})`);

  // An edit of mine: the page shows my values and no mark while it waits (keel is cut off).
  await page.locator('[data-screen="element"] .el-head h1').tap();
  const input = page.locator('[role=dialog] input, .sheet input').first();
  await input.waitFor();
  await input.fill('Judge Holden the elder');
  await page.getByRole('button', { name: 'Save' }).tap();
  await page.waitForFunction(() => /the elder/.test(document.querySelector('[data-screen="element"] .el-head h1')?.textContent ?? ''), null, { timeout: 10000 });
  check(tag, (await mark.count()) === 0, 'an edit of mine waiting: no mark');
  await page.screenshot({ path: `${OUT}/agentmark-${tag}-02-edited.png` });
  check(tag, agentHeader === 0, 'no request declared itself an agent');
  check(tag, errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await browser.close();
}

if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
