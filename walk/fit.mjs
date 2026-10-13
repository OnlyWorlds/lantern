// Every button on one line, at a narrow phone's width (the Captain's walk, 2026-10-12: "some
// buttons were two lines"). Visits each screen at 360 CSS px (a Galaxy S22), both themes, and counts
// the lines each control's text paints, per text leaf (a .choice's title and hint are two leaves by
// design). Pointed at a known two-line label first, so a zero is a measurement, not a blind spot.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/fit.mjs [webkit|chromium]
import './guard.mjs';
import { chromium, webkit, devices } from 'playwright';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const only = process.argv[2];
let failures = 0;

function check(tag, ok, what) {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

/** Controls whose text wraps: [{ text, lines }]. Measured on the text nodes' own line boxes. */
function wrapped(page) {
  return page.evaluate(() => {
    const sel = 'button, a.btn, a.choice, .tabbar a, .kind-chip, .link-chip, .pill, .type-tile';
    const out = [];
    for (const c of document.querySelectorAll(sel)) {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(c).visibility === 'hidden') continue;
      // Leaves: each element child that holds text directly, or the control itself.
      const leaves = new Map();
      const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!t.textContent.trim()) continue;
        const leaf = t.parentElement;
        if (!leaves.has(leaf)) leaves.set(leaf, []);
        leaves.get(leaf).push(t);
      }
      // A pick row (a note to sort, an ask's candidate) carries content, not a label: its title and
      // the words under it may wrap (cutting a candidate's anchor would hide which one it is). It
      // still may not run out of its box, checked below.
      for (const [leaf, texts] of c.classList.contains('note-pick') ? [] : leaves) {
        const tops = new Set();
        for (const t of texts) {
          const range = document.createRange();
          range.selectNodeContents(t);
          for (const rect of range.getClientRects()) if (rect.width > 1) tops.add(Math.round(rect.top));
        }
        // Rows closer than half a line are one row (a baseline shift, an icon beside the text).
        const rows = [...tops].sort((a, b) => a - b).filter((y, i, a) => i === 0 || y - a[i - 1] > 6);
        if (rows.length > 1) out.push({ text: leaf.textContent.trim().slice(0, 60), lines: rows.length });
      }
      // A label kept on one line can instead run out of its control, or off the screen.
      const ink = document.createRange();
      ink.selectNodeContents(c);
      const right = Math.max(...[...ink.getClientRects()].map((x) => x.right), 0);
      if (right > Math.min(r.right, innerWidth) + 1) out.push({ text: c.textContent.trim().slice(0, 60), lines: 1, overflow: Math.round(right - Math.min(r.right, innerWidth)) });
    }
    return out;
  });
}

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // The instrument first sees two known positives: a label that wraps (a plain button) and one
  // that runs out of its box (a .btn, which keeps its label on one line).
  await page.goto(`${BASE}/#/welcome`);
  await page.waitForSelector('[data-screen="welcome"]');
  await page.evaluate(() => {
    for (const [id, cls] of [['fit-wrap', ''], ['fit-over', 'btn']]) {
      const b = document.createElement('button');
      b.className = cls;
      b.style.width = '120px';
      if (cls) b.style.whiteSpace = 'nowrap'; // a label told to stay on one line
      b.textContent = `A label far too long ${id}`;
      b.id = id;
      document.querySelector('main').appendChild(b);
    }
  });
  const known = await wrapped(page);
  const wrap = known.find((w) => /fit-wrap/.test(w.text));
  const over = known.find((w) => /fit-over/.test(w.text));
  check(tag, wrap?.lines > 1, `the instrument sees a known two-line label (${wrap?.lines ?? 0} lines)`);
  check(tag, over?.overflow > 0, `the instrument sees a known label running out of its button (${over?.overflow ?? 0} px)`);
  await page.evaluate(() => document.querySelectorAll('#fit-wrap, #fit-over').forEach((b) => b.remove()));

  const seen = [];
  const visited = [];
  const measure = async (name) => {
    visited.push(`${name}:${await page.locator('button, a.btn, a.choice, .tabbar a, .kind-chip, .link-chip').count()}`);
    for (const theme of ['warm', 'house']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(50);
      for (const w of await wrapped(page)) seen.push({ ...w, at: `${name}/${theme}` });
      // At 320 (the smallest phones) a label may wrap, but nothing may run out of its control or
      // push the page sideways (the S398 gate: a one-line rule makes long labels spill).
      await page.setViewportSize({ width: 320, height: 780 });
      await page.waitForTimeout(50);
      for (const w of await wrapped(page)) if (w.overflow) seen.push({ ...w, at: `${name}/${theme}/320` });
      const sideways = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      if (sideways > 0) seen.push({ text: '(the page)', lines: 1, overflow: sideways, at: `${name}/${theme}/320` });
      await page.setViewportSize({ width: 360, height: 780 });
    }
  };

  await measure('welcome');
  for (const path of ['signin', 'key', 'new', 'join', 'settings']) {
    await page.goto(`${BASE}/#/${path}`);
    await page.waitForSelector('main[data-screen]');
    // Settings draws after the storage question, which WebKit answers slowly.
    if (path === 'settings') await page.waitForSelector('main .muted.small');
    await page.waitForTimeout(150);
    await measure(path);
  }

  // A world on this phone: its empty home, Catch, a Character made from a note, its page.
  await page.goto(`${BASE}/#/new`);
  await page.locator('input[aria-label="World name"]').fill('Fit walk');
  await page.getByRole('button', { name: 'Start the world' }).click();
  await page.waitForSelector('[data-screen="home"]');
  await measure('home-empty');
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('[data-screen="worlds"] .world-card');
  await measure('worlds');
  await page.goBack();
  await page.waitForSelector('[data-screen="home"]');
  await page.locator('.tabbar [data-tab=catch]').click();
  await page.waitForSelector('[data-screen="capture"]');
  await page.getByRole('button', { name: 'More' }).click();
  await measure('catch');
  await page.locator('textarea').fill('Mira Vell\nA smith in the lower town.');
  await page.locator('[data-kind=character]').click();
  await page.getByRole('button', { name: 'Make the character' }).click();
  await page.waitForSelector('[data-screen="element"]');
  await measure('element');
  await page.locator('[data-action=picture]').click();
  await page.waitForSelector('.sheet');
  await measure('picture-sheet');
  await page.locator('.sheet').getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.tabbar [data-tab=ask]').click();
  await page.waitForSelector('[data-screen="ask"]');
  await measure('ask');
  await page.locator('.tabbar [data-tab=world]').click();
  await page.waitForSelector('[data-screen="home"] .type-tile');
  await measure('home');
  await page.locator('.type-tile').first().click();
  await page.waitForSelector('[data-screen="type"]');
  await measure('type');

  // The morning after: a note kept in Unsorted, Sort's choose screen (a phone-only world says why it
  // cannot sort), then its review screen from a sort kept on this phone, every kind of card, long names.
  const worldId = page.url().match(/#\/w\/([^/?]+)/)[1];
  const miraId = await page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open(`lantern-world-${id}`);
        r.onsuccess = () => {
          const g = r.result.transaction('elements').objectStore('elements').getAll();
          g.onsuccess = () => res(g.result.find((e) => e.name === 'Mira Vell')?.id);
        };
      }),
    worldId,
  );
  await page.locator('.tabbar [data-tab=catch]').click();
  await page.waitForSelector('[data-screen="capture"]');
  await page.locator('textarea').fill('Last night at the Copper Kettle\nMira Vell argued with a stranger from the northern marches about the price of iron.');
  await page.getByRole('button', { name: 'Keep it in Unsorted' }).click();
  await page.waitForTimeout(300);
  await page.goto(`${BASE}/#/w/${worldId}/sort`);
  await page.waitForSelector('[data-screen="sort"] .note-pick');
  await measure('sort-choose');
  const mira = { id: miraId, type: 'character', name: 'Mira Vell', anchor: 'a smith in the lower town' };
  const stranger = { id: miraId, type: 'character', name: 'Aldric Thornwood-Vasquez of the Northern Marches', anchor: 'the iron trader' };
  await page.evaluate(
    ([id, mira, stranger]) =>
      localStorage.setItem(
        `lantern-sort-${id}`,
        JSON.stringify({
          notes: [],
          sent: [mira.id],
          at: new Date().toISOString(),
          result: {
            rows: [
              { kind: 'make', source_line: 'a stranger from the northern marches', proposal: { type: 'Character', name: 'Aldric Thornwood-Vasquez', description: 'An iron trader from the northern marches.' } },
              { kind: 'add_to', source_line: 'Mira Vell argued', target: mira, field: 'description', op: 'append', value: 'Argued about the price of iron.' },
              { kind: 'link', source_line: 'at the Copper Kettle', target: mira, field: 'location', value_id: mira.id, value_name: 'The Copper Kettle' },
              { kind: 'ask', source_line: 'a stranger', question: 'Which stranger was it?', candidates: [mira, stranger] },
            ],
            not_proposed: [{ source_line: 'the price of iron', reason: 'nothing particular to this world' }],
            remaining: 48,
          },
        }),
      ),
    [worldId, mira, stranger],
  );
  await page.reload();
  await page.waitForSelector('[data-screen="sort"] .sort-card');
  await page.locator('.sort-card [data-tick]').first().click();
  await measure('sort-review');
  await page.evaluate((id) => localStorage.removeItem(`lantern-sort-${id}`), worldId);

  // An online world (the demo, read from live keel): its home, a map's page, an element with links.
  await page.goto(`${BASE}/#/worlds`);
  await page.getByRole('button', { name: /Explore Moppetopia/ }).click();
  await page.waitForSelector('[data-screen="home"] .type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  await measure('demo-home');
  // A type's name cut to an ellipsis is neither a wrap nor a spill, so the measure above cannot
  // see it (S399: at 360, six of the 22 were cut). Every type shown, at four phone widths.
  await page.getByRole('button', { name: /All 22 types/ }).click();
  for (const w of [320, 360, 390, 412]) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(80);
    const cut = await page.evaluate(() => [...document.querySelectorAll('.type-tile b')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
    check(tag, cut.length === 0, `every type's name whole on its tile at ${w} wide${cut.length ? `: cut ${cut.join(', ')}` : ''}`);
  }
  await page.setViewportSize({ width: 360, height: 780 });
  for (const t of ['map', 'character', 'location']) {
    await page.goto(page.url().replace(/#\/w\/([^/]+).*/, `#/w/$1/t/${t}`));
    await page.waitForSelector('[data-screen="type"] .el-row', { timeout: 15000 }).catch(() => {});
    await measure(`demo-${t}s`);
    // The element with the most links on the first screen of the list.
    const n = await page.locator('.el-row').count();
    if (!n) continue;
    await page.locator('.el-row').first().click();
    await page.waitForSelector('[data-screen="element"] .el-head');
    await measure(`demo-${t}`);
    await page.goBack();
  }
  await page.locator('.tabbar [data-tab=ask]').click();
  await page.waitForSelector('[data-screen="ask"]');
  await page.locator('[data-screen="ask"] input').fill('fluffy');
  await page.waitForTimeout(500);
  await measure('demo-ask');

  for (const w of seen)
    console.log(`[${tag}]      ${w.overflow ? `runs out by ${w.overflow} px` : `${w.lines} lines`}: ${JSON.stringify(w.text)} at ${w.at}`);
  console.log(`[${tag}]      measured (screen:controls): ${visited.join(' ')}`);
  const labels = new Set(seen.map((w) => w.text));
  check(tag, labels.size === 0, `every control's text on one line at 360 wide, and nothing running out at 320, both themes (${labels.size} labels)`);
  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
