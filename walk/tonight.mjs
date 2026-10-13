// Tonight's cast (h37 #4061, #4072): keep a handful of a world's elements for a session from their
// pages; they lead the world's home in the order kept; let one go from its page, clear the list from
// the home; another world on the phone keeps its own list.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/tonight.mjs [webkit|chromium]
import './guard.mjs';
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
const W1 = '0f0f0f0f-0000-4000-8000-00000000c0a1';
const W2 = '0f0f0f0f-0000-4000-8000-00000000c0a2';
const ADA = 'c0a10000-0000-4000-8000-000000000001';
const INN = 'c0a10000-0000-4000-8000-000000000002';
const zipOf = (wid, name, els) =>
  Buffer.from(
    writeWorldFile(
      [{ path: 'world.json', data: enc({ id: wid, name }) }, ...els.map(([type, id, n]) => ({ path: `elements/${type}/${id.slice(-4)}.json`, data: enc({ id, name: n }) }))],
      name,
    ),
  );

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  const open = async (buffer) => {
    await page.goto(`${BASE}/#/worlds`);
    await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
    await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'w.zip', mimeType: 'application/zip', buffer });
    await page.waitForSelector('[data-screen="home"] .type-tile', { timeout: 30000 });
  };
  await open(zipOf(W2, 'Other world', [['character', 'c0a20000-0000-4000-8000-000000000001', 'Cy']]));
  await open(zipOf(W1, 'Game night', [['character', ADA, 'Ada'], ['location', INN, 'The Gull Inn'], ['character', 'c0a10000-0000-4000-8000-000000000003', 'Bo']]));
  check(tag, (await page.locator('[data-part=tonight]').count()) === 0, 'nothing kept: no Tonight on the home');

  const keepOn = async (id) => {
    await page.goto(`${BASE}/#/w/${W1}/e/${id}`);
    const b = page.locator('[data-action=tonight]');
    await b.waitFor();
    await b.tap();
    await page.waitForFunction(() => document.querySelector('[data-action=tonight]')?.getAttribute('aria-pressed') === 'true');
    return b.innerText();
  };
  check(tag, (await keepOn(INN)) === 'Kept for tonight', 'the page says it is kept');
  await keepOn(ADA);
  await page.goto(`${BASE}/#/w/${W1}`);
  const cast = () => page.$$eval('[data-part=tonight] .el-row b', (bs) => bs.map((b) => b.textContent));
  await page.waitForSelector('[data-part=tonight]');
  check(tag, JSON.stringify(await cast()) === JSON.stringify(['The Gull Inn', 'Ada']), `Tonight leads the home, in the order kept (${JSON.stringify(await cast())})`);
  await page.locator('main').screenshot({ path: `${OUT}/tonight-${tag}-01-home.png` });
  await page.locator('[data-part=tonight] .el-row', { hasText: 'Ada' }).tap();
  await page.waitForFunction(() => /Ada/.test(document.querySelector('.el-head h1')?.textContent ?? ''));
  await page.locator('[data-action=tonight]').tap();
  await page.waitForFunction(() => document.querySelector('[data-action=tonight]')?.getAttribute('aria-pressed') === 'false');
  await page.goto(`${BASE}/#/w/${W1}`);
  await page.waitForSelector('[data-part=tonight]');
  check(tag, JSON.stringify(await cast()) === JSON.stringify(['The Gull Inn']), 'let go from its page, it leaves the list');

  await page.goto(`${BASE}/#/w/${W2}`);
  await page.waitForSelector('[data-screen="home"] .type-tile');
  check(tag, (await page.locator('[data-part=tonight]').count()) === 0, 'another world keeps its own list');

  await page.goto(`${BASE}/#/w/${W1}`);
  await page.locator('[data-action=clear-tonight]').tap();
  await page.waitForFunction(() => !document.querySelector('[data-part=tonight]'));
  check(tag, true, 'Clear the list empties it');
  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'chromium');
if (only !== 'chromium') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
