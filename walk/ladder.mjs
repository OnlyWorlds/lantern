// OW Style's button ladder (S442; Studio style/RULES.md section 8, the Captain's "looks good", h63 #8314):
// the first screen's Sign in and Start the world are the Entry fill, a sheet's commit (Move now, an
// element's Save) is the Standard wash and edge, the delete sheet's Delete is the danger wash, never a fill,
// and every one keeps a finger's 48 high. Both engines, both themes; keel cut off, so nothing is sent.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/ladder.mjs [webkit|chromium]
import './guard.mjs';
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
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

const look = (loc) =>
  loc.first().evaluate((b) => {
    const s = getComputedStyle(b);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--lan-accent').trim();
    return { bg: s.backgroundColor, edge: s.borderTopColor, ink: s.color, h: Math.round(b.getBoundingClientRect().height), weight: s.fontWeight, accent };
  });
const hex = (c) => '#' + (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((n) => Math.round(Number(n) <= 1 && c.includes('srgb') ? Number(n) * 255 : Number(n)).toString(16).padStart(2, '0')).join('');
const alpha = (c) => { const m = c.match(/\/\s*([\d.]+)\)|rgba\([^)]*,\s*([\d.]+)\)/); return m ? Number(m[1] ?? m[2]) : 1; };
const isFill = (l) => hex(l.bg) === l.accent && alpha(l.bg) === 1;
const isWash = (l, colour) => hex(l.ink) === colour && hex(l.bg) === colour && alpha(l.bg) > 0.1 && alpha(l.bg) < 0.2;

async function walk(engine, deviceName, tag, theme) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/Failed to load resource|ERR_FAILED|cancelled/i.test(m.text()) && errors.push(m.text()));
  await page.route('**/api/v2/**', (r) => r.abort());
  await page.goto(`${BASE}/`);
  await page.evaluate((t) => localStorage.setItem('lantern-theme', t), theme);
  await page.goto(`${BASE}/`);
  tag = `${tag} ${theme}`;

  const signIn = page.locator('a.choice.primary[href="#/signin"]');
  await signIn.waitFor();
  const s = await look(signIn);
  check(tag, isFill(s), `the first screen's Sign in is the Entry fill (${s.bg} on ${s.accent})`);
  await page.screenshot({ path: `${OUT}/ladder-${tag.replace(' ', '-')}-first.png` });

  await page.goto(`${BASE}/#/new`);
  const start = page.getByRole('button', { name: 'Start the world' });
  const st = await look(start);
  check(tag, isFill(st) && st.h >= 48 && st.weight === '600', `Start the world is the Entry fill, 48 high, weight 600 (h${st.h}, ${st.weight})`);
  await page.locator('input[aria-label="World name"]').fill('Ladder table');
  await start.tap();
  await page.waitForSelector('[data-screen="home"]');
  const worldId = page.url().match(/#\/w\/([^/?]+)/)[1];

  // A Character, then its delete sheet: Delete is the danger wash, not the fill.
  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  const kind = page.getByRole('button', { name: /Character/ });
  if (await kind.count()) await kind.first().tap();
  await page.locator('textarea').fill('Ferryman\nHe knows the river');
  await page.locator('[data-action="catch-save"]').tap();
  await page.waitForTimeout(800);
  if (!/#\/w\/[^/]+\/e\//.test(page.url())) {
    const open = page.getByRole('link', { name: /Open it/ });
    if (await open.count()) await open.first().tap();
  }
  await page.waitForTimeout(600);
  const del = page.locator('button', { hasText: /^Delete this/ });
  // A frame of the state before the delete, kept when the step fails (S444: a red here, 3 in 9).
  await del.first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `${OUT}/ladder-${tag.replace(' ', '-')}-no-delete.png`, fullPage: true });
    console.log(`[${tag}] at the delete step: ${page.url().replace(/^.*#/, '#')}`);
  });
  await del.first().scrollIntoViewIfNeeded();
  await del.first().tap();
  const confirm = page.locator('[data-action="confirm-delete"]');
  await confirm.waitFor();
  const d = await look(confirm);
  check(tag, isWash(d, '#ff8a7a') && d.h >= 48, `the delete sheet's Delete is the danger wash, 48 high (${d.bg}, ink ${d.ink}, h${d.h})`);
  await page.screenshot({ path: `${OUT}/ladder-${tag.replace(' ', '-')}-delete.png` });
  await page.getByRole('button', { name: 'Cancel' }).first().tap();

  // A sheet's commit: an element's field edit, Save is the Standard wash.
  await page.goto(`${BASE}/#/w/${worldId}`);
  await page.waitForSelector('[data-screen="home"]');
  await page.waitForTimeout(400);
  const row = page.getByText('Ferryman').first();
  await row.tap();
  await page.waitForTimeout(500);
  const field = page.locator('[data-field], .field-row, button.row').filter({ hasText: /Description|description/ }).first();
  if (await field.count()) await field.tap();
  else await page.getByText('He knows the river').first().tap();
  const save = page.locator('.sheet button[type="submit"]');
  await save.first().waitFor({ timeout: 5000 });
  const sv = await look(save);
  check(tag, isWash(sv, sv.accent) && sv.h >= 48 && sv.weight === '500', `a sheet's Save is the Standard wash and edge, 48 high (${sv.bg}, edge ${sv.edge}, h${sv.h})`);
  await page.screenshot({ path: `${OUT}/ladder-${tag.replace(' ', '-')}-sheet.png` });

  check(tag, errors.length === 0, `no page errors (${errors.join(' | ').slice(0, 200)})`);
  await browser.close();
}

const runs = [
  [chromium, 'Pixel 7', 'chromium'],
  [webkit, 'iPhone 13', 'webkit'],
].filter(([, , t]) => !only || t === only);
for (const [engine, device, tag] of runs) for (const theme of ['warm', 'house']) await walk(engine, device, tag, theme);
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
