// A name says proposed or hidden wherever it shows without its row (the S462 gate's F3), both engines.
// The demo world on this phone: the element a MoppetopiaMap pin places marked hidden, an element that
// links to it marked proposed, a Collective marked hidden, as keel serves the marks to a keeper.
// 1. The linking element's page: the link chip to the hidden one says "· hidden".
// 2. The hidden one's page: Linked from's chip for the proposed one says "· proposed".
// 3. Show on map: the pin's card says hidden.
// 4. Give it to the party (an owner's world, keel unreachable): the hidden Collective's choice says hidden.
// Then a world file made to look like an account world (keel cut off), S478:
// 5. The edit picker on a link field: the chosen chip says "· hidden"; the rows offered say hidden
//    or known of (a stub keel served a player, carried in a file).
// 6. Waiting to send: an edit to the hidden one waits with its word, an edit to an unmarked one without.
// 7. A player's Share with the party, in two groups: the hidden group's choice says hidden.
// Each check has a twin that an unmarked name carries no word. Nothing is written.
// Run: npm run build && (npx vite preview &) && node walk/marknames.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile } from '@onlyworlds/sdk';

const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const API = 'https://www.onlyworlds.com/api/v2';
const KEY = '0000000001';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

async function list(type) {
  const r = await fetch(`${API}/${type}/?limit=500`, { headers: { 'API-Key': KEY } });
  return (await r.json()).data;
}

// What the walk expects, read from keel itself (as walk/map.mjs does).
const [maps, pins] = await Promise.all([list('map'), list('pin')]);
const overview = maps.find((m) => m.name === 'MoppetopiaMap');
const placed = pins.find((p) => p.map === overview.id && p.element_id);
const placedId = placed.element_id;

/** Change elements in the world's own db: patches by id. */
const patchElements = (page, worldId, patches) =>
  page.evaluate(
    ([worldId, patches]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(`lantern-world-${worldId}`);
        r.onsuccess = () => {
          const t = r.result.transaction('elements', 'readwrite');
          const es = t.objectStore('elements');
          for (const [id, patch] of Object.entries(patches)) {
            const g = es.get(id);
            g.onsuccess = () => g.result && es.put({ ...g.result, ...patch });
          }
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    [worldId, patches],
  );

const readElements = (page, worldId) =>
  page.evaluate(
    (worldId) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(`lantern-world-${worldId}`);
        r.onsuccess = () => {
          const g = r.result.transaction('elements').objectStore('elements').getAll();
          g.onsuccess = () => res(g.result);
          g.onerror = () => rej(g.error);
        };
      }),
    worldId,
  );

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

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

  await page.goto(BASE);
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  const worldId = await page.evaluate(() => location.hash.split('/')[2]);

  const els = await readElements(page, worldId);
  const byId = new Map(els.map((e) => [e.id, e]));
  const target = byId.get(placedId);
  const holds = (v) => v === placedId || (Array.isArray(v) && v.includes(placedId));
  const linker = els.find((e) => e.id !== placedId && !['pin', 'marker'].includes(e.type) && Object.entries(e).some(([k, v]) => k !== 'id' && k !== 'element_id' && holds(v)));
  const collectives = els.filter((e) => e.type === 'collective').sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const thing = els.find((e) => e.type === 'object');
  check(tag, !!target && !!linker && collectives.length > 1 && !!thing, `the demo has ${target?.name} on the map, ${linker?.name} linking to it, ${collectives.length} Collectives and an Object`);
  const hiddenCollective = collectives[0];
  await patchElements(page, worldId, {
    [placedId]: { hidden: true },
    [linker.id]: { x_review_proposed: { by: 'walk', expires: '2099-01-01' } },
    [hiddenCollective.id]: { hidden: true },
  });

  // 1. The linking element's page: its chip to the hidden one says so.
  await page.goto(`${BASE}/?marks#/w/${worldId}/e/${linker.id}`);
  await page.waitForSelector('[data-screen="element"] .el-head');
  const chip = await page.locator('.link-chip:not(.plain)', { hasText: target.name }).first().innerText({ timeout: 8000 }).catch(() => null);
  check(tag, /· hidden/.test(chip ?? ''), `a link chip to the hidden one: ${JSON.stringify(chip)}`);
  const plainChips = await page.locator('.link-chip:not(.plain):not(.missing)').allInnerTexts();
  const unmarked = plainChips.filter((t) => !t.includes(target.name));
  check(tag, unmarked.every((t) => !/· (hidden|proposed)/.test(t)), `the other chips carry no word (${unmarked.length}: ${JSON.stringify(unmarked.slice(0, 3))})`);
  const chipEl = page.locator('.link-chip:not(.plain)', { hasText: target.name }).first();
  await chipEl.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await chipEl.locator('xpath=../..').screenshot({ path: `${OUT}/marknames-${tag}-1-chip.png` }).catch(() => {});

  // 2. The hidden one's page: Linked from names the proposed one with its word.
  await page.goto(`${BASE}/?marks#/w/${worldId}/e/${placedId}`);
  await page.waitForSelector('[data-screen="element"] .el-head');
  const back = await page.locator('.link-chip.plain', { hasText: linker.name }).first().innerText({ timeout: 8000 }).catch(() => null);
  check(tag, /· proposed/.test(back ?? ''), `Linked from's chip for the proposed one: ${JSON.stringify(back)}`);
  const otherBack = (await page.locator('.link-chip.plain').allInnerTexts()).filter((t) => !t.includes(linker.name));
  check(tag, otherBack.every((t) => !/· (hidden|proposed)/.test(t)), `the other Linked from chips carry no word (${otherBack.length})`);
  await page.locator('.link-chip.plain', { hasText: linker.name }).first().locator('xpath=..').screenshot({ path: `${OUT}/marknames-${tag}-2-linkedfrom.png` }).catch(() => {});
  await page.evaluate(() => scrollTo(0, 0));

  // 3. Show on map: the pin's card.
  const mapLink = page.locator('.map-links a').first();
  await mapLink.tap();
  await page.waitForSelector('[data-screen="map"] .leaflet-image-layer', { timeout: 20000 });
  await page.waitForTimeout(600);
  const card = await page.evaluate(() => document.querySelector('.map-card:not([hidden])')?.textContent ?? '');
  check(tag, card.includes(target.name) && /· [^·]+· hidden/.test(card), `the pin's card: ${JSON.stringify(card)}`);
  // Seen, not only present: the label shows all of its text (S477's first frame cut it to "· location ·…").
  const fit = await page.evaluate(() => {
    const l = document.querySelector('.map-card:not([hidden]) .label');
    const c = l?.closest('.map-card')?.getBoundingClientRect();
    return l && c ? { over: l.scrollWidth - l.clientWidth, top: Math.round(c.top), bottom: Math.round(c.bottom), h: innerHeight } : null;
  });
  check(tag, !!fit && fit.over <= 1 && fit.top >= 0 && fit.bottom <= fit.h, `the card's label shows whole, on screen: ${JSON.stringify(fit)}`);
  await page.screenshot({ path: `${OUT}/marknames-${tag}-3-map.png` });

  // 4. An owner's world, keel unreachable: the party picker.
  await page.route('**/api/v2/**', (r) => r.abort());
  await patchRecord(page, worldId, { kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'x'.repeat(40), keyKind: 'write' });
  await page.goto(`${BASE}/?owner#/w/${worldId}/e/${thing.id}`);
  const give = page.getByRole('button', { name: 'Give it to the party' });
  await give.waitFor({ timeout: 10000 });
  await give.tap();
  await page.getByRole('dialog', { name: 'Which Collective is the party?' }).waitFor();
  const choices = await page.locator('.sheet .choice').allInnerTexts();
  const hc = choices.find((t) => t.startsWith(hiddenCollective.name));
  check(tag, /hidden/.test(hc ?? ''), `the hidden Collective's choice: ${JSON.stringify(hc)}`);
  const rest = choices.filter((t) => t !== hc && !/A new one/.test(t));
  check(tag, rest.length > 0 && rest.every((t) => !/hidden|proposed/.test(t)), `the other choices carry no word (${rest.length})`);
  await page.screenshot({ path: `${OUT}/marknames-${tag}-4-party.png` });

  check(tag, errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);
  await browser.close();
}

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const WID = '0f0f0f0f-0000-4000-8000-0000000004a7';
const id = (n) => `4a780000-0000-4000-8000-00000000000${n}`;
const [MIRA, WREN, HALE, BRAM, TOM, PARTY, WATCH] = [1, 2, 3, 4, 5, 6, 7].map(id);
const reach = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: WID, name: 'The Reach' }) },
      { path: 'elements/character/mira.json', data: enc({ id: MIRA, name: 'Mira', friends: [WREN] }) },
      { path: 'elements/character/wren.json', data: enc({ id: WREN, name: 'Wren', description: 'A runner.', hidden: true }) },
      { path: 'elements/character/hale.json', data: enc({ id: HALE, name: 'Hale', hidden: true }) },
      { path: 'elements/character/bram.json', data: enc({ id: BRAM, name: 'Bram', known_of: true }) },
      { path: 'elements/character/tom.json', data: enc({ id: TOM, name: 'Tom', description: 'A miller.' }) },
      { path: 'elements/collective/party.json', data: enc({ id: PARTY, name: 'The Party', supertype: 'Party', characters: [MIRA] }) },
      { path: 'elements/collective/watch.json', data: enc({ id: WATCH, name: 'The Watch', characters: [MIRA], hidden: true }) },
    ],
    'reach',
  ),
);

/** Patch the app db: the world's record, and kv values. */
const patchApp = (page, patch, kv = {}) =>
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

async function walkFile(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], viewport: { width: 360, height: 780 }, serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled/i.test(m.text()) && errors.push(m.text()));
  await page.route(/^https:\/\/(?!lantern\.)[^/]*onlyworlds\.com\//, (r) => r.abort());

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'reach.zip', mimeType: 'application/zip', buffer: reach });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await patchApp(page, { kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'x'.repeat(40), keyKind: 'write' });

  // 5. The edit picker on Mira's friends.
  await page.goto(`${BASE}/?owner#/w/${WID}/e/${MIRA}`);
  await page.waitForSelector('[data-screen="element"] .el-head');
  await page.locator('.frow[data-field=friends] .edit-btn').tap();
  await page.waitForSelector('.sheet .picker-results');
  const chosen = await page.locator('.sheet .chips .link-chip').allInnerTexts();
  check(tag, chosen.length === 1 && /Wren/.test(chosen[0]) && /· hidden/.test(chosen[0]), `the chosen chip: ${JSON.stringify(chosen)}`);
  const rowTexts = (await page.locator('.sheet .picker-results .el-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const offered = Object.fromEntries(['Hale', 'Bram', 'Tom'].map((n) => [n, rowTexts.find((t) => t.includes(n))]));
  check(tag, /· hidden/.test(offered.Hale ?? ''), `the hidden one offered: ${JSON.stringify(offered.Hale)}`);
  check(tag, /· known of/.test(offered.Bram ?? ''), `the known of one offered: ${JSON.stringify(offered.Bram)}`);
  check(tag, !!offered.Tom && !/·/.test(offered.Tom), `an unmarked one offered with no word: ${JSON.stringify(offered.Tom)}`);
  await page.locator('.sheet').screenshot({ path: `${OUT}/marknames-${tag}-5-picker.png` });
  await page.locator('.sheet').getByRole('button', { name: 'Cancel' }).tap();
  await page.waitForFunction(() => !document.querySelector('.sheet'));

  // 6. Waiting to send: an edit to Wren and one to Tom.
  for (const who of [WREN, TOM]) {
    await page.goto(`${BASE}/?edit${who.slice(-1)}#/w/${WID}/e/${who}`);
    await page.waitForSelector('[data-screen="element"] .el-head');
    await page.locator('main .prose').first().tap();
    await page.waitForSelector('.sheet textarea');
    await page.locator('.sheet textarea').fill('Seen by the mill at dusk.');
    await page.locator('.sheet button[type=submit]').tap();
    await page.waitForFunction(() => !document.querySelector('.sheet'));
  }
  await page.goto(`${BASE}/?out#/w/${WID}/outbox`);
  await page.waitForSelector('[data-screen="outbox"]');
  const rows = (await page.locator('[data-screen="outbox"] .el-row, [data-screen="outbox"] li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const wrenRow = rows.find((t) => t.includes('Wren'));
  const tomRow = rows.find((t) => t.includes('Tom'));
  check(tag, /· hidden/.test(wrenRow ?? ''), `Wren's waiting change: ${JSON.stringify(wrenRow)}`);
  check(tag, !!tomRow && !/hidden|proposed/.test(tomRow), `Tom's waiting change, no word: ${JSON.stringify(tomRow)}`);
  await page.screenshot({ path: `${OUT}/marknames-${tag}-6-outbox.png` });

  // 7. The player's phone: two groups, one hidden.
  await patchApp(page, { kind: 'online', apiKey: 'ow_r_' + 'p'.repeat(30), keyKind: 'read', role: 'collaborator', memberRole: 'guest', characterId: MIRA }, { accountToken: 'ow_a_' + 'z'.repeat(30) });
  await page.goto(`${BASE}/?player#/w/${WID}/notes`);
  await page.waitForSelector('[data-screen=notes]');
  await page.locator('textarea[aria-label="A note"]').fill('The innkeeper lied');
  await page.getByRole('button', { name: 'Save the note' }).tap();
  await page.waitForSelector('[data-action=share-note]');
  await page.locator('[data-action=share-note]').first().tap();
  await page.getByRole('dialog', { name: 'Share with which group?' }).waitFor({ timeout: 8000 });
  const groups = (await page.locator('.sheet .choice').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const watch = groups.find((t) => t.startsWith('The Watch'));
  const party = groups.find((t) => t.startsWith('The Party'));
  check(tag, /hidden/.test(watch ?? ''), `the hidden group's choice: ${JSON.stringify(watch)}`);
  check(tag, !!party && !/hidden|proposed/.test(party), `the other group, no word: ${JSON.stringify(party)}`);
  await page.locator('.sheet').screenshot({ path: `${OUT}/marknames-${tag}-7-groups.png` });

  check(tag, errors.length === 0, `no page errors on the world file (${errors.join(' | ').slice(0, 200)})`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'Pixel 7', 'chromium');
if (only !== 'chromium') await walk(webkit, 'iPhone 13', 'webkit');
if (only !== 'webkit') await walkFile(chromium, 'Pixel 7', 'chromium');
if (only !== 'chromium') await walkFile(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
