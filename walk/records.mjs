// records/ through a copy (folder spec §4.5 rules 6 and 11): the standard's own OW-8 file opened on
// the phone, Save a copy asks about the private producer, Leave them out carries every other record
// byte for byte, Include them carries all. Chromium only: Playwright's WebKit here raises no
// download event (the lantern skill's trap).
// Run: npm run build && (npx vite preview &) && node walk/records.mjs   (LANTERN_URL for a live host)
import './guard.mjs';
import { chromium, devices } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { readWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (ok, what) => {
  console.log(`[records] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const asked = new Uint8Array(readFileSync('test/fixtures/owworld/pass-OW-8-private-asked.owworld'));
const recordsOf = (bytes) =>
  readWorldFile(bytes).files.filter((f) => f.path.startsWith('records/')).sort((a, b) => (a.path < b.path ? -1 : 1));
const source = recordsOf(asked);
const same = (got, want) =>
  got.length === want.length && got.every((f, i) => f.path === want[i].path && Buffer.from(f.data).equals(Buffer.from(want[i].data)));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let n = 0;
const shot = (name) => page.screenshot({ path: `${OUT}/records-${String(++n).padStart(2, '0')}-${name}.png` });

await page.goto(`${BASE}/#/worlds`);
await page.locator('input[aria-label="A world file"]').waitFor({ state: 'attached', timeout: 15000 });
await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'abbey.owworld', mimeType: 'application/zip', buffer: Buffer.from(asked) });
await page.waitForSelector('[data-screen="home"]', { timeout: 15000 });
check(true, `the standard's file opens on the phone (${source.length} record files in it)`);

async function saveWith(button) {
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('.local-group');
  const save = page.getByRole('button', { name: 'Save a copy' });
  const direct = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
  await save.tap();
  const sheetUp = await page
    .getByRole('dialog', { name: 'Some records are private' })
    .waitFor({ state: 'visible', timeout: 4000 })
    .then(() => true, () => false);
  if (!sheetUp) return { sheetUp, download: await direct };
  await shot(`asked-${button}`);
  const what = await page.getByRole('dialog').innerText();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
    page.getByRole('button', { name: button }).tap(),
  ]);
  return { sheetUp, what, download };
}
const bytesOf = async (d) => new Uint8Array(readFileSync(await d.path()));

const left = await saveWith('Leave them out');
check(left.sheetUp, 'Save a copy asks first: "Some records are private"');
check(!!left.what?.includes('records/fold') && !left.what.includes('records/lab'), 'the question names the private producer, records/fold, and only it');
if (left.download) {
  const got = recordsOf(await bytesOf(left.download));
  const want = source.filter((f) => !f.path.startsWith('records/fold/'));
  check(same(got, want), `Leave them out: every other record byte for byte, RECORDS.json kept, fold left out (${got.length} of ${source.length})`);
  const mediaOf = (bytes) => readWorldFile(bytes).files.filter((f) => f.path.startsWith('media/'));
  check(same(mediaOf(await bytesOf(left.download)), mediaOf(asked)), "the file's picture, media/a.png, comes back byte for byte");
} else check(false, 'Leave them out hands a file over');

const all = await saveWith('Include them');
if (all.download) {
  const got = recordsOf(await bytesOf(all.download));
  check(same(got, source), `Include them: every record byte for byte (${got.length} of ${source.length})`);
} else check(false, 'Include them hands a file over');
await shot('after');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
