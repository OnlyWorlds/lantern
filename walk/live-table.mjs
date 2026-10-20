// S443: the party link's pick on live keel (PR 110), as a phone taps it. One throwaway world on crew-walk-a with three
// Characters; a table link (3 uses: Captain White, Alexander Doniphan, Sarah Borginnis) whose Captain White a seat takes
// over the API first, and a table with no list (2 uses).
// Checks: White greyed and last; Open waits for a pick and names it; Doniphan opens the world; with no list an empty
// name is stopped here and "Briony" opens. The control is the same walk on a build before the pick (LANTERN_URL).
// The teardown revokes both links, deletes the world on the site (its name typed) and revokes only this walk's token.
// Run: CREW_FILE=<file> LANTERN_URL=<url> node walk/live-table.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';
import fs from 'node:fs';

const API = 'https://www.onlyworlds.com/api/v2';
const BASE = process.env.LANTERN_URL ?? 'https://lantern.onlyworlds.com';
const OUT = 'walk/shots';
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

const signed = await new OwV2Client({}).signInWithPassword({ email, password, tokenName: `S443 Lantern table walk ${engineName} (crew-walk-a)` });
const auth = { Authorization: `Bearer ${signed.token}`, 'Content-Type': 'application/json' };
const name = `S443 Lantern table ${engineName} (throwaway)`;
let res = await fetch(`${API}/account/worlds`, { method: 'POST', headers: auth, body: JSON.stringify({ name }) });
if (res.status === 422) res = await fetch(`${API}/account/worlds`, { method: 'POST', headers: auth, body: JSON.stringify({ name, pin }) });
const world = await res.json();
const links = [];

try {
  const wk = { 'API-Key': world.key, 'API-Pin': pin, 'Content-Type': 'application/json' };
  const make = async (n) => (await (await fetch(`${API}/character`, { method: 'POST', headers: wk, body: JSON.stringify({ name: n }) })).json()).id;
  const WHITE = await make('Captain White');
  const DONIPHAN = await make('Alexander Doniphan');
  const SARAH = await make('Sarah Borginnis');
  const mint = async (body) => {
    const j = await (await fetch(`${API}/account/worlds/${world.id}/links`, { method: 'POST', headers: auth, body: JSON.stringify({ reader: 'player', days: 1, ...body }) })).json();
    if (j?.id) links.push(j.id);
    return j;
  };
  const table = await mint({ max_uses: 3, characters: [WHITE, DONIPHAN, SARAH] });
  const named = await mint({ max_uses: 2 });
  check(typeof table.code === 'string' && typeof named.code === 'string', 'setup: a table link and a table with no list');
  const seat = await fetch(`${API}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: table.code, character: WHITE }) });
  check(seat.status === 201, `setup: a seat takes Captain White (${seat.status})`);

  const browser = await (engineName === 'webkit' ? webkit : chromium).launch();
  try {
    const page = await (await browser.newContext({ ...devices[engineName === 'webkit' ? 'iPhone 13' : 'Pixel 7'], serviceWorkers: 'block' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/#/join/${table.code}`);
    await page.locator('.invite').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    const invite = await page.locator('.invite').innerText();
    check(/The link works 3 times, until .+\. 2 places are left\./.test(invite), `the card: ${JSON.stringify(invite.split('\n').at(-1))}`);
    const picks = await page.locator('[data-pick]').evaluateAll((bs) => bs.map((b) => [b.querySelector('b').textContent, b.disabled]));
    check(JSON.stringify(picks) === JSON.stringify([['Alexander Doniphan', false], ['Sarah Borginnis', false], ['Captain White', true]]), `picks: ${JSON.stringify(picks)}`);
    const open = page.locator('[data-action=open-player]');
    check(await open.isDisabled().catch(() => false), `Open waits for a pick ("${(await open.innerText().catch(() => '')).trim()}")`);
    await page.screenshot({ path: `${OUT}/live-table-${engineName}-1-list.png` });
    await page.locator(`[data-pick="${DONIPHAN}"]`).tap().catch(() => {});
    check(/as Alexander Doniphan$/.test((await open.innerText().catch(() => '')).trim()), `Open names the pick ("${(await open.innerText().catch(() => '')).trim()}")`);
    await open.tap().catch(() => {});
    const landed = await page.waitForURL(/#\/w\//, { timeout: 60000 }).then(() => true, () => false);
    check(landed, `Doniphan opens the world (${page.url().replace(/^.*#/, '#')})`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/live-table-${engineName}-2-opened.png` });

    await page.goto(`${BASE}/?named#/join/${named.code}`);
    await page.locator('.invite').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await page.locator('[data-action=open-player]').tap().catch(() => {});
    await page.waitForTimeout(800);
    const said = (await page.locator('.error').allInnerTexts()).join(' ');
    check(/Type your name/.test(said), `no list, no name: stopped here (${JSON.stringify(said.trim())})`);
    // An older build has no data-action on its Open: the control taps the button by its words.
    await page.locator('input[aria-label="Your name"]').fill('Briony', { timeout: 10000 }).catch(() => {});
    await page.locator('[data-action=open-player], button:has-text("Open")').first().tap({ timeout: 10000 }).catch(() => {});
    const landed2 = await page.waitForURL(/#\/w\//, { timeout: 60000 }).then(() => true, () => false);
    check(landed2, 'Briony opens the world');
    const pv = await (await fetch(`${API}/join/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: named.code }) })).json();
    check(pv.uses_left === 1, `the no-list table spent one place (uses_left ${pv.uses_left})`);
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
