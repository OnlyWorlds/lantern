// Ask follows the phone's room switch (SDK 4.72's buildAskContext leaves the room out unless asked,
// Kael h56 #11977; src/ask.ts askContext): the room walk's world, made to look like an account world on
// this phone, the room shown by its card's tap, then a question whose answer is a room element: the
// routed proxy (no question spent) must get it. Before 4.72 the SDK sent the room anyway, so a build on
// 4.70 passes too: this walk proves the behaviour held across the SDK's move, not a change a person sees.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/askroom.mjs [webkit|chromium]
import './guard.mjs';
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { writeWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const wid = '0f0f0f0f-0000-4000-8000-0000000a0002';
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '1')}`;
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const file = (type, o) => ({ path: `elements/${type}/${o.name.toLowerCase().replace(/[^a-z]+/g, '-')}--${o.id.slice(-8)}.json`, data: enc({ ...o, type }) });
const zip = Buffer.from(writeWorldFile([
  { path: 'world.json', data: enc({ id: wid, name: 'Ask room walk' }) },
  file('character', { id: id(1), name: 'Bo', description: 'The bosun.' }),
  file('narrative', { id: id(2), name: 'Shall we rename Bo?', supertype: 'Message', description: 'Asked at the table.', x_room_of: wid }),
], 'askroom-walk'));

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const page = await (await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const asked = [];
  await page.route('**/api/v2/account/ask', (r) => {
    asked.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: 'Someone asked to rename Bo.', model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 90, output_tokens: 9 }, remaining: 49 }) });
  });

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'askroom-walk.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await page.locator('[data-action="room-shown"]').tap();
  await page.waitForTimeout(400);
  // An account world on this phone, signed in (ask.mjs's way); nothing reaches keel but the routed proxy.
  await page.evaluate((w) => new Promise((res, rej) => {
    const r = indexedDB.open('lantern');
    r.onsuccess = () => {
      const t = r.result.transaction(['worlds', 'kv'], 'readwrite');
      const st = t.objectStore('worlds');
      const g = st.get(w);
      g.onsuccess = () => st.put({ ...g.result, kind: 'online', role: 'owner' });
      t.objectStore('kv').put('ow_a_' + 'w'.repeat(40), 'accountToken');
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
    };
  }), wid);
  await page.goto(`${BASE}/?signed#/w/${wid}/ask`);
  await page.locator('input[aria-label="Ask your world"]').fill('rename');
  await page.waitForSelector('[data-screen="ask"] .el-row', { timeout: 10000 }).catch(() => {});
  const rows = await page.$$eval('[data-screen="ask"] .el-row', (rs) => rs.map((r) => r.textContent));
  check(tag, rows.some((x) => x.includes('Shall we rename Bo?')), `with the room shown, Ask finds the room's message (${JSON.stringify(rows)})`);
  const btn = page.getByRole('button', { name: 'Answer it in a sentence' });
  await btn.waitFor({ timeout: 10000 }).catch(() => {});
  if (await btn.count()) {
    await btn.tap();
    await page.waitForSelector('[data-answer]', { timeout: 10000 }).catch(() => {});
  }
  const sent = asked[0]?.context ?? [];
  check(tag, sent.some((c) => c.includes('Shall we rename Bo?')), `the proxy got the room's message (${sent.length} sent)`);
  check(tag, errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await browser.close();
}

for (const [engine, tag] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  if (!only || only === tag) await walk(engine, tag);
}
console.log(failures ? `askroom: ${failures} FAIL` : 'askroom: all ok');
process.exit(failures ? 1 : 0);
