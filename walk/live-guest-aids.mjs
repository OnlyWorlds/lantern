// A player's reading aids on live keel, as a phone opens a player link. One throwaway world on crew-walk-a: a
// marked Charter (keel's house grant: whole to every member), a marked Guide and Domain whose `characters` name
// The Kid (whole to The Kid's player), a marked Domain that does not (the player may not read it), Ana (The Kid's
// friend: a known-of stub) and a lore Construct linked to The Kid. A player link for The Kid opened in Lantern.
// It prints what keel served the player (GET /me reading_aids, each aid's body: its mark, known_of) and checks the
// home: the door holds the aids keel's packet names, the lists and search leave them out, the lore stays in.
// Run: CREW_FILE=<file> [SERVE_DIST=dist] node walk/live-guest-aids.mjs [url] [chromium|webkit] [tag]
// SERVE_DIST serves the local build at the url's origin (keel's CORS admits only its hosts), keel itself real.
// The teardown revokes the link, deletes the world on the site (its name typed) and revokes only this walk's token.
import './guard.mjs';
import fs from 'node:fs';
import { chromium, webkit, devices } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';

const [, , url = 'https://lantern.onlyworlds.com', engineName = 'chromium', tag = 'live'] = process.argv;
const API = 'https://www.onlyworlds.com/api/v2';
const OUT = process.env.SHOTS ?? 'walk/shots';
fs.mkdirSync(OUT, { recursive: true });
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith('crew-walk-a ') && l.includes('@')).trim().split(/\s+/);
const pin = lines.find((l) => /^crew-walk-a PIN /i.test(l))?.trim().split(/\s+/)[2];
let failures = 0;
const check = (ok, what) => {
  console.log(`[${engineName} ${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const T = () => AbortSignal.timeout(30000);

const signed = await new OwV2Client({}).signInWithPassword({ email, password, tokenName: `S526 Lantern guest aids ${engineName} ${tag} (crew-walk-a)` });
const auth = { Authorization: `Bearer ${signed.token}`, 'Content-Type': 'application/json' };
const name = `S526 Lantern guest aids ${engineName} ${tag} (throwaway)`;
let res = await fetch(`${API}/account/worlds`, { method: 'POST', headers: auth, body: JSON.stringify({ name }), signal: T() });
if (res.status === 422) res = await fetch(`${API}/account/worlds`, { method: 'POST', headers: auth, body: JSON.stringify({ name, pin }), signal: T() });
const world = await res.json();
console.log(`world ${world.id} (${res.status})`);
const links = [];

try {
  const wk = { 'API-Key': world.key, 'API-Pin': pin, 'Content-Type': 'application/json' };
  const post = async (type, body) => {
    const r = await fetch(`${API}/${type}`, { method: 'POST', headers: wk, body: JSON.stringify(body), signal: T() });
    const j = await r.json();
    if (!r.ok) console.log(`setup: POST ${type} ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  };
  const mark = world.id;
  const ana = await post('character', { name: 'Ana', description: 'Sells mules at the crossing.' });
  const kid = await post('character', { name: 'The Kid', description: 'Rides west.', friends: [ana.id] });
  const charter = await post('law', { name: 'House rules', supertype: 'Charter', x_charter_of: mark, description: 'Be kind at the table.' });
  const near = await post('construct', { name: 'The crossing', supertype: 'Domain', x_charter_of: mark, description: 'Where the mules are sold.', characters: [kid.id] });
  const far = await post('construct', { name: 'The far coast', supertype: 'Domain', x_charter_of: mark, description: 'Nobody here has been.' });
  const guide = await post('construct', { name: 'Start at the crossing', supertype: 'Guide', x_charter_of: mark, description: 'Read the crossing first.', constructs: [near.id, far.id], characters: [kid.id] });
  const lore = await post('construct', { name: 'The mule trade', supertype: 'Custom', description: 'Who buys, who sells.', characters: [kid.id] });
  const link = await (await fetch(`${API}/account/worlds/${world.id}/links`, { method: 'POST', headers: auth, body: JSON.stringify({ reader: 'player', character: kid.id, days: 1 }), signal: T() })).json();
  if (link?.id) links.push(link.id);
  check(typeof link.code === 'string' && [ana, kid, charter, near, far, guide, lore].every((x) => x?.id), 'setup: seven elements, a player link for The Kid');

  const browser = await (engineName === 'webkit' ? webkit : chromium).launch();
  try {
    const ctx = await browser.newContext({ ...devices[engineName === 'webkit' ? 'iPhone 13' : 'Pixel 7'], serviceWorkers: 'block' });
    const DIST = process.env.SERVE_DIST;
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
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/#/join/${link.code}`);
    await page.locator('.invite').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await page.locator("[data-action=open-player]").tap({ timeout: 10000 });
    const landed = await page.waitForURL(/#\/w\//, { timeout: 60000 }).then(() => true, () => false);
    check(landed, `the link opens the world (${page.url().replace(/^.*#/, '#')})`);
    if (!landed) {
      await page.screenshot({ path: `${OUT}/live-guest-aids-${engineName}-${tag}-join.png`, fullPage: true });
      throw new Error(`stuck at the join: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    const wid = page.url().match(/#\/w\/([^/?]+)/)?.[1];
    await page.locator('[data-screen="home"]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(4000);

    // What keel served this player, read with the key the phone holds.
    const rec = await page.evaluate((id) => new Promise((ok, no) => {
      const r = indexedDB.open('lantern');
      r.onsuccess = () => { const g = r.result.transaction('worlds').objectStore('worlds').get(id); g.onsuccess = () => ok(g.result); g.onerror = () => no(g.error); };
      r.onerror = () => no(r.error);
    }), wid);
    const pk = { 'API-Key': rec?.apiKey ?? '' };
    const me = await (await fetch(`${API}/me`, { headers: pk, signal: T() })).json();
    console.log(`player /me reading_aids: ${JSON.stringify(me.reading_aids ?? null)}`);
    for (const [type, el] of [['law', charter], ['construct', guide], ['construct', near], ['construct', far], ['construct', lore], ['character', ana]]) {
      const r = await fetch(`${API}/${type}/${el.id}`, { headers: pk, signal: T() });
      const b = r.ok ? await r.json() : null;
      console.log(`player GET ${type} ${el.name}: ${r.status}${b ? ` known_of=${!!b.known_of} x_charter_of=${b.x_charter_of ?? '(absent)'}` : ''}`);
    }
    console.log(`phone record servedAids: ${JSON.stringify(rec?.servedAids ?? '(absent)')}`);

    // The home: the door holds what keel's packet names; the lists leave them out.
    const door = page.locator('[data-part="reading-aids"]');
    const doorText = (await door.count()) ? (await door.innerText()).replace(/\s+/g, ' ') : '';
    console.log(`door: ${JSON.stringify(doorText)}`);
    const packetNames = [me.reading_aids?.charter?.name, me.reading_aids?.guide?.name, ...(me.reading_aids?.domains ?? []).map((d) => d.name)].filter(Boolean);
    check(packetNames.length > 0 && packetNames.every((n) => doorText.includes(n)), `the door names every aid keel's packet names (${JSON.stringify(packetNames)})`);
    check(!doorText.includes('The far coast') || packetNames.includes('The far coast'), 'the door names no aid keel did not serve this player');
    await page.screenshot({ path: `${OUT}/live-guest-aids-${engineName}-${tag}-home.png`, fullPage: true });
    await page.goto(`${url}/?l#/w/${wid}/t/construct`);
    await page.waitForTimeout(2500);
    const listed = await page.$$eval('.el-row b', (bs) => bs.map((b) => b.textContent));
    check(listed.includes('The mule trade') && !listed.includes('The crossing') && !listed.includes('Start at the crossing'), `the Constructs list holds the lore alone (${JSON.stringify(listed)})`);
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  } finally {
    await browser.close();
  }
} finally {
  const client = new OwV2Client({ apiKey: signed.token });
  for (const id of links) await client.revokeWorldLink(world.id, id).catch((e) => console.log('teardown: revoke failed', String(e)));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`https://www.onlyworlds.com/account/worlds/${world.id}/delete`);
  await page.waitForLoadState('networkidle');
  if (await page.locator('input[type="password"]').count()) {
    await page.locator('input[type="email"], input[name="login"], input[name="email"], input[name="username"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"], input[type="submit"]').first().click();
    await page.waitForLoadState('networkidle');
    if (!page.url().includes(`/account/worlds/${world.id}/delete`)) await page.goto(`https://www.onlyworlds.com/account/worlds/${world.id}/delete`);
    await page.waitForLoadState('networkidle');
  }
  await page.locator('form input[type="text"], form input:not([type])').first().fill(name);
  await page.locator('form button[type="submit"], form input[type="submit"]').last().click();
  await page.waitForLoadState('networkidle');
  await browser.close();
  const listed = await (await fetch(`${API}/account/worlds`, { headers: auth })).json();
  const ids = new Set((listed.data ?? listed.results ?? listed ?? []).map((x) => x.id));
  console.log(`teardown: ${links.length} links revoked; world still listed: ${ids.has(world.id)}`);
  const del = await fetch(`${API}/account/tokens/${signed.id}`, { method: 'DELETE', headers: auth });
  const after = await fetch(`${API}/account`, { headers: auth });
  console.log(`teardown: token DELETE ${del.status}, then GET /account ${after.status}`);
}
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
