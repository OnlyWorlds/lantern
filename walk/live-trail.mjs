// The Waymark's trail on an element page, read live: "On OnlyWorlds: last shaped in ..." and the doors
// before it, from keel's `doors`, and Lantern's own write named the moment keel answers it.
//   1. Seed: crew-walk-b signs in by API (a token the walk records), mints one write key on its kept world
//      "Dashboard ground (crew test)" (recorded) and makes one Character there as client 'atlas', so keel's
//      doors hold Atlas. Every id is recorded before the next step.
//   2. The phone: Lantern's door #/open/<world>, Lantern's own sign-in by email and password, Open. Every
//      token and world key keel mints for Lantern is recorded from keel's answer.
//   3. The Character's page: one trail line, "last shaped in Atlas", and no "Before that".
//   4. Renamed on the phone (the PIN given where it is asked); once nothing waits to send, the trail reads
//      "last shaped in Lantern, just now" and "Before that: in Atlas", and keel's own read says the same.
//   5. Teardown: the Character deleted by its recorded id (410 or 404 after), every recorded world key revoked
//      by id (401 after), every recorded token revoked by id (401 after). A throw or the watchdog still runs it.
// The control is the live build before the trail (f38d057): it must FAIL at the first trail check and still
// take everything back. Secrets are never printed.
// Run from tools/lantern:
//   CREW_FILE=<crew-walk-accounts.txt> node walk/live-trail.mjs [url] [chromium|webkit|firefox] [tag]
import fs from 'node:fs';
import { chromium, webkit, firefox, devices } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';

const [, , url = 'https://lantern.onlyworlds.com', engine = 'chromium', tag = 'live'] = process.argv;
const WORLD_NAME = 'Dashboard ground (crew test)';
const TOKEN_NAME = 'Lantern walk, trail';
const OUT = 'walk/shots';
fs.mkdirSync(OUT, { recursive: true });
const API = 'https://www.onlyworlds.com/api/v2';
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
const trail = () => p.locator('[data-screen="element"] [data-section="door-trail"] p').allTextContents();
/** The PIN, where Lantern asks for it: a visible PIN field, or the field's or the world's Needs your PIN. */
async function givePin() {
  const ask = p.locator('button.wait-pin:visible, button.pill.alert:visible', { hasText: 'Needs your PIN' });
  if (await ask.count()) {
    await ask.first().tap();
    await p.locator('input[aria-label="PIN"]:visible').first().waitFor({ timeout: 5000 }).catch(() => {});
  }
  const field = p.locator('input[aria-label="PIN"]:visible');
  if (await field.count()) {
    await field.first().fill(pin);
    await field.first().press('Enter');
    return true;
  }
  return false;
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
  writer = new OwV2Client({ apiKey: wk.key, apiPin: pin, baseUrl: API, client: 'atlas', fetch: sdkFetch });
  const name = `Trail walk ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const made = await writer.create('character', { name });
  madeIds.push(made.id);
  console.log(`${T}      the walk's Character ${made.id} (recorded)`);
  const seeded = await writer.get('character', made.id);
  need(seeded.doors && Object.keys(seeded.doors).join() === 'atlas', `keel's doors on it hold Atlas alone (${JSON.stringify(seeded.doors ?? null)})`);

  // ---- 2. Lantern's door, its own sign-in, Open ----
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
  await p.waitForTimeout(1500);
  await givePin();

  // ---- 3. The Character's page: Atlas's door ----
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
  const first = await trail();
  await p.screenshot({ path: `${OUT}/live-trail-${engine}-${tag}-1-atlas.png` });
  need(first.length === 1 && /^On OnlyWorlds: last shaped in Atlas, (just now|\d+ min ago)$/.test(first[0]), `the trail reads Atlas's write alone (${JSON.stringify(first)})`);

  // ---- 4. Renamed on the phone: Lantern's door, at once ----
  const renamed = `${name} (renamed)`;
  await p.locator('.el-head h1').tap();
  await p.locator('.sheet input').fill(renamed);
  await p.getByRole('button', { name: 'Save' }).tap();
  await p.waitForTimeout(800);
  await givePin();
  // Sent: keel's copy holds the new name, and nothing waits on the phone.
  let sent = false;
  for (let i = 0; i < 30 && !sent; i++) {
    const r = await writer.get('character', made.id).catch(() => null);
    const waiting = await p.evaluate((w) => new Promise((res) => {
      const o = indexedDB.open(`lantern-world-${w}`);
      o.onsuccess = () => {
        if (!o.result.objectStoreNames.contains('outbox')) return res(0);
        const c = o.result.transaction('outbox').objectStore('outbox').count();
        c.onsuccess = () => res(c.result);
      };
      o.onerror = () => res(-1);
    }), W);
    sent = r?.name === renamed && waiting === 0;
    if (!sent) await p.waitForTimeout(1000);
  }
  need(sent, `the rename reached keel and nothing waits on the phone (${await screen()})`);
  const kept = await writer.get('character', made.id);
  check(Object.keys(kept.doors ?? {}).sort().join() === 'atlas,lantern', `keel's doors hold Atlas and Lantern (${JSON.stringify(kept.doors ?? null)})`);
  let second = [];
  for (let i = 0; i < 10; i++) {
    second = await trail();
    if (/in Lantern/.test(second[0] ?? '')) break;
    await p.waitForTimeout(500);
  }
  await p.screenshot({ path: `${OUT}/live-trail-${engine}-${tag}-2-lantern.png` });
  check(/^On OnlyWorlds: last shaped in Lantern, just now$/.test(second[0] ?? ''), `after the rename, the trail's first line names Lantern (${second[0]})`);
  check(/^Before that: in Atlas, (just now|\d+ min ago)$/.test(second[1] ?? '') && second.length === 2, `and "Before that" names Atlas (${second[1]})`);
  // After the poll has brought the write's echo back through the feed (no doors there), a reload with
  // no signal: the trail comes from the copy kept on the phone alone. Offline serving is Chromium's proof.
  const words = (lines) => JSON.stringify(lines.map((t) => t.replace(/,[^,·]*$/, '').replace(/, (just now|\d+ min ago)/g, '')));
  await p.waitForTimeout(25000);
  const polled = await trail();
  check(words(polled) === words(second), `after a poll the trail still reads both (${JSON.stringify(polled)})`);
  if (engine === 'chromium') {
    await ctx.setOffline(true);
    await p.reload();
    await p.waitForSelector('[data-screen="element"]', { timeout: 30000 });
    await p.waitForTimeout(1000);
    const third = await trail();
    await p.screenshot({ path: `${OUT}/live-trail-${engine}-${tag}-3-offline.png` });
    check(words(third) === words(second), `reloaded with no signal, the trail reads the same from the phone's copy (${JSON.stringify(third)})`);
    await ctx.setOffline(false);
  }
} catch (e) {
  if (!String(e).includes('stopped:')) check(false, `the walk went on (${String(e).split('\n')[0].slice(0, 160)})`);
  await p.screenshot({ path: `${OUT}/live-trail-${engine}-${tag}-x-stopped.png` }).catch(() => {});
} finally {
  await teardown();
  clearTimeout(watchdog);
}
check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]);
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
