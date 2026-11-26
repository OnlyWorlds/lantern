// A world file whose world holds a tool's own world.json under a dot-folder (`abbey/.atlas/world.json`)
// opens as the one world it is (SDK 4.201.1). On a build pinned before it (the control), the file is
// refused as holding more than one world.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/dotfolder.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { zipSync, strToU8 } from 'fflate';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const j = (o) => strToU8(JSON.stringify(o));
const WID = 'd07f0000-0000-4000-8000-000000000001';
const zip = Buffer.from(zipSync({
  mimetype: strToU8('application/vnd.onlyworlds.world+zip'),
  'abbey/world.json': j({ id: WID, name: 'The Abbey' }),
  'abbey/.atlas/world.json': j({ id: 'd07f0000-0000-4000-8000-000000000009', name: 'A tool copy' }),
  'abbey/elements/character/brother.json': j({ id: 'd07f0000-0000-4000-8000-000000000002', name: 'Brother Cadfael' }),
}));

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' })).newPage();
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, (r) => r.abort());
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'abbey.owworld', mimeType: 'application/zip', buffer: zip });
  const opened = await page.waitForSelector('[data-screen="home"]', { timeout: 15000 }).then(() => true, () => false);
  const said = opened ? '' : (await page.locator('main').innerText()).slice(0, 160).replace(/\s+/g, ' ');
  check(tag, opened, `the world file opens${opened ? '' : ` (said: ${said})`}`);
  if (opened) check(tag, (await page.locator('[data-screen="home"]').innerText()).includes('The Abbey'), 'as The Abbey');
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'Pixel 7', 'chromium');
if (only !== 'chromium') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAIL` : 'all ok');
process.exitCode = failures ? 1 : 0;
