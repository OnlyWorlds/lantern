// A world's own words for the types (the names profile, schema-dist dist.48): a world file whose
// world.json carries x_names shows Employees on the home's type list, the type screen's heading and
// count, and a supertype's word on an element; one hostile word stays text. The same file without
// x_names is the control: the standard's words, as before. Keel is cut off.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/names.mjs [webkit|chromium]
import './guard.mjs';
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile } from '@onlyworlds/sdk';

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
const HOSTILE = '<img src=x onerror="window.__pwned=1">';
const X_NAMES = {
  version: 1,
  types: { character: { one: 'Employee', many: 'Employees' }, law: { one: HOSTILE, many: HOSTILE } },
  supertypes: { character: { Agent: { one: 'AI agent', many: 'AI agents' } } },
};
const id = (w, n) => `a0e5000${w}-0000-4000-8000-00000000000${n}`;

const world = (w, name, names) =>
  Buffer.from(
    writeWorldFile(
      [
        { path: 'world.json', data: enc({ id: id(w, 0), name, ...(names ? { x_names: names } : {}) }) },
        { path: 'elements/character/ada.json', data: enc({ id: id(w, 1), name: 'Ada' }) },
        { path: 'elements/character/bot.json', data: enc({ id: id(w, 2), name: 'Bot', supertype: 'Agent' }) },
        { path: 'elements/law/leave.json', data: enc({ id: id(w, 3), name: 'Leave policy' }) },
      ],
      name,
    ),
  );

async function open(page, zip, name) {
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
}

async function read(page, tag, w, own) {
  const want = (a, b) => (own ? a : b);
  const home = await page.locator('[data-screen=home]').innerText();
  check(tag, home.includes(want('Employees', 'Characters')), `the home's type list says ${want('Employees', 'Characters')}`);
  await page.screenshot({ path: `${OUT}/names-${tag}-${own ? 'own' : 'std'}-home.png` });
  await page.goto(`${BASE}/#/w/${id(w, 0)}/t/character`);
  await page.waitForTimeout(600);
  const list = await page.locator('main').innerText();
  check(tag, list.includes(want('2 Employees', '2 characters')), `the type screen's count (${want('2 Employees', '2 characters')})`);
  // Bot's row says the world's word for its supertype once (Atlas 1.82.2).
  check(tag, own ? list.includes('AI agent') && !list.includes('AI agent · Agent') : /character · Agent/i.test(list),
    `Bot's row (${want('AI agent, said once', 'character · Agent')})`);
  await page.goto(`${BASE}/#/w/${id(w, 0)}/e/${id(w, 2)}`);
  await page.waitForSelector('[data-screen=element]');
  const el = await page.locator('main').innerText();
  // The world's word for the supertype says it once (Atlas 1.82.2).
  check(tag, own ? el.includes('AI agent') && !el.includes('AI agent · Agent') : el.includes('Character · Agent'),
    `Bot's kind line (${want('AI agent, said once', 'Character · Agent')})`);
  await page.screenshot({ path: `${OUT}/names-${tag}-${own ? 'own' : 'std'}-bot.png` });
  await page.goto(`${BASE}/#/w/${id(w, 0)}/t/law`);
  await page.waitForTimeout(600);
  const pwned = await page.evaluate(() => window.__pwned ?? null);
  const imgs = await page.locator('img[src="x"]').count();
  check(tag, pwned === null && imgs === 0, 'a hostile word stays text');
}

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED/i.test(m.text()) && errors.push('console: ' + m.text()));
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, (r) => r.abort());

  await open(page, world(1, 'Work', X_NAMES), 'work');
  await read(page, tag, 1, true);
  await open(page, world(2, 'Plain', null), 'plain');
  await read(page, tag, 2, false);

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} failed` : 'all ok');
process.exit(failures ? 1 : 0);
