// The morning after, as a phone taps it, both engines. The demo world, made to look like an
// owner's account world with a write key and a sign-in; two notes planted in Unsorted; keel cut off
// (every API call aborted, no PIN), and Skeld's sorting route (h37 #3591) answered by a fake in
// Simmer's row shape, so nothing reaches the wire and no answer is spent. Checks: the slice holds
// what the notes name and never the notes; a refusal is said; nothing is ticked at first; a reload
// keeps the spent sort; the ticked rows land in the outbox (a make with its edited name, an
// addition, an ask's pick) and the notes are filed as Sorted; an unticked row writes nothing.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/sort.mjs [webkit|chromium]
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
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Put elements into the world's own db (as a sync would have). */
const putElements = (page, id, list) =>
  page.evaluate(
    ([id, list]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(`lantern-world-${id}`);
        r.onsuccess = () => {
          const t = r.result.transaction('elements', 'readwrite');
          for (const e of list) t.objectStore('elements').put(e);
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    [id, list],
  );

/** The world's record made an owner's account world with a write key, and this phone signed in. */
const makeOwner = (page, id) =>
  page.evaluate(
    (id) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction(['worlds', 'kv'], 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'x'.repeat(40), keyKind: 'write' });
          t.objectStore('kv').put('ow_a_' + 'w'.repeat(40), 'accountToken');
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    id,
  );

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
  const page = await (await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/sort-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });

  await page.goto(BASE);
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  const worldId = await page.evaluate(() => location.hash.split('/')[2]);
  const els = await readStore(page, worldId, 'elements');
  const [a, b] = els.filter((e) => e.type === 'character' && e.name);
  const place = els.find((e) => e.type === 'location' && e.name);
  check(tag, !!a && !!b && !!place, `the demo has two Characters (${a?.name}, ${b?.name}) and a Location (${place?.name})`);

  // Two notes caught last night, planted in Unsorted.
  const notes = [
    { id: '0199aaaa-0000-7000-8000-000000000001', type: 'narrative', name: `${a.name} at the fire`, supertype: 'Unsorted', description: `${a.name} at the fire\nA stranger called Ember tends it`, image_url: `https://media.onlyworlds.com/w/${worldId}/fire-page.webp`, created_at: '2026-10-12T01:00:00Z' },
    { id: '0199aaaa-0000-7000-8000-000000000002', type: 'narrative', name: `Someone went to ${place.name}`, supertype: 'Unsorted', description: `Someone went to ${place.name}`, created_at: '2026-10-12T01:05:00Z' },
  ];
  await putElements(page, worldId, notes);

  // From here keel is unreachable, but for the fake sorting route.
  const sent = [];
  let answer = json(429, { error: { code: 'quota_exceeded', message: 'quota_exceeded', type: 'rate_limit_error' } });
  await page.route('**/api/v2/**', (r) => r.abort());
  await page.route('**/api/v2/account/sort', (r) => {
    sent.push(JSON.parse(r.request().postData()));
    return r.fulfill(answer);
  });

  // 1. A read-only world: no Sort.
  await page.goto(`${BASE}/?planted#/w/${worldId}/t/narrative?unsorted`);
  await page.waitForSelector('[data-screen="type"] .el-row');
  check(tag, (await page.locator('[data-action=sort]').count()) === 0, 'a read-only world: no Sort on Unsorted');

  // 2. An owner's account world, signed in.
  await makeOwner(page, worldId);
  await page.goto(`${BASE}/?owner#/w/${worldId}/t/narrative?unsorted`);
  await page.locator('[data-action=sort]').tap();
  await page.waitForSelector('[data-screen="sort"] .note-pick');
  const picked = await page.locator('.note-pick[aria-checked=true]').count();
  check(tag, picked === 2, `both notes chosen at first (${picked})`);
  const sortBtn = page.locator('[data-action=sort]');
  await page.waitForFunction(() => !document.querySelector('[data-action=sort]')?.disabled, null, { timeout: 10000 });
  check(tag, (await sortBtn.innerText()) === 'Sort 2 notes', `the button says what it sorts (${JSON.stringify(await sortBtn.innerText())})`);
  await shot('choose');

  // 3. The day's answers used up: said, and the notes wait.
  await sortBtn.tap();
  await page.waitForSelector('[data-screen="sort"] .error');
  check(tag, /used up/.test(await page.locator('.error').innerText()), `a refusal is said: ${JSON.stringify(await page.locator('.error').innerText())}`);

  // 4. What is sent: the notes' words, and a slice of what they name, never the notes.
  const ask = { id: a.id, type: 'character', name: a.name, anchor: 'by the fire' };
  const other = { id: b.id, type: 'character', name: b.name };
  answer = json(200, {
    rows: [
      { kind: 'make', source_line: 'A stranger called Ember tends it', proposal: { type: 'Character', name: 'Ember', description: 'Tends the fire.' } },
      { kind: 'add_to', source_line: `${a.name} at the fire`, target: ask, field: 'description', op: 'append', value: 'Was at the fire.' },
      { kind: 'link', source_line: `Someone went to ${place.name}`, target: other, field: 'location', value_id: place.id, value_name: place.name },
      { kind: 'ask', source_line: `Someone went to ${place.name}`, question: 'Who went there?', candidates: [ask, other], then: { kind: 'add_to', field: 'description', op: 'append', value: `Went to ${place.name}.` } },
    ],
    not_proposed: [{ source_line: 'the wind came up', reason: 'nothing particular to this world' }],
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 2100, output_tokens: 380 },
    remaining: 48,
  });
  await sortBtn.tap();
  await page.waitForSelector('.sort-card', { timeout: 15000 });
  const body = sent.at(-1);
  const sliceIds = body.slice.map((x) => x.id);
  const pictured = body.notes.filter((x) => typeof x !== 'string');
  check(
    tag,
    body.world_id === worldId && body.notes.length === 2 && pictured.length === 1 && /fire-page\.webp$/.test(pictured[0].image_url) && /Ember/.test(pictured[0].text),
    'the notes go as their words, the photographed one with its picture, to this world',
  );
  check(tag, sliceIds.includes(a.id) && sliceIds.includes(place.id), `the slice holds what the notes name (${body.slice.length} elements)`);
  check(tag, !sliceIds.some((id) => notes.some((n) => n.id === id)), 'and never the notes');
  check(tag, (await page.locator('.sort-card').count()) === 4, 'four cards');
  check(tag, (await page.locator('.sort-card.on').count()) === 0, 'nothing is ticked at first');
  check(tag, (await page.locator('[data-action=write]').innerText()) === 'File the notes as sorted', 'with nothing ticked, the button only files the notes');
  await shot('review');

  // 5. A reload keeps the spent sort.
  await page.reload();
  await page.waitForSelector('.sort-card', { timeout: 15000 });
  check(tag, (await page.locator('.sort-card').count()) === 4 && sent.length === 2, 'a reload keeps the sort, and asks nothing again');

  // 6. Tick: the make (renamed), the addition, the ask's pick; leave the link.
  // Neither: an empty card to make it new, right under the question, nothing filled in for the person.
  await page.locator('.sort-card[data-kind=ask] [data-neither]').tap();
  const kinds = await page.locator('.sort-card').evaluateAll((cs) => cs.map((c) => c.dataset.kind));
  const fresh = page.locator('.sort-card[data-kind=make]').nth(1);
  check(
    tag,
    JSON.stringify(kinds) === JSON.stringify(['make', 'add_to', 'link', 'ask', 'make']) && (await fresh.locator('input[aria-label="Name"]').inputValue()) === '' && !(await fresh.locator('select').inputValue()),
    `Neither opens an empty card under the question (${kinds.join(', ')})`,
  );
  const make = page.locator('.sort-card[data-kind=make]').first();
  await make.locator('input[aria-label="Name"]').fill('Ember of the Hearth');
  await make.locator('[data-tick]').tap();
  await page.locator('.sort-card[data-kind=add_to] [data-tick]').tap();
  await page.locator('.sort-card[data-kind=ask] .note-pick').nth(1).tap();
  const writeLabel = await page.locator('[data-action=write]').innerText();
  check(tag, writeLabel === 'Write 3', `three ticked (${JSON.stringify(writeLabel)})`);
  check(tag, (await make.locator('input[aria-label="Name"]').inputValue()) === 'Ember of the Hearth', 'a tick keeps the edited name');
  await shot('ticked');
  await page.locator('[data-action=write]').tap();
  await page.waitForSelector('[data-screen="type"]');
  const rows = await readStore(page, worldId, 'outbox');
  const created = rows.find((r) => r.op === 'create' && r.type === 'character');
  const onA = rows.find((r) => r.id === a.id);
  const onB = rows.find((r) => r.id === b.id);
  const filed = rows.filter((r) => notes.some((n) => n.id === r.id));
  check(tag, created?.values.name === 'Ember of the Hearth' && created?.values.description === 'Tends the fire.', 'the make is a new Character with its edited name');
  check(tag, typeof onA?.values.description === 'string' && onA.values.description.endsWith('Was at the fire.'), 'the addition is appended to its description');
  check(tag, typeof onB?.values.description === 'string' && onB.values.description.endsWith(`Went to ${place.name}.`) && !('location' in onB.values), "the ask's pick wrote its row; the unticked link wrote nothing");
  check(tag, filed.length === 2 && filed.every((r) => r.values.supertype === 'Sorted'), 'both notes are filed as Sorted');
  check(tag, (await page.locator('[data-screen="type"] .el-row').count()) === 0, 'Unsorted is empty');
  check(tag, (await page.evaluate((id) => localStorage.getItem(`lantern-sort-${id}`), worldId)) === null, 'the kept sort is let go once written');
  await shot('after');

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
