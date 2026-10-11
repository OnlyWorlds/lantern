// Shared from another app, as Android's share sheet does it: the start URL opened with title,
// text and url in its query (the manifest's GET share_target). Both engines.
// Run: npm run build && (npx vite preview &) && node walk/share.mjs [webkit|chromium]
import { chromium, webkit, devices } from 'playwright';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const SHARE = `${BASE}/?title=${encodeURIComponent('Rope')}&text=${encodeURIComponent('Buy rope at the docks https://example.com/rope')}&url=${encodeURIComponent('https://example.com/rope')}`;
const NOTE = 'Rope\nBuy rope at the docks https://example.com/rope';

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName] })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // 1. No world takes changes: say how to get one
  await page.goto(SHARE);
  await page.waitForSelector('[data-screen="share"]');
  check(tag, /No world here takes changes/.test(await page.locator('main').innerText()), 'with no world, the share screen says how to get one');
  check(tag, (await page.evaluate(() => location.search)) === '', `the address loses the share (${await page.evaluate(() => location.href)})`);

  // 2. One world on this phone: straight to its catch screen, the note in it
  await page.locator('a', { hasText: 'Start a world on this phone' }).tap();
  await page.waitForSelector('[data-screen="new-world"]');
  await page.locator('input[aria-label="World name"]').fill('Market');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.goto(SHARE);
  await page.waitForSelector('[data-screen="capture"]');
  const text = await page.locator('textarea').inputValue();
  check(tag, text === NOTE, `one world: its catch screen holds the note ${JSON.stringify(text)}`);
  await page.getByRole('button', { name: /Keep it in Unsorted/ }).tap();
  await page.waitForSelector('[data-screen="element"] h1');
  check(tag, (await page.locator('[data-screen="element"] h1').innerText()) === 'Rope', 'kept, named by its first line');

  // 3. A reload does not catch it again
  await page.reload();
  await page.waitForSelector('main[data-screen]');
  check(tag, (await page.evaluate(() => document.querySelector('main').dataset.screen)) === 'element', 'a reload stays on the element');

  // 4. Two worlds: a choice, then the note in the chosen one
  await page.goto(`${BASE}/#/new`);
  await page.waitForSelector('[data-screen="new-world"]');
  await page.locator('input[aria-label="World name"]').fill('Harbour');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.goto(SHARE);
  await page.waitForSelector('[data-screen="share"] .choice');
  const choices = await page.locator('.choice b').allInnerTexts();
  check(tag, choices.join(',') === 'Harbour,Market', `two worlds to choose from: ${choices.join(', ')}`);
  await page.locator('.choice', { hasText: 'Harbour' }).tap();
  await page.waitForSelector('[data-screen="capture"]');
  check(tag, (await page.locator('textarea').inputValue()) === NOTE, 'the chosen world gets the note');
  // Back to the share screen and on: the note is caught once, not carried into a later catch.
  await page.goto(`${BASE}/#/worlds`);
  await page.locator('.world-card', { hasText: 'Market' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.locator('.fab').tap();
  await page.waitForSelector('[data-screen="capture"]');
  check(tag, (await page.locator('textarea').inputValue()) === '', 'a later catch starts empty');

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
