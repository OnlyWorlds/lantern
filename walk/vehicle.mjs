// A Location's Vehicle (the standard 00.34.00): a place inside a moving thing names the Object it is
// the inside of, and its page shows that link. The demo world on this phone: one Location given the
// demo's first Object as its vehicle in the world's own db, then its page read.
// 1. The page has a Vehicle field, and its chip names the Object.
// 2. The chip opens the Object's page.
// Nothing is written to keel.
// Run: npm run build && (npx vite preview &) && node walk/vehicle.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';

const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const inWorld = (page, worldId, fn, arg) =>
  page.evaluate(
    ([worldId, fn, arg]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(`lantern-world-${worldId}`);
        r.onsuccess = () => {
          const t = r.result.transaction('elements', 'readwrite');
          const es = t.objectStore('elements');
          if (fn === 'all') {
            const g = es.getAll();
            g.onsuccess = () => res(g.result);
            g.onerror = () => rej(g.error);
            return;
          }
          const g = es.get(arg.id);
          g.onsuccess = () => es.put({ ...g.result, ...arg.patch });
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    [worldId, fn, arg],
  );

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto(BASE);
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  const worldId = await page.evaluate(() => location.hash.split('/')[2]);

  const els = await inWorld(page, worldId, 'all');
  const place = els.find((e) => e.type === 'location' && !e.vehicle);
  const ship = els.find((e) => e.type === 'object' && e.name);
  check(tag, !!place && !!ship, `the demo has a Location (${place?.name}) and an Object (${ship?.name})`);
  await inWorld(page, worldId, 'put', { id: place.id, patch: { vehicle: ship.id } });

  // 1. The Location's page: a Vehicle field whose chip names the Object.
  await page.goto(`${BASE}/?vehicle#/w/${worldId}/e/${place.id}`);
  await page.waitForSelector('[data-screen="element"] .el-head');
  const text = await page.locator('[data-screen="element"]').innerText();
  const field = /Vehicle/.test(text);
  const chip = page.locator('.link-chip:not(.plain)', { hasText: ship.name }).first();
  const chipShown = await chip.isVisible().catch(() => false);
  check(tag, field && chipShown, `the page says Vehicle (${field}) and shows ${ship.name}'s chip (${chipShown})`);

  // 2. The chip opens the Object.
  if (chipShown) {
    await chip.tap();
    // The hash moves before the page draws: wait for the head to name the Object, not for the address.
    await page.locator('[data-screen="element"] .el-head', { hasText: ship.name }).waitFor({ timeout: 8000 }).catch(() => {});
    const head = await page.locator('[data-screen="element"] .el-head').innerText().catch(() => '');
    check(tag, head.includes(ship.name), `the chip opens ${ship.name} (${JSON.stringify(head.slice(0, 60))})`);
  } else check(tag, false, 'the chip opens the Object (no chip to press)');

  check(tag, errors.length === 0, `no page errors (${errors.length}${errors.length ? `: ${errors[0]}` : ''})`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
