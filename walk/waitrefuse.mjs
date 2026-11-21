// keel's refusal of one change, and keel's wait. On a played keel:
// 1. keeper_only on a Law (the world's house is its keepers', keel's HOUSE_TYPES law and object): that
//    one change is refused in keel's words (the route it points a program at left out), every other
//    element's change goes, the key and the PIN are never blamed, and the poll never sends the refused
//    change again. The Law's next edit takes its place and is sent once (refused again here).
// 2. 429 rate_limited with Retry-After 900 (the wrong-PIN lock): nothing is sent for the whole 900 s,
//    whatever asks (the poll, a new save, a reload); Waiting to send and the home say why and until
//    when; once it ends the changes go by themselves.
// 3. The PIN sheet under the lock: a 429 on its /me says the wait and keeps it for the account; a second
//    press sends nothing; the home then says the wait, never asks for the PIN before it ends.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/waitrefuse.mjs [chromium|webkit]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const WID = '0f0f0f0f-0000-4000-8000-0000000e4290';
const ADA = '0f0f0f0f-0000-4000-8000-0000000c0291'; // a Law: the world's charter
const BO = '0f0f0f0f-0000-4000-8000-0000000c0292';
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'Wait ground' }) },
      { path: `elements/law/the-charter--${ADA.slice(-8)}.json`, data: enc({ id: ADA, name: 'The charter', description: 'How the house is kept.' }) },
      { path: `elements/character/bo--${BO.slice(-8)}.json`, data: enc({ id: BO, name: 'Bo', description: 'A ferryman.' }) },
    ],
    'Wait ground',
  ),
);
// keel's words (elements/charter.py HOUSE_MESSAGE) and what the phone keeps of them.
const houseMessage = (type, id) =>
  `Only the world's owner and co-builders change this element. Nothing was written. Ask one of them, or propose the change: POST /api/v2/${type}/${id}/proposals.`;
const HOUSE_SAID = "Only the world's owner and co-builders change this element. Nothing was written. Ask one of them, or propose the change.";
const LOCK_S = 900;

async function run(engine, name, device) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[device], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  // WebKit names a poll its own navigation cancelled "due to access control checks" (as walk/opendoor.mjs reads it).
  page.on('pageerror', (e) => !/due to access control checks/.test(e.message) && errors.push(e.message));
  const writes = [];
  /** Every request that carried a PIN, whatever keel answered. */
  const pinned = [];
  let head = 100;
  /** Set: keel's PIN wall is locked; every request carrying a PIN is 429 with this Retry-After (core/auth.py). */
  let locked = null;
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  // Only keel's host is played; Lantern's own host is never routed.
  await page.route(/^https:\/\/www\.onlyworlds\.com\//, (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const path = u.pathname.replace('/api/v2', '');
    const method = req.method();
    // keel exposes Retry-After to browser code (config/settings CORS_EXPOSE_HEADERS).
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Retry-After' };
    if (method === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } });
    const pin = req.headers()['api-pin'];
    if (pin) pinned.push(`${method} ${path}`);
    if (pin && locked !== null) {
      writes.push({ method, path, answer: 429 });
      return r.fulfill({
        status: 429,
        headers: { ...cors, 'Retry-After': String(locked) },
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'rate_limited', type: 'rate_limited', message: 'Too many failed PIN attempts. Try again later.', param: null } }),
      });
    }
    if (path.startsWith('/changes')) {
      if (u.searchParams.get('head') === 'true') return r.fulfill({ ...json({ head, cursor: String(head) }), headers: cors });
      return r.fulfill({ ...json({ cursor: String(head), changes: [], has_more: false, head }), headers: cors });
    }
    if (method === 'PATCH' || method === 'POST' || method === 'DELETE') {
      const m = path.match(/^\/([a-z]+)\/([^/]+)\/?$/);
      // keel's house is Laws and Objects (elements/charter.py HOUSE_TYPES).
      if (m && m[2] === ADA && (m[1] === 'law' || m[1] === 'object')) {
        writes.push({ method, path, answer: 403 });
        return r.fulfill({ ...json({ error: { code: 'keeper_only', type: 'permission_error', message: houseMessage(m[1], m[2]), param: 'id' } }, 403), headers: cors });
      }
      writes.push({ method, path, answer: 200 });
      head += 1;
      const el = { ...(m ? { id: m[2], type: m[1] } : {}), ...JSON.parse(req.postData() || '{}'), change_seq: head, updated_at: new Date().toISOString() };
      return r.fulfill({ ...json(el), headers: cors });
    }
    if (path.startsWith('/me')) return r.fulfill({ ...json({ role: 'owner', character: null }), headers: cors });
    if (path.startsWith('/world')) return r.fulfill({ ...json({ id: WID, name: 'Wait ground' }), headers: cors });
    return r.fulfill({ ...json({ error: { code: 'not_found' } }, 404), headers: cors });
  });

  await page.clock.install();
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'Wait.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  const worldId = await page.evaluate(() => location.hash.split('/')[2]);
  // The world as an online one with a write key and the account PIN, its cursor at the played head.
  await page.evaluate(
    (id) =>
      new Promise((res) => {
        localStorage.setItem('lantern-pin-account', '1234');
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction('worlds', 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'q'.repeat(40), keyKind: 'write', cursor: '100' });
          t.oncomplete = () => res(true);
        };
      }),
    worldId,
  );
  await page.goto(`${BASE}/#/w/${worldId}`);
  await page.reload();
  await page.waitForSelector('[data-screen="home"]');

  const rename = async (id, to) => {
    await page.goto(`${BASE}/#/w/${worldId}/e/${id}`);
    // This element's own page, never the one the walk came from (a hash change keeps the old one a moment).
    await page.waitForSelector(`[data-screen="element"][data-id="${id}"] .el-head h1`);
    await page.locator('.el-head h1').tap();
    await page.locator('.sheet input').fill(to);
    await page.getByRole('button', { name: 'Save' }).tap();
    await page.waitForSelector('.toast');
    const said = await page.locator('.toast').innerText();
    await page.waitForTimeout(1200);
    return said;
  };
  const text = () => page.evaluate(() => document.body.innerText);
  const patches = (id) => writes.filter((w) => w.method === 'PATCH' && w.path.includes(id));
  const outbox = async () => {
    await page.goto(`${BASE}/#/w/${worldId}/outbox`);
    await page.waitForSelector('[data-screen="outbox"]');
    return text();
  };
  const home = async () => {
    await page.goto(`${BASE}/#/w/${worldId}`);
    await page.waitForSelector('[data-screen="home"]');
  };
  const polls = async (n) => {
    for (let i = 0; i < n * 2; i++) {
      await page.clock.runFor(10_000);
      await page.waitForTimeout(150);
    }
  };

  // ---- 1. keeper_only: one change refused, the rest goes, never sent again by itself
  await rename(ADA, 'The charter, amended');
  await rename(BO, 'Bo Vell');
  check(name, patches(ADA).length === 1 && patches(ADA)[0].answer === 403, 'keel refused the house element (keeper_only)');
  check(name, patches(BO).some((w) => w.answer === 200), "the next element's change is sent after the refused one");
  const box1 = await outbox();
  check(name, box1.includes(`Not sent: ${HOUSE_SAID}`), "Waiting to send says it in keel's words");
  check(name, !/\/api\//.test(box1), 'no API route on the screen');
  await page.screenshot({ path: `${OUT}/waitrefuse-${name}-refused.png` });
  await home();
  const sentAda = patches(ADA).length;
  await polls(3);
  const h1 = await text();
  check(name, !/key can no longer|only reads|PIN|no longer opens/i.test(h1), 'the home never blames the key or the PIN');
  check(name, patches(ADA).length === sentAda, `not sent again by itself across three polls (${patches(ADA).length - sentAda} more)`);
  // The Law's next edit is the person's new act: it takes the refused change's place and goes once.
  await rename(ADA, 'The charter, as read at dusk');
  check(name, patches(ADA).length === sentAda + 1 && patches(ADA).at(-1).answer === 403, `the next edit goes once and is refused again (${patches(ADA).length - sentAda})`);
  const box1b = await outbox();
  check(name, (box1b.match(/Not sent: Only the world's owner/g) ?? []).length === 1, 'one refused row: the new edit took the old one\'s place');
  check(name, !/send by themselves/.test(box1b), 'never "They send by themselves" over a refused change');
  await home();
  await polls(2);
  check(name, patches(ADA).length === sentAda + 1, 'the new edit is not sent again by itself');
  const sentAgain = patches(ADA).length;

  // ---- 2. 429 with Retry-After 900: the world's wait, honoured in full
  locked = LOCK_S;
  await rename(BO, 'Bo Vellen');
  const first = writes.filter((w) => w.answer === 429).length;
  check(name, first === 1, `keel's lock met once (${first})`);
  const kept = await page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          // The wrong-PIN lock is the account's (keel counts it there): kept under the account's PIN.
          const g = r.result.transaction('kv').objectStore('kv').get('sendWait:lantern-pin-account');
          g.onsuccess = () => res({ wait: g.result, now: Date.now() });
        };
      }),
    worldId,
  );
  const secs = kept.wait ? Math.round((kept.wait.until - kept.now) / 1000) : null;
  check(name, secs !== null && secs >= LOCK_S - 5 && secs <= LOCK_S + 1, `the wait kept is keel's ${LOCK_S} s in full (${secs} s)`);
  const box2 = await outbox();
  check(name, /OnlyWorlds is holding off after too many wrong PINs\. Your changes wait on this phone and go by themselves at \S/.test(box2), 'Waiting to send says why and until when');
  check(name, (await page.locator('[data-action="send-now"]').count()) === 0, 'no Send now while the wait runs');
  await page.screenshot({ path: `${OUT}/waitrefuse-${name}-wait.png` });
  await home();
  check(name, (await page.locator('.banner[data-wait]').count()) === 1, 'the home says the wait');
  check(name, !/Try again/.test(await page.locator('.banner[data-wait]').innerText()), 'the home offers no Try again during it');

  locked = null; // keel would take it now; the phone waits as it was told
  const writesAt = writes.length;
  await polls(10); // 200 s of polls
  const savedSaid = await rename(BO, 'Bo Vellena'); // a new save
  check(name, /^Saved\. It waits on this phone and goes by itself at \S/.test(savedSaid), `a save during the wait says when it goes (${savedSaid})`);
  check(name, writes.length === writesAt, `nothing sent by polls or a new save during the wait (${writes.length - writesAt})`);
  await page.reload();
  await page.waitForSelector('[data-screen]');
  await page.waitForTimeout(800);
  await polls(5);
  check(name, writes.length === writesAt, `nothing sent after a reload during the wait (${writes.length - writesAt})`);
  const box3 = await outbox();
  check(name, /go by themselves at \S/.test(box3), 'after a reload, Waiting to send still says until when');
  await home();

  // Run the clock to just short of the end, then past it.
  const left = await page.evaluate((u) => u - Date.now(), kept.wait.until);
  await page.clock.runFor(Math.max(left - 20_000, 0));
  await page.waitForTimeout(400);
  check(name, writes.length === writesAt, `still nothing 20 s before the end (${writes.length - writesAt})`);
  await page.clock.runFor(25_000);
  await page.waitForTimeout(1500);
  const after = patches(BO).at(-1);
  check(name, after?.answer === 200, 'once the wait ends, the change goes by itself');
  const leftRows = await page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open(`lantern-world-${id}`);
        r.onsuccess = () => {
          const g = r.result.transaction('outbox').objectStore('outbox').getAll();
          g.onsuccess = () => {
            res(g.result.map((x) => x.state));
            r.result.close();
          };
        };
      }),
    worldId,
  );
  check(name, leftRows.length === 1 && leftRows[0] === 'refused', `only the refused house change is left (${JSON.stringify(leftRows)})`);
  check(name, patches(ADA).length === sentAgain, 'the refused change was never sent again');

  // ---- 3. The PIN sheet under the lock
  locked = LOCK_S;
  await page.evaluate(() => localStorage.removeItem('lantern-pin-account'));
  await rename(BO, 'Bo of the far bank');
  await home();
  const ask = page.getByRole('button', { name: 'Enter your PIN' });
  check(name, (await ask.count()) === 1, 'with no PIN kept, the home asks for it');
  await ask.tap();
  await page.locator('.sheet input[aria-label="PIN"]').fill('1234');
  const before429 = writes.filter((w) => w.answer === 429).length;
  await page.getByRole('button', { name: 'Send my changes' }).tap();
  await page.waitForFunction(() => /Try again after/.test(document.querySelector('.sheet .error')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const said1 = (await page.locator('.sheet .error').textContent()) ?? '';
  check(name, /^OnlyWorlds is holding off after too many wrong PINs\. Try again after \S/.test(said1), `the PIN sheet says the wait (${said1})`);
  check(name, writes.filter((w) => w.answer === 429).length === before429 + 1 && writes.at(-1).path.startsWith('/me'), 'its /me met the lock once');
  locked = null;
  const atSecond = pinned.length;
  await page.getByRole('button', { name: 'Send my changes' }).tap();
  await page.waitForTimeout(800);
  // A sheet that took the PIN closes: read its words only while it is there.
  const said2 = (await page.locator('.sheet .error').count()) ? ((await page.locator('.sheet .error').textContent()) ?? '') : '(the sheet closed)';
  check(name, pinned.length === atSecond, `a second press sends no PIN (${pinned.length - atSecond})`);
  check(name, /Try again after \S/.test(said2), 'and says the wait again');
  await page.reload();
  await page.waitForSelector('[data-screen="home"]');
  await page.waitForTimeout(800);
  const banner = page.locator('.banner[data-wait]');
  check(name, (await banner.count()) === 1 && /Enter your PIN after \S/.test(await banner.innerText()), 'the home says the wait and when to enter the PIN');
  check(name, (await page.getByRole('button', { name: 'Enter your PIN' }).count()) === 0, 'no PIN question before the wait ends');
  await page.screenshot({ path: `${OUT}/waitrefuse-${name}-pinwait.png` });
  check(name, errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await run(chromium, 'chromium', 'Pixel 7');
if (!only || only === 'webkit') await run(webkit, 'webkit', 'iPhone 13');
console.log(failures ? `${failures} failed` : 'all ok');
process.exit(failures ? 1 : 0);
