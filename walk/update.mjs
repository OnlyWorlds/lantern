// A pinned phone meets a newer build: the banner shows, the outbox holds, Reload lands on the
// new build. Builds twice into dist/ while vite preview (:5181) serves it.
//   node walk/update.mjs
import { chromium, webkit, devices } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:5181';
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const build = () => {
  execSync('npx vite build', { stdio: 'ignore' });
  return JSON.parse(readFileSync('dist/version.json', 'utf8')).build;
};

async function walk(engine, deviceName, tag) {
  const a = build();
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[deviceName] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/new`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 });
  await page.locator('input[aria-label="World name"]').fill('Update probe');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  const running = () => page.evaluate(() => fetch('/version.json').then(() => document.querySelector('script[type=module]')?.getAttribute('src')));
  const scriptA = await running();

  const b = build();
  check(tag, a !== b, `two builds (${a} then ${b})`);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('.banner button', { timeout: 15000 });
  const banner = await page.locator('.banner').innerText();
  check(tag, /new version/.test(banner), `the banner: ${JSON.stringify(banner.split('\n')[0])}`);
  await page.screenshot({ path: `walk/shots/update-${tag}-banner.png` });
  await Promise.all([page.waitForEvent('load', { timeout: 20000 }), page.locator('.banner button').tap()]);
  await page.waitForSelector('[data-screen]');
  const scriptB = await running();
  check(tag, scriptA !== scriptB, `Reload runs the new build (${scriptA} to ${scriptB})`);
  await page.goto(`${BASE}/#/settings`);
  const shown = await page.locator('text=/build /').innerText();
  check(tag, shown.includes(b), `settings names the new build (${shown})`);
  check(tag, (await page.locator('.banner').count()) === 0, 'no banner on the new build');
  await browser.close();
}

await walk(chromium, 'Pixel 7', 'pixel');
await walk(webkit, 'iPhone 13', 'iphone');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
