// The keyboard over a sheet (the Captain's phone, h43 #4293: Save was hidden). Emulation opens no
// keyboard, so this plays Safari's: the visible part of the screen (visualViewport) shrinks and the
// page does not. The check: every sheet's buttons stay inside what is visible. Chrome on Android
// shrinks the page itself (`interactive-widget` in index.html): that is a real phone's check.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/keyboard.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { writeWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = process.env.WALK_OUT ?? '';
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const WID = '0f0f0f0f-0000-4000-8000-00000000b0a7';
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'The Keys' }) },
      { path: 'elements/character/mira.json', data: enc({ id: 'b0a70000-0000-4000-8000-000000000001', name: 'Mira', description: 'A smith.' }) },
    ],
    'keys',
  ),
);

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
  // A stand-in visualViewport whose height the walk sets, firing resize as Safari does when the keyboard opens.
  await ctx.addInitScript(() => {
    const vv = new EventTarget();
    Object.assign(vv, { height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    window.__keyboard = (px) => {
      vv.height = window.innerHeight - px;
      vv.dispatchEvent(new Event('resize'));
    };
  });
  const page = await ctx.newPage();
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, (r) => r.abort());
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'keys.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await page.goto(`${BASE}/#/w/${WID}/e/b0a70000-0000-4000-8000-000000000001`);
  await page.waitForSelector('[data-screen="element"] h1');

  // The description's sheet: a text box with Save under it, the Captain's case.
  await page.locator('[data-field="description"], .prose').first().tap();
  await page.waitForSelector('.sheet');
  await page.evaluate(() => window.__keyboard(340));
  await page.waitForTimeout(150);
  const fit = await page.evaluate(() => {
    const visible = window.visualViewport.height;
    const buttons = [...document.querySelectorAll('.sheet button')].map((b) => ({ text: b.textContent.trim(), bottom: Math.round(b.getBoundingClientRect().bottom) }));
    return { visible, buttons };
  });
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-keyboard.png` });
  const save = fit.buttons.find((b) => b.text === 'Save');
  check(tag, !!save && save.bottom <= fit.visible, `Save is above the keyboard (its bottom ${save?.bottom} of ${fit.visible} visible)`);
  check(tag, fit.buttons.every((b) => b.bottom <= fit.visible), `every button of the sheet is (${JSON.stringify(fit.buttons)})`);
  await page.evaluate(() => window.__keyboard(0));
  await page.waitForTimeout(150);
  const back = await page.evaluate(() => Math.round(document.querySelector('.backdrop').getBoundingClientRect().height));
  check(tag, back === (await page.evaluate(() => window.innerHeight)), `with the keyboard gone the sheet's ground is the whole screen again (${back})`);
  await page.locator('.backdrop').click({ position: { x: 5, y: 5 } });

  // Catch (the Captain's smoke, h37 #4359): the keyboard hid its button. While the box is typed in,
  // the button sits above the keyboard, a tap on it still lands, and the note is added.
  await page.goto(`${BASE}/#/w/${WID}/capture`);
  await page.waitForSelector('[data-screen="capture"] textarea');
  const box = page.locator('[data-screen="capture"] textarea');
  await box.tap();
  await box.fill('Old Marta at the well');
  await page.evaluate(() => window.__keyboard(340));
  await page.waitForTimeout(150);
  const catchFit = await page.evaluate(() => {
    const b = document.querySelector('[data-action="catch-save"]').getBoundingClientRect();
    return { visible: window.visualViewport.height, top: Math.round(b.top), bottom: Math.round(b.bottom), text: document.querySelector('[data-action="catch-save"]').textContent };
  });
  if (OUT) await page.screenshot({ path: `${OUT}/${tag}-catch-keyboard.png` });
  check(tag, catchFit.top >= 0 && catchFit.bottom <= catchFit.visible, `Catch's "${catchFit.text}" is above the keyboard (${catchFit.top} to ${catchFit.bottom} of ${catchFit.visible} visible)`);
  await page.locator('[data-action="catch-save"]').tap();
  await page.waitForTimeout(500);
  const kept = await page.locator('[data-part="kept"]').innerText();
  check(tag, /Added to Unsorted: Old Marta at the well/.test(kept), `the tap on it added the note (${kept.trim()})`);
  // The box lets go (the keyboard's Done): a tap on a heading keeps the focus on WebKit, as on iOS.
  await page.evaluate(() => document.activeElement?.blur());
  await page.evaluate(() => window.__keyboard(0));
  await page.waitForTimeout(500);
  const inFlow = await page.evaluate(() => getComputedStyle(document.querySelector('[data-action="catch-save"]')).position);
  check(tag, inFlow !== 'fixed', `with the box let go the button is back in the page (${inFlow})`);
  await browser.close();
}

for (const [engine, tag] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  if (only && only !== tag) continue;
  try {
    await walk(engine, tag);
  } catch (e) {
    check(tag, false, `walk stopped: ${e.message.split('\n')[0]}`);
  }
}
console.log(failures ? `${failures} failed` : 'all ok');
process.exit(failures ? 1 : 0);
