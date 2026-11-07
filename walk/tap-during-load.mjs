// A tap pressed while a screen's late read is still on its way opens what it was pressed on.
// Each case holds one read until the press is down, lets it go, waits for its answer to land, then
// lifts the finger: before the press guard, the screen was rebuilt under the finger and the tap
// did nothing (a slow phone's lost tap).
//   Your worlds: the cached list draws, then the account's list lands and redraws it (Settings pressed).
//   An element page: its trail read lands after it opens and redraws it (a friend's link chip pressed).
// Run: npm run build && (npx vite preview --port 5181 --host 127.0.0.1 &) && node walk/tap-during-load.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';

const BASE = process.env.LANTERN_URL ?? 'http://127.0.0.1:5181';
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const WID = '0aaa0000-0000-4000-8000-0000000000ab';
const TOR = '0ccc0000-0000-4000-8000-0000000000cc';
const ANA = '0ccc0000-0000-4000-8000-0000000000ad';
const KEY = 'ow_r_' + 'q'.repeat(30);
const TOR_EL = { id: TOR, type: 'character', name: 'Tor', description: 'A ferryman.', supertype: '', subtype: '', image_url: '', physicality: 'Broad', friends: [ANA], species: [], created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', change_seq: 2, created_by: null, changed_by: null, changed_via: null };
const ANA_EL = { ...TOR_EL, id: ANA, name: 'Ana', description: 'Sells mules.', friends: [], change_seq: 1 };

/** A gate: the first request matching `re` waits until `open()`; `landed` resolves when its answer is back. */
function holdFirst() {
  let open, answered;
  const gate = new Promise((r) => { open = r; });
  const landed = new Promise((r) => { answered = r; });
  return { gate, open: () => open(), landed, answered: () => answered(), used: false };
}

/** Press `loc`, let the held read go while the finger is down, lift after it lands; true if `opened()` comes true. */
async function pressThrough(page, loc, hold, opened, arg = null) {
  await loc.waitFor({ timeout: 15000 });
  const box = await loc.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  hold.open();
  await hold.landed;
  await page.waitForTimeout(600); // the answer's redraw (or its hold) has run
  await page.mouse.up();
  return page.waitForFunction(opened, arg, { timeout: 5000 }).then(() => true, () => false);
}

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const watchdog = setTimeout(() => { console.log(`[${tag}] watchdog: 120 s`); process.exit(2); }, 120_000);
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/ERR_FAILED|cancelled/i.test(m.text()) && errors.push(m.text()));

  // Your worlds is visited three times (two in Chromium): each visit's account read gets its own hold.
  const dragHold = holdFirst(); // a press on the heading moved off: no click on a control
  const linkDragHold = holdFirst(); // WebKit: Settings dragged as a link
  const worldsHold = holdFirst(); // Settings tapped
  const worldsHolds = tag === 'webkit' ? [dragHold, linkDragHold, worldsHold] : [dragHold, worldsHold];
  const trailHold = holdFirst();
  const FRESH = { data: [{ id: '0bbb0000-0000-4000-8000-0000000000bb', name: 'Fresh world', role: 'owner' }] };
  // keel's API host only: the page itself may be lantern.onlyworlds.com.
  await page.route(/www\.onlyworlds\.com\/api\//, async (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const held = async (hold, status, body) => {
      if (hold.used) return json(status, body);
      hold.used = true;
      await hold.gate;
      await json(status, body);
      hold.answered();
    };
    if (req.method() === 'GET' && path === '/account/worlds') return held(worldsHolds.find((x) => !x.used) ?? worldsHold, 200, FRESH);
    if (req.method() === 'GET' && path === '/account/me') return json(200, { id: 7, username: 'walker' });
    if (req.method() === 'POST' && path === '/join/preview') {
      return json(200, { reader: 'player', world: { name: 'The Reach', description: 'Salt and debts.' }, invited_by: 'Ada', owner_character: null, role: 'guest', with_character: true, expires_at: '2027-10-27T00:00:00+00:00' });
    }
    if (req.method() === 'POST' && path === '/join') {
      return json(201, { kind: 'player', key: KEY, world: { id: WID, name: 'The Reach', description: 'Salt and debts.' }, character: { id: TOR, name: 'Tor' }, role: 'guest' });
    }
    if (req.headers()['api-key'] !== KEY || req.method() !== 'GET') return json(404, { error: { code: 'not_found', message: 'not_found' } });
    if (path === '/world') return json(200, { id: WID, name: 'The Reach', description: 'Salt and debts.' });
    if (path === '/me') return json(200, { kind: 'player', role: 'guest', character: TOR, scope: 'read' });
    if (path === '/changes') {
      const changes = [ANA_EL, TOR_EL].map((e) => ({ op: 'upsert', id: e.id, type: e.type, element: e, change_seq: e.change_seq }));
      return json(200, { cursor: '2:ffffffff:1', changes, has_more: false, head: 2, epoch: 1, epoch_reason: 'view' });
    }
    if (/\/files$/.test(path)) return json(200, { results: [] });
    if (path === `/character/${TOR}`) return held(trailHold, 200, { ...TOR_EL, doors: null });
    if (path === `/character/${ANA}`) return json(200, { ...ANA_EL, doors: null });
    return json(404, { error: { code: 'not_found', message: 'not_found' } });
  });

  try {
    // 1. Your worlds, signed in: the cached list first, the account's list late.
    // Your worlds signed out first, so the app has made its store before the walk writes into it.
    await page.goto(`${BASE}/#/worlds`);
    await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached', timeout: 15000 });
    await page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('lantern');
      r.onsuccess = () => {
        const t = r.result.transaction(['kv'], 'readwrite');
        t.objectStore('kv').put('ow_a_' + 'w'.repeat(40), 'accountToken');
        t.objectStore('kv').put([], 'accountWorlds');
        t.objectStore('kv').put(7, 'accountId');
        t.oncomplete = () => { r.result.close(); res(true); };
        t.onerror = () => rej(t.error);
      };
    }));
    // A press that ends without its click (moved off, or a link dragged): the held redraw still lands.
    const noClick = async (hold, target, what) => {
      // The visit before cached the account's list: put the empty cache back.
      await page.evaluate(() => new Promise((res) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction(['kv'], 'readwrite');
          t.objectStore('kv').put([], 'accountWorlds');
          t.oncomplete = () => { r.result.close(); res(true); };
        };
      }));
      await page.goto(`${BASE}/?${hold === dragHold ? 'off' : 'linkdrag'}#/worlds`);
      const loc = page.locator(target).first();
      await loc.waitFor({ timeout: 15000 });
      const first = (await page.locator('[data-screen="worlds"]', { hasText: 'Fresh world' }).count()) === 0;
      const g = await loc.boundingBox();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      hold.open();
      await hold.landed;
      await page.waitForTimeout(300);
      await page.mouse.move(40, g.y + 300, { steps: 4 });
      await page.mouse.up();
      const drawn = await page.waitForFunction(() => document.querySelector('[data-screen="worlds"]')?.textContent?.includes('Fresh world'), null, { timeout: 2000 }).then(() => true, () => false);
      const hashNow = await page.evaluate(() => location.hash);
      check(tag, first && drawn && hashNow === '#/worlds', `${what}: the cached list first, then the account's list draws once the finger is up (first ${first}, drawn ${drawn}, ${hashNow})`);
    };
    await noClick(dragHold, '[data-screen="worlds"] h1', 'a press on the heading moved off');
    // A link dragged with a mouse becomes a native drag in WebKit: no pointerup, no click, no cancel.
    // (Playwright's Chromium intercepts drags and stalls on a dragged node rebuilt, so WebKit's alone.)
    if (tag === 'webkit') await noClick(linkDragHold, '[data-screen="worlds"] a[aria-label="Settings"]', 'Settings dragged off as a link');

    await page.goto(`${BASE}/?worlds#/worlds`);
    const settings = page.locator('[data-screen="worlds"] a[aria-label="Settings"]');
    const a = await pressThrough(page, settings, worldsHold, () => location.hash === '#/settings');
    check(tag, worldsHold.used, "Your worlds asked the account's list, and it was held under the press");
    check(tag, a, `Settings pressed while the account's list lands opens Settings (${await page.evaluate(() => location.hash)})`);

    // 2. An element page: Tor opens, his trail read lands late; Ana's chip is pressed meanwhile.
    await page.goto(`${BASE}/?join#/join/ow_j_tapload`);
    await page.waitForSelector('.invite', { timeout: 15000 });
    await page.getByRole('button', { name: 'Open The Reach' }).tap();
    await page.waitForSelector('[data-screen="home"] .el-row', { timeout: 15000 });
    await page.goto(`${BASE}/?tor#/w/${WID}/e/${TOR}`);
    await page.waitForSelector('[data-screen="element"] h1', { timeout: 15000 });
    const chip = page.locator(`[data-screen="element"] a.link-chip[href="#/w/${WID}/e/${ANA}"]`).first();
    const b = await pressThrough(page, chip, trailHold, (id) => location.hash.endsWith(id), ANA);
    check(tag, trailHold.used, "Tor's page asked keel for his trail, and it was held under the press");
    check(tag, b, `Ana's chip pressed while Tor's trail lands opens Ana (${await page.evaluate(() => location.hash)})`);
  } catch (e) {
    check(tag, false, `${e.message.split('\n')[0]}`);
  }
  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  clearTimeout(watchdog);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
