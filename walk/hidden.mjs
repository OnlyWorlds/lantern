// The hidden mark on the phone (src/hidden.ts; folder spec §4.8; Atlas 1.86.0's twin), both engines.
// The demo world, made to look like an account world on this phone, one of its Characters marked
// hidden in the phone's copy as keel serves the mark to its owner, and keel's Ask proxy routed (no
// question spent): the home's count keeps it; its row in the type's list and its page say hidden;
// Ask lists it with its word, says it is not sent, and the request's context carries none of its text.
// Workers blocked: with one in control, Playwright's WebKit does not route the page's requests.
// Run: npm run build && (npx vite preview &) && node walk/hidden.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

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
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const NAME = 'Admiral Fluffington';

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const asked = [];
  await page.route('**/api/v2/account/ask', (r) => {
    asked.push(JSON.parse(r.request().postData()));
    return r.fulfill(json(200, { answer: 'The Puddle Navy has an admiral.', model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 6 }, remaining: 49 }));
  });

  await page.goto(BASE);
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  const worldId = await page.evaluate(() => location.hash.split('/')[2]);
  const tileBefore = await page.locator('.type-tile[href$="/t/character"]').textContent().catch(() => null);

  // An account world on this phone, signed in; the Admiral marked hidden in the phone's copy.
  const marked = await page.evaluate(
    ({ id, name }) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction(['worlds', 'kv'], 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, kind: 'online', role: 'owner' });
          t.objectStore('kv').put('ow_a_' + 'w'.repeat(40), 'accountToken');
          t.oncomplete = () => {
            const w = indexedDB.open(`lantern-world-${id}`);
            w.onsuccess = () => {
              const tx = w.result.transaction('elements', 'readwrite');
              const es = tx.objectStore('elements');
              const all = es.getAll();
              let found = null;
              all.onsuccess = () => {
                const el = all.result.find((e) => e.name === name);
                if (el) { found = { id: el.id, description: el.description ?? '' }; es.put({ ...el, hidden: true }); }
              };
              tx.oncomplete = () => res(found);
              tx.onerror = () => rej(tx.error);
            };
          };
          t.onerror = () => rej(t.error);
        };
      }),
    { id: worldId, name: NAME },
  );
  check(tag, Boolean(marked), `the demo holds ${NAME}, marked hidden in the phone's copy`);

  // 1. Home: still counted, as the world's own.
  await page.goto(`${BASE}/?signed#/w/${worldId}`);
  await page.waitForSelector('.type-tile', { timeout: 30000 });
  const tileAfter = await page.locator('.type-tile[href$="/t/character"]').textContent().catch(() => null);
  check(tag, !!tileBefore && tileAfter === tileBefore, `home's Characters tile unchanged: ${JSON.stringify(tileBefore)} then ${JSON.stringify(tileAfter)}`);
  await page.screenshot({ path: `${OUT}/hidden-${tag}-1-home.png` });

  // 2. The type's list: its row says hidden.
  await page.goto(`${BASE}/?signed#/w/${worldId}/t/character`);
  const row = await page.locator('.el-row', { hasText: NAME }).first().textContent({ timeout: 8000 }).catch(() => null);
  check(tag, /· .*hidden/.test(row ?? ''), `list row: ${JSON.stringify(row)}`);
  const other = await page.locator('.el-row').filter({ hasNotText: NAME }).first().textContent().catch(() => null);
  check(tag, !!other && !/hidden/.test(other), `another row has no word: ${JSON.stringify(other)}`);

  // 3. Its page says so, in an online world's words.
  await page.goto(`${BASE}/?signed#/w/${worldId}/e/${marked.id}`);
  const mark = await page.locator('[data-role="hidden-mark"]').textContent({ timeout: 8000 }).catch(() => null);
  check(tag, /^Hidden on OnlyWorlds: only the owner, co-builders/.test(mark ?? ''), `page: ${JSON.stringify(mark)}`);
  await page.screenshot({ path: `${OUT}/hidden-${tag}-2-page.png` });

  // 4. Ask: listed with its word, not sent, and said.
  await page.goto(`${BASE}/?signed#/w/${worldId}/ask`);
  await page.locator('input[aria-label="Ask your world"]').fill(`Who is ${NAME}?`);
  await page.waitForSelector('[data-screen="ask"] .el-row');
  const askRow = await page.locator('[data-screen="ask"] .el-row', { hasText: NAME }).first().textContent({ timeout: 5000 }).catch(() => null);
  check(tag, /hidden/.test(askRow ?? ''), `Ask's list shows it with its word: ${JSON.stringify(askRow)}`);
  const said = (await page.locator('[data-sentence] p, [data-why="hidden"]').allInnerTexts()).join(' | ');
  check(tag, /hidden element[s]? (is|are) not sent|One hidden element.* not sent|Only hidden elements match/.test(said), `Ask says it is not sent: ${JSON.stringify(said)}`);
  const btn = page.getByRole('button', { name: 'Answer it in a sentence' });
  if (await btn.count()) {
    await btn.tap();
    await page.waitForSelector('[data-answer]', { timeout: 10000 }).catch(() => {});
    const entries = asked[0]?.context ?? [];
    const ctx = entries.join('\n');
    if (process.env.DUMP) console.log(JSON.stringify({ desc: marked.description.slice(0, 40), ctx: entries }, null, 1));
    check(tag, asked.length === 1 && !ctx.includes(marked.description.slice(0, 40)) && !entries.some((e) => e.startsWith(NAME)), `the context sent holds no entry of its own (${asked.length} asked, ${entries.length} entries)`);
    // A kept element's link to it says a linked element is not present, never its name (prose that names it stays prose).
    const linkLines = ctx.split('\n').filter((l) => /^(linked from \(|(holders|objects|characters|friends|rivals|family|members|leaders|followers|commanders|crew|institutions): )/.test(l));
    check(tag, linkLines.length > 0 && !linkLines.some((l) => l.includes(NAME)), `no link line names it (${linkLines.length} link lines)`);
    check(tag, /linked element\(s\) not present/.test(ctx), 'and a link to it says only that a linked element is not present');
  } else {
    check(tag, asked.length === 0, 'nothing asked: only the hidden element matched');
  }
  await page.screenshot({ path: `${OUT}/hidden-${tag}-3-ask.png` });
  check(tag, errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'Pixel 7', 'chromium');
if (only !== 'chromium') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
