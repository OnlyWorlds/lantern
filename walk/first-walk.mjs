// The Captain's first phone walk (h37 #3552, 2026-10-12), each thing he hit walked as fixed, on a
// world on this phone: Add to home screen does something; Catch makes a Character at once and
// opens it with its empty fields; a linked field changes from its pencil while its chip still
// opens the place; a picture added after the element was made (camera or gallery); the tab bar on
// every screen, World going home; Ask says why it gives no sentence.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/first-walk.mjs [webkit|chromium]
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;

function check(tag, ok, what) {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/first-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });
  const screen = () => page.evaluate(() => document.querySelector('main')?.dataset.screen ?? '?');

  // 1. Add to home screen is a button, and it does something (here: no browser dialog, so the steps).
  await page.goto(`${BASE}/#/welcome`);
  await page.waitForSelector('[data-screen="welcome"]');
  await page.locator('[data-action=install]').tap();
  await page.waitForSelector('.sheet');
  const steps = await page.locator('.sheet .steps li').allInnerTexts();
  check(tag, steps.length === 2, `the install button opens the steps (${JSON.stringify(steps[0] ?? '')})`);
  await shot('install-steps');
  await page.locator('.sheet').getByRole('button', { name: 'Got it' }).tap();
  await page.goto(`${BASE}/#/settings`);
  // Settings draws after the storage question, which WebKit answers slowly.
  await page.waitForSelector('[data-screen="settings"] [data-action=install]', { timeout: 5000 }).catch(() => {});
  check(tag, (await page.locator('[data-action=install]').count()) === 1, 'Settings keeps the install button');

  // 2. A world on this phone; Catch from the tab bar makes a Location, then a Character.
  await page.goto(`${BASE}/#/new`);
  await page.locator('input[aria-label="World name"]').fill('First walk');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  const catchTab = page.locator('.tabbar [data-tab=catch]');
  check(tag, (await catchTab.count()) === 1, 'the tab bar has Catch');
  await catchTab.tap();
  await page.waitForSelector('[data-screen="capture"]');
  check(tag, (await page.locator('[data-kind=Unsorted][aria-checked=true]').count()) === 1, 'Unsorted is chosen first');
  check(tag, (await page.locator('[data-photo=camera][capture]').count()) === 1 && (await page.locator('[data-photo=gallery]:not([capture])').count()) === 1, 'Camera opens the camera, Gallery the picker');
  await page.locator('textarea').fill('Lower Town');
  await page.locator('[data-kind=location]').tap();
  const saveLabel = await page.locator('button[type=submit]').innerText();
  check(tag, saveLabel === 'Make the location', `the button says what it makes (${JSON.stringify(saveLabel)})`);
  await shot('catch-location');
  await page.locator('button[type=submit]').tap();
  await page.waitForSelector('[data-screen="element"] .el-head');
  const kind1 = await page.locator('.el-head .muted').innerText();
  check(tag, /^Location/.test(kind1), `a Location was made (${JSON.stringify(kind1)})`);
  check(tag, (await page.locator('.frow[data-field=description]').count()) === 1, 'made from a one-line note, it offers a description among its empty fields');

  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  await page.locator('textarea').fill('Mira Vell\nA smith in the lower town.');
  await page.locator('[data-kind=character]').tap();
  await page.locator('button[type=submit]').tap();
  await page.waitForSelector('[data-screen="element"] .el-head');
  check(tag, (await page.locator('.el-head h1').innerText()).startsWith('Mira Vell'), 'the first line is the name');
  check(tag, (await page.locator('.prose').innerText()).startsWith('A smith in the lower town.'), 'the rest is the description');
  const emptyRows = await page.locator('.fields .frow[data-field]').count();
  check(tag, emptyRows > 5, `made from Catch, it opens with its empty fields showing (${emptyRows} rows)`);  check(tag, (await page.locator('.tabbar').count()) === 1, 'the element page has the tab bar');
  await shot('character-fill');

  // 3. The location field: empty, the row opens the sheet; set, the pencil does, and the chip opens the place.
  await page.locator('.frow[data-field=location]').tap();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet .el-row', { hasText: 'Lower Town' }).tap();
  await page.waitForSelector('.frow[data-field=location] .link-chip');
  const pencil = page.locator('.frow[data-field=location] .edit-btn');
  check(tag, (await pencil.count()) === 1, 'a set link field has its pencil');
  await pencil.tap();
  await page.waitForSelector('.sheet');
  check(tag, (await screen()) === 'element' && (await page.locator('.sheet h2').innerText()) === 'Location', 'the pencil opens the link sheet, not the place');
  await shot('pencil-sheet');
  await page.locator('.sheet').getByRole('button', { name: 'Cancel' }).tap();
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  await page.locator('.frow[data-field=location] .link-chip').tap();
  await page.waitForFunction(() => /Lower Town/.test(document.querySelector('.el-head h1')?.textContent ?? ''));
  check(tag, true, 'the chip still opens the place');
  await page.goBack();
  await page.waitForFunction(() => /Mira/.test(document.querySelector('.el-head h1')?.textContent ?? ''));

  // 4. A picture after the element was made, from the gallery.
  await page.locator('[data-action=picture]').tap();
  await page.waitForSelector('.sheet [data-photo=gallery]', { state: 'attached' });
  const png = await page.screenshot({ type: 'png' });
  await page.locator('.sheet [data-photo=gallery]').setInputFiles({ name: 'mira.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => /url\("data:image/.test(document.querySelector('.avatar')?.style.backgroundImage ?? ''), null, { timeout: 15000 });
  check(tag, (await page.locator('img.picture').count()) === 1, 'the picture shows on the page');
  check(tag, (await page.locator('[data-action=picture]').innerText()).trim() === 'Change the picture','the button now offers to change it');
  await shot('picture');
  await page.locator('[data-action=picture]').tap();
  await page.locator('.sheet').getByRole('button', { name: 'Remove the picture' }).tap();
  await page.waitForFunction(() => !document.querySelector('img.picture'));
  check(tag, true, 'Remove the picture removes it');

  // 5. World goes home from anywhere; Ask says why there is no sentence.
  await page.locator('.tabbar [data-tab=world]').tap();
  await page.waitForSelector('[data-screen="home"] .type-tile');
  check(tag, true, 'World in the tab bar lands on the world home');
  await page.locator('.tabbar [data-tab=ask]').tap();
  await page.waitForSelector('[data-screen="ask"]');
  await page.locator('[data-screen="ask"] input').fill('the king of the north');
  await page.waitForSelector('[data-answer=none]');
  const why = await page.locator('[data-why]').getAttribute('data-why');
  check(tag, why === 'local', `Ask says why a world on this phone gives no sentence (${why})`);
  await shot('ask-why');
  // Typing hides the tab bar (the keyboard would carry it); leaving the field brings it back.
  await page.locator('[data-screen="ask"] input').focus();
  check(tag, !(await page.locator('.tabbar').isVisible()), 'typing hides the tab bar');
  await page.locator('[data-screen="ask"] input').blur();
  check(tag, await page.locator('.tabbar').isVisible(), 'and it comes back');

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
