// A world's reading aids (src/aids.ts, the charter profile): a world file holding a marked Charter, an older
// one, a Guide and two Domains, beside a kingdom's charter with no mark (lore), opens on this phone with the
// Charter, the Guide and the Domains first on its home, in that order, and out of the tiles, a type's list and
// search. The switch beside the counts says what it holds; one tap brings them into every view, a reload keeps
// the choice, a second tap takes them out. A Domain's page says what it is and is linked from the Guide; the
// Guide's picker offers the Domains the lists hide. A world holding only its Charter is not "empty".
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/aids.mjs [webkit|chromium]
import './guard.mjs';
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const wid = '0f0f0f0f-0000-4000-8000-0000000d0001';
const lone = '0f0f0f0f-0000-4000-8000-0000000d0002';
const id = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const file = (type, o) => ({ path: `elements/${type}/${o.name.toLowerCase().replace(/[^a-z]+/g, '-')}--${o.id.slice(-8)}.json`, data: enc({ ...o, type }) });
const zip = (name, w, files) => Buffer.from(writeWorldFile([{ path: 'world.json', data: enc({ id: w, name }) }, ...files], name.toLowerCase().replace(/ /g, '-')));

const aidsWorld = zip('Aids walk', wid, [
  file('law', { id: id(1), name: 'House rules', supertype: 'Charter', x_charter_of: wid, description: 'Be kind at the table.', created_at: '2026-10-01T00:00:00Z' }),
  file('law', { id: id(2), name: 'Old rules', supertype: 'Charter', x_charter_of: wid, created_at: '2026-09-01T00:00:00Z' }),
  file('construct', { id: id(3), name: 'Start with the Heir', supertype: 'Guide', x_charter_of: wid, description: 'Read the court first.', constructs: [id(5)] }),
  file('construct', { id: id(4), name: 'The coast', supertype: 'Domain', x_charter_of: wid, description: 'Where the ferries run.', locations: [id(8)] }),
  file('construct', { id: id(5), name: 'The court', supertype: 'Domain', x_charter_of: wid, description: 'Who rules.', hidden: true }),
  // Lore: a kingdom's charter with no mark, a person, a place.
  file('law', { id: id(6), name: "The kingdom's charter", supertype: 'Charter', description: 'Signed at the ford.' }),
  file('character', { id: id(7), name: 'Ada', description: 'A ferrywoman who keeps the house rules.' }),
  file('location', { id: id(8), name: 'The harbour' }),
]);
const loneWorld = zip('Lone charter', lone, [file('law', { id: id(11), name: 'Our rules', supertype: 'Charter', x_charter_of: lone, description: 'Ask first.' })]);
// A world file can carry any value as a name: a marked Guide named 42 must not stop the home.
const odd = '0f0f0f0f-0000-4000-8000-0000000d0003';
const oddWorld = zip('Odd names', odd, [
  { path: `elements/construct/odd--${id(21).slice(-8)}.json`, data: enc({ id: id(21), type: 'construct', name: 42, supertype: 'Guide', x_charter_of: odd }) },
  file('character', { id: id(22), name: 'Bo' }),
]);

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && errors.push('console: ' + m.text()));

  const open = async (buffer) => {
    await page.goto(`${BASE}/#/worlds`);
    await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
    await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'w.zip', mimeType: 'application/zip', buffer });
    await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  };
  const home = async () => {
    await page.goto(`${BASE}/#/w/${wid}`);
    await page.waitForSelector('[data-screen="home"]');
    await page.waitForTimeout(300);
  };
  const tiles = () =>
    page.$$eval('.type-tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('b')?.textContent, t.querySelector('.tile-count')?.textContent?.trim()])));
  const card = page.locator('[data-action="aids-shown"]');
  const search = async (q) => {
    await page.locator('input[aria-label="Search the world"]').fill(q);
    await page.waitForTimeout(300);
    const names = await page.$$eval('.results a, .results .row', (rs) => rs.map((r) => r.textContent));
    await page.locator('input[aria-label="Search the world"]').fill('');
    await page.waitForTimeout(200);
    return names;
  };
  const listOf = async (type) => {
    await page.goto(`${BASE}/#/w/${wid}/t/${type}`);
    await page.waitForTimeout(400);
    const names = await page.$$eval('.results .el-row b', (bs) => bs.map((b) => b.textContent));
    await home();
    return names;
  };

  await open(aidsWorld);

  // The door: the Charter, the Guide, the Domains, first on the home, in that order.
  const door = page.locator('[data-part="reading-aids"]');
  check(tag, (await door.count()) === 1, 'the home has the reading aids block');
  const first = await page.$eval('[data-screen="home"] .stack > *:first-child', (n) => n.getAttribute('data-part')).catch(() => null);
  check(tag, first === 'reading-aids', `the block is the first thing on the home (${first})`);
  const doorText = (await door.count()) ? await door.innerText() : '';
  const at = (s) => doorText.indexOf(s);
  check(tag, at('House rules') >= 0 && at('House rules') < at('Start with the Heir') && at('Start with the Heir') < at('The court') && at('The court') < at('The coast'),
    `Charter, Guide, then the Domains in the Guide's order (${JSON.stringify(doorText)})`);
  check(tag, doorText.includes("This world's charter · Be kind at the table.") && doorText.includes('Where the ferries run.'), 'each says its opening or its sentence');
  check(tag, doorText.includes('The court · hidden · Who rules.'), 'a hidden Domain says so at the door');
  check(tag, !doorText.includes('Old rules') && !doorText.includes("kingdom"), 'the older Charter and the unmarked one are not at the door');

  // Out of every lore view by default.
  let t = await tiles();
  check(tag, t.Laws === '1' && !t.Constructs && t.Characters === '1', `the tiles count the lore alone: ${JSON.stringify(t)}`);
  check(tag, (await card.count()) === 1 && (await card.innerText()).includes('The reading aids · 5') && (await card.innerText()).includes('2 charters, the guide and 2 domains stay out of'),
    `the switch says what it holds (${(await card.count()) ? await card.innerText() : 'no card'})`);
  let hits = await search('rules');
  check(tag, hits.some((x) => x.includes('Ada')) && !hits.some((x) => x.includes('House rules')) && !hits.some((x) => x.includes('Old rules')), `search leaves the aids out (${JSON.stringify(hits)})`);
  hits = await search('ford');
  check(tag, hits.some((x) => x.includes("The kingdom's charter")), `the kingdom's charter (no mark) is lore and found (${JSON.stringify(hits)})`);
  let laws = await listOf('law');
  check(tag, JSON.stringify(laws) === JSON.stringify(["The kingdom's charter"]), `the Laws list holds the lore alone (${JSON.stringify(laws)})`);
  await page.screenshot({ path: `${OUT}/aids-home-${tag}.png`, fullPage: true });

  // A Domain's page: what it is, linked from the Guide (an aid's page reads the whole world).
  await page.locator('[data-part="reading-aids"] a', { hasText: 'The coast' }).first().tap();
  await page.waitForTimeout(500);
  const coast = await page.locator('main, body').first().innerText();
  check(tag, coast.includes("One of this world's domains, on its home. It stays out of the lists and search."), 'the Domain says what it is');
  await page.goto(`${BASE}/#/w/${wid}/e/${id(5)}`);
  await page.waitForTimeout(500);
  check(tag, (await page.locator('main, body').first().innerText()).includes('Start with the Heir'), 'the court, in the Guide, is linked from it');
  // The harbour's page, a lore view, does not list the Domain that gathers it.
  await page.goto(`${BASE}/#/w/${wid}/e/${id(8)}`);
  await page.waitForTimeout(500);
  const harbour = await page.locator('main, body').first().innerText();
  check(tag, harbour.includes('The harbour') && !harbour.includes('The coast'), "the harbour's page leaves the Domain out of its links");
  // The Guide's picker offers the Domains the lists hide.
  await page.goto(`${BASE}/#/w/${wid}/e/${id(3)}`);
  await page.waitForTimeout(500);
  const guideText = await page.locator('main, body').first().innerText();
  check(tag, guideText.includes("This world's guide, first on its home."), 'the Guide says it leads');
  await page.locator('button[aria-label="Change constructs"]').tap();
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(300);
  await page.locator('.sheet input').first().fill('the');
  await page.waitForTimeout(300);
  const picks = await page.$$eval('.sheet .el-row b', (bs) => bs.map((b) => b.textContent));
  check(tag, picks.includes('The coast'), `the Guide's picker offers the Domain the lists hide (${JSON.stringify(picks)})`);
  await page.keyboard.press('Escape').catch(() => {});
  // The older Charter's page says which one leads.
  await page.goto(`${BASE}/#/w/${wid}/e/${id(2)}`);
  await page.waitForTimeout(500);
  check(tag, (await page.locator('main, body').first().innerText()).includes('Also marked as a charter: House rules is the one that leads.'), 'the older Charter says which one leads');

  // Shown, by one tap; kept across a reload; hidden again by a second.
  await home();
  const recentRows = await page.$$eval('[data-part="recent"] .el-row b', (bs) => bs.map((b) => b.textContent));
  check(tag, recentRows.includes('The harbour') && !recentRows.some((n) => /rules|Heir|court|coast/.test(n ?? '')), `Recent keeps the pages opened, the aids left out (${JSON.stringify(recentRows)})`);
  await card.tap();
  await page.waitForTimeout(400);
  t = await tiles();
  check(tag, t.Laws === '3' && t.Constructs === '3', `shown, the tiles count them: ${JSON.stringify(t)}`);
  check(tag, (await card.getAttribute('aria-pressed')) === 'true' && (await card.innerText()).includes('Tap to keep them out'), 'the switch says they are shown');
  hits = await search('rules');
  check(tag, hits.some((x) => x.includes('House rules')), `search finds them (${JSON.stringify(hits)})`);
  check(tag, (await door.count()) === 1, 'the door stays');
  await page.reload();
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await page.waitForTimeout(300);
  check(tag, (await tiles()).Laws === '3', 'a reload keeps them shown');
  await card.tap();
  await page.waitForTimeout(400);
  t = await tiles();
  check(tag, t.Laws === '1' && !t.Constructs, `a second tap takes them out again: ${JSON.stringify(t)}`);

  // A world holding only its Charter is not empty.
  await open(loneWorld);
  const lonely = await page.locator('[data-screen="home"]').innerText();
  check(tag, lonely.includes('Our rules') && lonely.includes("This world's charter · Ask first.") && !lonely.includes('Nothing here yet') && lonely.includes('Nothing in the lists yet'),
    `a lone Charter's world shows its door, not "Nothing here yet" (${JSON.stringify(lonely.slice(0, 300))})`);
  check(tag, (await page.locator('[data-action="aids-shown"]').count()) === 1, 'and offers the switch');

  // A Guide named 42: the home still draws, the door says Unnamed.
  await open(oddWorld);
  const oddHome = await page.locator('[data-screen="home"]').innerText();
  check(tag, oddHome.includes('Unnamed') && oddHome.includes('Start here') && oddHome.includes('Characters'), `a Guide whose name is a number reads as Unnamed (${JSON.stringify(oddHome.slice(0, 200))})`);
  await page.screenshot({ path: `${OUT}/aids-lone-${tag}.png`, fullPage: true });

  check(tag, errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await browser.close();
}

for (const [engine, tag] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  if (!only || only === tag) await walk(engine, tag);
}
console.log(failures ? `aids: ${failures} FAIL` : 'aids: all ok');
process.exit(failures ? 1 : 0);
