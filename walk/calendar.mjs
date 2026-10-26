// The world's calendar (SDK 4.20, Atlas's kernel): a world file holding one calendar Construct names
// its dates on Before now, the now line, the home's Before now row and an Event's date fields (the
// number kept beside it); a world holding two keeps the numbers with the unit, as Atlas does on a
// device that never chose. The calendar's own field never shows. A version 2 calendar (SDK 4.76, a
// leap rule with exceptions) names 2000's leap day and not 1900's. Keel is cut off.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/calendar.mjs [webkit|chromium]
import './guard.mjs';
// WebKit logs the viewport's interactive-widget key (Android Chrome's keyboard rule) as unknown: harmless.
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile, formatStep } from '@onlyworlds/sdk';

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
const CAL = { version: 1, grain: 'Year', eras: [{ name: 'After the Eruption', abbrev: 'AE', start: 0 }] };
const id = (w, n) => `ca1e000${w}-0000-4000-8000-00000000000${n}`;

/** A world file: a clock at 453, two Events, and `cals` calendar Constructs. */
const world = (w, name, cals) =>
  Buffer.from(
    writeWorldFile(
      [
        { path: 'world.json', data: enc({ id: id(w, 0), name, time_current: 453, time_basic_unit: 'Year' }) },
        { path: 'elements/event/siege.json', data: enc({ id: id(w, 1), name: 'The siege', start_date: 400, end_date: 410 }) },
        { path: 'elements/event/flood.json', data: enc({ id: id(w, 2), name: 'The flood', start_date: 460 }) },
        ...cals.map((c, i) => ({ path: `elements/construct/cal${i}.json`, data: enc({ id: id(w, 5 + i), name: `Calendar ${i + 1}`, supertype: 'calendar', atlas_calendar: c }) })),
      ],
      name,
    ),
  );

const GREG = {
  version: 2, grain: 'day',
  bundles: { months: { names: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], lengths: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] } },
  intercalary: [{ name: 'Leap day', after_month: 2, every_years: 4, except: [100, 400], offset: 1 }],
  eras: [{ name: 'Common Era', abbrev: 'CE', start: 0 }],
};
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** The step of 1 March in `year` (the day after 28 Feb), counted by the proleptic Gregorian rule. */
const mar1 = (year) => { let d = 0; for (let y = 1; y < year; y++) d += leap(y) ? 366 : 365; return d + 31 + 28; };
/** A world file whose one calendar is Gregorian (version 2), its clock at `now`, one Event at `at`. */
const gregWorld = (now, at) =>
  Buffer.from(
    writeWorldFile(
      [
        { path: 'world.json', data: enc({ id: id(3, 0), name: 'Gregorian', time_current: now, time_basic_unit: 'Day' }) },
        { path: 'elements/event/census.json', data: enc({ id: id(3, 1), name: 'The census', start_date: at }) },
        { path: 'elements/construct/cal0.json', data: enc({ id: id(3, 5), name: 'Gregorian', supertype: 'calendar', atlas_calendar: GREG }) },
      ],
      'Gregorian',
    ),
  );

async function open(page, zip, name) {
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
}

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED/i.test(m.text()) && errors.push('console: ' + m.text()));
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, (r) => r.abort());

  // One calendar: its words.
  await open(page, world(1, 'One calendar', [CAL]), 'one');
  const homeText = await page.locator('[data-screen=home]').innerText();
  check(tag, homeText.includes(`up to ${formatStep(CAL, 453)}`), `the home's Before now row names the now (${formatStep(CAL, 453)})`);
  await page.goto(`${BASE}/#/w/${id(1, 0)}/time`);
  await page.waitForSelector('.now-line');
  const nowLine = (await page.locator('.now-line').textContent()).trim();
  check(tag, nowLine === `Now · ${formatStep(CAL, 453)}`, `the now line in the calendar (${nowLine})`);
  const listText = await page.locator('main').innerText();
  check(tag, listText.includes(`${formatStep(CAL, 400)} to ${formatStep(CAL, 410)}`), "an Event's span in the calendar");
  await page.screenshot({ path: `${OUT}/calendar-${tag}-01-before-now.png` });
  await page.goto(`${BASE}/#/w/${id(1, 0)}/e/${id(1, 1)}`);
  await page.waitForSelector('[data-screen=element]');
  const dates = await page.$$eval('[data-part=calendar-date]', (els) => els.map((e) => e.textContent));
  check(tag, JSON.stringify(dates) === JSON.stringify([`${formatStep(CAL, 400)} · 400`, `${formatStep(CAL, 410)} · 410`]), `its date fields name the date beside the number (${JSON.stringify(dates)})`);
  check(tag, !/atlas_calendar|Atlas calendar/i.test(await page.locator('main').innerText()), "the calendar's own field never shows");
  await page.screenshot({ path: `${OUT}/calendar-${tag}-02-event.png` });

  // Two calendars: nothing guessed, the numbers with the unit.
  await open(page, world(2, 'Two calendars', [CAL, { version: 1, grain: 'Year' }]), 'two');
  await page.goto(`${BASE}/#/w/${id(2, 0)}/time`);
  await page.waitForSelector('.now-line');
  check(tag, (await page.locator('.now-line').textContent()).trim() === 'Now · Year 453', 'two calendars: Year 453, nothing guessed');
  check(tag, /2 calendars/.test(await page.locator('[data-part=calendar]').innerText()), 'and Before now says why');
  await page.goto(`${BASE}/#/w/${id(2, 0)}/e/${id(2, 1)}`);
  await page.waitForSelector('[data-screen=element]');
  check(tag, (await page.locator('[data-part=calendar-date]').count()) === 0, 'and the date fields stay numbers');

  // This phone's choice: one of them, kept; then the numbers again.
  await page.goto(`${BASE}/#/w/${id(2, 0)}/time`);
  await page.locator('[data-action=pick-calendar]').tap();
  await page.getByRole('button', { name: /Calendar 1/ }).tap();
  await page.waitForFunction((t) => document.querySelector('.now-line')?.textContent?.trim() === t, `Now · ${formatStep(CAL, 453)}`);
  check(tag, /Dates in\s+Calendar 1/.test(await page.locator('[data-part=calendar]').innerText()), 'Calendar 1 chosen: the now line and the row say so');
  await page.screenshot({ path: `${OUT}/calendar-${tag}-03-chosen.png` });
  await page.goto(`${BASE}/#/w/${id(2, 0)}/e/${id(2, 1)}`);
  await page.waitForSelector('[data-part=calendar-date]');
  check(tag, (await page.locator('[data-part=calendar-date]').first().textContent()) === `${formatStep(CAL, 400)} · 400`, 'kept across screens: the Event page speaks it');
  await page.goto(`${BASE}/#/w/${id(2, 0)}/time`);
  await page.locator('[data-action=pick-calendar]').tap();
  await page.getByRole('button', { name: /^Numbers/ }).tap();
  await page.waitForFunction(() => document.querySelector('.now-line')?.textContent?.trim() === 'Now · Year 453');
  check(tag, true, 'Numbers: back to Year 453');

  // A version 2 calendar (SDK 4.76): Gregorian's leap rule, every 4 years, not every 100, yet every 400.
  // The steps are counted by the rule written out here, the words written by hand: not the SDK's.
  await open(page, gregWorld(mar1(2000), mar1(1900)), 'gregorian');
  await page.goto(`${BASE}/#/w/${id(3, 0)}/time`);
  await page.waitForSelector('.now-line');
  const gNow = (await page.locator('.now-line').textContent()).trim();
  check(tag, gNow === 'Now · Leap day, 2000 CE', `a version 2 calendar: 2000 has its leap day (${gNow})`);
  await page.screenshot({ path: `${OUT}/calendar-${tag}-04-version2.png` });
  await page.goto(`${BASE}/#/w/${id(3, 0)}/e/${id(3, 1)}`);
  await page.waitForSelector('[data-screen=element]');
  const gDates = await page.$$eval('[data-part=calendar-date]', (els) => els.map((e) => e.textContent));
  check(tag, JSON.stringify(gDates) === JSON.stringify([`1 Mar, 1900 CE · ${mar1(1900)}`]), `and 1900 has none (${JSON.stringify(gDates)})`);

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'Pixel 7', 'chromium');
if (only !== 'chromium') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
