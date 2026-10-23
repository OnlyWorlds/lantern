// Lantern walked as a phone taps it: .tap() on device profiles, WebKit and Chromium, against the
// production build (vite preview on :5181, so the worker is real), airplane mode included.
// Run: npm run build && (npx vite preview &) && node walk/walk.mjs [webkit|chromium]
import './guard.mjs';
// WebKit logs the viewport's interactive-widget key (Android Chrome's keyboard rule, S404) as unknown: harmless.
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { readWorldFile, writeWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;

function check(tag, ok, what) {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[deviceName] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  let offline = false;
  let expect400 = false; // the deliberate wrong password
  page.on('console', (m) => {
    // Offline, a failed fetch is the expected answer, not an error.
    if (m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !((offline || expect400) && /Failed to load resource/.test(m.text()))) errors.push('console: ' + m.text());
  });
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${String(++n).padStart(2, '0')}-${name}.png` });
  const screen = () => page.evaluate(() => document.querySelector('main')?.dataset.screen ?? '?');

  // 1. First open
  await page.goto(BASE);
  await page.waitForSelector('[data-screen="welcome"]');
  await shot('welcome');
  const first = await page.locator('.choice').first().innerText();
  check(tag, /Sign in/.test(first), `Sign in is the first choice (${JSON.stringify(first.split('\n')[0])})`);

  // 1b. Sign in against live keel (Keel #211, through SDK 4.31) with a wrong password: said in Lantern's words
  await page.locator('a.choice.primary').tap();
  await page.waitForSelector('[data-screen="signin"]');
  // The token door stays shut until asked for (S397: a flex class once showed it open).
  check(tag, !(await page.locator('input[aria-label="Account token"]').isVisible()), 'the account token field waits behind "I have an account token"');
  await page.locator('input[aria-label="Email or username"]').fill('nobody-lantern-walk@example.com');
  await page.locator('input[aria-label="Password"]').fill('not-the-password-1');
  expect400 = true;
  await page.getByRole('button', { name: 'Sign in', exact: true }).tap();
  await page.waitForFunction(() => document.querySelector('.error')?.textContent, null, { timeout: 15000 });
  const signErr = await page.locator('.error').first().innerText();
  check(tag, /did not match an OnlyWorlds account/.test(signErr), `a wrong password is refused, in Lantern's words: ${JSON.stringify(signErr)}`);
  await shot('signin-wrong');
  expect400 = false;
  await page.goto(`${BASE}/#/welcome`);
  await page.waitForSelector('[data-screen="welcome"]');

  // 2. The demo
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  await shot('home');
  const tiles = await page.locator('.type-tile').count();
  check(tag, tiles > 0, `home shows ${tiles} type tiles`);
  check(tag, (await page.locator('.tabbar [data-tab=catch]').count()) === 0, 'a read-only demo has no capture button');
  const pill = await page.locator('.pill').first().innerText().catch(() => '');
  check(tag, /Read only/.test(pill), `the head says read only (${JSON.stringify(pill)})`);

  // 3. Find
  await page.locator('.search input').tap();
  await page.keyboard.type('flu', { delay: 40 });
  await page.waitForTimeout(300);
  const hits = await page.locator('.results .el-row').count();
  await shot('find');
  check(tag, hits > 0, `"flu" finds ${hits}`);

  // 4. An element
  const firstHit = await page.locator('.results .el-row b').first().innerText();
  await page.locator('.results .el-row').first().tap();
  await page.waitForSelector('[data-screen="element"] h1');
  const h1 = await page.locator('[data-screen="element"] h1').innerText();
  check(tag, h1.startsWith(firstHit), `tapping "${firstHit}" opens it (${JSON.stringify(h1)})`);
  await shot('element');
  const chip = page.locator('.fields a.link-chip').first();
  if (await chip.count()) {
    const target = await chip.innerText();
    await chip.tap();
    await page.waitForFunction((t) => document.querySelector('[data-screen="element"] h1')?.textContent?.startsWith(t), target);
    check(tag, true, `a link chip opens "${target}"`);
    await shot('linked');
    await page.locator('[aria-label="Back"]').tap();
    await page.waitForFunction((t) => document.querySelector('[data-screen="element"] h1')?.textContent?.startsWith(t), firstHit);
    check(tag, true, 'Back returns to the first element');
  } else check(tag, true, '(no link chip on this element)');
  const emptyToggle = page.getByRole('button', { name: /empty fields/ });
  if (await emptyToggle.count()) {
    await emptyToggle.tap();
    await page.waitForTimeout(200);
    await shot('empty-fields');
  }

  // 4b. Ask, from the phone's own copy
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('[data-screen="worlds"]');
  await page.locator('.world-card').first().tap();
  await page.waitForSelector('.tabbar');
  await page.getByRole('link', { name: 'Ask' }).tap();
  await page.waitForSelector('[data-screen="ask"]');
  await page.locator('[data-screen="ask"] input').tap();
  await page.keyboard.type('who does Snoot quarrel with?', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const askHits = await page.locator('[data-screen="ask"] .el-row').count();
  const askFirst = await page.locator('[data-screen="ask"] .el-row b').first().innerText().catch(() => '');
  check(tag, askHits > 0, `Ask answers with ${askHits} sources, first "${askFirst}"`);
  await shot('ask');
  await page.locator('[data-screen="ask"] input').fill('zqxv wobblequark');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check(tag, (await page.locator('[data-answer="none"]').count()) === 1, 'a question the world cannot answer gets "Your world does not say."');
  await shot('ask-none');

  // 4c. A player's home: the demo marked as a guest's world (no guest key here; Keel #213's live walk is the first invite)
  const demoId = await page.evaluate(() => location.hash.split('/')[2]);
  // The guest's own Character, as keel's /me would name it (Skeld #3457): one the demo holds.
  const chars = (await (await fetch('https://www.onlyworlds.com/api/v2/character/?limit=200', { headers: { 'API-Key': '0000000001' } })).json()).data;
  const mine = chars.find((c) => c.name === 'Admiral Fluffington');
  await page.evaluate(
    ([id, characterId]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction('worlds', 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, memberRole: 'guest', characterId });
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    [demoId, mine.id],
  );
  // A full navigation (a new query string), so the app starts fresh and reads the record again.
  await page.goto(`${BASE}/?as=player#/w/${demoId}`);
  await page.waitForSelector('[data-screen="home"] .section-label');
  const labels = await page.locator('[data-screen="home"] .section-label').allInnerTexts();
  check(tag, labels[0] === 'NEWEST' || labels[0] === 'Newest', `a player's home leads with what is newest (${labels.join(', ')})`);
  check(tag, (await page.locator('.pill').innerText()) === 'Player', 'the head says Player');
  const intro = await page.locator('[data-screen="home"] p.dim').first().innerText();
  check(tag, intro === 'You play Admiral Fluffington. You see what Admiral Fluffington knows.', `the player's header names their Character: ${JSON.stringify(intro)}`);
  await shot('player-home');
  await page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction('worlds', 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, memberRole: undefined });
          t.oncomplete = () => res(true);
        };
      }),
    demoId,
  );
  await page.goto(`${BASE}/?as=owner#/`);

  // 5. A type's list
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('[data-screen="worlds"]');
  await shot('worlds');
  await page.locator('.world-card').first().tap();
  await page.waitForSelector('.type-tile');
  await page.locator('.type-tile').first().tap();
  await page.waitForSelector('[data-screen="type"] .el-row');
  const rows = await page.locator('[data-screen="type"] .el-row').count();
  check(tag, rows > 0, `a type's list shows ${rows} rows`);
  await shot('type-list');

  // 6. Airplane mode: the app opens from the worker, the world from the store
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 }).catch(() => {});
  const controlled = await page.evaluate(() => navigator.serviceWorker?.controller != null);
  check(tag, controlled, 'the worker controls the page');
  await ctx.setOffline(true);
  offline = true;
  // page.reload() errors in Playwright's WebKit under a worker while offline; a page-side reload is what a user does.
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('load');
  await page.waitForSelector('[data-screen="worlds"]', { timeout: 15000 }).catch(() => {});
  check(tag, (await screen()) === 'worlds', `offline reload opens Your worlds (screen=${await screen()})`);
  await page.locator('.world-card').first().tap();
  await page.waitForSelector('.type-tile', { timeout: 15000 }).catch(() => {});
  const offTiles = await page.locator('.type-tile').count();
  check(tag, offTiles === tiles, `offline, the world opens from the phone (${offTiles} tiles)`);
  await page.waitForTimeout(800);
  // Playwright's WebKit on Windows fails every subresource offline, worker or not (probed S395: a
  // precached font and script both "Load failed" with the worker in control and the cache holding
  // them), so a screenshot waits for fonts forever. The worker serving offline is Chromium's proof.
  if (engine === webkit) console.log(`[${tag}] (no offline screenshot: this WebKit cannot load anything offline)`);
  else await shot('offline-home');
  const banner = await page.locator('.banner').innerText().catch(() => '');
  check(tag, /No connection/.test(banner), `offline banner: ${JSON.stringify(banner)}`);
  await ctx.setOffline(false);
  offline = false;

  // 7. A world on this phone: catch, edit, all offline-capable
  // A new document (a query string): fonts that failed offline stay failed in the old one.
  await page.goto(`${BASE}/?online#/new`);
  await page.waitForSelector('[data-screen="new-world"]');
  await page.locator('input[aria-label="World name"]').tap();
  await page.keyboard.type('Bus stop ideas');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await shot('local-home');
  // An empty world's first Character (S397: a type with no tile had no "New" anywhere).
  await page.getByRole('button', { name: 'Or choose a type to start with' }).tap();
  const offered = await page.locator('.type-tile b').allInnerTexts();
  check(tag, offered.includes('Characters') && !offered.includes('Pins') && !offered.includes('Maps'), `an empty world offers ${offered.length} types, none of the map ones`);
  await page.locator('.type-tile', { hasText: 'Characters' }).tap();
  await page.getByRole('button', { name: 'New' }).tap();
  await page.locator('.sheet input[aria-label="Name"]').fill('Oskar');
  await page.getByRole('button', { name: 'Make it' }).tap();
  await page.waitForFunction(() => document.querySelector('[data-screen="element"] h1')?.textContent === 'Oskar');
  check(tag, /Character/.test(await page.locator('.el-head .muted').innerText()), 'the first Character is made from the type list');
  await page.goto(`${BASE}/?online2${(await page.evaluate(() => location.hash)).replace(/\/e\/.*$/, '')}`);
  await page.waitForSelector('[data-screen="home"] .type-tile');
  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  await page.locator('textarea').tap();
  await page.keyboard.type('The ferryman owes the bell-founder three years of crossings.\nHe pays in fish.');
  await shot('capture');
  await page.getByRole('button', { name: /Add to Unsorted/ }).tap();
  // A note stays on Catch now (S404); its page is one tap away.
  await page.locator('[data-action="open-kept"]').tap();
  await page.waitForSelector('[data-screen="element"] h1');
  const caught = await page.locator('[data-screen="element"] h1').innerText();
  const kind = await page.locator('.el-head .muted').innerText();
  check(tag, /ferryman/.test(caught) && /Unsorted note/.test(kind), `caught as ${JSON.stringify(caught)} (${kind})`);
  await shot('caught');
  await page.locator('.el-head h1').tap();
  await page.waitForSelector('.sheet input');
  await page.locator('.sheet input').fill('The ferryman\'s debt');
  await page.getByRole('button', { name: 'Save' }).tap();
  await page.waitForFunction(() => document.querySelector('[data-screen="element"] h1')?.textContent?.startsWith("The ferryman's debt"));
  check(tag, true, 'renaming through the sheet shows at once');
  // Back returns to Catch, where "Open it" came from (S404); the World tab goes home.
  await page.locator('[aria-label="Back"]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  await page.locator('.tabbar [data-tab=world]').tap();
  await page.waitForSelector('[data-screen="home"]');
  const unsorted = await page.locator('a.choice').first().innerText().catch(() => '');
  check(tag, /Unsorted · 1/.test(unsorted), `home shows ${JSON.stringify(unsorted.split('\n')[0])}`);
  await shot('local-home-after');

  // 7b. Save a copy, and open a world file (a real Atlas folder, zipped)
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('.local-group');
  await shot('worlds-local');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
    page.getByRole('button', { name: 'Save a copy' }).tap(),
  ]);
  if (download) {
    const saved = await download.path().then((p) => readWorldFile(new Uint8Array(readFileSync(p))));
    check(tag, saved.name === 'Bus stop ideas' && saved.files.length === 3, `Save a copy gives a world file (world, the note, Oskar) (${download.suggestedFilename()}, ${saved.files.length} files)`);
  } else check(tag, true, 'Save a copy went to the share sheet (no download to read)');
  const sample = `${homedir()}/Desktop/TESTOWFOLDER/onlyworlds-atlas/moppetopia-sample-55a9b4d5`;
  const filesOf = (d, rel = '') =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? filesOf(`${d}/${e.name}`, `${rel}${e.name}/`) : [{ path: `${rel}${e.name}`, data: new Uint8Array(readFileSync(`${d}/${e.name}`)) }],
    );
  const zip = Buffer.from(writeWorldFile(filesOf(sample), 'moppetopia-sample-55a9b4d5'));
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'moppetopia-sample.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"] .type-tile', { timeout: 15000 });
  const opened = await page.locator('.world-name span').innerText();
  check(tag, opened === 'Moppetopia (sample)', `Open a world file opens "${opened}" on this phone`);
  await shot('opened-file');

  // 8. The house look
  await page.goto(`${BASE}/#/settings`);
  await page.getByRole('button', { name: 'House' }).tap();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check(tag, theme === 'house', `the switch sets data-theme=${theme}`);
  await shot('settings-house');
  await page.getByRole('button', { name: 'Warm' }).tap();

  // 9. A missing path reaches the host's 404 (preview has no 404.html rule; this checks the worker lets it through)
  // (The page errors are counted first: this step's 404 is the point, not an error.)
  for (const e of errors) console.log(`[${tag}] ${e}`);
  check(tag, errors.length === 0, `no page errors (${errors.length})`);
  const res = await page.goto(`${BASE}/this-is-not-a-page`);
  check(
    tag,
    res?.status() === 404 && !(await page.locator('#app').count()),
    `a missing path reaches the host's 404, not the app shell (status ${res?.status()}, from worker: ${res?.fromServiceWorker()})`,
  );
  await browser.close();
}

if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'iphone');
if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'pixel');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
