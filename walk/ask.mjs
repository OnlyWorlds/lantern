// Ask in a sentence (Keel #159), as a phone taps it, both engines. The demo world, made to look
// like an account world on this phone, and keel's proxy routed to a fake that answers as its docs
// say, so no question is spent: the button shows only when it can be used; the sentence lands
// above its sources; a redraw keeps it; the allowance and a pause get their own sentences.
// Workers blocked: with one in control, Playwright's WebKit does not route the page's requests.
// Run: npm run build && (npx vite preview &) && node walk/ask.mjs [webkit|chromium]
import './guard.mjs';
// WebKit logs the viewport's interactive-widget key (Android Chrome's keyboard rule, S404) as unknown: harmless.
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const Q = 'Who is Admiral Fluffington?';

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/ask-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });
  let answer = json(200, { answer: 'Admiral Fluffington commands the Puddle Navy from the USS Fuzzball.', model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 812, output_tokens: 19 }, remaining: 49 });
  const asked = [];
  await page.route('**/api/v2/account/ask', (r) => {
    asked.push(JSON.parse(r.request().postData()));
    return r.fulfill(answer);
  });

  await page.goto(BASE);
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  const worldId = await page.evaluate(() => location.hash.split('/')[2]);

  // 1. The demo as it is: no sign-in, not an account world: no button
  await page.goto(`${BASE}/#/w/${worldId}/ask`);
  await page.locator('input[aria-label="Ask your world"]').fill(Q);
  await page.waitForSelector('[data-screen="ask"] .el-row');
  check(tag, (await page.getByRole('button', { name: 'Answer it in a sentence' }).count()) === 0, 'not signed in: no sentence button, the list alone');

  // 2. Signed in, an account world (the record says so): the button, and what it says it sends
  await page.evaluate(
    (id) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction(['worlds', 'kv'], 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, kind: 'online', role: 'owner' });
          t.objectStore('kv').put('ow_a_' + 'w'.repeat(40), 'accountToken');
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    worldId,
  );
  await page.goto(`${BASE}/?signed#/w/${worldId}/ask`);
  await page.locator('input[aria-label="Ask your world"]').fill(Q);
  await page.waitForSelector('[data-screen="ask"] .el-row');
  const btn = page.getByRole('button', { name: 'Answer it in a sentence' });
  await btn.waitFor({ timeout: 10000 });
  const hint = await page.locator('[data-sentence] p').innerText();
  check(tag, /Sends these \w+ to OnlyWorlds/.test(hint), `the button says what it sends: ${JSON.stringify(hint)}`);
  check(tag, asked.length === 0, 'nothing is asked before the tap');
  await shot('before');

  // 3. The tap: a sentence above the elements it came from
  await btn.tap();
  await page.waitForSelector('[data-answer="sentence"]');
  const said = await page.locator('[data-answer="sentence"]').innerText();
  check(tag, /Puddle Navy/.test(said), `the sentence: ${JSON.stringify(said)}`);
  check(tag, /49 left today/.test(await page.locator('[data-sentence]').innerText()), 'it says how many are left today');
  const sentBody = asked[0];
  check(tag, sentBody?.world_id === worldId && sentBody?.question === Q && sentBody.context.length >= 1 && sentBody.context.length <= 8, `the proxy got the world, the question and ${sentBody?.context.length} elements`);
  check(tag, sentBody.context.some((c) => c.startsWith('Admiral Fluffington (character')), 'the elements go as text, name and type first');
  const above = await page.evaluate(() => {
    const a = document.querySelector('[data-answer="sentence"]');
    const list = document.querySelector('[data-screen="ask"] .results');
    return !!(a && list && a.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check(tag, above, 'the sentence sits above its sources, which stay on screen');
  await shot('sentence');

  // 4. A redraw (the world syncing) keeps the answer that was given
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1500);
  check(tag, (await page.locator('[data-answer="sentence"]').count()) === 1 && asked.length === 1, 'a redraw keeps the answer, and asks nothing again');

  // 4b. A redraw while it is asking picks up the same box: no second tap, no second spend (the third gate)
  let release;
  const held = new Promise((r) => (release = r));
  await page.unroute('**/api/v2/account/ask');
  await page.route('**/api/v2/account/ask', async (r) => {
    asked.push(JSON.parse(r.request().postData()));
    await held;
    return r.fulfill(json(200, { answer: 'The USS Fuzzball floats in the Eternal Drip.', remaining: 48 }));
  });
  await page.locator('input[aria-label="Ask your world"]').fill('Where does the USS Fuzzball float?');
  await btn.waitFor({ timeout: 10000 });
  const before = asked.length;
  await btn.tap();
  await page.locator('input[aria-label="Ask your world"]').press('Enter');
  await page.waitForTimeout(400);
  const enabled = await page.getByRole('button', { name: 'Answer it in a sentence' }).isEnabled().catch(() => false);
  check(tag, !enabled, 'while it asks, the redrawn list shows the same box, its button not tappable');
  release();
  await page.waitForSelector('[data-answer="sentence"]');
  check(tag, asked.length === before + 1 && /Eternal Drip/.test(await page.locator('[data-answer="sentence"]').innerText()), `one question sent (${asked.length - before}), and its answer is the one on screen`);
  await page.unroute('**/api/v2/account/ask');
  await page.route('**/api/v2/account/ask', (r) => {
    asked.push(JSON.parse(r.request().postData()));
    return r.fulfill(answer);
  });

  // 5. Today's allowance spent, and a pause
  answer = json(429, { error: { code: 'quota_exceeded', message: 'quota' } });
  await page.locator('input[aria-label="Ask your world"]').fill('Where is the USS Fuzzball?');
  await btn.waitFor({ timeout: 10000 });
  await btn.tap();
  await page.waitForFunction(() => /used up/.test(document.querySelector('[data-sentence]')?.textContent ?? ''), null, { timeout: 10000 });
  check(tag, true, 'the allowance spent: its own sentence');
  answer = json(503, { error: { code: 'ask_unavailable', message: 'paused' } });
  await btn.tap();
  await page.waitForFunction(() => /paused/.test(document.querySelector('[data-sentence]')?.textContent ?? ''), null, { timeout: 10000 });
  check(tag, (await page.locator('[data-screen="ask"] .el-row').count()) > 0, 'paused: said, and the list stays');

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
