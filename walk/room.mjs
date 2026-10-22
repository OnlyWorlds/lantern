// The parlor's room (OW Parlor; src/room.ts): a lore world whose file also holds a parlor's room (a
// message, a work item about Ada, a vote, a sitting) opens on this phone reading as lore: the home's
// tiles, search, Ada's page and Before now leave the room out, and the home says how many it holds.
// One tap shows them everywhere, a reload keeps the choice, a second tap hides them again.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/room.mjs [webkit|chromium]
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

const wid = '0f0f0f0f-0000-4000-8000-0000000a0001';
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ada = id(1);
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const file = (type, o) => ({ path: `elements/${type}/${o.name.toLowerCase().replace(/[^a-z]+/g, '-')}--${o.id.slice(-8)}.json`, data: enc({ ...o, type }) });
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: wid, name: 'Room walk' }) },
      // The lore.
      file('character', { id: ada, name: 'Ada', description: 'A ferrywoman.' }),
      file('character', { id: id(2), name: 'Bo', description: 'Her bosun.' }),
      file('narrative', { id: id(3), name: 'The drowning', supertype: 'Story', characters: [ada] }),
      file('law', { id: id(4), name: 'House rules', supertype: 'Charter', description: 'Be kind in the room.' }),
      // A lore letter: a Message with no parlor's mark is the world's own and stays in view (dist.45).
      file('narrative', { id: id(9), name: 'A letter from Bo', supertype: 'Message', description: 'Written at sea.' }),
      // The parlor's room, inside the same world (the sheet §1), each with the parlor's mark.
      file('narrative', { id: id(5), name: 'Shall we rename Bo?', supertype: 'Message', x_room_of: wid }),
      file('relation', { id: id(6), name: "Fix Ada's age", supertype: 'Work item', characters: [ada], x_room_of: wid }),
      file('relation', { id: id(7), name: 'Vote of Bo', supertype: 'Vote', x_room_of: wid }),
      file('event', { id: id(8), name: 'Sitting one', supertype: 'Sitting', start_date: 5, x_room_of: wid }),
    ],
    'room-walk',
  ),
);

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && errors.push('console: ' + m.text()));

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'room-walk.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });

  const tiles = () =>
    page.$$eval('.type-tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('b')?.textContent, t.querySelector('.tile-count')?.textContent?.trim()])));
  const card = page.locator('[data-action="room-shown"]');
  const beforeNow = page.locator('[data-action="before-now"]');
  const search = async (q) => {
    await page.locator('input[aria-label="Search the world"]').fill(q);
    await page.waitForTimeout(300);
    const names = await page.$$eval('.results a, .results .row', (rs) => rs.map((r) => r.textContent));
    await page.locator('input[aria-label="Search the world"]').fill('');
    await page.waitForTimeout(200);
    return names;
  };
  const adaPage = async () => {
    await page.goto(`${BASE}/#/w/${wid}/e/${ada}`);
    await page.waitForTimeout(600);
    const text = await page.locator('main, body').first().innerText();
    await page.goto(`${BASE}/#/w/${wid}`);
    await page.waitForSelector('[data-screen="home"]');
    return text;
  };

  // Hidden, as it opens.
  let t = await tiles();
  check(tag, t.Characters === '2' && t.Narratives === '2' && t.Laws === '1' && !t.Relations && !t.Events, `the tiles read the lore: ${JSON.stringify(t)}`);
  check(tag, (await card.count()) === 1 && (await card.innerText()).includes("The parlor's room · 4"), `the home says the room holds 4 (${(await card.count()) ? await card.innerText() : 'no card'})`);
  check(tag, (await beforeNow.count()) === 0, 'Before now is not offered for the sitting alone');
  let hits = await search('rename');
  check(tag, hits.length === 0, `search leaves the message out (${JSON.stringify(hits)})`);
  hits = await search('letter');
  check(tag, hits.some((x) => x.includes('A letter from Bo')), `a lore letter (a Message with no mark) is found (${JSON.stringify(hits)})`);
  hits = await search('Ada');
  check(tag, hits.some((x) => x.includes('Ada')) && !hits.some((x) => x.includes('age')), `search for Ada finds her, not the work item (${JSON.stringify(hits)})`);
  check(tag, !(await adaPage()).includes("Fix Ada's age"), "Ada's page does not list the work item about her");
  await page.screenshot({ path: `${OUT}/room-hidden-${tag}.png`, fullPage: true });

  // Shown, by one tap.
  await card.tap();
  await page.waitForTimeout(400);
  t = await tiles();
  check(tag, t.Narratives === '3' && t.Relations === '2' && t.Events === '1', `shown, the tiles count the room: ${JSON.stringify(t)}`);
  check(tag, (await card.getAttribute('aria-pressed')) === 'true' && (await card.innerText()).includes('Tap to keep them out'), 'the card says the room is shown');
  check(tag, (await beforeNow.count()) === 1, 'Before now is offered for the sitting');
  hits = await search('rename');
  check(tag, hits.some((x) => x.includes('rename')), `search finds the message (${JSON.stringify(hits)})`);
  check(tag, (await adaPage()).includes("Fix Ada's age"), "Ada's page lists the work item about her");
  await page.screenshot({ path: `${OUT}/room-shown-${tag}.png`, fullPage: true });

  // The choice is kept by this phone across a reload; a second tap hides the room again.
  await page.reload();
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  check(tag, (await tiles()).Relations === '2', 'a reload keeps the room shown');
  await card.tap();
  await page.waitForTimeout(400);
  t = await tiles();
  check(tag, !t.Relations && t.Narratives === '2', `a second tap hides it again: ${JSON.stringify(t)}`);

  check(tag, errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await browser.close();
}

for (const [engine, tag] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  if (!only || only === tag) await walk(engine, tag);
}
console.log(failures ? `room: ${failures} FAIL` : 'room: all ok');
process.exit(failures ? 1 : 0);
