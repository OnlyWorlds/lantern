// A World's own extension keys through a copy (folder spec §3.3): a world file whose world.json carries
// the strand's x_strand and another tool's atlas_ and shadow_ keys is opened on the phone, Save a copy
// hands a file over, and its world.json carries each key as given. Chromium only: Playwright's WebKit
// here raises no download event (the lantern skill's trap).
// Run: npm run build && (npx vite preview &) && node walk/world-keys.mjs   (LANTERN_URL for a live host)
import './guard.mjs';
import { chromium, devices } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { readWorldFile, writeWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (ok, what) => {
  console.log(`[world-keys] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const enc = new TextEncoder();
const KEYS = {
  x_strand: { narrative: '019f0000-0000-7000-8000-0000000000a1', event: '019f0000-0000-7000-8000-0000000000a2', location: null },
  atlas_home: { grid: [[1, 2]] },
  shadow_note: 'kept as given',
};
const world = { id: '019f0000-0000-7000-8000-0000000000aa', name: 'Strand keys', ...KEYS };
const story = { id: KEYS.x_strand.narrative, name: 'How Hollowmere began', events: [KEYS.x_strand.event] };
const happening = { id: KEYS.x_strand.event, name: 'The Founding' };
const file = writeWorldFile([
  { path: 'world.json', data: enc.encode(JSON.stringify(world)) },
  { path: 'elements/narrative/how-hollowmere-began--0000a1.json', data: enc.encode(JSON.stringify(story)) },
  { path: 'elements/event/the-founding--0000a2.json', data: enc.encode(JSON.stringify(happening)) },
], 'Strand keys');

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${BASE}/#/worlds`);
await page.locator('input[aria-label="A world file"]').waitFor({ state: 'attached', timeout: 15000 });
await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'strand.owworld', mimeType: 'application/zip', buffer: Buffer.from(file) });
await page.waitForSelector('[data-screen="home"]', { timeout: 15000 });
check(true, 'the world file opens on the phone');

await page.goto(`${BASE}/#/worlds`);
await page.waitForSelector('.local-group');
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
  page.getByRole('button', { name: 'Save a copy' }).tap(),
]);
await page.screenshot({ path: `${OUT}/world-keys-01-saved.png` });
if (download) {
  const bytes = new Uint8Array(readFileSync(await download.path()));
  const got = JSON.parse(new TextDecoder().decode(readWorldFile(bytes).files.find((f) => f.path === 'world.json').data));
  for (const [k, v] of Object.entries(KEYS)) check(JSON.stringify(got[k]) === JSON.stringify(v), `the copy's world.json carries ${k} as given`);
  check(got.id === world.id && got.name === world.name, 'the copy is the same world');
} else check(false, 'Save a copy hands a file over');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
