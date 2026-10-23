// Keel #565's reader rule on the phone (src/review.ts; Atlas 1.84.0's twin, conv. 168), both engines.
// The demo world, made to look like an account world on this phone, one of its Characters marked
// proposed in the phone's copy as keel serves the mark, and keel's Ask proxy routed (no question spent):
// the home counts it apart and says so; its row and its page say proposed; Ask lists it with its word,
// says it is not sent, and the request's context carries none of its text.
// Workers blocked: with one in control, Playwright's WebKit does not route the page's requests.
// Run: npm run build && (npx vite preview &) && node walk/review.mjs [webkit|chromium]
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
const MARK = { by: '19e1c2e5-5e8e-4d46-8382-e5ad445d13a0', evidence: 'seat', expires: '2099-11-22' };

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

  // An account world on this phone, signed in; the Admiral marked proposed in the phone's copy.
  const marked = await page.evaluate(
    ({ id, name, mark }) =>
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
                if (el) { found = { id: el.id, description: el.description ?? '' }; es.put({ ...el, x_review_proposed: mark }); }
              };
              tx.oncomplete = () => res(found);
              tx.onerror = () => rej(tx.error);
            };
          };
          t.onerror = () => rej(t.error);
        };
      }),
    { id: worldId, name: NAME, mark: MARK },
  );
  check(tag, Boolean(marked), `the demo holds ${NAME}, marked proposed in the phone's copy`);

  // 1. Home: counted apart, said once.
  await page.goto(`${BASE}/?signed#/w/${worldId}`);
  await page.waitForSelector('.type-tile', { timeout: 30000 });
  const homeLine = await page.locator('[data-role="home-proposed"]').textContent({ timeout: 5000 }).catch(() => null);
  check(tag, /^1 proposed, not yet reviewed, is not counted above/.test(homeLine ?? ''), `home: ${JSON.stringify(homeLine)}`);
  await page.screenshot({ path: `${OUT}/review-${tag}-1-home.png` });

  // 2. Its page says so.
  await page.goto(`${BASE}/?signed#/w/${worldId}/e/${marked.id}`);
  const mark = await page.locator('[data-role="proposed-mark"]').textContent({ timeout: 8000 }).catch(() => null);
  check(tag, /^Proposed, not yet reviewed/.test(mark ?? ''), `page: ${JSON.stringify(mark)}`);
  await page.screenshot({ path: `${OUT}/review-${tag}-2-page.png` });

  // 3. Ask: listed with its word, not sent, and said.
  await page.goto(`${BASE}/?signed#/w/${worldId}/ask`);
  await page.locator('input[aria-label="Ask your world"]').fill(`Who is ${NAME}?`);
  await page.waitForSelector('[data-screen="ask"] .el-row');
  const row = await page.locator('[data-screen="ask"] .el-row', { hasText: NAME }).first().textContent({ timeout: 5000 }).catch(() => null);
  check(tag, /proposed/.test(row ?? ''), `Ask's list shows it with its word: ${JSON.stringify(row)}`);
  const sentence = page.locator('[data-sentence] p, [data-why="proposed"]');
  const said = (await sentence.allInnerTexts()).join(' | ');
  check(tag, /proposed element[s]?,? not yet reviewed,? (is|are) not sent|Only proposed elements match/.test(said), `Ask says it is not sent: ${JSON.stringify(said)}`);
  const btn = page.getByRole('button', { name: 'Answer it in a sentence' });
  if (await btn.count()) {
    await btn.tap();
    await page.waitForSelector('[data-answer]', { timeout: 10000 }).catch(() => {});
    const ctx = (asked[0]?.context ?? []).join('\n');
    check(tag, asked.length === 1 && !ctx.includes(marked.description.slice(0, 40)) && !ctx.startsWith(NAME), `the context sent holds none of its text (${asked.length} asked, ${asked[0]?.context?.length ?? 0} entries)`);
  }
  await page.screenshot({ path: `${OUT}/review-${tag}-3-ask.png` });
  check(tag, errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'Pixel 7', 'chromium');
if (only !== 'chromium') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
