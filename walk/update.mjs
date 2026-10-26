// A pinned phone meets a newer build: the banner shows, the outbox holds, Reload lands on the
// new build. Builds twice into dist/ while vite preview (:5181) serves it.
//   node walk/update.mjs
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

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
  // What the button said the moment the tap landed (seconds with no sign the tap took).
  // A window listener runs after the button's own; sessionStorage outlives the reload.
  await page.evaluate(() =>
    window.addEventListener('click', (e) => {
      const btn = e.target.closest?.('.banner button');
      if (btn) sessionStorage.setItem('walk-reload', JSON.stringify({ text: btn.textContent, disabled: btn.disabled, line: btn.parentElement.textContent }));
    }),
  );
  await Promise.all([page.waitForEvent('load', { timeout: 20000 }), page.locator('.banner button').tap()]);
  await page.waitForSelector('[data-screen]');
  const tapped = JSON.parse((await page.evaluate(() => sessionStorage.getItem('walk-reload'))) ?? '{}');
  check(tag, tapped.text === 'Reloading' && tapped.disabled === true && /Loading the new version/.test(tapped.line ?? ''), `the tap shows at once (${JSON.stringify(tapped)})`);
  const scriptB = await running();
  check(tag, scriptA !== scriptB, `Reload runs the new build (${scriptA} to ${scriptB})`);
  await page.goto(`${BASE}/#/settings`);
  const shown = await page.locator('text=/build /').innerText();
  check(tag, shown.includes(b), `settings names the new build (${shown})`);
  check(tag, (await page.locator('.banner').count()) === 0, 'no banner on the new build');
  await browser.close();
}

// A deploy's cutover: the new worker and assets are live while "/" is still the
// previous shell. The new worker must refuse to install (it would store the old shell under the new
// build); once "/" is the new shell, it installs.
const nextWorker = (page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const settled = new Promise((res) => {
      reg.addEventListener(
        'updatefound',
        () => {
          const w = reg.installing;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' || w.state === 'redundant') res(w.state);
          });
        },
        { once: true },
      );
      setTimeout(() => res('no update found'), 15000);
    });
    await reg.update().catch(() => {});
    return settled;
  });

async function cutover(engine, deviceName, tag) {
  build();
  const oldShell = readFileSync('dist/index.html', 'utf8');
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[deviceName] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 });
  build();
  const newShell = readFileSync('dist/index.html', 'utf8');
  writeFileSync('dist/index.html', oldShell);
  const during = await nextWorker(page);
  check(tag, during === 'redundant', `a new worker meeting the previous shell at "/" refuses to install (${during})`);
  writeFileSync('dist/index.html', newShell);
  // The manifest has no hash in its name: a previous build's copy (here, one changed byte) refuses too.
  const manifest = readFileSync('dist/manifest.webmanifest', 'utf8');
  writeFileSync('dist/manifest.webmanifest', manifest.replace('"Lantern"', '"Lantern "'));
  const oldManifest = await nextWorker(page);
  check(tag, oldManifest === 'redundant', `a new worker meeting another build's manifest refuses to install (${oldManifest})`);
  writeFileSync('dist/manifest.webmanifest', manifest);
  const after = await nextWorker(page);
  check(tag, after === 'installed', `with the new shell at "/" it installs (${after})`);
  await browser.close();
}

await walk(chromium, 'Pixel 7', 'pixel');
await walk(webkit, 'iPhone 13', 'iphone');
await cutover(chromium, 'Pixel 7', 'pixel');
await cutover(webkit, 'iPhone 13', 'iphone');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
