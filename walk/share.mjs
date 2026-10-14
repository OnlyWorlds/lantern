// Shared from another app, as Android's share sheet does it: the start URL opened with title,
// text and url in its query (the manifest's GET share_target). Both engines.
// Run: npm run build && (npx vite preview &) && node walk/share.mjs [webkit|chromium]
import './guard.mjs';
// WebKit logs the viewport's interactive-widget key (Android Chrome's keyboard rule, S404) as unknown: harmless.
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
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
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && errors.push(m.text()));

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
  await page.getByRole('button', { name: /Add to Unsorted/ }).tap();
  // A note stays on Catch now (S404); its page is one tap away.
  await page.locator('[data-action="open-kept"]').tap();
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
  // Walked away from Harbour's catch screen: the share is Harbour's draft now (src/draft.ts), and
  // only Harbour's: a catch in another world starts empty.
  await page.goto(`${BASE}/#/worlds`);
  await page.locator('.world-card', { hasText: 'Market' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  check(tag, (await page.locator('textarea').inputValue()) === '', 'a later catch in another world starts empty');
  await page.goto(`${BASE}/#/worlds`);
  await page.locator('.world-card', { hasText: 'Harbour' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  check(tag, (await page.locator('textarea').inputValue()) === NOTE && /Your note from before/.test(await page.locator('main').innerText()), 'back in Harbour, the walked-away share is its note from before, said as such');
  await page.getByRole('button', { name: 'Clear it' }).tap();

  // 5. A share walked away from: Back from the choice, then a catch in another world starts empty (the gate's case)
  await page.goto(SHARE);
  await page.waitForSelector('[data-screen="share"] .choice');
  await page.locator('[data-screen="share"] .topbar a').tap();
  await page.waitForSelector('[data-screen="worlds"]');
  await page.locator('.world-card', { hasText: 'Market' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  const leaked = await page.locator('textarea').inputValue();
  check(tag, leaked === '', `a share walked away from fills no later note (${JSON.stringify(leaked)})`);

  // 6. A half-typed note, then a share loaded into the open app (Android, no launch_handler): both survive
  await page.locator('textarea').fill('Half a thought about the');
  await page.goto(SHARE);
  await page.waitForSelector('[data-screen="share"] .choice');
  await page.locator('.choice', { hasText: 'Market' }).tap();
  await page.waitForSelector('[data-screen="capture"]');
  const both = await page.locator('textarea').inputValue();
  check(tag, both === `Half a thought about the\n\n${NOTE}`, `the half-typed note comes back, the share under it: ${JSON.stringify(both)}`);
  check(tag, /Your note from before is still here/.test(await page.locator('main').innerText()), 'it says the note is from before');
  await page.getByRole('button', { name: /Add to Unsorted/ }).tap();
  // A note stays on Catch now (S404); its page is one tap away.
  await page.locator('[data-action="open-kept"]').tap();
  await page.waitForSelector('[data-screen="element"] h1');
  await page.goto(`${BASE}/#/worlds`);
  await page.locator('.world-card', { hasText: 'Market' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  check(tag, (await page.locator('textarea').inputValue()) === '', 'once kept, the next catch starts empty');

  // 7. Clear it: the note from before goes, and stays gone
  await page.locator('textarea').fill('Never mind');
  await page.reload();
  await page.waitForSelector('[data-screen="capture"]');
  check(tag, (await page.locator('textarea').inputValue()) === 'Never mind', 'a reload keeps the note');
  await page.getByRole('button', { name: 'Clear it' }).tap();
  await page.reload();
  await page.waitForSelector('[data-screen="capture"]');
  check(tag, (await page.locator('textarea').inputValue()) === '' && !(await page.getByRole('button', { name: 'Clear it' }).count()), 'cleared, and gone after a reload');

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
