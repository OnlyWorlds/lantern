// The newest address wins: a route that is still waiting (the store read behind Your worlds, a
// world opening) when a newer address comes in never mounts over it, so the screen is always the
// one the address bar names. The overtaking is made exact: a hashchange listener added after the
// app's own moves the address on the moment the first route has started and is waiting.
// (The revoke walk met this by chance: Settings opened just after a sign-in landed on Your worlds,
// and Your worlds arrived late over it.)
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/route-last.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const NOWHERE = '0fff0000-0000-4000-8000-0000000000ff';

/** Go to `first`, and the moment its route has started, to `then`; after the dust, what shows. */
async function overtake(page, first, then) {
  await page.evaluate(
    ([a, b]) =>
      new Promise((res) => {
        window.addEventListener('hashchange', () => { location.hash = b; }, { once: true });
        location.hash = a;
        setTimeout(res, 50);
      }),
    [first, then],
  );
  await page.waitForTimeout(1200);
  return page.evaluate(() => ({
    hash: location.hash,
    screen: document.querySelector('#app > main')?.getAttribute('data-screen') ?? null,
    title: document.querySelector('#app h1')?.textContent?.trim() ?? null,
  }));
}

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && errors.push(m.text()));
  // Signed out on an empty phone: nothing here needs keel, and nothing reaches it.
  await page.route(/www\.onlyworlds\.com\//, (r) => r.fulfill({ status: 503, body: '' }));

  await page.goto(`${BASE}/#/welcome`);
  await page.waitForSelector('[data-screen="welcome"]', { timeout: 15000 });

  // Your worlds waits on the store; Settings, asked a moment later, is what shows.
  const a = await overtake(page, '#/worlds', '#/settings');
  check(tag, a.hash === '#/settings' && a.screen === 'settings', `Your worlds overtaken by Settings: Settings shows (${JSON.stringify(a)})`);

  // A world opening (here one the phone does not hold, so its Not here comes late): Settings stays.
  await page.goto(`${BASE}/#/welcome`);
  await page.waitForSelector('[data-screen="welcome"]', { timeout: 15000 });
  const b = await overtake(page, `#/w/${NOWHERE}`, '#/settings');
  check(tag, b.hash === '#/settings' && b.screen === 'settings', `a world opening overtaken by Settings: Settings shows (${JSON.stringify(b)})`);

  // The control: the newest route is the slow one, and it still mounts.
  const c = await overtake(page, '#/key', '#/worlds');
  check(tag, c.hash === '#/worlds' && c.screen === 'worlds', `Open with a key overtaken by Your worlds: Your worlds shows (${JSON.stringify(c)})`);

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
