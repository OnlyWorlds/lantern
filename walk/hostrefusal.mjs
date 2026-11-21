// The web host's refusal: the host in front of OnlyWorlds answers a write whose text holds a shell
// command after a code mark with its own 403 page ("Blocked"), before keel sees it. On a played keel
// that refuses only such text, the phone says the host refused that one change, keeps the text on the
// screen, sends every other element's change, never blames the key, never sends the refused text again
// by itself, and sends it once the text is changed.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/hostrefusal.mjs [chromium|webkit]
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

const HTML403 = '<!DOCTYPE html><html><head><title>Blocked</title></head><body><h1>Sorry, you have been blocked</h1></body></html>';
const WID = '0f0f0f0f-0000-4000-8000-0000000e4032';
const ADA = '0f0f0f0f-0000-4000-8000-0000000c0011';
const BO = '0f0f0f0f-0000-4000-8000-0000000c0012';
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'Host ground' }) },
      { path: `elements/character/ada--${ADA.slice(-8)}.json`, data: enc({ id: ADA, name: 'Ada', description: 'A cartographer.' }) },
      { path: `elements/character/bo--${BO.slice(-8)}.json`, data: enc({ id: BO, name: 'Bo', description: 'A ferryman.' }) },
    ],
    'Host ground',
  ),
);
const BAD = 'Ada, who runs `python -m http.server`';

async function run(engine, name, device) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[device], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  // WebKit names a poll its own navigation cancelled "due to access control checks" (as walk/opendoor.mjs reads it).
  page.on('pageerror', (e) => !/due to access control checks/.test(e.message) && errors.push(e.message));
  const writes = [];
  let head = 100;
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  // Only keel's host is played; Lantern's own host is never routed.
  await page.route(/^https:\/\/www\.onlyworlds\.com\//, (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const path = u.pathname.replace('/api/v2', '');
    const method = req.method();
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };
    if (method === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } });
    if (path.startsWith('/changes')) {
      if (u.searchParams.get('head') === 'true') return r.fulfill({ ...json({ head, cursor: String(head) }), headers: cors });
      return r.fulfill({ ...json({ cursor: String(head), changes: [], has_more: false, head }), headers: cors });
    }
    if (method === 'PATCH' || method === 'POST' || method === 'DELETE') {
      const body = req.postData() ?? '';
      if (/python -m/.test(body)) {
        writes.push({ method, path, answer: 403 });
        return r.fulfill({ status: 403, headers: { ...cors, server: 'cloudflare' }, contentType: 'text/html; charset=UTF-8', body: HTML403 });
      }
      writes.push({ method, path, answer: 200 });
      const m = path.match(/^\/([a-z]+)\/([^/]+)\/?$/);
      head += 1;
      const el = { ...(m ? { id: m[2], type: m[1] } : {}), ...JSON.parse(body || '{}'), change_seq: head, updated_at: new Date().toISOString() };
      return r.fulfill({ ...json(el), headers: cors });
    }
    if (path.startsWith('/me')) return r.fulfill({ ...json({ role: 'owner', character: null }), headers: cors });
    if (path.startsWith('/world')) return r.fulfill({ ...json({ id: WID, name: 'Host ground' }), headers: cors });
    return r.fulfill({ ...json({ error: { code: 'not_found' } }, 404), headers: cors });
  });

  await page.clock.install();
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'Host.zip', mimeType: 'application/zip', buffer: zip });
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
          g.onsuccess = () => st.put({ ...g.result, kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'p'.repeat(40), keyKind: 'write', cursor: '100' });
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
    await page.waitForTimeout(1200);
  };
  const text = () => page.evaluate(() => document.body.innerText);
  const patches = (id) => writes.filter((w) => w.method === 'PATCH' && w.path.includes(id));

  await rename(ADA, BAD);
  await rename(BO, 'Bo Vell');
  check(name, patches(BO).some((w) => w.answer === 200), "the next element's change is sent after the refused one");
  await page.goto(`${BASE}/#/w/${worldId}/e/${ADA}`);
  await page.waitForSelector(`[data-screen="element"][data-id="${ADA}"] .el-head h1`);
  check(name, (await page.locator('.el-head h1').innerText()).includes('python -m'), 'the refused text stays on the screen');
  check(name, /A change to this was not sent/.test(await text()), "the element's page says a change was not sent");
  await page.goto(`${BASE}/#/w/${worldId}/outbox`);
  await page.waitForSelector('[data-screen="outbox"]');
  const box = await text();
  check(name, /The web host in front of OnlyWorlds refused this change before it reached OnlyWorlds\. A command written between code marks/.test(box), 'Waiting to send says the host refused it, and the usual cause');
  await page.screenshot({ path: `${OUT}/hostrefusal-${name}-outbox.png` });
  await page.goto(`${BASE}/#/w/${worldId}`);
  await page.waitForSelector('[data-screen="home"]');
  const sent = patches(ADA).length;
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(10_000);
    await page.waitForTimeout(200);
  }
  const home = await text();
  check(name, !/key can no longer|PIN|no longer opens/i.test(home), 'the home never blames the key or the PIN');
  check(name, patches(ADA).length === sent, `not sent again by itself across four polls (${patches(ADA).length - sent} more)`);
  await rename(ADA, 'Ada, who runs a small server');
  check(name, patches(ADA).at(-1)?.answer === 200, 'changed, it goes up');
  const left = await page.evaluate((id) => new Promise((res) => { const r = indexedDB.open(`lantern-world-${id}`); r.onsuccess = () => { const g = r.result.transaction('outbox').objectStore('outbox').count(); g.onsuccess = () => { res(g.result); r.result.close(); }; }; }), worldId);
  check(name, left === 0, `nothing left waiting (${left})`);
  check(name, errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await run(chromium, 'chromium', 'Pixel 7');
if (!only || only === 'webkit') await run(webkit, 'webkit', 'iPhone 13');
console.log(failures ? `${failures} failed` : 'all ok');
process.exit(failures ? 1 : 0);
