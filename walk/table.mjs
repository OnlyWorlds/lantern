// The party link (keel #422 PR 2, keel PR 110; Seethe's frame 5), as a phone taps it, both engines,
// on a fake keel shaped by PR 110's table_preview and _table_pick: "Who are you at this table?"
// lists the owner's picks with the taken one greyed and last; Open waits for a pick and names it;
// a pick taken a moment ago brings the list back from keel with a sentence and nothing spent; the
// pick opens the world as that Character; a table with no list asks each name; every Character
// taken says so with no button.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/table.mjs [webkit|chromium]
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
const WID = '0aaa0000-0000-4000-8000-0000000000ab';
const WHITE = '0ccc0000-0000-4000-8000-0000000000a1';
const DONIPHAN = '0ccc0000-0000-4000-8000-0000000000a2';
const LINCOLN = '0ccc0000-0000-4000-8000-0000000000a3';
const KEY = 'ow_r_' + 't'.repeat(30);
const NAMES = { [WHITE]: 'Captain White', [DONIPHAN]: 'Alexander Doniphan', [LINCOLN]: 'A. L. Lincoln' };

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled/i.test(m.text()) && errors.push(m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/table-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });

  // The fake: one table of 5 (White, Lincoln, Doniphan; Lincoln already played), one with no list.
  const played = new Set([LINCOLN]);
  const seats = { ow_j_table: 0, ow_j_named: 0, ow_j_alltaken: 0 };
  const lists = { ow_j_table: [WHITE, LINCOLN, DONIPHAN], ow_j_named: [], ow_j_alltaken: [LINCOLN] };
  let stealNext = false;
  const redeems = [];
  await page.route(/onlyworlds\.com/, async (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const h = req.headers();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = req.method() === 'POST' ? req.postDataJSON() : null;
    if (path === '/join/preview') {
      const list = lists[body.code];
      return json(200, {
        reader: 'player', world: { name: 'BM walk copy', description: '' }, invited_by: 'Seethe', owner_character: null, role: 'guest', with_character: false,
        expires_at: '2026-10-26T00:00:00+00:00', max_uses: 5, uses_left: 5 - seats[body.code], name_required: list.length === 0,
        characters: list.map((id) => ({ id, name: NAMES[id], image_url: null, taken: played.has(id) })),
      });
    }
    if (path === '/join') {
      redeems.push({ body, credential: Boolean(h['authorization'] || h['api-key']) });
      if (stealNext) {
        // Someone at the table took it between this phone's preview and its tap.
        stealNext = false;
        played.add(body.character);
        return json(422, { error: { type: 'invalid_request', code: 'character_taken', param: 'character', message: 'That Character is taken: pick another from the list.' } });
      }
      const list = lists[body.code];
      let ch = body.character;
      if (!list.length) {
        if (!body.name) return json(422, { error: { code: 'invalid_request', param: 'name' } });
        ch = '0ddd0000-0000-4000-8000-000000000001';
        NAMES[ch] = body.name;
      } else if (!list.includes(ch) || played.has(ch)) {
        return json(422, { error: { code: 'invalid_request', param: 'character' } });
      }
      seats[body.code]++;
      played.add(ch);
      return json(201, { kind: 'player', key: KEY, world: { id: WID, name: 'BM walk copy', description: '' }, character: { id: ch, name: NAMES[ch] }, role: 'guest' });
    }
    if (h['api-key'] === KEY && req.method() === 'GET' && path === '/world') return json(200, { id: WID, name: 'BM walk copy', description: '' });
    if (h['api-key'] === KEY && req.method() === 'GET' && path === '/me') return json(200, { kind: 'player', role: 'guest', character: redeems.at(-1)?.body?.character ?? null, scope: 'read' });
    return r.abort();
  });

  await page.goto(`${BASE}/?from=keel#/join/ow_j_table`);
  await page.waitForSelector('.invite', { timeout: 15000 });
  const invite = await page.locator('.invite').innerText();
  check(tag, /The link works 5 times, until 26 October\. 5 places are left\./.test(invite), `the card says how often it works: ${JSON.stringify(invite.split('\n').at(-1))}`);
  const picks = await page.locator('[data-pick]').evaluateAll((bs) => bs.map((b) => [b.querySelector('b').textContent, b.disabled]));
  check(tag, JSON.stringify(picks) === JSON.stringify([['Captain White', false], ['Alexander Doniphan', false], ['A. L. Lincoln', true]]), `the owner's picks, the taken one greyed and last: ${JSON.stringify(picks)}`);
  const open = page.locator('[data-action=open-player]');
  check(tag, (await open.isDisabled()) && (await open.innerText()) === 'Pick who you are', 'Open waits for a pick');
  await shot('list');

  // White, then taken by someone else before this tap lands.
  await page.locator(`[data-pick="${WHITE}"]`).tap();
  check(tag, (await open.innerText()) === 'Open BM walk copy as Captain White' && !(await open.isDisabled()), 'a pick names who opens the world');
  await shot('picked');
  stealNext = true;
  await open.tap();
  await page.waitForFunction(() => /a moment ago/.test(document.querySelector('[data-role=pick-refused]')?.textContent ?? ''), null, { timeout: 15000 });
  const after = await page.locator('[data-pick]').evaluateAll((bs) => bs.map((b) => [b.querySelector('b').textContent, b.disabled]));
  check(tag, JSON.stringify(after) === JSON.stringify([['Alexander Doniphan', false], ['Captain White', true], ['A. L. Lincoln', true]]), `taken a moment ago: the list comes back from keel with White taken (${JSON.stringify(after)})`);
  check(tag, (await open.isDisabled()), 'and nothing is picked until the player picks again');
  const above = await page.evaluate(() => {
    const e = document.querySelector('[data-role=pick-refused]');
    const l = document.querySelector('[data-pick]');
    return !!e && !!l && e.getBoundingClientRect().bottom <= l.getBoundingClientRect().top;
  });
  check(tag, above, 'the sentence sits above the list, where the player looks again');
  await shot('taken');

  await page.locator(`[data-pick="${DONIPHAN}"]`).tap();
  await page.locator('input[aria-label="Your name"]').fill('Mara');
  await open.tap();
  await page.waitForFunction((id) => location.hash.startsWith(`#/w/${id}`), WID, { timeout: 15000 });
  const last = redeems.at(-1);
  check(tag, last?.body?.character === DONIPHAN && last?.body?.name === 'Mara' && !last.credential, `the pick and the name went, no credential (${JSON.stringify(last)})`);
  await page.waitForSelector('[data-screen="home"]', { timeout: 15000 });
  await shot('home');

  // A table with no list: the name is asked, and an empty one is said before anything is sent.
  await page.goto(`${BASE}/?named#/join/ow_j_named`);
  await page.waitForSelector('.invite', { timeout: 15000 });
  check(tag, (await page.locator('[data-pick]').count()) === 0 && /a Character of your own/.test(await page.locator('.invite').innerText()), 'a table with no list offers no list, and says the Character is your own');
  const sent = redeems.length;
  await page.locator('[data-action=open-player]').tap();
  check(tag, /Type your name/.test((await page.locator('.error').allInnerTexts()).join(' ')) && redeems.length === sent, 'an empty name is said, and nothing is sent');
  await shot('named');

  // Every Character taken: said, and no button.
  await page.goto(`${BASE}/?full#/join/ow_j_alltaken`);
  await page.waitForSelector('.invite', { timeout: 15000 });
  check(tag, /Every Character on this link is taken/.test(await page.locator('[data-screen=join]').innerText()) && (await page.locator('[data-action=open-player]').count()) === 0, 'every Character taken: said, and no Open');
  await shot('alltaken');

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
