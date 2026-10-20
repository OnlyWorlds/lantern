// Share with the party (the Captain h37 #4420, B; keel #241), as a player taps it, both engines.
// A world file made to look like a player's account world (a read key, a guest with a Character in
// The Party); keel routed: the key mint, the PIN read and the Narrative's POST are answered as keel
// answers them, every other call is cut off. Checks: the player's screens stay read only; the first
// share mints a write key for the membership and asks the PIN once; the note goes as a Narrative
// to the party with no narrator (keel fills it in); the card says where it went and opens it; a
// second share asks nothing and mints nothing; a seat with no Character is told why before a tap.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/sharenote.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile } from '@onlyworlds/sdk';

// WebKit logs the viewport's interactive-widget key (Android Chrome's keyboard rule, S404) as unknown: harmless.
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const WID = '0f0f0f0f-0000-4000-8000-00000000b41e';
const MIRA = 'b41e0000-0000-4000-8000-000000000001';
const PARTY = 'b41e0000-0000-4000-8000-000000000002';
const READ = 'ow_r_' + 'p'.repeat(30);
const WRITE = 'ow_w_' + 'q'.repeat(30);
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'The Reach' }) },
      { path: 'elements/character/mira.json', data: enc({ id: MIRA, name: 'Mira' }) },
      { path: 'elements/collective/party.json', data: enc({ id: PARTY, name: 'The Party', supertype: 'Party', characters: [MIRA] }) },
    ],
    'reach',
  ),
);

/** Patch the app db: the world's record, and a kv value. */
const patchApp = (page, patch, kv) =>
  page.evaluate(
    ([id, patch, kv]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction(['worlds', 'kv'], 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, ...patch });
          for (const [k, v] of Object.entries(kv)) t.objectStore('kv').put(v, k);
          t.oncomplete = () => {
            r.result.close();
            res(true);
          };
          t.onerror = () => rej(t.error);
        };
      }),
    [WID, patch, kv],
  );

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
  const ctx = await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled/i.test(m.text()) && errors.push('console: ' + m.text()));

  const mints = [];
  const pinReads = [];
  const notes = [];
  let seq = 100;
  // Who the signed-in account is in this world: the game master's phone first, then the player's.
  let seat = 'owner';
  let refuseNext = false;
  // The seat's Character, as keel's /me says it (the app learns it again on each open).
  let meChar = MIRA;
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const auth = req.headers()['authorization'] ?? req.headers()['api-key'] ?? '';
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'GET' && path === '/account/worlds') {
      return json(200, { data: [{ id: WID, name: 'The Reach', ...(seat === 'owner' ? { role: 'owner' } : { role: 'collaborator', member_role: 'guest' }) }] });
    }
    if (req.method() === 'GET' && (path === '/me' || path === '/me/') && auth.includes(WRITE)) return json(200, { role: 'guest', character: meChar, scope: 'write' });
    if (req.method() === 'POST' && path === '/narrative' && refuseNext) {
      refuseNext = false;
      notes.push({ refused: true });
      return json(400, { error: { code: 'invalid_request', message: 'Link not found.', type: 'invalid_request_error', param: 'collectives' } });
    }
    if (req.method() === 'POST' && path === `/account/worlds/${WID}/keys`) {
      mints.push(req.postDataJSON());
      return json(201, { key: WRITE, scope: 'write' });
    }
    if (req.method() === 'GET' && path === '/world' && req.headers()['api-pin']) {
      pinReads.push({ key: auth, pin: req.headers()['api-pin'] });
      return req.headers()['api-pin'] === '1234' ? json(200, { id: WID, name: 'The Reach' }) : json(401, { error: { code: 'invalid_credentials', message: 'Incorrect PIN.', type: 'authentication_error' } });
    }
    if (req.method() === 'POST' && path === '/narrative') {
      const body = req.postDataJSON();
      notes.push({ body, key: auth, pin: req.headers()['api-pin'] });
      // keel #241: the narrator filled in with the player's own Character.
      return json(201, { ...body, narrator: body.narrator ?? MIRA, type: 'narrative', change_seq: ++seq, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    return r.abort();
  });

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'reach.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await patchApp(page, { kind: 'online', apiKey: READ, keyKind: 'read', role: 'collaborator', memberRole: 'guest', characterId: MIRA }, { accountToken: 'ow_a_' + 'z'.repeat(30) });

  await page.goto(`${BASE}/?player#/w/${WID}/notes`);
  await page.waitForSelector('[data-screen=notes]');
  await page.locator('textarea[aria-label="A note"]').fill('The innkeeper lied\nHe said the north road was clear. Tor saw fresh tracks by the mill.');
  await page.getByRole('button', { name: 'Save the note' }).tap();
  await page.waitForSelector('[data-action=share-note]');
  await page.locator('[data-action=share-note]').first().tap();
  await page.waitForSelector('.sheet input[aria-label=PIN], [role=dialog] input[aria-label=PIN]');
  const sheetText = await page.locator('[role=dialog]').last().innerText().catch(() => page.locator('.sheet').last().innerText());
  check(tag, /To\s+The Party/.test(sheetText), 'the sheet names the party, the only group Mira is in');
  check(tag, /Mira tells it/.test(sheetText), 'and says Mira tells it');
  await page.screenshot({ path: `${OUT}/sharenote-${tag}-01-sheet.png` });

  // On the game master's phone (signed in as the owner): refused before any key is minted.
  await page.locator('input[aria-label=PIN]').fill('1234');
  await page.getByRole('button', { name: 'Share it' }).tap();
  await page.waitForFunction(() => /another account/.test(document.querySelector('[role=alert]')?.textContent ?? ''));
  check(tag, mints.length === 0 && notes.length === 0, "the game master's phone: said, no key minted, nothing sent");
  seat = 'player';

  // A wrong PIN first: said, nothing sent, and the key minted for it is kept (no second mint).
  await page.locator('input[aria-label=PIN]').fill('9999');
  await page.getByRole('button', { name: 'Share it' }).tap();
  await page.waitForFunction(() => /not your account/.test(document.querySelector('[role=alert]')?.textContent ?? ''));
  check(tag, notes.length === 0, 'a wrong PIN: said, and nothing sent');
  await page.locator('input[aria-label=PIN]').fill('1234');
  await page.getByRole('button', { name: 'Share it' }).tap();
  await page.waitForFunction(() => /Shared with The Party/.test(document.querySelector('[data-part=share-state]')?.textContent ?? ''), null, { timeout: 15000 });
  check(tag, mints.length === 1 && mints[0].scope === 'write', `one write key minted for the membership (${JSON.stringify(mints)})`);
  check(tag, pinReads.length === 2 && pinReads.every((p) => p.key.includes(WRITE)), 'the PIN read with the new key');
  const sent = notes[0]?.body ?? {};
  check(tag, notes.length === 1 && notes[0].key.includes(WRITE) && notes[0].pin === '1234', 'the Narrative went with the write key and the PIN');
  check(tag, sent.name === 'The innkeeper lied' && /Tor saw fresh tracks/.test(sent.description ?? ''), `first line the name, the rest the description (${JSON.stringify(sent.name)})`);
  check(tag, JSON.stringify(sent.collectives) === JSON.stringify([PARTY]) && !('narrator' in sent), 'told to the party, no narrator (keel fills it in)');
  const rec = await record(page);
  check(tag, rec.apiKey === WRITE && rec.keyKind === 'write' && rec.memberRole === 'guest', 'the world keeps the write key, still a player');
  await page.screenshot({ path: `${OUT}/sharenote-${tag}-02-shared.png` });

  // A second note: no PIN asked, no second key.
  await page.locator('textarea[aria-label="A note"]').fill('Bo owes Mira a silver coin.');
  await page.getByRole('button', { name: 'Save the note' }).tap();
  await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 2);
  await page.locator('.note-card').first().locator('[data-action=share-note]').tap();
  await page.waitForSelector('text=Share it');
  check(tag, (await page.locator('input[aria-label=PIN]').count()) === 0, 'the second share asks no PIN');
  await page.getByRole('button', { name: 'Share it' }).tap();
  // The card is marked shared when the note is queued; "Shared with" once keel has it.
  await page.waitForFunction(() => [...document.querySelectorAll('[data-part=share-state]')].filter((x) => /^Shared with/.test(x.textContent ?? '')).length === 2, null, { timeout: 15000 });
  check(tag, mints.length === 1 && notes.length === 2, `and mints no second key (mints ${mints.length}, notes ${notes.length})`);

  // Open it: the shared Narrative, on a player's screens, offers no change and no delete.
  await page.locator('.note-card').last().locator('[data-part=share-state] a').tap();
  await page.waitForSelector('[data-screen=element]');
  const pageText = await page.locator('[data-screen=element]').innerText();
  check(tag, /The innkeeper lied/.test(pageText), 'Open it opens the shared Narrative');
  check(tag, !/Delete this/.test(pageText) && (await page.locator('.edit-btn').count()) === 0, 'no edit or delete on it for a player');
  check(tag, (await page.locator('[data-tab=catch]').innerText()).trim() === 'Note', "the tab is still a player's Note");
  await page.screenshot({ path: `${OUT}/sharenote-${tag}-03-opened.png` });

  // A share keel refuses (Mira left the group meanwhile): said on the card, offered again.
  await page.goto(`${BASE}/?player3#/w/${WID}/notes`);
  await page.waitForSelector('[data-screen=notes]');
  await page.locator('textarea[aria-label="A note"]').fill('The ferry runs at dawn.');
  await page.getByRole('button', { name: 'Save the note' }).tap();
  await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 3);
  refuseNext = true;
  await page.locator('.note-card').first().locator('[data-action=share-note]').tap();
  await page.getByRole('button', { name: 'Share it' }).tap();
  await page.waitForFunction(() => /^Not shared: Your Character is not in that group/.test(document.querySelector('.note-card [data-part=share-state]')?.textContent ?? ''), null, { timeout: 15000 });
  check(tag, (await page.locator('.note-card').first().locator('[data-action=share-note]').innerText()).trim() === 'Share it again', 'a refused share is said on its card and offered again');
  await page.screenshot({ path: `${OUT}/sharenote-${tag}-035-refused.png` });

  // A seat with no Character: told why before anything is sent.
  meChar = null;
  await patchApp(page, { characterId: null }, {});
  await page.goto(`${BASE}/?player2#/w/${WID}/notes`);
  await page.waitForSelector('[data-screen=notes]');
  await page.locator('textarea[aria-label="A note"]').fill('A fourth thought.');
  await page.getByRole('button', { name: 'Save the note' }).tap();
  await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 4);
  await page.locator('.note-card').first().locator('[data-action=share-note]').tap();
  await page.waitForSelector('text=you have none in this world yet');
  check(tag, notes.length === 3, 'no Character: said, and nothing sent');
  await page.screenshot({ path: `${OUT}/sharenote-${tag}-04-nocharacter.png` });

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'Pixel 7', 'chromium');
if (only !== 'chromium') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
