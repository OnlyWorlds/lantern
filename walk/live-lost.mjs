// Put it online after a lost answer, read live on keel. The walk lets Lantern's send reach keel and drops
// keel's answer before the page sees it (route.fetch, then abort), as a phone losing signal mid-send does.
//   A. A world file put online, its hand-over's answer lost: the retry asks keel which world this put's key
//      made (GET /account/worlds/made?key=) and finishes there without sending the hand-over again.
//   B. A world file of the account's own online world (a throwaway made by this walk, keyless as a hand-over
//      leaves it), its refusal's answer lost: the retry writes nothing to that world (no key minted there, no
//      settings, no elements) and says where to look.
// Signed in as crew-walk-b. Every world and token this run makes is recorded from keel's own answer and
// taken back by id in teardown (a world deleted on the site by its recorded id and this run's name).
// The control is the live build before (2d0b2a1): it sends the hand-over twice in A, and in B mints a key in
// the original world and writes the file's copy over it, so it must FAIL at those checks.
// Secrets are never printed.
// Run from tools/lantern:
//   CREW_FILE=<crew-walk-accounts.txt> [SERVE_DIST=dist] node walk/live-lost.mjs [url] [chromium|webkit] [tag]
import fs from 'node:fs';
import { chromium, webkit, devices } from 'playwright';
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

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const LOST_NAME = `Lost answer walk ${engine} ${stamp} (crew test)`;
const ORIG_NAME = `Lost refusal walk ${engine} ${stamp} (crew test)`;
const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
const run = `${hex()}${hex()}`;
const id = (n) => `019f${run.slice(0, 4)}-${run.slice(4, 8)}-7000-8000-${String(n).padStart(12, '0')}`;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const enc = new TextEncoder();
const el = (type, slug, body) => ({ path: `elements/${type}/${slug}--${body.id.slice(-6)}.json`, data: enc.encode(JSON.stringify(body)) });
// A: a story and a hero, fresh ids.
const fileA = writeWorldFile([
  { path: 'world.json', data: enc.encode(JSON.stringify({ id: id(90), name: LOST_NAME })) },
  el('narrative', 'the-crossing', { id: id(1), name: 'The Crossing', protagonist: id(2) }),
  el('character', 'ada', { id: id(2), name: 'Ada', image_url: `data:image/png;base64,${PNG}` }),
], `lost-${run}`);
// B: the original's ids, as a world file saved from it holds them, with the phone's older names and a picture.
const ORIG_STORY = id(11), ORIG_HERO = id(12);
const fileB = writeWorldFile([
  { path: 'world.json', data: enc.encode(JSON.stringify({ id: id(91), name: ORIG_NAME, description: 'The file, older.' })) },
  el('narrative', 'the-ferry', { id: ORIG_STORY, name: 'The Ferry (file, older)', protagonist: ORIG_HERO }),
  el('character', 'bo', { id: ORIG_HERO, name: 'Bo (file, older)', image_url: `data:image/png;base64,${PNG}` }),
], `orig-${run}`);

const tokens = []; // { id, token, by }
const worlds = []; // { id, name }
const pending = [];

let tornDown = null;
function teardown(why) {
  tornDown ??= (async () => {
    console.log(`${T} teardown${why ? ` (${why})` : ''}: ${worlds.length} worlds, ${tokens.length} tokens recorded`);
    await Promise.allSettled(pending);
    const own = tokens.find((t) => t.by === 'walk')?.token;
    if (worlds.length) {
      const b = await chromium.launch();
      try {
        const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
        for (const w of worlds) {
          if (w.name !== LOST_NAME && w.name !== ORIG_NAME) { check(false, `teardown: world ${w.id} is named ${JSON.stringify(w.name)}, not this run's: left alone`); continue; }
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
          check(Boolean(listed) && !(listed.data ?? []).some((x) => x.id === w.id), `teardown: world ${w.id} deleted on the site by its recorded id, then not on the account's list`);
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

// A throw outside the walk's own try (a route handler, a listener) still runs the teardown.
process.on('unhandledRejection', async (e) => {
  console.log(`${T} FAIL unhandled: ${String(e).slice(0, 200)}`);
  failures++;
  await Promise.race([teardown('unhandled'), new Promise((r) => setTimeout(r, 90000))]);
  console.log(`${failures} FAILED`);
  process.exit(2);
});

const browser = await (engine === 'webkit' ? webkit : chromium).launch();
const profile = engine === 'webkit' ? devices['iPhone 13'] : devices['Pixel 7'];
const DIST = process.env.SERVE_DIST;
const ctx = await browser.newContext({ ...profile, ...(DIST || engine === 'webkit' ? { serviceWorkers: 'block' } : {}) });
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
// Every request the page makes to keel, by method and path, and Lantern's own tokens recorded from keel's answer.
const sent = [];
p.on('request', (r) => { if (r.url().startsWith(API)) sent.push(`${r.method()} ${new URL(r.url()).pathname.replace('/api/v2', '')}`); });
p.on('response', (r) => {
  if (r.request().method() !== 'POST' || r.status() !== 201) return;
  pending.push((async () => {
    try {
      const path = new URL(r.url()).pathname;
      if (/\/account\/tokens\/?$/.test(path)) {
        const j = await r.json();
        if (j?.id) { tokens.push({ id: j.id, token: j.token, by: 'Lantern' }); console.log(`${T}      Lantern minted token ${j.id} (recorded)`); }
      }
      if (/\/account\/worlds\/handover\/?$/.test(path)) {
        const j = await r.json();
        if (j?.world?.id && !worlds.some((w) => w.id === j.world.id)) { worlds.push({ id: j.world.id, name: j.world.name }); console.log(`${T}      keel made world ${j.world.id} (recorded)`); }
      }
    } catch { /* not json */ }
  })());
});
/** The next hand-over reaches keel, and keel's answer is dropped before the page sees it. */
async function loseNextHandover() {
  let answer = null;
  await p.route(`${API}/account/worlds/handover**`, async (route) => {
    try {
      const res = await route.fetch();
      answer = { status: res.status(), body: await res.json().catch(() => null) };
      if (answer.status === 201 && answer.body?.world?.id) { worlds.push({ id: answer.body.world.id, name: answer.body.world.name }); console.log(`${T}      keel made world ${answer.body.world.id}, its answer dropped (recorded)`); }
    } catch (e) {
      answer = { status: 0, error: String(e).slice(0, 160) };
    }
    await route.abort('failed').catch(() => {});
  }, { times: 1 });
  return () => answer;
}
const screen = async () => (await p.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
const sheetSays = async () => (await p.locator('.sheet .error').filter({ hasText: /\S/ }).first().innerText({ timeout: 60000 }).catch(() => '')).trim();
async function openAndPut(file, name, fileName) {
  await p.goto(new URL('/#/worlds', url).href);
  await p.locator('input[aria-label="A world file"]').waitFor({ state: 'attached', timeout: 15000 });
  await p.locator('input[aria-label="A world file"]').setInputFiles({ name: fileName, mimeType: 'application/zip', buffer: Buffer.from(file) });
  need(await p.waitForSelector('[data-screen="home"]', { timeout: 15000 }).then(() => true, () => false), `the world file ${fileName} opens on the phone`);
  await p.goto(new URL('/#/worlds', url).href);
  const group = p.locator('.local-group', { hasText: name });
  await group.waitFor({ timeout: 15000 });
  await group.getByRole('button', { name: 'Put it online' }).tap();
  await p.locator('.sheet input[aria-label="PIN"]').fill(pin);
}
const submit = () => p.locator('.sheet button[type="submit"]').tap();

try {
  console.log(`${T} build`, DIST ? `${fs.readFileSync(`${DIST}/version.json`, 'utf8').trim()} (served from ${DIST})` : await (await fetch(new URL('/version.json', url), limit())).text().catch(() => '?'));
  need(Boolean(pin), 'crew-walk-b has its PIN row');
  const own = await new OwV2Client({ baseUrl: API, client: 'lantern', fetch: sdkFetch }).signInWithPassword({ email, password, tokenName: 'Lantern walk, lost answer' });
  tokens.push({ id: own.id, token: own.token, by: 'walk' });
  console.log(`${T}      the walk's token ${own.id} (recorded)`);
  const acct = { Authorization: `Bearer ${own.token}`, 'Content-Type': 'application/json' };

  // The original online world for B: a hand-over by the walk, keyless as the hand-over leaves it.
  const og = await fetch(`${API}/account/worlds/handover`, {
    method: 'POST', headers: { ...acct, 'Idempotency-Key': crypto.randomUUID() }, ...limit(),
    body: JSON.stringify({ world: { name: ORIG_NAME, pin, description: 'Online, newer.' }, items: [
      { type: 'narrative', element: { id: ORIG_STORY, name: 'The Ferry (online, newer)', protagonist: ORIG_HERO } },
      { type: 'character', element: { id: ORIG_HERO, name: 'Bo (online, newer)' } },
    ] }),
  });
  const ogj = await og.json().catch(() => null);
  if (ogj?.world?.id) { worlds.push({ id: ogj.world.id, name: ORIG_NAME }); console.log(`${T}      the walk's original world ${ogj.world.id} (recorded)`); }
  need(og.status === 201 && ogj?.world?.id, `the walk's original world is made (${og.status})`);
  const ORIG = ogj.world.id;

  // Lantern's own sign-in.
  await p.goto(new URL('/#/signin', url).href);
  await p.getByLabel('Email or username').fill(email);
  await p.getByLabel('Password').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).tap();
  need(await p.waitForURL(/#\/(worlds|join)/, { timeout: 30000 }).then(() => true, () => false), `Lantern's sign-in lands (${await screen()})`);

  // ---- A. The hand-over's answer lost ----
  await openAndPut(fileA, LOST_NAME, 'lost.owworld');
  const gotA = await loseNextHandover();
  await submit();
  const saidA = await sheetSays();
  check(/No answer from OnlyWorlds/.test(saidA), `A: the lost answer is said, the copy kept (${JSON.stringify(saidA)})`);
  need(gotA()?.status === 201, `A: keel made the world behind the lost answer (${gotA()?.status})`);
  const MADE = gotA().body.world.id;
  const before = sent.filter((s) => s === 'POST /account/worlds/handover').length;
  await submit();
  const landedA = await p.waitForFunction((w) => location.hash === `#/w/${w}`, MADE, { timeout: 60000 }).then(() => true, () => false);
  await Promise.allSettled(pending);
  const handovers = sent.filter((s) => s === 'POST /account/worlds/handover').length;
  check(sent.some((s) => s === 'GET /account/worlds/made'), `A: the retry asks keel which world its key made`);
  check(handovers === before, `A: the retry sends no second hand-over (${handovers} sent in all)`);
  check(landedA, `A: the put finishes in the world keel made (${MADE})${landedA ? '' : `; ${await screen()}`}`);
  const listedA = ((await (await fetch(`${API}/account/worlds`, { headers: acct, ...limit() })).json().catch(() => ({}))).data ?? []).filter((w) => w.name === LOST_NAME);
  check(listedA.length === 1, `A: one world of this name on the account (${listedA.length})`);
  for (const w of listedA) if (!worlds.some((x) => x.id === w.id)) worlds.push({ id: w.id, name: w.name });
  await p.screenshot({ path: `${OUT}/live-lost-${engine}-${tag}-A.png` });

  // ---- B. A world file of the account's own online world, its refusal's answer lost ----
  await openAndPut(fileB, ORIG_NAME, 'orig.owworld');
  const gotB = await loseNextHandover();
  const sentBefore = sent.length;
  await submit();
  const saidB1 = await sheetSays();
  check(gotB()?.status === 409, `B: keel refused the file's ids behind the lost answer (${gotB()?.status})`);
  check(/No answer from OnlyWorlds/.test(saidB1), `B: the lost answer is said (${JSON.stringify(saidB1)})`);
  await submit();
  await p.waitForFunction(() => /may already have put this world|^#\/w\//.test((document.querySelector('.sheet .error')?.textContent ?? '') + ' ' + location.hash), null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await Promise.allSettled(pending);
  const saidB2 = (await p.locator('.sheet .error').allInnerTexts().catch(() => [])).join(' ').trim();
  const afterB = sent.slice(sentBefore);
  check(/may already have put this world on your account: look in Your worlds/.test(saidB2), `B: the retry says where to look and finishes nothing (${JSON.stringify(saidB2)})`);
  check(!afterB.some((s) => s.startsWith(`POST /account/worlds/${ORIG}/keys`)), `B: no key minted in the original world (${afterB.filter((s) => s.includes('/keys')).join(', ') || 'none'})`);
  check(!afterB.some((s) => /^(PATCH \/world|POST \/bulk)/.test(s)), `B: nothing written by a world key (${afterB.filter((s) => /^(PATCH|POST \/bulk)/.test(s)).join(', ') || 'none'})`);
  // keel's own read of the original, on a read key minted now by the walk (it goes with the world).
  const rk = await (await fetch(`${API}/account/worlds/${ORIG}/keys`, { method: 'POST', headers: acct, ...limit(), body: JSON.stringify({ scope: 'read', name: 'walk read' }) })).json().catch(() => ({}));
  const changes = rk.key ? await (await fetch(`${API}/changes?limit=100`, { headers: { 'API-Key': rk.key }, ...limit() })).json().catch(() => ({})) : {};
  const names = (changes.changes ?? []).map((c) => c.element?.name).sort();
  check(JSON.stringify(names) === JSON.stringify(['Bo (online, newer)', 'The Ferry (online, newer)']), `B: keel's original keeps its own elements (${JSON.stringify(names)})`);
  await p.screenshot({ path: `${OUT}/live-lost-${engine}-${tag}-B.png` });
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
