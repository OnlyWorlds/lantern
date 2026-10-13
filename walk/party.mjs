// Give it to the party, as a game master taps it at the table, both engines. The demo world,
// made to look like an owner's account world with a write key; keel is cut off (every API call
// aborted) and no PIN is given, so the reveal stays in the outbox and nothing reaches the wire.
// Checks: the button shows on a thing, never on a Collective or for a player; the first tap asks
// which Collective is the party and remembers it; the reveal carries its own name, line and
// picture, is told to the party and links the thing; Change keeps what was typed.
// Run: npm run build && (npx vite preview &) && node walk/party.mjs [webkit|chromium]
import './guard.mjs';
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

/** Patch the world's record in the app db. */
const patchRecord = (page, id, patch) =>
  page.evaluate(
    ([id, patch]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction('worlds', 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, ...patch });
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    [id, patch],
  );

/** Read a store of the world's own db. */
const readStore = (page, id, store) =>
  page.evaluate(
    ([id, store]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(`lantern-world-${id}`);
        r.onsuccess = () => {
          const g = r.result.transaction(store).objectStore(store).getAll();
          g.onsuccess = () => res(g.result);
          g.onerror = () => rej(g.error);
        };
      }),
    [id, store],
  );

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/party-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });

  await page.goto(BASE);
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  const worldId = await page.evaluate(() => location.hash.split('/')[2]);
  const els = await readStore(page, worldId, 'elements');
  const thing = els.find((e) => e.type === 'object');
  const collectives = els.filter((e) => e.type === 'collective');
  // The demo's Objects have no picture: this one borrows another element's, as a found sword would have.
  const pictured = els.find((e) => /^https:/.test(e.image_url ?? ''));
  if (pictured && !/^https:/.test(thing.image_url ?? '')) {
    thing.image_url = pictured.image_url;
    await page.evaluate(
      ([id, el]) =>
        new Promise((res) => {
          const r = indexedDB.open(`lantern-world-${id}`);
          r.onsuccess = () => {
            const t = r.result.transaction('elements', 'readwrite');
            t.objectStore('elements').put(el);
            t.oncomplete = () => res(true);
          };
        }),
      [worldId, thing],
    );
  }
  check(tag, !!thing && collectives.length > 0, `the demo has an Object (${thing?.name}, picture: ${!!thing?.image_url}) and ${collectives.length} Collectives`);

  // From here keel is unreachable: nothing this walk does can reach the wire.
  await page.route('**/api/v2/**', (r) => r.abort());

  // 1. The demo as it is (read only): no button
  await page.goto(`${BASE}/#/w/${worldId}/e/${thing.id}`);
  await page.waitForSelector('.el-head');
  const give = page.getByRole('button', { name: 'Give it to the party' });
  check(tag, (await give.count()) === 0, 'a read-only world: no button');

  // 2. An owner's account world with a write key
  await patchRecord(page, worldId, { kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'x'.repeat(40), keyKind: 'write' });
  await page.goto(`${BASE}/?owner#/w/${worldId}/e/${collectives[0].id}`);
  await page.waitForSelector('.el-head');
  check(tag, (await give.count()) === 0, 'never on a Collective');
  await page.goto(`${BASE}/?owner#/w/${worldId}/e/${thing.id}`);
  await give.waitFor({ timeout: 10000 });
  check(tag, true, `on ${thing.name}: the button`);
  await shot('thing');

  // 3. The first tap asks which Collective is the party
  await give.tap();
  await page.getByRole('dialog', { name: 'Which Collective is the party?' }).waitFor();
  const listed = await page.locator('.sheet .choice b').allInnerTexts();
  check(tag, listed.length === collectives.length + 1 && listed.at(-1) === 'A new one called The Party', `it lists the ${collectives.length} Collectives and a new one: ${JSON.stringify(listed)}`);
  await shot('which');
  await page.getByRole('button', { name: /A new one called The Party/ }).tap();

  // 4. The give sheet: the thing's name to start from, the party, and the empty-party warning
  const sheet = page.getByRole('dialog', { name: 'Give it to the party' });
  await sheet.waitFor();
  const nameBox = sheet.getByLabel('What the party sees');
  check(tag, (await nameBox.inputValue()) === thing.name, 'the name starts as the thing\'s own');
  check(tag, /To The Party · 0 Characters/.test(await sheet.innerText()), 'it says who it goes to');
  check(tag, /No Character is in The Party yet, so no player sees this/.test(await sheet.innerText()), 'an empty party is said, before the tap');
  check(tag, (await sheet.locator('img.give-thumb').getAttribute('src')) === thing.image_url, 'the picture the party sees is shown');
  await nameBox.fill('A rusted sword');
  await sheet.getByLabel('Your line').fill('It hums when you hold it.');
  await shot('give');

  // 5. Change keeps what was typed; choosing The Party again returns to the sheet
  await sheet.getByRole('button', { name: 'Change' }).tap();
  const which = page.getByRole('dialog', { name: 'Which Collective is the party?' });
  await which.waitFor();
  check(tag, /Change the party/.test(await which.innerText()), 'Change opens the choice');
  const marked = which.locator('.choice[aria-pressed="true"]');
  check(tag, (await marked.locator('b').innerText()) === 'The Party' && /The party now/.test(await marked.innerText()), 'the kept choice is marked, in words too');
  await which.locator('.choice', { hasText: 'The Party' }).first().tap();
  await sheet.waitFor();
  check(tag, (await sheet.getByLabel('What the party sees').inputValue()) === 'A rusted sword' && (await sheet.getByLabel('Your line').inputValue()) === 'It hums when you hold it.', 'what was typed survives Change');

  // 6. Give it: the reveal's own page
  await sheet.getByRole('button', { name: 'Give it' }).tap();
  // The thing's own page is on screen until the reveal's replaces it: wait for the change, not a selector.
  await page.waitForFunction(() => /^A rusted sword/.test(document.querySelector('[data-screen="element"] h1')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const h1 = await page.locator('[data-screen="element"] h1').innerText();
  check(tag, /^A rusted sword/.test(h1), `lands on the reveal: ${JSON.stringify(h1)}`);
  const said = await page.locator('.toast').innerText().catch(() => '');
  check(tag, said === 'Sending to The Party…', `the toast says it is on its way, not that it arrived: ${JSON.stringify(said)}`);
  await shot('reveal');

  // 7. What waits to send: the party first, then the reveal, with the values the convention asks for
  const rows = (await readStore(page, worldId, 'outbox')).sort((a, b) => a.seq - b.seq);
  const party = rows.find((r) => r.type === 'collective');
  const reveal = rows.find((r) => r.type === 'narrative');
  check(tag, party?.values.name === 'The Party' && party?.values.supertype === 'Party', 'a new Collective, The Party (supertype Party)');
  check(tag, party && reveal && party.seq < reveal.seq, 'the party is sent before the reveal that names it');
  const v = reveal?.values ?? {};
  check(tag, v.name === 'A rusted sword' && v.description === 'It hums when you hold it.', 'the reveal carries the game master\'s name and line');
  check(tag, JSON.stringify(v.collectives) === JSON.stringify([party?.id]), 'told to the party (its collectives)');
  check(tag, JSON.stringify(v.objects) === JSON.stringify([thing.id]), 'links the thing (keel strips it for players)');
  check(tag, !!thing.image_url && v.image_url === thing.image_url, 'carries the thing\'s picture');
  check(tag, !v.narrator && !v.characters && v.story === undefined, 'nothing else: no narrator, no one it is about, none of the thing\'s words');
  check(tag, rows.every((r) => r.state === 'waiting'), 'nothing sent: no PIN, keel cut off');

  // 8. The second tap goes straight to the sheet: the party is remembered. Two clicks in one
  // frame (a double tap landing before the sheet draws; dispatched, so a model of it) open one sheet.
  await page.goto(`${BASE}/?owner#/w/${worldId}/e/${thing.id}`);
  await give.waitFor();
  await give.evaluate((b) => {
    b.click();
    b.click();
  });
  await sheet.waitFor();
  check(tag, (await page.locator('.sheet').count()) === 1, 'a double tap opens one sheet');
  check(tag, (await page.getByRole('dialog', { name: 'Which Collective is the party?' }).count()) === 0, 'the second time, no question: the party is remembered');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);

  // 9. A player never sees the button
  await patchRecord(page, worldId, { role: 'collaborator', memberRole: 'guest' });
  await page.goto(`${BASE}/?guest#/w/${worldId}/e/${thing.id}`);
  await page.waitForSelector('.el-head');
  check(tag, (await give.count()) === 0, 'a player: no button');

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
