// keel's "known of" stub (PR 113) on live keel, as a phone taps it. One throwaway world on crew-walk-a: The Kid,
// whose friend is Ana, so Ana is a stub to The Kid's player. A player link for The Kid opened in Lantern.
// Checks: Ana's row says known of; her page shows her description, the known-of line, only the fields keel shares (PR 117), no
// empty-field toggle; The Kid's page has its rows and no line (the control). The control build is the same walk on a
// build before the stub (LANTERN_URL).
// The teardown revokes the link, deletes the world on the site (its name typed) and revokes only this walk's token.
// Run: CREW_FILE=<file> LANTERN_URL=<url> SHOTS=<dir> node walk/live-knownof.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';
import fs from 'node:fs';

const API = 'https://www.onlyworlds.com/api/v2';
const BASE = process.env.LANTERN_URL ?? 'https://lantern.onlyworlds.com';
const OUT = process.env.SHOTS ?? 'walk/shots';
fs.mkdirSync(OUT, { recursive: true });
const engineName = process.argv[2] ?? 'chromium';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith('crew-walk-a ') && l.includes('@')).trim().split(/\s+/);
const pin = lines.find((l) => /^crew-walk-a PIN /i.test(l))?.trim().split(/\s+/)[2];
let failures = 0;
const check = (ok, what) => {
  console.log(`[${engineName}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const signed = await new OwV2Client({}).signInWithPassword({ email, password, tokenName: `S444 Lantern known-of walk ${engineName} (crew-walk-a)` });
const auth = { Authorization: `Bearer ${signed.token}`, 'Content-Type': 'application/json' };
const name = `S444 Lantern known of ${engineName} (throwaway)`;
let res = await fetch(`${API}/account/worlds`, { method: 'POST', headers: auth, body: JSON.stringify({ name }) });
if (res.status === 422) res = await fetch(`${API}/account/worlds`, { method: 'POST', headers: auth, body: JSON.stringify({ name, pin }) });
const world = await res.json();
const links = [];

try {
  const wk = { 'API-Key': world.key, 'API-Pin': pin, 'Content-Type': 'application/json' };
  const post = async (type, body) => (await (await fetch(`${API}/${type}`, { method: 'POST', headers: wk, body: JSON.stringify(body) })).json());
  const ana = await post('character', { name: 'Ana', description: 'Sells mules at the crossing.', reputation: 'Honest', physicality: 'Tall', mentality: 'Sly' });
  const kid = await post('character', { name: 'The Kid', description: 'Rides west.', physicality: 'Thin', friends: [ana.id] });
  const link = await (await fetch(`${API}/account/worlds/${world.id}/links`, { method: 'POST', headers: auth, body: JSON.stringify({ reader: 'player', character: kid.id, days: 1 }) })).json();
  if (link?.id) links.push(link.id);
  check(typeof link.code === 'string' && !!ana.id && !!kid.id, 'setup: Ana, The Kid with Ana as a friend, a player link for The Kid');

  const browser = await (engineName === 'webkit' ? webkit : chromium).launch();
  try {
    const page = await (await browser.newContext({ ...devices[engineName === 'webkit' ? 'iPhone 13' : 'Pixel 7'], serviceWorkers: 'block' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = (n) => page.screenshot({ path: `${OUT}/live-knownof-${engineName}-${n}.png`, fullPage: true });
    await page.goto(`${BASE}/#/join/${link.code}`);
    await page.locator('.invite').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await page.locator('[data-action=open-player], button:has-text("Open")').first().tap({ timeout: 10000 }).catch(() => {});
    const landed = await page.waitForURL(/#\/w\//, { timeout: 60000 }).then(() => true, () => false);
    check(landed, `the link opens the world (${page.url().replace(/^.*#/, '#')})`);
    const wid = page.url().match(/#\/w\/([^/?]+)/)?.[1];
    await page.locator('[data-screen="home"] .el-row', { hasText: 'Ana' }).first().waitFor({ timeout: 30000 }).catch(() => {});
    const row = (await page.locator('[data-screen="home"] .el-row', { hasText: 'Ana' }).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    check(/known of/.test(row), `Ana's row says known of (${JSON.stringify(row)})`);
    await shot('1-home');

    await page.goto(`${BASE}/?ana#/w/${wid}/e/${ana.id}`);
    const el = page.locator('[data-screen="element"]');
    await el.locator('h1').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const line = el.locator('[data-part="known-of"]');
    check((await line.count()) === 1 && (await line.innerText()) === 'Known of: you know only what anyone could see of Ana.', 'Ana says known of');
    check((await el.innerText()).includes('Sells mules at the crossing.'), "Ana's description shows");
    // keel: physicality and reputation are public on a Character; mentality is not, so it never shows.
    const fields = await el.locator('.frow[data-field]').evaluateAll((rs) => rs.map((r) => `${r.getAttribute('data-field')}=${r.querySelector('.v')?.textContent}`));
    check(JSON.stringify(fields) === JSON.stringify(['physicality=Tall', 'reputation=Honest']), `only what keel shares: ${JSON.stringify(fields)}`);
    check(!(await el.innerText()).includes('Sly'), 'her mentality (not shared) is nowhere on the page');
    const toggle = await el.locator('[data-action="toggle-fields"]').innerText().catch(() => '(none)');
    check(toggle === '(none)', `no empty-field toggle (${toggle})`);
    await shot('2-ana');

    await page.goto(`${BASE}/?kid#/w/${wid}/e/${kid.id}`);
    await el.locator('h1').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    check((await el.locator('[data-part="known-of"]').count()) === 0 && (await el.locator('.frow[data-field]').count()) > 0, `The Kid is whole (rows ${await el.locator('.frow[data-field]').count()}, no line)`);
    await shot('3-kid');
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
