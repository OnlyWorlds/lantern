// The write path against keel itself, as a phone taps it. Scratch elements only, deleted after,
// with their uploaded picture. Keys come from the environment and never reach a screenshot
// (the inputs are password fields) or a log.
//   OW_WRITE_KEY=... OW_PIN_FILE=... node walk/live-write.mjs
import './guard.mjs';
import { chromium, devices } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { OwV2Client } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const KEY = process.env.OW_WRITE_KEY ?? process.env.OW_DEMO_WRITE_KEY;
const PIN = readFileSync(process.env.OW_PIN_FILE, 'utf8').trim();
if (!KEY || !PIN) throw new Error('OW_WRITE_KEY and OW_PIN_FILE are needed');
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const api = new OwV2Client({ apiKey: KEY, apiPin: PIN });
const made = new Set();
const images = new Set();
let failures = 0;
const check = (ok, what) => {
  console.log(`[live] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const until = async (fn, what, ms = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 400));
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let n = 0;
const shot = (name) => page.screenshot({ path: `${OUT}/live-${String(++n).padStart(2, '0')}-${name}.png` });
const elementId = () => page.evaluate(() => location.hash.match(/\/e\/([^/?]+)/)?.[1]);

try {
  // Open with the key and PIN
  await page.goto(`${BASE}/#/key`);
  await page.locator('input[aria-label="World key"]').tap();
  await page.locator('input[aria-label="World key"]').fill(KEY);
  await page.locator('input[aria-label="PIN"]').fill(PIN);
  await page.getByRole('button', { name: 'Open the world' }).tap();
  await page.waitForSelector('.type-tile', { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 90000 });
  check(true, 'opened the world with a write key and its PIN');

  // 1. Catch a line: a create through the outbox, with its own id
  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.locator('textarea').tap();
  await page.keyboard.type('Lantern probe, delete me\nA scratch element from the overnight walk.');
  await page.getByRole('button', { name: /Keep it in Unsorted/ }).tap();
  // A note stays on Catch now (S404); its page is one tap away.
  await page.locator('[data-action="open-kept"]').tap();
  await page.waitForSelector('[data-screen="element"] h1');
  const id = await elementId();
  made.add(id);
  const created = await until(() => api.get('narrative', id), 'the create reaches keel');
  check(created.supertype === 'Unsorted' && created.name === 'Lantern probe, delete me', `keel has it: ${JSON.stringify({ name: created.name, supertype: created.supertype })}`);
  await page.waitForFunction(() => !document.querySelector('.wait'), null, { timeout: 20000 }).catch(() => {});
  check((await page.locator('.wait').count()) === 0, 'the page no longer says waiting to send');

  // 2. An edit: PATCH with If-Match
  await page.locator('.el-head h1').tap();
  await page.locator('.sheet input').fill('Lantern probe (renamed), delete me');
  await page.getByRole('button', { name: 'Save' }).tap();
  const renamed = await until(async () => (await api.get('narrative', id)).name.includes('renamed') && api.get('narrative', id), 'the rename reaches keel');
  check(renamed.change_seq > created.change_seq, `rename landed (change_seq ${created.change_seq} to ${renamed.change_seq})`);

  // 3. A conflict: the phone edits offline while another hand changes the same field
  await ctx.setOffline(true);
  await page.locator('.el-head h1').tap();
  await page.locator('.sheet input').fill('Mine: the phone');
  await page.getByRole('button', { name: 'Save' }).tap();
  await page.waitForSelector('.wait');
  check(/waiting/.test(await page.locator('.wait').first().innerText()), 'offline, the edit waits on the phone');
  await shot('waiting');
  await api.patch('narrative', id, { name: 'Theirs: another hand' });
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('a.banner[href$="/outbox"]', { timeout: 20000 });
  check(true, 'the element page says the change needs you');
  await page.locator('a.banner[href$="/outbox"]').tap();
  await page.waitForSelector('[data-conflict]');
  await shot('conflict');
  const sides = await page.locator('[data-conflict] .side .val').allInnerTexts();
  check(sides.includes('Mine: the phone') && sides.includes('Theirs: another hand'), `the conflict shows both: ${JSON.stringify(sides)}`);
  await page.getByRole('button', { name: /Yours, from this phone/ }).tap();
  await page.getByRole('button', { name: 'Use these' }).tap();
  const kept = await until(async () => (await api.get('narrative', id)).name === 'Mine: the phone', 'keep-mine reaches keel');
  check(!!kept, 'keep mine: keel has the phone\'s value');

  // 4. A conflict on another field re-sends by itself
  await ctx.setOffline(true);
  await page.goto(`${BASE}/#/w/${await page.evaluate(() => location.hash.split('/')[2])}/e/${id}`);
  await page.waitForSelector('.el-head h1');
  await page.locator('.prose').tap();
  await page.locator('.sheet textarea').fill('Description from the phone.');
  await page.getByRole('button', { name: 'Save' }).tap();
  await api.patch('narrative', id, { story: 'A story from another hand.' });
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const both = await until(async () => {
    const e = await api.get('narrative', id);
    return e.description === 'Description from the phone.' && e.story === 'A story from another hand.' && e;
  }, 'the untouched-field 412 re-sends by itself');
  check(!!both, 'different fields: both kept, nothing asked');
  check((await page.locator('a.banner[href$="/outbox"]').count()) === 0, 'and the phone asks nothing');

  // 5. A photo: prepared on the phone, uploaded, set as the picture
  await page.goto(`${BASE}/#/w/${await page.evaluate(() => location.hash.split('/')[2])}/capture`);
  await page.waitForSelector('[data-screen="capture"]');
  const png = Buffer.from(
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 900;
      const g = c.getContext('2d');
      g.fillStyle = '#2b3a4a';
      g.fillRect(0, 0, 1200, 900);
      g.fillStyle = '#f0b44c';
      g.font = '80px sans-serif';
      g.fillText('a page of notes', 200, 450);
      const b = await new Promise((r) => c.toBlob(r, 'image/png'));
      return [...new Uint8Array(await b.arrayBuffer())];
    }),
  );
  await page.locator('input[data-photo="gallery"]').setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.photo-preview');
  await shot('photo');
  await page.getByRole('button', { name: /Keep it in Unsorted/ }).tap();
  // A note stays on Catch now (S404); its page is one tap away.
  await page.locator('[data-action="open-kept"]').tap();
  await page.waitForSelector('[data-screen="element"] h1');
  const pid = await elementId();
  made.add(pid);
  const withPhoto = await until(async () => {
    const e = await api.get('narrative', pid);
    return typeof e.image_url === 'string' && e.image_url.startsWith('https://') && e;
  }, 'the photo reaches the edge and the element', 40000);
  images.add(withPhoto.image_url);
  check(/^https:\/\/media\.onlyworlds\.com\//.test(withPhoto.image_url), `the photo landed: ${withPhoto.name}, ${withPhoto.image_url.split('/').pop()}`);
  await page.waitForTimeout(1500);
  await shot('photo-element');

  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
} catch (e) {
  failures++;
  console.log('[live] FAIL', e.message);
  await shot('failure').catch(() => {});
} finally {
  for (const url of images) await api.removeImage(url).then(() => console.log('[live] removed the picture'), (e) => console.log('[live] picture not removed:', e.message));
  for (const id of made) await api.delete('narrative', id).then(() => console.log('[live] deleted a scratch element'), (e) => console.log('[live] not deleted:', id, e.message));
  await browser.close();
}
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
