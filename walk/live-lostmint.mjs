// A key mint whose answer is lost, read live on keel. The walk lets Lantern's mint reach keel and drops
// keel's answer before the page sees it (route.fetch, then abort), as a phone losing signal mid-mint does.
// Lantern asks keel which key that mint made (GET /account/worlds/{id}/keys/made?key=) and takes it back
// by the id keel names; the tap again opens the world on a key of its own, so the account keeps one
// "Lantern on ..." key for this phone, not two.
// Signed in as crew-walk-b, on a world this walk makes (a hand-over, keyless as it leaves it). Every world
// and token this run makes is recorded from keel's own answer and taken back by id in teardown (the world
// deleted on the site by its recorded id and this run's name; its keys go with it).
// The control is the live build before: it leaves the lost key live, so it must FAIL at those checks.
// Secrets are never printed.
// Run from tools/lantern:
//   CREW_FILE=<crew-walk-accounts.txt> [SERVE_DIST=dist] node walk/live-lostmint.mjs [url] [chromium|webkit] [tag]
import fs from 'node:fs';
import { chromium, webkit, devices } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';

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
const NAME = `Lost mint walk ${engine} ${stamp} (crew test)`;

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
          if (w.name !== NAME) { check(false, `teardown: world ${w.id} is named ${JSON.stringify(w.name)}, not this run's: left alone`); continue; }
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
const sent = [];
p.on('request', (r) => { if (r.url().startsWith(API)) sent.push(`${r.method()} ${new URL(r.url()).pathname.replace('/api/v2', '')}`); });
p.on('response', (r) => {
  if (r.request().method() !== 'POST' || r.status() !== 201) return;
  pending.push((async () => {
    try {
      if (/\/account\/tokens\/?$/.test(new URL(r.url()).pathname)) {
        const j = await r.json();
        if (j?.id) { tokens.push({ id: j.id, token: j.token, by: 'Lantern' }); console.log(`${T}      Lantern minted token ${j.id} (recorded)`); }
      }
    } catch { /* not json */ }
  })());
});
const screen = async () => (await p.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);

try {
  console.log(`${T} build`, DIST ? `${fs.readFileSync(`${DIST}/version.json`, 'utf8').trim()} (served from ${DIST})` : await (await fetch(new URL('/version.json', url), limit())).text().catch(() => '?'));
  need(Boolean(pin), 'crew-walk-b has its PIN row');
  const own = await new OwV2Client({ baseUrl: API, client: 'lantern', fetch: sdkFetch }).signInWithPassword({ email, password, tokenName: 'Lantern walk, lost mint' });
  tokens.push({ id: own.id, token: own.token, by: 'walk' });
  console.log(`${T}      the walk's token ${own.id} (recorded)`);
  const acct = { Authorization: `Bearer ${own.token}`, 'Content-Type': 'application/json' };

  // The walk's world: a hand-over leaves it with no key, so every key on it is Lantern's.
  const made = await fetch(`${API}/account/worlds/handover`, {
    method: 'POST', headers: { ...acct, 'Idempotency-Key': crypto.randomUUID() }, ...limit(),
    body: JSON.stringify({ world: { name: NAME, pin }, items: [{ type: 'character', element: { id: crypto.randomUUID(), name: 'Ada' } }] }),
  });
  const mj = await made.json().catch(() => null);
  if (mj?.world?.id) { worlds.push({ id: mj.world.id, name: NAME }); console.log(`${T}      the walk's world ${mj.world.id} (recorded)`); }
  need(made.status === 201 && mj?.world?.id, `the walk's world is made (${made.status})`);
  const W = mj.world.id;
  const liveKeys = async () => ((await (await fetch(`${API}/account/worlds/${W}/keys`, { headers: acct, ...limit() })).json().catch(() => ({}))).data ?? []).filter((k) => !k.revoked);
  need((await liveKeys()).length === 0, 'the walk\'s world starts with no live key');
  // keel's lookup must be live (PR 478), or a red here says nothing about Lantern: before it, the path
  // is the revoke's and a GET answers 405.
  const probe = await fetch(`${API}/account/worlds/${W}/keys/made?key=${crypto.randomUUID()}`, { headers: acct, ...limit() });
  need(probe.status === 404, `keel answers the made-key lookup (a key never sent: ${probe.status}, 404 wanted)`);

  // Lantern's own sign-in.
  await p.goto(new URL('/#/signin', url).href);
  await p.getByLabel('Email or username').fill(email);
  await p.getByLabel('Password').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).tap();
  need(await p.waitForURL(/#\/(worlds|join)/, { timeout: 30000 }).then(() => true, () => false), `Lantern's sign-in lands (${await screen()})`);
  await p.goto(new URL('/#/worlds', url).href);
  const card = p.locator(`button.world-card[data-world="${W}"]`);
  need(await card.waitFor({ timeout: 30000 }).then(() => true, () => false), `the walk's world is on Your worlds (${await screen()})`);

  // The first tap's mint reaches keel; its answer is dropped.
  let lost = null;
  await p.route(`${API}/account/worlds/${W}/keys`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    try {
      const res = await route.fetch();
      lost = { status: res.status(), id: (await res.json().catch(() => null))?.id };
      console.log(`${T}      keel minted key ${lost.id}, its answer dropped`);
    } catch (e) { lost = { status: 0, error: String(e).slice(0, 160) }; }
    await route.abort('failed').catch(() => {});
  }, { times: 1 });
  const before = sent.length;
  await card.tap();
  // Lantern says it could not open the world; the card comes back for another tap.
  await p.waitForFunction((w) => !document.querySelector(`button.world-card[data-world="${w}"]`)?.hasAttribute('disabled'), W, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  need(lost?.status === 201 && Boolean(lost.id), `keel minted the key behind the lost answer (${lost?.status})`);
  const first = sent.slice(before);
  check(first.some((s) => s === `GET /account/worlds/${W}/keys/made`), `Lantern asks keel which key its mint made (${first.filter((s) => s.includes('/keys')).join(', ')})`);
  check(first.some((s) => s === `DELETE /account/worlds/${W}/keys/${lost.id}`), `Lantern takes that key back by the id keel named`);
  const afterLost = await liveKeys();
  check(!afterLost.some((k) => k.id === lost.id), `the lost answer's key is not live on the account (${afterLost.length} live)`);

  // The tap again opens the world on a key of its own.
  await card.tap();
  const opened = await p.waitForFunction((w) => location.hash.startsWith(`#/w/${w}`), W, { timeout: 30000 }).then(() => true, () => false);
  check(opened, `the tap again opens the world${opened ? '' : ` (${await screen()})`}`);
  const end = await liveKeys();
  check(end.length === 1 && end[0].id !== lost.id, `the account keeps one live key for this phone (${end.map((k) => `${k.id.slice(0, 8)} ${k.name}`).join(', ') || 'none'})`);
  await p.screenshot({ path: `${OUT}/live-lostmint-${engine}-${tag}.png` });
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
