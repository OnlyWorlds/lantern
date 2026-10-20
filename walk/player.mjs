// A player link, no account (Keel #353, keel PR 55), as a phone taps it, both engines, on a fake
// keel shaped by keel's own join_api.py: the preview says reader player; "Open The Reach" posts
// POST /join with no credential and an optional name; the 201 PlayerJoined's read key is kept and
// the world opens to read; the player's notes stay on the phone with no Share; a spent link is
// the one 404.
// Run: npm run build && (npx vite preview &) && node walk/player.mjs [webkit|chromium]
import './guard.mjs';
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const WID = '0aaa0000-0000-4000-8000-0000000000aa';
const CHAR = '0ccc0000-0000-4000-8000-0000000000cc';
const KEY = 'ow_r_' + 'p'.repeat(30);

const record = (page) =>
  page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const g = r.result.transaction('worlds').objectStore('worlds').get(id);
          g.onsuccess = () => {
            r.result.close();
            res(g.result);
          };
        };
      }),
    WID,
  );

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  let expect4xx = false;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !(expect4xx && /Failed to load resource/.test(m.text())) && !/ERR_FAILED|cancelled/i.test(m.text()) && errors.push(m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/player-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });

  const redeems = [];
  let spent = false;
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, async (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const h = req.headers();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'POST' && path === '/join/preview') {
      if (spent) return json(404, { error: { code: 'not_found', message: 'This join code is not valid.' } });
      return json(200, { reader: 'player', world: { name: 'The Reach', description: 'Salt and debts.' }, invited_by: 'Ada', owner_character: null, role: 'guest', with_character: true, expires_at: '2026-10-23T00:00:00+00:00' });
    }
    if (req.method() === 'POST' && path === '/join') {
      redeems.push({ body: req.postDataJSON(), credential: Boolean(h['authorization'] || h['api-key']) });
      if (spent) return json(404, { error: { code: 'not_found', message: 'This join code is not valid.' } });
      spent = true;
      return json(201, { kind: 'player', key: KEY, world: { id: WID, name: 'The Reach', description: 'Salt and debts.' }, character: { id: CHAR, name: 'Tor' }, role: 'guest' });
    }
    if (h['api-key'] === KEY && req.method() === 'GET' && path === '/world') return json(200, { id: WID, name: 'The Reach', description: 'Salt and debts.' });
    if (h['api-key'] === KEY && req.method() === 'GET' && path === '/me') return json(200, { kind: 'player', role: 'guest', character: CHAR, scope: 'read' });
    return r.abort();
  });

  // keel's /join page hands the code on in the fragment.
  await page.goto(`${BASE}/?from=keel#/join/ow_j_playerlink`);
  await page.waitForSelector('.invite', { timeout: 15000 });
  const invite = await page.locator('.invite').innerText();
  check(tag, /Ada invites you to play in The Reach\./.test(invite), `the invite says play: ${JSON.stringify(invite.split('\n')[0])}`);
  check(tag, /with no account/.test(invite), 'and that no account is needed');
  check(tag, (await page.getByRole('button', { name: 'Sign in to join' }).count()) === 0, 'no sign-in is asked');
  check(tag, (await page.locator('input[aria-label="PIN"]').count()) === 0, 'no PIN is asked');
  await shot('invite');

  await page.locator('input[aria-label="Your name"]').fill('Ana');
  await page.getByRole('button', { name: 'Open The Reach' }).tap();
  await page.waitForFunction((id) => location.hash.startsWith(`#/w/${id}`), WID, { timeout: 15000 });
  check(tag, redeems.length === 1 && !redeems[0].credential, `redeemed once, with no credential (${JSON.stringify(redeems)})`);
  check(tag, redeems[0]?.body?.name === 'Ana' && redeems[0]?.body?.code === 'ow_j_playerlink', 'the code and the name went with it');
  const rec = await record(page);
  check(tag, rec?.apiKey === KEY && rec?.playerSeat === true && rec?.memberRole === 'guest' && rec?.characterId === CHAR && !rec?.role, `kept as a player seat: ${JSON.stringify({ key: rec?.apiKey?.slice(0, 5), playerSeat: rec?.playerSeat, memberRole: rec?.memberRole, role: rec?.role })}`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 15000 });
  await shot('home');

  // A player's notes: kept on the phone, no Share.
  await page.goto(`${BASE}/?player#/w/${WID}/notes`);
  await page.waitForSelector('[data-screen=notes]');
  const intro = await page.locator('[data-screen=notes] p.dim').first().innerText();
  check(tag, /sharing with the party needs an account/.test(intro), `the notes say why they stay here: ${JSON.stringify(intro)}`);
  await page.locator('textarea[aria-label="A note"]').fill('The innkeeper lied');
  await page.getByRole('button', { name: 'Save the note' }).tap();
  await page.waitForSelector('.note-card');
  check(tag, (await page.locator('[data-action=share-note]').count()) === 0, 'a saved note offers no Share');
  await shot('notes');

  // The same link again: spent, the one 404.
  expect4xx = true;
  await page.goto(`${BASE}/?again#/join/ow_j_playerlink`);
  await page.waitForFunction(() => document.querySelector('.error')?.textContent, null, { timeout: 15000 });
  check(tag, /does not work/.test(await page.locator('.error').first().innerText()), 'the spent link says it does not work');

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
