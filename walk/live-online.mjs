// Put it online keeps the World's own keys, read live on keel. A world file whose world.json carries the
// strand's x_strand, the names profile's x_names, another tool's atlas_ and shadow_ keys and the world's now
// is opened on the phone, signed in as crew-walk-b, and put online from Your worlds.
//   1. Lantern's own sign-in by email and password; every token keel mints for Lantern is recorded from keel's answer.
//   2. The world file opened; Put it online with the PIN. keel's 201 for the new world is recorded (id, name, key)
//      the moment it comes, before anything else.
//   3. The phone lands on the online world's home, where the strand shows its filled slots.
//   4. keel's own read of the world (GET /world with the world's key): each own key as the file gave it, the now
//      and its unit, the description.
//   5. Teardown: the world deleted on the site by its recorded id (its recorded name typed, and only when that
//      name is this run's), then the account's list read to show it gone; every recorded token revoked by id and
//      read back 401. A throw or the watchdog still runs it.
// A wrong PIN goes first: nothing is made, and the sheet says so; the right PIN then makes one world.
// The control is the live build before (9a0e88f): it must FAIL at the key checks and still delete its world.
// For the wrong PIN, a3679cb is the control: it makes the world empty and FAILs at those two checks.
// Then a second world file holding an id the first world now holds is put online: nothing may be made
// (keel's hand-over, one write). a331c51 is that control: it makes the world, the bulk is refused, an
// empty world stays (recorded from the account's list by this run's name, and torn down).
// Secrets are never printed.
// Run from tools/lantern:
//   CREW_FILE=<crew-walk-accounts.txt> [SERVE_DIST=dist] node walk/live-online.mjs [url] [chromium|webkit|firefox] [tag]
import fs from 'node:fs';
import { chromium, webkit, firefox, devices } from 'playwright';
import { OwV2Client, writeWorldFile } from '@onlyworlds/sdk';

const [, , url = 'https://lantern.onlyworlds.com', engine = 'chromium', tag = 'live'] = process.argv;
const OUT = 'walk/shots';
fs.mkdirSync(OUT, { recursive: true });
const API = 'https://www.onlyworlds.com/api/v2';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith('crew-walk-b ') && l.includes('@')).trim().split(/\s+/);
const pin = lines.find((l) => l.startsWith('crew-walk-b ') && /\bPIN\b/i.test(l))?.trim().split(/\s+/)[2];

let failures = 0;
const T = `[${engine} ${tag}]`;
const check = (ok, what) => { console.log(`${T} ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; return ok; };
const need = (ok, what) => { if (!check(ok, what)) throw new Error(`stopped: ${what}`); };
const limit = () => ({ signal: AbortSignal.timeout(15000) });
const sdkFetch = (u, init = {}) => fetch(u, { ...init, signal: init.signal ?? AbortSignal.timeout(15000) });
/** A JSON value with its object keys in order: keel stores a value as jsonb, which reorders keys. */
const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v);

// The world file: a story, its happening at a place, a hero there now. Ids fresh each run (keel's ids are global).
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const WORLD_NAME = `Online keys walk ${engine} ${stamp} (crew test)`;
const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
const run = `${hex()}${hex()}`;
const id = (n) => `019f${run.slice(0, 4)}-${run.slice(4, 8)}-7000-8000-${String(n).padStart(12, '0')}`;
const STORY = id(1), HAPPENING = id(2), PLACE = id(3), HERO = id(4);
const KEYS = {
  x_strand: { narrative: STORY, event: HAPPENING, location: PLACE },
  x_names: { character: 'Soul', characters: 'Souls' },
  atlas_home: { grid: [[1, 2], [3, 4]], note: 'kept as given' },
  shadow_note: 'kept as given',
};
const PRODUCER = { tool: 'lantern-walk', version: '1', input: 'bare' };
// A 1x1 picture the phone holds: it goes up after the world exists, on the phone's own key.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const world = { id: id(99), name: WORLD_NAME, description: 'A walk of Put it online.', time_current: 1204, time_basic_unit: 'Year', producer: PRODUCER, ...KEYS };
const enc = new TextEncoder();
const el = (type, slug, body) => ({ path: `elements/${type}/${slug}--${body.id.slice(-6)}.json`, data: enc.encode(JSON.stringify(body)) });
const file = writeWorldFile([
  { path: 'world.json', data: enc.encode(JSON.stringify(world)) },
  el('narrative', 'the-long-thaw', { id: STORY, name: 'The Long Thaw', events: [HAPPENING], protagonist: HERO }),
  el('event', 'the-ice-breaks', { id: HAPPENING, name: 'The Ice Breaks', locations: [PLACE] }),
  el('location', 'the-harbour', { id: PLACE, name: 'The harbour' }),
  el('character', 'ada', { id: HERO, name: 'Ada', location: PLACE, image_url: `data:image/png;base64,${PNG}` }),
], `online-keys-${run}`);

// Since 2026-11-07: a second world file holding an element whose id the first world now holds (a world file of an
// online world, opened as a new world): keel refuses it, and Put it online must leave no world on the
// account. The build before (a331c51) made the world, then the bulk refused: an empty world left.
const REFUSED_NAME = `${WORLD_NAME} refused`;
const refusedFile = writeWorldFile([
  { path: 'world.json', data: enc.encode(JSON.stringify({ id: id(98), name: REFUSED_NAME })) },
  el('narrative', 'the-long-thaw', { id: STORY, name: 'The Long Thaw again' }),
  el('character', 'bram', { id: id(5), name: 'Bram' }),
], `online-refused-${run}`);

// The record: what this run minted, by id. Only these are revoked or deleted.
const tokens = []; // { id, token, by }
const worlds = []; // { id, name, key }
const pending = [];

let tornDown = null;
function teardown(why) {
  tornDown ??= (async () => {
    console.log(`${T} teardown${why ? ` (${why})` : ''}: ${worlds.length} world, ${tokens.length} tokens recorded`);
    await Promise.allSettled(pending);
    const own = tokens.find((t) => t.by === 'walk')?.token;
    if (worlds.length) {
      const b = await chromium.launch();
      try {
        const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
        for (const w of worlds) {
          if (w.name !== WORLD_NAME && w.name !== REFUSED_NAME) { check(false, `teardown: world ${w.id} is named ${JSON.stringify(w.name)}, not this run's: left alone`); continue; }
          const del = `https://www.onlyworlds.com/account/worlds/${w.id}/delete`;
          await page.goto(del);
          await page.waitForLoadState('networkidle');
          if (await page.locator('input[type="password"]').count()) {
            await page.evaluate(() => localStorage.setItem('cookieNoticeAccepted', 'true'));
            await page.locator('input[name="login"], input[type="email"], input[name="email"], input[name="username"]').first().fill(email);
            await page.locator('input[type="password"]').first().fill(password);
            await page.locator('button[type="submit"], input[type="submit"]').first().click();
            await page.waitForLoadState('networkidle');
            if (!page.url().includes(`/account/worlds/${w.id}/delete`)) await page.goto(del);
            await page.waitForLoadState('networkidle');
          }
          await page.locator('form input[type="text"], form input:not([type])').first().fill(w.name);
          await page.locator('form button[type="submit"], form input[type="submit"]').last().click();
          await page.waitForLoadState('networkidle');
          const listed = own ? await (await fetch(`${API}/account/worlds`, { headers: { Authorization: `Bearer ${own}` }, ...limit() })).json().catch(() => null) : null;
          const ids = new Set((listed?.data ?? []).map((x) => x.id));
          check(Boolean(listed) && !ids.has(w.id), `teardown: the walk's world ${w.id} deleted on the site by its recorded id, then not on the account's list`);
        }
      } finally { await b.close(); }
    }
    for (const t of tokens.slice().reverse()) {
      const r = await fetch(`${API}/account/tokens/${encodeURIComponent(t.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t.token}` }, ...limit() }).catch(() => null);
      const after = (await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${t.token}` }, ...limit() }).catch(() => null))?.status;
      check(after === 401, `teardown: ${t.by}'s token ${t.id} by recorded id, ${r?.status ?? 'no answer'}, then GET /account ${after}`);
    }
  })();
  return tornDown;
}

const watchdog = setTimeout(async () => {
  console.log(`${T} FAIL the walk hung past 5 minutes; minted: tokens [${tokens.map((t) => t.id).join(', ')}], worlds [${worlds.map((w) => w.id).join(', ')}]`);
  failures++;
  await Promise.race([teardown('watchdog'), new Promise((r) => setTimeout(r, 90000))]);
  console.log(`${failures} FAILED`);
  process.exit(2);
}, 300000);

const browser = await (engine === 'webkit' ? webkit : engine === 'firefox' ? firefox : chromium).launch();
const profile = engine === 'webkit' ? devices['iPhone 13'] : engine === 'firefox' ? { viewport: { width: 390, height: 844 }, hasTouch: true } : devices['Pixel 7'];
// SERVE_DIST=dist: the local build served at the url's own origin (so keel's CORS admits it), the worker
// blocked; keel itself is real. A build's read before it flies; the deployed host still gets its own read.
const DIST = process.env.SERVE_DIST;
const ctx = await browser.newContext({ ...profile, ...(DIST ? { serviceWorkers: 'block' } : {}) });
if (DIST) {
  const origin = new URL(url).origin;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  await ctx.route(`${origin}/**`, (route) => {
    let path = new URL(route.request().url()).pathname;
    if (path === '/' || path === '') path = '/index.html';
    const f = `${DIST}${path}`;
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: types[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
  });
}
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
// Lantern's token and the new world, recorded from keel's answer the moment it comes.
p.on('response', (r) => {
  if (r.request().method() !== 'POST' || r.status() !== 201) return;
  pending.push((async () => {
    try {
      if (r.url().startsWith(`${API}/account/tokens`)) {
        const j = await r.json();
        if (j?.id) { tokens.push({ id: j.id, token: j.token, by: 'Lantern' }); console.log(`${T}      Lantern minted token ${j.id} (recorded)`); }
      }
      const path = new URL(r.url()).pathname;
      if (/\/account\/worlds\/?$/.test(path)) {
        const j = await r.json();
        if (j?.id) { worlds.push({ id: j.id, name: j.name, key: j.key }); console.log(`${T}      keel made world ${j.id} (recorded)`); }
      }
      // keel's hand-over (since 2026-11-07): the world and its elements in one write, no key in it.
      if (/\/account\/worlds\/handover\/?$/.test(path)) {
        const j = await r.json();
        if (j?.world?.id) { worlds.push({ id: j.world.id, name: j.world.name }); console.log(`${T}      keel made world ${j.world.id} by the hand-over (recorded)`); }
      }
      // The key Lantern mints for the phone after a hand-over: the walk reads the world with it.
      const minted = path.match(/\/account\/worlds\/([0-9a-f-]{36})\/keys\/?$/);
      if (minted) {
        const j = await r.json();
        const w = worlds.find((x) => x.id === minted[1]);
        if (w && j?.key) { w.key = j.key; console.log(`${T}      Lantern minted key ${j.id} for world ${w.id} (it goes with the world)`); }
      }
    } catch { /* not json */ }
  })());
});
const screen = async () => (await p.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);

try {
  console.log(`${T} build`, DIST ? `${fs.readFileSync(`${DIST}/version.json`, 'utf8').trim()} (served from ${DIST})` : await (await fetch(new URL('/version.json', url), limit())).text().catch(() => '?'));
  need(Boolean(pin), 'crew-walk-b has its PIN row');
  const own = await new OwV2Client({ baseUrl: API, client: 'lantern', fetch: sdkFetch }).signInWithPassword({ email, password, tokenName: 'Lantern walk, put online' });
  tokens.push({ id: own.id, token: own.token, by: 'walk' });
  console.log(`${T}      the walk's token ${own.id} (recorded)`);

  // ---- 1. Lantern's own sign-in ----
  await p.goto(new URL('/#/signin', url).href);
  await p.getByLabel('Email or username').fill(email);
  await p.getByLabel('Password').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).tap();
  need(await p.waitForURL(/#\/(worlds|join)/, { timeout: 30000 }).then(() => true, () => false), `Lantern's sign-in lands (${await screen()})`);

  // ---- 2. The world file, then Put it online ----
  await p.goto(new URL('/#/worlds', url).href);
  await p.locator('input[aria-label="A world file"]').waitFor({ state: 'attached', timeout: 15000 });
  await p.locator('input[aria-label="A world file"]').setInputFiles({ name: 'keys.owworld', mimeType: 'application/zip', buffer: Buffer.from(file) });
  need(await p.waitForSelector('[data-screen="home"]', { timeout: 15000 }).then(() => true, () => false), 'the world file opens on the phone');
  await p.goto(new URL('/#/worlds', url).href);
  const group = p.locator('.local-group', { hasText: WORLD_NAME });
  await group.waitFor({ timeout: 15000 });
  await group.getByRole('button', { name: 'Put it online' }).tap();
  // A wrong PIN first: keel checks it at the create, so nothing is made and the sheet says so.
  // (Before the check, keel made the world and refused its elements: an empty world left on the account.)
  const wrongPin = String(((Number(pin) - 1000 + 1) % 9000) + 1000);
  await p.locator('.sheet input[aria-label="PIN"]').fill(wrongPin);
  await p.locator('.sheet button[type="submit"]').tap();
  const wrongSaid = await p.locator('.sheet .error').filter({ hasText: /\S/ }).first().innerText({ timeout: 60000 }).catch(() => '');
  await p.waitForTimeout(1500);
  await Promise.allSettled(pending);
  const namedSo = ((await (await fetch(`${API}/account/worlds`, { headers: { Authorization: `Bearer ${own.token}` }, ...limit() })).json().catch(() => ({}))).data ?? []).filter((w) => w.name === WORLD_NAME).length;
  check(/does not match your account\. Nothing was made\./.test(wrongSaid), `a wrong PIN is said with nothing made (${JSON.stringify(wrongSaid.trim())})`);
  check(worlds.length === 0 && namedSo === 0, `a wrong PIN makes no world: keel answered no create (${worlds.length}), the account lists none of this run's name (${namedSo})`);
  await p.screenshot({ path: `${OUT}/live-online-${engine}-${tag}-0-wrong-pin.png` });
  await p.locator('.sheet input[aria-label="PIN"]').fill(pin);
  await p.locator('.sheet button[type="submit"]').tap();
  const landed = await p.waitForFunction(() => /^#\/w\/[0-9a-f-]{36}$/.test(location.hash), null, { timeout: 60000 }).then(() => true, () => false);
  await Promise.allSettled(pending);
  const said = (await p.locator('.sheet .error').allInnerTexts().catch(() => [])).join(' ').trim();
  need(worlds.length === 1, `keel made one world for Put it online (${worlds.length})`);
  check(landed, `Put it online lands on the online world's home${landed ? '' : `; the sheet says ${JSON.stringify(said)}`}`);
  const W = worlds[0];

  // ---- 3. The phone: the strand at the door ----
  if (landed) {
    await p.waitForSelector('[data-screen="home"]', { timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/live-online-${engine}-${tag}-1-home.png` });
    const rows = await p.$$eval('[data-part="reading-aids"] [data-role="strand"] .el-row', (rs) => rs.map((r) => [r.getAttribute('data-slot'), r.querySelector('b')?.textContent]));
    check(canon(rows) === canon([['narrative', 'The Long Thaw'], ['event', 'The Ice Breaks'], ['location', 'The harbour'], ['character', 'Ada'], ['now', 'The harbour']]),
      `the online world's home draws its strand (${JSON.stringify(rows)})`);
  }

  // ---- 4. keel's own read of the world ----
  const got = await (await fetch(`${API}/world/`, { headers: { 'API-Key': W.key, 'API-Pin': pin }, ...limit() })).json().catch(() => ({}));
  for (const [k, v] of Object.entries(KEYS)) check(k in got && canon(got[k]) === canon(v), `keel holds ${k} as the file gave it (${JSON.stringify(got[k] ?? null).slice(0, 120)})`);
  check(got.time_range_current === 1204 && got.time_basic_unit === 'Year', `keel holds the world's now, 1204 Year (${got.time_range_current} ${got.time_basic_unit})`);
  check(got.description === world.description, `keel holds the description (${JSON.stringify(got.description ?? null)})`);
  check(canon(got.origin?.producer ?? null) === canon(PRODUCER), `keel holds the file's maker line (${JSON.stringify(got.origin ?? null)})`);
  const els = await (await fetch(`${API}/changes?limit=100`, { headers: { 'API-Key': W.key, 'API-Pin': pin }, ...limit() })).json().catch(() => ({}));
  check((els.changes ?? []).length === 4, `keel holds the four elements (${(els.changes ?? []).length})`);
  const ada = (els.changes ?? []).find((c) => c.id === HERO)?.element ?? {};
  check(/^https:\/\//.test(String(ada.image_url ?? '')), `keel holds Ada's picture as an address on the media host (${String(ada.image_url ?? null).slice(0, 60)})`);
  // The address serves the phone's own picture, byte for byte.
  const pic = /^https:\/\//.test(String(ada.image_url ?? '')) ? await fetch(ada.image_url, limit()).catch(() => null) : null;
  const picBytes = pic?.ok ? Buffer.from(await pic.arrayBuffer()) : null;
  check(!!picBytes && picBytes.equals(Buffer.from(PNG, 'base64')), `Ada's picture address serves the phone's picture (${pic?.status ?? 'no answer'}, ${pic?.headers.get('content-type') ?? '-'}, ${picBytes?.length ?? 0} bytes)`);

  // ---- 5. A world file holding an id the first world now holds: no world made ----
  await p.goto(new URL('/#/worlds', url).href);
  await p.locator('input[aria-label="A world file"]').waitFor({ state: 'attached', timeout: 15000 });
  await p.locator('input[aria-label="A world file"]').setInputFiles({ name: 'refused.owworld', mimeType: 'application/zip', buffer: Buffer.from(refusedFile) });
  need(await p.waitForSelector('[data-screen="home"]', { timeout: 15000 }).then(() => true, () => false), 'the second world file opens on the phone');
  await p.goto(new URL('/#/worlds', url).href);
  const g2 = p.locator('.local-group', { hasText: REFUSED_NAME });
  await g2.waitFor({ timeout: 15000 });
  await g2.getByRole('button', { name: 'Put it online' }).tap();
  await p.locator('.sheet input[aria-label="PIN"]').fill(pin);
  await p.locator('.sheet button[type="submit"]').tap();
  const refusedSaid = await p.locator('.sheet .error').filter({ hasText: /\S/ }).first().innerText({ timeout: 60000 }).catch(() => '');
  await p.waitForTimeout(1500);
  await Promise.allSettled(pending);
  const listed2 = ((await (await fetch(`${API}/account/worlds`, { headers: { Authorization: `Bearer ${own.token}` }, ...limit() })).json().catch(() => ({}))).data ?? []);
  // A world of this run's refused name that the recorder missed is recorded now, from keel's list, so it is torn down.
  for (const w of listed2.filter((x) => x.name === REFUSED_NAME)) if (!worlds.some((x) => x.id === w.id)) worlds.push({ id: w.id, name: w.name });
  check(/another world online.*Nothing was made\./.test(refusedSaid), `an id another world holds is said with nothing made (${JSON.stringify(refusedSaid.trim())})`);
  check(listed2.filter((x) => x.name === REFUSED_NAME).length === 0 && worlds.filter((x) => x.name === REFUSED_NAME).length === 0,
    `the refused put leaves no world on the account (listed ${listed2.filter((x) => x.name === REFUSED_NAME).length}, recorded ${worlds.filter((x) => x.name === REFUSED_NAME).length})`);
  await p.screenshot({ path: `${OUT}/live-online-${engine}-${tag}-2-refused.png` });
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  if (!String(e.message).startsWith('stopped:')) { console.log(`${T} FAIL threw: ${String(e).slice(0, 200)}`); failures++; }
} finally {
  await browser.close().catch(() => {});
  await teardown();
  clearTimeout(watchdog);
}
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
