// The Catch shortcut on the home-screen icon (the manifest's shortcuts; a long press on Android):
// the manifest names it inside Lantern's scope; with no world it says how to get one, with one
// world it opens that world's catch screen, with several it asks which (no shared note rides along).
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/catch.mjs [webkit|chromium]
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
const zipOf = (id, name) => Buffer.from(writeWorldFile([{ path: 'world.json', data: enc({ id, name }) }], name));

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const m = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json();
  const sc = (m.shortcuts ?? []).find((x) => x.name === 'Catch');
  check(tag, !!sc && sc.url.startsWith(m.scope ?? '/'), `the manifest offers Catch inside the scope (${sc?.url})`);

  await page.goto(`${BASE}/#/catch`);
  await page.waitForSelector('[data-screen=share]');
  check(tag, /No world here takes changes yet/.test(await page.locator('main').innerText()), 'no world: it says how to get one');

  const open = async (id, name) => {
    await page.goto(`${BASE}/#/worlds`);
    await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
    await page.locator('input[aria-label="A world file"]').setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zipOf(id, name) });
    await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  };
  await open('0f0f0f0f-0000-4000-8000-0000000ca701', 'Bus ideas');
  await page.goto(`${BASE}/#/catch`);
  await page.waitForSelector('[data-screen=capture]');
  check(tag, page.url().endsWith('/capture'), `one world: straight to its catch screen (${page.url().split('#')[1]})`);

  await open('0f0f0f0f-0000-4000-8000-0000000ca702', 'The Reach');
  await page.goto(`${BASE}/#/catch`);
  await page.waitForSelector('[data-screen=share] .choice');
  const hrefs = await page.$$eval('[data-screen=share] .choice', (as) => as.map((a) => a.getAttribute('href')));
  check(tag, hrefs.length === 2 && hrefs.every((x) => x.endsWith('/capture')), `several: it asks which, and no shared note rides along (${JSON.stringify(hrefs)})`);
  check(tag, (await page.locator('[data-screen=share] h1').innerText()) === 'Catch', 'titled Catch, not Catch this');
  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'chromium');
if (only !== 'chromium') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
