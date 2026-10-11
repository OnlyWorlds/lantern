// Lantern walked as a phone taps it: .tap() on device profiles, WebKit and Chromium, against the
// production build (vite preview on :5181, so the worker is real), airplane mode included.
// Run: npm run build && (npx vite preview &) && node walk/walk.mjs [webkit|chromium]
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

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[deviceName] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  let offline = false;
  page.on('console', (m) => {
    // Offline, a failed fetch is the expected answer, not an error.
    if (m.type() === 'error' && !(offline && /Failed to load resource/.test(m.text()))) errors.push('console: ' + m.text());
  });
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${String(++n).padStart(2, '0')}-${name}.png` });
  const screen = () => page.evaluate(() => document.querySelector('main')?.dataset.screen ?? '?');

  // 1. First open
  await page.goto(BASE);
  await page.waitForSelector('[data-screen="welcome"]');
  await shot('welcome');
  const first = await page.locator('.choice').first().innerText();
  check(tag, /Sign in/.test(first), `Sign in is the first choice (${JSON.stringify(first.split('\n')[0])})`);

  // 2. The demo
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  await shot('home');
  const tiles = await page.locator('.type-tile').count();
  check(tag, tiles > 0, `home shows ${tiles} type tiles`);
  check(tag, (await page.locator('.fab').count()) === 0, 'a read-only demo has no capture button');
  const pill = await page.locator('.pill').first().innerText().catch(() => '');
  check(tag, /Read only/.test(pill), `the head says read only (${JSON.stringify(pill)})`);

  // 3. Find
  await page.locator('.search input').tap();
  await page.keyboard.type('flu', { delay: 40 });
  await page.waitForTimeout(300);
  const hits = await page.locator('.results .el-row').count();
  await shot('find');
  check(tag, hits > 0, `"flu" finds ${hits}`);

  // 4. An element
  const firstHit = await page.locator('.results .el-row b').first().innerText();
  await page.locator('.results .el-row').first().tap();
  await page.waitForSelector('[data-screen="element"] h1');
  const h1 = await page.locator('[data-screen="element"] h1').innerText();
  check(tag, h1.startsWith(firstHit), `tapping "${firstHit}" opens it (${JSON.stringify(h1)})`);
  await shot('element');
  const chip = page.locator('.fields a.link-chip').first();
  if (await chip.count()) {
    const target = await chip.innerText();
    await chip.tap();
    await page.waitForFunction((t) => document.querySelector('[data-screen="element"] h1')?.textContent?.startsWith(t), target);
    check(tag, true, `a link chip opens "${target}"`);
    await shot('linked');
    await page.locator('[aria-label="Back"]').tap();
    await page.waitForFunction((t) => document.querySelector('[data-screen="element"] h1')?.textContent?.startsWith(t), firstHit);
    check(tag, true, 'Back returns to the first element');
  } else check(tag, true, '(no link chip on this element)');
  const emptyToggle = page.getByRole('button', { name: /empty fields/ });
  if (await emptyToggle.count()) {
    await emptyToggle.tap();
    await page.waitForTimeout(200);
    await shot('empty-fields');
  }

  // 5. A type's list
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('[data-screen="worlds"]');
  await shot('worlds');
  await page.locator('.world-card').first().tap();
  await page.waitForSelector('.type-tile');
  await page.locator('.type-tile').first().tap();
  await page.waitForSelector('[data-screen="type"] .el-row');
  const rows = await page.locator('[data-screen="type"] .el-row').count();
  check(tag, rows > 0, `a type's list shows ${rows} rows`);
  await shot('type-list');

  // 6. Airplane mode: the app opens from the worker, the world from the store
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 }).catch(() => {});
  const controlled = await page.evaluate(() => navigator.serviceWorker?.controller != null);
  check(tag, controlled, 'the worker controls the page');
  await ctx.setOffline(true);
  offline = true;
  // page.reload() errors in Playwright's WebKit under a worker while offline; a page-side reload is what a user does.
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('load');
  await page.waitForSelector('[data-screen="worlds"]', { timeout: 15000 }).catch(() => {});
  check(tag, (await screen()) === 'worlds', `offline reload opens Your worlds (screen=${await screen()})`);
  await page.locator('.world-card').first().tap();
  await page.waitForSelector('.type-tile', { timeout: 15000 }).catch(() => {});
  const offTiles = await page.locator('.type-tile').count();
  check(tag, offTiles === tiles, `offline, the world opens from the phone (${offTiles} tiles)`);
  await page.waitForTimeout(800);
  await shot('offline-home');
  const banner = await page.locator('.banner').innerText().catch(() => '');
  check(tag, /No connection/.test(banner), `offline banner: ${JSON.stringify(banner)}`);
  await ctx.setOffline(false);
  offline = false;

  // 7. A world on this phone: catch, edit, all offline-capable
  await page.goto(`${BASE}/#/new`);
  await page.waitForSelector('[data-screen="new-world"]');
  await page.locator('input[aria-label="World name"]').tap();
  await page.keyboard.type('Bus stop ideas');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await shot('local-home');
  await page.locator('.fab').tap();
  await page.waitForSelector('[data-screen="capture"]');
  await page.locator('textarea').tap();
  await page.keyboard.type('The ferryman owes the bell-founder three years of crossings.\nHe pays in fish.');
  await shot('capture');
  await page.getByRole('button', { name: /Keep it in Unsorted/ }).tap();
  await page.waitForSelector('[data-screen="element"] h1');
  const caught = await page.locator('[data-screen="element"] h1').innerText();
  const kind = await page.locator('.el-head .muted').innerText();
  check(tag, /ferryman/.test(caught) && /Narrative · Unsorted/.test(kind), `caught as ${JSON.stringify(caught)} (${kind})`);
  await shot('caught');
  await page.locator('.el-head h1').tap();
  await page.waitForSelector('.sheet input');
  await page.locator('.sheet input').fill('The ferryman\'s debt');
  await page.getByRole('button', { name: 'Save' }).tap();
  await page.waitForFunction(() => document.querySelector('[data-screen="element"] h1')?.textContent?.startsWith("The ferryman's debt"));
  check(tag, true, 'renaming through the sheet shows at once');
  await page.locator('[aria-label="Back"]').tap();
  await page.waitForSelector('[data-screen="home"]');
  const unsorted = await page.locator('a.choice').first().innerText().catch(() => '');
  check(tag, /Unsorted · 1/.test(unsorted), `home shows ${JSON.stringify(unsorted.split('\n')[0])}`);
  await shot('local-home-after');

  // 8. The house look
  await page.goto(`${BASE}/#/settings`);
  await page.getByRole('button', { name: 'House' }).tap();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check(tag, theme === 'house', `the switch sets data-theme=${theme}`);
  await shot('settings-house');
  await page.getByRole('button', { name: 'Warm' }).tap();

  // 9. A missing path reaches the host's 404 (preview has no 404.html rule; this checks the worker lets it through)
  // (The page errors are counted first: this step's 404 is the point, not an error.)
  for (const e of errors) console.log(`[${tag}] ${e}`);
  check(tag, errors.length === 0, `no page errors (${errors.length})`);
  const res = await page.goto(`${BASE}/this-is-not-a-page`);
  check(
    tag,
    res?.status() === 404 && !(await page.locator('#app').count()),
    `a missing path reaches the host's 404, not the app shell (status ${res?.status()}, from worker: ${res?.fromServiceWorker()})`,
  );
  await browser.close();
}

if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'iphone');
if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'pixel');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
