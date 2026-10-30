// #755, read live: the OnlyWorlds mark (the SDK's Waymark) beside a world's name on its home and an
// element's name on its page, for the world's owner signed in on Lantern, and its rows on the real site.
//   1. Seed: crew-walk-b signs in by API (a token the walk records), mints one write key on its kept world
//      "Dashboard ground (crew test)" (recorded) and makes one Character there as client 'lantern', so keel
//      stamps its door and the fan-out has a "Last shaped in ..." line. Every id is recorded before the next step.
//   2. The phone: one context signed in on www.onlyworlds.com by the site's own form, then Lantern's door
//      #/open/<world>, Lantern's own sign-in by email and password, Open. Every token and world key keel mints
//      for Lantern is recorded from keel's answer.
//   3. Home: one mark beside the world's name; its fan-out (the name line, onlyworlds.com, Atlas, Lantern
//      "You are here", Copy link); Escape; the onlyworlds.com row opens the site's page for the world, signed in.
//   4. The Character's page: one mark beside its name; the name line, "Last shaped in ..."; "You are here"
//      closes it; Copy link's address; a tap on the scrim closes it; the onlyworlds.com row opens its page.
//   5. Teardown: the Character deleted by its recorded id (410 or 404 after), every recorded world key revoked
//      by id (401 after), every recorded token revoked by id (401 after). A throw or the watchdog still runs it.
// The control is the live build before the mark (4c11686): it must FAIL at the first mark check and still
// take everything back. Secrets are never printed.
// Run from tools/lantern:
//   CREW_FILE=<crew-walk-accounts.txt> node walk/live-waymark.mjs [url] [chromium|webkit|firefox] [tag]
import fs from 'node:fs';
import { chromium, webkit, firefox, devices } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';

const [, , url = 'https://lantern.onlyworlds.com', engine = 'chromium', tag = 'live'] = process.argv;
const WORLD_NAME = 'Dashboard ground (crew test)';
const TOKEN_NAME = 'Lantern walk, waymark';
const OUT = 'walk/shots';
fs.mkdirSync(OUT, { recursive: true });
const API = 'https://www.onlyworlds.com/api/v2';
const SITE = 'https://www.onlyworlds.com';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith('crew-walk-b ') && l.includes('@')).trim().split(/\s+/);
const pin = lines.find((l) => l.startsWith('crew-walk-b ') && /\bPIN\b/i.test(l))?.trim().split(/\s+/)[2];

let failures = 0;
const T = `[${engine} ${tag}]`;
const check = (ok, what) => { console.log(`${T} ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; return ok; };
/** A check the walk cannot go on without: a FAIL stops it here (the teardown still runs). */
const need = (ok, what) => { if (!check(ok, what)) throw new Error(`stopped: ${what}`); };
// Every request with a time limit of its own.
const limit = () => ({ signal: AbortSignal.timeout(15000) });
const sdkFetch = (u, init = {}) => fetch(u, { ...init, signal: init.signal ?? AbortSignal.timeout(15000) });

// The record: what this run minted, by id. Only these are revoked or deleted.
const tokens = []; // { id, token, by }
const keys = []; // { world, id, key, by }
const madeIds = []; // Character ids
let writer = null;
const pending = [];

// ---- Teardown, by the ids this walk recorded, each read back ----
let tornDown = null;
function teardown(why) {
  tornDown ??= (async () => {
    console.log(`${T} teardown${why ? ` (${why})` : ''}: ${madeIds.length} Character, ${keys.length} world keys, ${tokens.length} tokens recorded`);
    await Promise.allSettled(pending);
    for (const id of madeIds) {
      let status = 'deleted';
      try { await writer.delete('character', id); } catch (e) { status = String(e.status ?? e); }
      let after = 'still there';
      try { await writer.get('character', id); } catch (e) { after = String(e.status ?? e); }
      check(after === '404' || after === '410', `teardown: the walk's Character ${id} by recorded id, ${status}, then ${after}`);
    }
    const own = tokens.find((t) => t.by === 'walk')?.token;
    for (const k of keys) {
      const r = own
        ? await fetch(`${API}/account/worlds/${k.world}/keys/${encodeURIComponent(k.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${own}` }, ...limit() }).catch(() => null)
        : null;
      const after = k.key
        ? (await fetch(`${API}/world/`, { headers: { 'API-Key': k.key, ...(pin ? { 'API-Pin': pin } : {}) }, ...limit() }).catch(() => null))?.status
        : 'no key value kept';
      check(after === 401, `teardown: ${k.by}'s world key ${k.id} by recorded id, ${r?.status ?? 'no answer'}, then GET /world ${after}`);
    }
    for (const t of tokens.slice().reverse()) {
      const r = await fetch(`${API}/account/tokens/${encodeURIComponent(t.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t.token}` }, ...limit() }).catch(() => null);
      const after = (await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${t.token}` }, ...limit() }).catch(() => null))?.status;
      check(after === 401, `teardown: ${t.by}'s token ${t.id} by recorded id, ${r?.status ?? 'no answer'}, then GET /account ${after}`);
    }
  })();
  return tornDown;
}

let browser = null;
const watchdog = setTimeout(async () => {
  console.log(`${T} FAIL the walk hung past 5 minutes; minted: tokens [${tokens.map((t) => t.id).join(', ')}], keys [${keys.map((k) => k.id).join(', ')}], Characters [${madeIds.join(', ')}]`);
  failures++;
  await Promise.race([teardown('watchdog'), new Promise((r) => setTimeout(r, 60000))]);
  console.log(`${failures} FAILED`);
  process.exit(2);
}, 300000);

browser = await (engine === 'webkit' ? webkit : engine === 'firefox' ? firefox : chromium).launch();
// Playwright's Firefox takes no device profile (no isMobile): a phone's size and touch only.
const profile = engine === 'webkit' ? devices['iPhone 13'] : engine === 'firefox' ? { viewport: { width: 390, height: 844 }, hasTouch: true } : devices['Pixel 7'];
const ctx = await browser.newContext({ ...profile });
if (engine === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
// What a copy wrote, read in every engine (only Chromium lets the page read the clipboard back).
await ctx.addInitScript(() => {
  const c = navigator.clipboard;
  if (!c?.writeText) return;
  const real = c.writeText.bind(c);
  c.writeText = (t) => { window.__owCopied = String(t); return real(t); };
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
// Lantern's own token and world key, recorded from keel's answer the moment it comes.
p.on('response', (r) => {
  if (r.request().method() !== 'POST' || r.status() !== 201) return;
  pending.push((async () => {
    try {
      if (r.url().startsWith(`${API}/account/tokens`)) {
        const j = await r.json();
        if (j?.id) { tokens.push({ id: j.id, token: j.token, by: 'Lantern' }); console.log(`${T}      Lantern minted token ${j.id} (recorded)`); }
      }
      const m = r.url().match(/\/account\/worlds\/([0-9a-f-]{36})\/keys/);
      if (m) {
        const j = await r.json();
        if (j?.id) { keys.push({ world: m[1], id: j.id, key: j.key ?? null, by: 'Lantern' }); console.log(`${T}      Lantern minted world key ${j.id} (recorded)`); }
      }
    } catch { /* not json */ }
  })());
});
const hashIs = (h) => p.waitForFunction((x) => location.hash === x, h, { timeout: 20000 }).then(() => true, () => false);
const screen = async () => (await p.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
const pop = p.locator('.ow-waymark__pop:not([hidden])');
const isOpen = () => p.evaluate(() => !!document.querySelector('.ow-waymark__mark[aria-expanded="true"]'));
const rowLabels = () => p.locator('.ow-waymark__pop:not([hidden]) .ow-waymark__row .ow-waymark__label').allTextContents();
const siteRow = pop.locator('a[data-opener="onlyworlds"]');
const hereRow = pop.locator('[data-here]');
const copyRow = pop.locator('.ow-waymark__row', { hasText: 'Copy link' });
const WANT_ROWS = ['onlyworlds.com', 'Atlas', 'Lantern', 'Copy link'];

/** Press the onlyworlds.com row and read where the browser lands: host, path, status, signed in. */
async function pressSite() {
  let last = null;
  const onResp = (r) => {
    if (r.frame() !== p.mainFrame() || !r.request().isNavigationRequest()) return;
    if (new URL(r.url()).hostname === 'www.onlyworlds.com') last = { status: r.status(), url: r.url() };
  };
  p.on('response', onResp);
  await siteRow.tap();
  await p.waitForURL((u) => u.hostname === 'www.onlyworlds.com', { timeout: 30000 });
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(800);
  p.off('response', onResp);
  const u = new URL(p.url());
  const signedOut = u.pathname.startsWith('/accounts/login') || (await p.locator('input[name="password"]').count()) > 0;
  const notFound = /page not found|404/i.test((await p.title().catch(() => '')) + ' ' + (await p.locator('h1').first().innerText().catch(() => '')));
  return { u, status: last?.status ?? null, signedOut, notFound };
}

/** Back from the site to Lantern's world home. */
async function backHome(W) {
  await p.goBack({ timeout: 30000 }).catch(() => {});
  const back = await p.waitForSelector('[data-screen]', { timeout: 30000 }).then(() => true, () => false);
  if (!back || !p.url().startsWith(url)) await p.goto(new URL(`/#/w/${W}`, url).href);
  await p.evaluate((w) => { if (location.hash !== `#/w/${w}`) location.hash = `#/w/${w}`; }, W);
  await p.waitForSelector('[data-screen="home"]', { timeout: 30000 });
}

try {
  console.log(`${T} build`, await (await fetch(new URL('/version.json', url), limit())).text().catch(() => '?'));
  need(Boolean(pin), 'crew-walk-b has its PIN row');

  // ---- 1. Seed, every id recorded before the next step ----
  const own = await new OwV2Client({ baseUrl: API, client: 'lantern', fetch: sdkFetch }).signInWithPassword({ email, password, tokenName: TOKEN_NAME });
  tokens.push({ id: own.id, token: own.token, by: 'walk' });
  console.log(`${T}      the walk's token ${own.id} (recorded)`);
  const worlds = (await (await fetch(`${API}/account/worlds`, { headers: { Authorization: `Bearer ${own.token}` }, ...limit() })).json()).data ?? [];
  const world = worlds.find((w) => w.name === WORLD_NAME && w.role === 'owner');
  need(Boolean(world), `crew-walk-b owns "${WORLD_NAME}"`);
  const W = world.id;
  const mint = await fetch(`${API}/account/worlds/${W}/keys`, { method: 'POST', headers: { Authorization: `Bearer ${own.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'write', name: TOKEN_NAME }), ...limit() });
  const wk = await mint.json().catch(() => null);
  if (wk?.id) { keys.push({ world: W, id: wk.id, key: wk.key ?? null, by: 'walk' }); console.log(`${T}      the walk's world key ${wk.id} (recorded)`); }
  need(mint.status === 201 && Boolean(wk?.key), `the walk's write key minted (${mint.status})`);
  writer = new OwV2Client({ apiKey: wk.key, apiPin: pin, baseUrl: API, client: 'lantern', fetch: sdkFetch });
  const name = `Waymark walk ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const made = await writer.create('character', { name });
  madeIds.push(made.id);
  console.log(`${T}      the walk's Character ${made.id} (recorded)`);
  const read = await writer.get('character', made.id);
  const doors = read.doors && Object.keys(read.doors).length ? read.doors : null;
  console.log(`${T}      keel's doors on it: ${JSON.stringify(doors)}`);

  // ---- 2. Signed in on onlyworlds.com by the site's own form, then Lantern's door ----
  await p.goto(`${SITE}/accounts/login/`);
  await p.locator('input[name="login"]').fill(email);
  await p.locator('input[name="password"]').fill(password);
  await Promise.all([
    p.waitForURL((u) => !u.pathname.startsWith('/accounts/login'), { timeout: 30000 }),
    p.locator('form:has(input[name="password"]) button[type="submit"]').first().tap(),
  ]);
  need(!p.url().includes('/accounts/login'), `signed in on onlyworlds.com by its form (${new URL(p.url()).pathname})`);

  await p.goto(new URL(`/#/open/${W}`, url).href);
  const asked = await p.waitForFunction(() => /Sign in to open this world/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true, () => false);
  need(asked, `signed out in Lantern, the door asks for a sign-in (${await screen()})`);
  await p.locator('[data-screen="open"] a', { hasText: 'Sign in' }).tap();
  await p.locator('input[aria-label="Email or username"]').fill(email);
  await p.getByLabel('Password').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).tap();
  const named = await p.waitForFunction((n) => document.querySelector('[data-screen="open"]')?.textContent?.includes(`Open ${n} on this phone?`), world.name, { timeout: 30000 }).then(() => true, () => false);
  need(named, `after Lantern's sign-in, the door names the world (${await screen()})`);
  await p.locator('[data-action="open-world"]').tap();
  need(await hashIs(`#/w/${W}`), `Open lands on the world's home (${await p.evaluate(() => location.hash)})`);
  await p.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await p.waitForTimeout(2000);

  // ---- 3. Home: one mark beside the world's name ----
  const homeMark = p.locator('[data-screen="home"] .lantern-waymark[data-mark="world"] .ow-waymark__mark');
  await homeMark.waitFor({ timeout: 10000 }).catch(() => {});
  const marks = p.locator('.ow-waymark__mark');
  await p.screenshot({ path: `${OUT}/live-waymark-${engine}-${tag}-home.png` });
  need((await homeMark.count()) === 1 && (await marks.count()) === 1, `the home shows one mark beside the world's name (${await homeMark.count()} beside the name, ${await marks.count()} on the page)`);
  const hashHome = await p.evaluate(() => location.hash);
  await homeMark.tap();
  await pop.waitFor({ timeout: 5000 }).catch(() => {});
  check(await isOpen(), 'a tap on the world\'s mark opens the fan-out');
  check(p.url().endsWith(hashHome), 'and leaves the address as it was (no Your worlds)');
  const homeName = await pop.locator('.ow-waymark__name').textContent().catch(() => null);
  check(homeName === world.name, `the name line is the world's name (${homeName})`);
  const homeRows = await rowLabels();
  check(JSON.stringify(homeRows) === JSON.stringify(WANT_ROWS), `the world's rows: ${homeRows.join(', ')}`);
  const here = (await hereRow.innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(/Lantern/.test(here) && /You are here/.test(here), `Lantern's row says "You are here" (${here})`);
  const worldHref = await siteRow.getAttribute('href').catch(() => null);
  check(worldHref === `${SITE}/w/${W}`, `the world's onlyworlds.com row goes to its page (${worldHref})`);
  await p.screenshot({ path: `${OUT}/live-waymark-${engine}-${tag}-home-open.png` });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check(!(await isOpen()) && (await p.evaluate(() => location.hash)) === hashHome, 'Escape closes the world\'s fan-out, the address stays');
  // The world's onlyworlds.com row, on the real site.
  await homeMark.tap();
  await pop.waitFor({ timeout: 5000 });
  const worldLand = await pressSite();
  await p.screenshot({ path: `${OUT}/live-waymark-${engine}-${tag}-site-world.png` });
  // keel sends a signed-in owner on from /w/<world> to /account/worlds/<world>; /w/<world> itself also counts.
  const wantWorld = [`/account/worlds/${W}`, `/w/${W}`];
  check(worldLand.u.hostname === 'www.onlyworlds.com' && worldLand.status === 200 && !worldLand.signedOut && !worldLand.notFound && wantWorld.some((x) => worldLand.u.pathname.startsWith(x)),
    `the world's onlyworlds.com row opens its page on the site, signed in (${worldLand.status} ${worldLand.u.pathname})`);
  await backHome(W);

  // ---- 4. The Character's page: one mark beside its name ----
  let el = null;
  for (let i = 0; i < 20 && !el; i++) {
    el = await p.evaluate(([w, e]) => new Promise((res) => {
      const r = indexedDB.open(`lantern-world-${w}`);
      r.onsuccess = () => {
        if (!r.result.objectStoreNames.contains('elements')) return res(null);
        const g = r.result.transaction('elements').objectStore('elements').get(e);
        g.onsuccess = () => res(g.result ?? null);
      };
      r.onerror = () => res(null);
    }), [W, made.id]);
    if (!el) await p.waitForTimeout(1000);
  }
  need(Boolean(el), `the walk's Character arrived on the phone (${el ? el.type : 'none; the home reads: ' + (await screen())})`);
  await p.evaluate(([w, id]) => { location.hash = `#/w/${w}/e/${id}`; }, [W, made.id]);
  const shown = await p.waitForFunction((n) => document.querySelector('[data-screen="element"]')?.textContent?.includes(n), name, { timeout: 15000 }).then(() => true, () => false);
  need(shown, 'the Character\'s page shows its name');
  const elMark = p.locator('[data-screen="element"] .lantern-waymark[data-mark="element"] .ow-waymark__mark');
  await elMark.waitFor({ timeout: 10000 }).catch(() => {});
  need((await elMark.count()) === 1 && (await marks.count()) === 1, `the Character's page shows one mark beside its name (${await elMark.count()} beside the name, ${await marks.count()} on the page)`);
  const hashEl = await p.evaluate(() => location.hash);
  await elMark.tap();
  await pop.waitFor({ timeout: 5000 }).catch(() => {});
  check(await isOpen(), 'a tap on the Character\'s mark opens the fan-out');
  check((await p.locator('.sheet[role="dialog"]').count()) === 0, 'and opens no rename sheet');
  const elName = await pop.locator('.ow-waymark__name').textContent().catch(() => null);
  check(elName === name, `the name line is the Character's name (${elName})`);
  const door = await pop.locator('.ow-waymark__door').textContent().catch(() => null);
  check(/^Last shaped in /.test(door ?? ''), `a member reads "Last shaped in ..." (${door}; keel's doors ${JSON.stringify(doors)})`);
  const elRows = await rowLabels();
  check(JSON.stringify(elRows) === JSON.stringify(WANT_ROWS), `the Character's rows: ${elRows.join(', ')}`);
  const elementUrl = `${SITE}/w/${W}/character/${made.id}`;
  const elHref = await siteRow.getAttribute('href').catch(() => null);
  check(elHref === elementUrl, `the Character's onlyworlds.com row goes to its page (${elHref})`);
  await p.screenshot({ path: `${OUT}/live-waymark-${engine}-${tag}-element-open.png` });
  // Lantern's own row: closes, goes nowhere.
  const hrefBefore = p.url();
  await hereRow.tap();
  await p.waitForTimeout(400);
  check(!(await isOpen()) && p.url() === hrefBefore, '"You are here" closes the fan-out and the address stays');
  // Copy link.
  await elMark.tap();
  await pop.waitFor({ timeout: 5000 });
  await copyRow.tap();
  const toastSaid = await p.locator('.ow-waymark__toast:not([hidden])', { hasText: 'Link copied' }).waitFor({ timeout: 4000 }).then(() => true, () => false);
  const copied = engine === 'chromium'
    ? await p.evaluate(() => navigator.clipboard.readText()).catch((e) => 'unread: ' + String(e).slice(0, 60))
    : await p.evaluate(() => window.__owCopied ?? null);
  check(copied === elementUrl && toastSaid, `Copy link ${engine === 'chromium' ? 'puts' : 'writes'} the Character's address ${engine === 'chromium' ? 'on the clipboard' : '(the page\'s write, read back)'}, "Link copied" said (${copied}; toast ${toastSaid})`);
  await p.waitForFunction(() => !document.querySelector('.ow-waymark__toast:not([hidden])'), null, { timeout: 8000 }).catch(() => {});
  // A tap on the scrim closes it.
  await elMark.tap();
  await pop.waitFor({ timeout: 5000 });
  await p.locator('.ow-waymark__scrim:not([hidden])').tap({ position: { x: 12, y: 12 } }).catch((e) => console.log(`${T}      the scrim tap: ${String(e).split('\n')[0]}`));
  await p.waitForTimeout(400);
  check(!(await isOpen()) && (await p.evaluate(() => location.hash)) === hashEl, 'a tap on the scrim closes the Character\'s fan-out, the address stays');
  // The Character's onlyworlds.com row, on the real site.
  await elMark.tap();
  await pop.waitFor({ timeout: 5000 });
  const elLand = await pressSite();
  await p.screenshot({ path: `${OUT}/live-waymark-${engine}-${tag}-site-element.png` });
  check(elLand.u.hostname === 'www.onlyworlds.com' && elLand.status === 200 && !elLand.signedOut && !elLand.notFound,
    `the Character's onlyworlds.com row opens its page on the site, signed in, not a 404 (${elLand.status} ${elLand.u.pathname})`);
} catch (e) {
  if (!String(e).includes('stopped:')) check(false, `the walk went on (${String(e).split('\n')[0].slice(0, 160)})`);
  await p.screenshot({ path: `${OUT}/live-waymark-${engine}-${tag}-x-stopped.png` }).catch(() => {});
} finally {
  // The site's session in this context, then the record.
  await p.goto(`${SITE}/accounts/logout/`, { timeout: 20000 }).then(async () => {
    const btn = p.locator('form[action*="logout"] button[type="submit"], form[action*="logout"] input[type="submit"]').first();
    if (await btn.count()) await Promise.all([p.waitForLoadState('domcontentloaded'), btn.tap()]);
  }).catch(() => {});
  await teardown();
  clearTimeout(watchdog);
}
check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]);
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
