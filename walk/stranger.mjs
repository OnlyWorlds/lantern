// Quillon's stranger walk (h37 #4275), walked as fixed: a world on this phone from nothing, a note
// caught into Unsorted that stays on Catch, the note made into a Character by hand (no AI, no
// account), the note filed out of Unsorted, and what each screen says on the way. keel is cut off:
// a world on this phone sends nothing.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/stranger.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = process.env.WALK_OUT ?? '';
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const sent = [];
  await page.route(/onlyworlds\.com/, (r) => {
    sent.push(`${r.request().method()} ${r.request().url()}`);
    return r.abort();
  });
  const shot = (name) => (OUT ? page.screenshot({ path: `${OUT}/${tag}-${name}.png` }) : null);

  // A world from nothing.
  await page.goto(`${BASE}/#/new`);
  await page.locator('input[aria-label="World name"]').fill('The Ferry Road');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');

  // 4: the hint names the first-line rule before a type is picked; 7: a note stays on Catch.
  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  const hint = await page.locator('[data-screen="capture"] .chips + p').innerText();
  check(tag, /first line names the note/i.test(hint), `the Unsorted hint says the first line names it (${JSON.stringify(hint)})`);
  await page.locator('textarea[aria-label="What to keep"]').fill('Old Marta\nSells charms by the bridge, and knows the ferryman owes her.');
  await page.getByRole('button', { name: /Keep it in Unsorted/ }).tap();
  await page.waitForSelector('[data-part="kept"] [data-action="open-kept"]');
  check(tag, (await page.locator('[data-screen="capture"]').count()) === 1, 'after Keep, Catch stays open');
  check(tag, (await page.locator('textarea[aria-label="What to keep"]').inputValue()) === '', 'the box is empty for the next one');
  check(tag, /Kept in Unsorted: Old Marta/.test(await page.locator('[data-part="kept"]').innerText()), 'it says what was kept');
  await shot('kept');
  // A second catch in a row, no round trip.
  await page.locator('textarea[aria-label="What to keep"]').fill('A bell that rings under the water');
  await page.getByRole('button', { name: /Keep it in Unsorted/ }).tap();
  await page.waitForFunction(() => /A bell that rings/.test(document.querySelector('[data-part="kept"]')?.textContent ?? ''));

  // 1 and 2: Unsorted says what it is and what sorting needs, before any tap.
  await page.goto(`${BASE}/#/w/${page.url().match(/#\/w\/([^/]+)/)[1]}`);
  await page.waitForSelector('[data-screen="home"]');
  const card = await page.locator('a.choice', { hasText: 'Unsorted' }).innerText();
  check(tag, /Narratives until you sort/.test(card), `the home's card says they are Narratives till sorted (${JSON.stringify(card.replace(/\n/g, ' / '))})`);
  await page.locator('a.choice', { hasText: 'Unsorted' }).tap();
  await page.waitForSelector('[data-screen="type"]');
  check(tag, (await page.locator('[data-action="sort"]').count()) === 0, 'no Sort button in a world on this phone');
  check(tag, /Open a note to make it an element/.test(await page.locator('[data-part="sort-hint"]').innerText()), 'the list says how to sort here, before any tap');
  check(tag, (await page.locator('[data-screen="type"] p.muted:not([data-part])').allInnerTexts()).includes('2 notes'), 'the list counts notes');
  check(tag, (await page.locator('.results a').allInnerTexts()).every((t) => /unsorted note/.test(t) && !/narrative/.test(t)), 'each row reads as a note');
  check(tag, (await page.locator('input[type=search]').getAttribute('placeholder')) === 'Search your notes', 'search says notes');
  await shot('unsorted');

  // 1: the note made into a Character by hand.
  await page.locator('.results a', { hasText: 'Old Marta' }).tap();
  await page.waitForSelector('[data-screen="element"] h1');
  check(tag, (await page.locator('.el-head .muted').innerText()) === 'Unsorted note', 'the note reads as an Unsorted note');
  check(tag, /Tap the name or a value/.test(await page.locator('[data-screen="element"] p.muted.small').last().innerText()), 'the page says the name can be tapped');
  check(tag, (await page.locator('[data-screen="element"] [role="button"][data-field]').count()) > 0, 'the field rows are buttons to a screen reader');
  await page.locator('[data-action="make-from-note"]').tap();
  await page.waitForSelector('.sheet [role="radiogroup"]');
  await shot('make-sheet');
  await page.locator('.sheet .kind-chip[data-kind="character"]').tap();
  await page.getByRole('button', { name: 'Make the character' }).tap();
  await page.waitForFunction(() => /\?fill$/.test(location.hash));
  await page.waitForSelector('[data-screen="element"] h1');
  check(tag, (await page.locator('[data-screen="element"] h1').innerText()).startsWith('Old Marta'), 'a Character named by the first line');
  check(tag, /^Character/.test(await page.locator('.el-head .muted').innerText()), 'of the type picked');
  check(tag, /Sells charms by the bridge/.test(await page.locator('[data-screen="element"] .prose').innerText()), 'the rest is its description');
  await shot('made');

  // The note left Unsorted; the other stays.
  const wid = page.url().match(/#\/w\/([^/]+)/)[1];
  await page.goto(`${BASE}/#/w/${wid}/t/narrative?unsorted`);
  await page.waitForSelector('[data-screen="type"]');
  const left = await page.locator('.results a').allInnerTexts();
  check(tag, left.length === 1 && /A bell/.test(left[0]), `Unsorted holds only the other note (${JSON.stringify(left)})`);

  check(tag, sent.length === 0, `nothing left the phone (${sent.length})`);
  check(tag, errors.length === 0, `no page errors ${errors.join(' | ')}`);
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
