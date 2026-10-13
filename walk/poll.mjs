// The poll while open (Kael's story 2: the reveal reaches a player at the table), both engines.
// The demo world, made to look like a player's world; keel routed to a fake feed; Playwright's
// clock runs the app's timers, so twenty seconds pass in a moment. Checks: a poll every 20 s while
// in front, quiet (no banner); a reveal arrives on the player's home without a tap; hidden, no poll.
// Run: npm run build && (npx vite preview &) && node walk/poll.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto(BASE);
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  const worldId = await page.evaluate(() => location.hash.split('/')[2]);
  await page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction('worlds', 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, kind: 'online', role: 'collaborator', memberRole: 'guest', apiKey: 'ow_r_' + 'p'.repeat(40), keyKind: 'read', cursor: '100' });
          t.oncomplete = () => res(true);
        };
      }),
    worldId,
  );

  // The fake feed: nothing new until the game master gives the party something.
  let heads = 0;
  let walks = 0;
  let reveal = false;
  await page.route('**/api/v2/**', (r) => {
    const path = new URL(r.request().url()).pathname.replace('/api/v2', '');
    if (path.startsWith('/changes')) {
      const url = new URL(r.request().url());
      const head = reveal ? 101 : 100;
      // keel's head read (Skeld, h29 #3511): only the tip, no bodies.
      if (url.searchParams.get('head') === 'true') {
        heads++;
        return r.fulfill(json({ head, cursor: String(head) }));
      }
      walks++;
      const el = { id: '0199c0de-0000-7000-8000-00000000r001', type: 'narrative', name: 'A rusted sword', description: 'It hums when you hold it.', updated_at: '2030-01-01T00:00:00Z' };
      const since = Number(url.searchParams.get('since') ?? 0);
      const changes = reveal && since < 101 ? [{ op: 'upsert', id: el.id, type: 'narrative', element: el, change_seq: 101 }] : [];
      return r.fulfill(json({ cursor: String(head), changes, has_more: false, head }));
    }
    if (path.startsWith('/me')) return r.fulfill(json({ role: 'guest', character: null }));
    if (path.startsWith('/world')) return r.fulfill(json({ id: worldId, name: 'Moppetopia' }));
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.clock.install();
  await page.goto(`${BASE}/?poll#/w/${worldId}`);
  await page.waitForSelector('[data-screen="home"]');
  await page.waitForTimeout(500);
  const atOpen = { heads, walks };
  check(tag, walks >= 1, `the launch walks the feed (${walks})`);

  // 1. Twenty seconds in front: one quiet look, no banner
  let banners = 0;
  await page.exposeFunction('sawBanner', () => banners++);
  await page.evaluate(() => new MutationObserver(() => document.querySelector('.banner') && window.sawBanner()).observe(document.body, { subtree: true, childList: true }));
  await page.clock.runFor(21_000);
  await page.waitForTimeout(300);
  check(tag, heads === atOpen.heads + 1 && walks === atOpen.walks, `twenty seconds in front: one head read, no walk (${heads - atOpen.heads}, ${walks - atOpen.walks})`);
  check(tag, banners === 0, 'the look is quiet: no banner');
  check(tag, (await page.locator('.toast').count()) === 0, 'nothing new: nothing said');

  // 2. The game master gives it: the next look brings it to the player's home, no tap
  reveal = true;
  await page.clock.runFor(20_000);
  await page.waitForFunction(() => /A rusted sword/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
  check(tag, /A rusted sword/.test(await page.locator('main').innerText()), 'the reveal appears on the player\'s home by itself');
  const said = await page.locator('.toast').innerText().catch(() => '');
  check(tag, said === 'New: A rusted sword', `and the player is told: ${JSON.stringify(said)}`);
  check(tag, banners === 0, 'still no banner');

  // 3. Hidden (the phone locked, another app in front): no looks
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenAt = heads + walks;
  await page.clock.runFor(65_000);
  await page.waitForTimeout(300);
  check(tag, heads + walks === hiddenAt, `hidden for a minute: no looks (${heads + walks - hiddenAt})`);

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
