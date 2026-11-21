// keel's refusal of one change, and keel's wait. On a played keel:
// 1. keeper_only (the world's house is its keepers'): that one change is refused in keel's words (the
//    route it points a program at left out), every other element's change goes, the key and the PIN
//    are never blamed, and the poll never sends the refused change again.
// 2. 429 rate_limited with Retry-After 900 (the wrong-PIN lock): nothing is sent for the whole 900 s,
//    whatever asks (the poll, a new save, a reload); Waiting to send and the home say why and until
//    when; once it ends the changes go by themselves.
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
const ADA = '0f0f0f0f-0000-4000-8000-0000000c0291';
const BO = '0f0f0f0f-0000-4000-8000-0000000c0292';
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'Wait ground' }) },
      { path: `elements/character/ada--${ADA.slice(-8)}.json`, data: enc({ id: ADA, name: 'Ada', description: 'Keeps the charter.' }) },
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
      if (m && m[2] === ADA) {
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
    await page.waitForSelector('.el-head h1');
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
  await rename(ADA, 'Ada, keeper of the charter');
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
          const g = r.result.transaction('kv').objectStore('kv').get(`sendWait:${id}`);
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
  check(name, patches(ADA).length === sentAda, 'the refused change was never sent again');
  check(name, errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await run(chromium, 'chromium', 'Pixel 7');
if (!only || only === 'webkit') await run(webkit, 'webkit', 'iPhone 13');
console.log(failures ? `${failures} failed` : 'all ok');
process.exit(failures ? 1 : 0);
