// #755: the OnlyWorlds mark beside a world's and an element's name, as a phone taps it, both engines.
// A world file made to look like an account world (patched in the app's database); keel is cut off,
// so nothing the walk does reaches a server. Checks: a world on this phone only shows no mark; the
// owner's world shows one on its home and one on an element; a tap opens the fan-out as a sheet and
// starts no rename and no navigation; "You are here" leaves the address as it was; Copy link copies
// the site's address (Chromium); a world change while it is open leaves it open, and runs once after
// it closes; focus on the mark survives a world change; ten world changes leave one mark; the sheet's
// rows are above the tab bar; a read key shows the mark only while the public page was last said on.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/waymark.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, firefox, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile } from '@onlyworlds/sdk';

const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const WID = '0f0f0f0f-0000-4000-8000-00000000a755';
const ADA = 'a7550000-0000-4000-8000-000000000001';
const WRITE = 'ow_w_' + 'w'.repeat(30);
const READ = 'ow_r_' + 'r'.repeat(30);
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'The Lantern Coast' }) },
      { path: 'elements/character/ada.json', data: enc({ id: ADA, name: 'Ada Brightwater', description: 'Keeps the light.', changed_client: 'atlas', changed_via: 'api', updated_at: '2026-10-30T10:00:00+00:00' }) },
    ],
    'coast',
    { includeAuthorFields: true },
  ),
);

const patchApp = (page, patch) =>
  page.evaluate(
    ([id, patch]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction(['worlds'], 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => {
            const next = { ...g.result, ...patch };
            for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
            st.put(next);
          };
          t.oncomplete = () => {
            r.result.close();
            res(true);
          };
          t.onerror = () => rej(t.error);
        };
      }),
    [WID, patch],
  );

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  // Playwright's Firefox takes no device profile (no isMobile): a phone's size and touch only.
  const device = deviceName ? devices[deviceName] : { hasTouch: true };
  const ctx = await browser.newContext({ ...device, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  if (tag === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled|net::|Cross-Origin Request Blocked/i.test(m.text()) && errors.push('console: ' + m.text()));
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, (r) => r.abort());

  const marks = page.locator('.ow-waymark__mark');
  const homeMark = page.locator('[data-screen="home"] .lantern-waymark[data-mark="world"] .ow-waymark__mark');
  const elMark = page.locator('[data-screen="element"] .lantern-waymark[data-mark="element"] .ow-waymark__mark');
  const isOpen = () => page.evaluate(() => !!document.querySelector('.ow-waymark__mark[aria-expanded="true"]'));
  // A world change, as the phone has one: signal lost and back makes the open world read again.
  const worldChange = async () => {
    await ctx.setOffline(true);
    await ctx.setOffline(false);
    await page.waitForTimeout(400);
  };

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'coast.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  check(tag, (await marks.count()) === 0, 'a world on this phone only: no mark on its home');
  await page.goto(`${BASE}/#/w/${WID}/e/${ADA}`);
  await page.waitForSelector('[data-screen="element"] .el-head', { timeout: 20000 });
  check(tag, (await marks.count()) === 0, 'a world on this phone only: no mark on an element');

  // The owner's account world.
  await patchApp(page, { kind: 'online', apiKey: WRITE, keyKind: 'write', role: 'owner' });
  await page.goto(`${BASE}/?online#/w/${WID}`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await homeMark.waitFor({ timeout: 10000 }).catch(() => {});
  check(tag, (await homeMark.count()) === 1 && (await marks.count()) === 1, "the owner's world: one mark beside its name");
  check(tag, (await page.locator('.world-title > .world-name + .lantern-waymark').count()) === 1, 'the mark sits beside the name link, never inside it');

  // Home: a tap opens the sheet and leaves Lantern where it was.
  const hrefBefore = page.url();
  await homeMark.tap();
  await page.waitForTimeout(300);
  check(tag, await isOpen(), 'a tap on the mark opens the fan-out');
  check(tag, page.url() === hrefBefore, 'the tap left the address as it was (no Your worlds)');
  const rows = await page.locator('.ow-waymark__row .ow-waymark__label').allTextContents();
  check(tag, rows[0] === 'onlyworlds.com' && rows.includes('Lantern') && rows.at(-1) === 'Copy link', `the rows: ${rows.join(', ')}`);
  check(tag, (await page.locator('.ow-waymark--sheet, .ow-waymark__pop').first().isVisible()), 'the fan-out shows');
  // Above the tab bar: the point at the Copy link row's centre is the row.
  const onTop = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ow-waymark__row')];
    const copy = rows[rows.length - 1];
    const r = copy.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && copy.contains(hit) && r.bottom <= window.innerHeight + 1;
  });
  check(tag, onTop, 'the Copy link row is on top, inside the screen (not under the tab bar)');
  await page.screenshot({ path: `${OUT}/waymark-${tag}-01-home-open.png` });
  const titleBefore = await page.$('.world-title');
  await worldChange();
  check(tag, await isOpen(), 'a world change while it is open leaves it open');
  check(tag, await titleBefore.evaluate((n) => n.isConnected), 'the home was not redrawn under it');
  // "You are here": closes, goes nowhere.
  await page.locator('.ow-waymark__row[data-here]').tap();
  await page.waitForTimeout(500);
  check(tag, !(await isOpen()), '"You are here" closes the fan-out');
  check(tag, page.url() === hrefBefore, '"You are here" leaves the address as it was');
  check(tag, !(await titleBefore.evaluate((n) => n.isConnected)), 'the held world change ran once it closed');
  check(tag, (await marks.count()) === 1, 'one mark after it');

  // Ten world changes leave one mark.
  for (let i = 0; i < 10; i++) {
    await ctx.setOffline(true);
    await ctx.setOffline(false);
  }
  await page.waitForTimeout(600);
  check(tag, (await marks.count()) === 1, `ten world changes leave one mark (${await marks.count()})`);

  // The element page.
  await page.goto(`${BASE}/#/w/${WID}/e/${ADA}`);
  await page.waitForSelector('[data-screen="element"] .el-head', { timeout: 20000 });
  check(tag, (await elMark.count()) === 1 && (await marks.count()) === 1, "an element keel holds: one mark beside its name");
  check(tag, (await page.locator('.el-head > .lantern-waymark').count()) === 1, 'the mark is its own slot in the head, not inside the name block');
  await elMark.tap();
  await page.waitForTimeout(300);
  check(tag, await isOpen(), 'a tap opens the fan-out');
  check(tag, (await page.locator('.sheet[role="dialog"]').count()) === 0, 'and opens no rename sheet');
  const nameLine = await page.locator('.ow-waymark__name').textContent();
  check(tag, nameLine === 'Ada Brightwater', `the name line (${nameLine})`);
  const door = await page.locator('.ow-waymark__door').textContent().catch(() => '');
  check(tag, /Atlas/.test(door ?? ''), `a member reads the last door (${door})`);
  await page.screenshot({ path: `${OUT}/waymark-${tag}-02-element-open.png` });
  if (tag === 'chromium') {
    await page.locator('.ow-waymark__row', { hasText: 'Copy link' }).tap();
    await page.waitForTimeout(300);
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'unread: ' + e.message);
    check(tag, copied === `https://www.onlyworlds.com/w/${WID}/character/${ADA}`, `Copy link copies the site's address (${copied})`);
    const toast = page.locator('.ow-waymark__toast:not([hidden])');
    check(tag, (await toast.count()) === 1, 'Link copied shows');
    const headBefore = await page.$('.el-head');
    // A touch that turns into a scroll while the toast shows: pointerdown, then pointercancel, no click.
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    });
    await worldChange();
    check(tag, await headBefore.evaluate((n) => n.isConnected), 'a world change waits while Link copied shows');
    await page.waitForFunction(() => !document.querySelector('.ow-waymark__toast:not([hidden])'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    check(tag, !(await headBefore.evaluate((n) => n.isConnected)), 'and runs once it is gone');
  } else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Offline at the table: the web rows say so and lead nowhere; Copy link stays.
  await ctx.setOffline(true);
  await elMark.tap();
  await page.waitForTimeout(300);
  const site = page.locator('.ow-waymark__row[data-opener="onlyworlds"]');
  const siteText = await site.textContent();
  check(tag, /Needs a connection/.test(siteText ?? '') && (await site.getAttribute('href')) === null, `offline: onlyworlds.com needs a connection and leads nowhere (${siteText})`);
  const offUrl = page.url();
  await site.tap({ force: true }); // a finger lands on a disabled row too
  await page.waitForTimeout(300);
  check(tag, (await isOpen()) && page.url() === offUrl, 'offline: a tap on it does nothing and leaves the fan-out open');
  check(tag, (await page.locator('.ow-waymark__row', { hasText: 'Copy link' }).count()) === 1, 'offline: Copy link is still there');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await ctx.setOffline(false);
  await page.waitForTimeout(400);

  // Escape closes it with focus on the mark; a world change after keeps focus on the new mark, and
  // leaves the page where the person scrolled it. The empty fields make the page long enough to scroll.
  await page.locator('[data-action="toggle-fields"]').tap();
  await page.waitForTimeout(200);
  await elMark.tap();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(tag, !(await isOpen()), 'Escape closes it');
  const onMark = () => page.evaluate(() => document.activeElement?.classList.contains('ow-waymark__mark') ?? false);
  check(tag, await onMark(), 'focus is on the mark');
  const markBefore = await page.$('.ow-waymark__mark');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  const scrolled = await page.evaluate(() => window.scrollY);
  await worldChange();
  check(tag, !(await markBefore.evaluate((n) => n.isConnected)) && (await onMark()), 'a world change after: focus on the new mark');
  const after = await page.evaluate(() => window.scrollY);
  check(tag, scrolled > 200 && Math.abs(after - scrolled) < 2, `and the page stays where it was scrolled (${scrolled} then ${after})`);
  check(tag, page.url().endsWith(`/e/${ADA}`), 'still on the element');

  // A key someone lent, with no account role: the site goes by its own sign-in, so only the public page.
  await patchApp(page, { role: undefined, memberRole: undefined, publicPageOn: false, publicPageAt: Date.now() });
  await page.goto(`${BASE}/?lent#/w/${WID}`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  check(tag, (await marks.count()) === 0, 'a lent write key with the public page off: no mark');

  // A read key: the public face, only while the public page was last said on.
  await patchApp(page, { apiKey: READ, keyKind: 'read', role: undefined, memberRole: undefined, publicPageOn: false, publicPageAt: Date.now() });
  await page.goto(`${BASE}/?read#/w/${WID}`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  check(tag, (await marks.count()) === 0, 'a read key with the public page off: no mark');
  await patchApp(page, { publicPageOn: true, publicPageAt: Date.now() });
  await page.goto(`${BASE}/?read2#/w/${WID}`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await homeMark.waitFor({ timeout: 10000 }).catch(() => {});
  check(tag, (await homeMark.count()) === 1, 'a read key with the public page on: the mark');
  await homeMark.tap();
  await page.waitForTimeout(300);
  check(tag, (await page.locator('.ow-waymark__door').count()) === 0, 'the public face shows no last door');
  await page.keyboard.press('Escape');

  check(tag, errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await browser.close();
}

// A window wider than a phone (a tablet, a desktop browser, a phone on its side): the fan-out is a
// pop with no scrim, so a press outside it lands on the page. With a world change held, the press on
// the element's name must still open its rename sheet (the held refresh waits for its click), and the
// head is rebuilt after.
async function wide(engine, tag) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, (r) => r.abort());
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'coast.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await patchApp(page, { kind: 'online', apiKey: WRITE, keyKind: 'write', role: 'owner' });
  await page.goto(`${BASE}/?wide#/w/${WID}/e/${ADA}`);
  await page.waitForSelector('[data-screen="element"] .el-head .ow-waymark__mark', { timeout: 20000 });
  await page.locator('.ow-waymark__mark').click();
  await page.waitForTimeout(300);
  const open = await page.evaluate(() => !!document.querySelector('.ow-waymark__mark[aria-expanded="true"]'));
  const sheet = await page.evaluate(() => !!document.querySelector('.ow-waymark--sheet'));
  check(tag, open && !sheet, 'wide: a click opens the fan-out as a pop, not a sheet');
  const headBefore = await page.$('.el-head');
  await ctx.setOffline(true);
  await ctx.setOffline(false);
  await page.waitForTimeout(400);
  check(tag, await headBefore.evaluate((n) => n.isConnected), 'wide: a world change waits while it is open');
  await page.locator('[data-screen="element"] .el-head h1').click();
  await page.waitForTimeout(600);
  check(tag, (await page.locator('.sheet[role="dialog"]').count()) === 1, 'wide: a press on the name outside it opens the rename sheet');
  check(tag, !(await headBefore.evaluate((n) => n.isConnected)), 'wide: the held world change ran after the press landed');
  check(tag, errors.length === 0, `wide: no page errors (${errors.join(' | ')})`);
  await browser.close();
}

if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
// Firefox is a phone browser too, and the press-then-click hold broke there alone in Atlas.
if (!only || only === 'firefox') await walk(firefox, null, 'firefox');
if (!only || only === 'chromium') await wide(chromium, 'chromium');
if (!only || only === 'firefox') await wide(firefox, 'firefox');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
