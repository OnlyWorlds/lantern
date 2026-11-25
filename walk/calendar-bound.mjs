// A calendar past Lantern's bound names no dates: a world file whose one calendar holds 300 eras shows its
// now line and its Events in the unit ("Year 453"), at once, while the same world with 3 eras names them.
// On a build before the bound (the control), the 300-era world's now line is named by the calendar.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/calendar-bound.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { writeWorldFile, formatStep, readCalendarConfig } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const id = (w, n) => `ca1eb00${w}-0000-4000-8000-00000000000${n}`;
const eras = (n) => ({ version: 1, grain: 'Year', eras: Array.from({ length: n }, (_, i) => ({ name: `Age ${i}`, abbrev: `A${i}`, start: i * 10 })) });
const world = (w, name, cal) =>
  Buffer.from(
    writeWorldFile(
      [
        { path: 'world.json', data: enc({ id: id(w, 0), name, time_current: 453, time_basic_unit: 'Year' }) },
        { path: 'elements/event/siege.json', data: enc({ id: id(w, 1), name: 'The siege', start_date: 400 }) },
        { path: 'elements/construct/cal.json', data: enc({ id: id(w, 5), name: 'The count', supertype: 'calendar', atlas_calendar: cal }) },
      ],
      name,
    ),
  );

async function nowLineOf(page, zip, name, w) {
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await page.goto(`${BASE}/#/w/${id(w, 0)}/time`);
  await page.waitForSelector('.now-line', { timeout: 30000 });
  return (await page.locator('.now-line').textContent()).trim();
}

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' })).newPage();
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, (r) => r.abort());
  const small = eras(3);
  const named = formatStep(readCalendarConfig(small), 453);
  const smallLine = await nowLineOf(page, world(1, 'Three ages', small), 'three', 1);
  check(tag, smallLine === `Now · ${named}`, `3 eras name the now (${smallLine})`);
  const bigLine = await nowLineOf(page, world(2, 'Three hundred ages', eras(300)), 'many', 2);
  check(tag, bigLine === 'Now · Year 453', `300 eras give the unit (${bigLine})`);
  const list = await page.locator('main').innerText();
  check(tag, list.includes('Year 400'), "an Event's date in the unit");
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'Pixel 7', 'chromium');
if (only !== 'chromium') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAIL` : 'all ok');
process.exitCode = failures ? 1 : 0;
