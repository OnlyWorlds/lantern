// Before now (h37 #4061, #4072): a world file with a clock (now Year 453) and Events opens on this
// phone; its home offers "Before now"; the list runs in order, the now line between what has happened
// and what has not, an Event under way says so, an undated one stays reachable, nothing spills at 320.
// A world with no Event offers no list.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/time.mjs [webkit|chromium]
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
const wid = '0f0f0f0f-0000-4000-8000-0000000071e0';
const events = [
  ['The flood', 460],
  ['The founding', 10],
  ['The siege', 400, 410],
  ['The crowning', 453],
  ['The long war', 440, 470],
  ['A rumour'],
];
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: wid, name: 'Time walk', time_current: 453, time_basic_unit: 'Year' }) },
      ...events.map(([name, start, end], i) => ({
        path: `elements/event/e${i}.json`,
        data: enc({ id: `071e0000-0000-4000-8000-00000000000${i}`, name, start_date: start, end_date: end }),
      })),
      { path: 'elements/character/ada.json', data: enc({ id: '071e0000-0000-4000-8000-0000000000c1', name: 'Ada' }) },
    ],
    'time-walk',
  ),
);
const noEvents = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: '0f0f0f0f-0000-4000-8000-0000000071e1', name: 'Quiet walk' }) },
      { path: 'elements/character/bo.json', data: enc({ id: '071e0000-0000-4000-8000-0000000000c2', name: 'Bo' }) },
    ],
    'quiet-walk',
  ),
);

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  const open = async (buffer, name) => {
    await page.goto(`${BASE}/#/worlds`);
    await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
    await page.locator('input[aria-label="A world file"]').setInputFiles({ name, mimeType: 'application/zip', buffer });
    await page.waitForSelector('[data-screen="home"] .type-tile', { timeout: 30000 });
  };

  await open(noEvents, 'quiet-walk.zip');
  check(tag, (await page.locator('[data-action=before-now]').count()) === 0, 'a world with no Event offers no list');

  await open(zip, 'time-walk.zip');
  const entry = page.locator('[data-action=before-now]');
  check(tag, /up to Year 453/.test(await entry.innerText()), `the home offers it, with the now (${JSON.stringify(await entry.innerText())})`);
  await entry.tap();
  await page.waitForSelector('[data-screen="time"] .now-line');
  const names = (part) => page.$$eval(`[data-part=${part}] .el-row b`, (bs) => bs.map((b) => b.textContent));
  check(tag, JSON.stringify(await names('before')) === JSON.stringify(['The founding', 'The siege', 'The long war', 'The crowning']), `before now, in order (${JSON.stringify(await names('before'))})`);
  check(tag, JSON.stringify(await names('after')) === JSON.stringify(['The flood']), `after now (${JSON.stringify(await names('after'))})`);
  check(tag, JSON.stringify(await names('undated')) === JSON.stringify(['A rumour']), 'an undated Event stays reachable');
  const order = await page.evaluate(() => {
    const line = document.querySelector('.now-line').getBoundingClientRect().top;
    const last = [...document.querySelectorAll('[data-part=before] .el-row')].pop().getBoundingClientRect().bottom;
    const first = document.querySelector('[data-part=after] .el-row').getBoundingClientRect().top;
    return last <= line && line <= first;
  });
  check(tag, order, 'the now line sits between what has happened and what has not');
  const war = await page.locator('[data-part=before] .el-row', { hasText: 'The long war' }).innerText();
  check(tag, /Year 440 to 470/.test(war) && /still going/.test(war), `an Event under way says so (${JSON.stringify(war)})`);
  await page.locator('main').screenshot({ path: `${OUT}/time-${tag}-01-list.png` });
  await page.setViewportSize({ width: 320, height: 780 });
  const spill = await page.evaluate(() => [...document.querySelectorAll('[data-screen=time] *')].filter((n) => n.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length);
  check(tag, spill === 0, `nothing spills at 320 (${spill})`);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.locator('[data-part=after] .el-row').first().tap();
  await page.waitForFunction(() => /The flood/.test(document.querySelector('.el-head h1')?.textContent ?? ''));
  check(tag, true, 'a row opens its Event');

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'chromium');
if (only !== 'chromium') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
