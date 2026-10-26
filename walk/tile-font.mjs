// Which type names cut on their tiles when the system font is wider than this machine's
// (the Linux runner's system-ui is DejaVu Sans; Samsung's own font is wider than Roboto too).
// FONT stands in for system-ui in both themes. Reads keel's public demo world, as fit.mjs does.
//   FONT=Verdana node walk/tile-font.mjs [chromium|webkit]
import { chromium, webkit } from 'playwright';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const FONT = process.env.FONT ?? 'Verdana';
const engine = process.argv[2] === 'webkit' ? webkit : chromium;
const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 780 } });
await page.goto(`${BASE}/#/worlds`);
await page.getByRole('button', { name: /Explore Moppetopia/ }).click();
await page.waitForSelector('[data-screen="home"] .type-tile', { timeout: 60000 });
await page.getByRole('button', { name: /All 22 types/ }).click();
let bad = 0;
for (const theme of ['warm', 'house']) {
  await page.evaluate(([t, f]) => {
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.setProperty('--lan-font-body', `'${f}', sans-serif`);
    document.documentElement.style.setProperty('--lan-font-display', `'${f}', sans-serif`);
  }, [theme, FONT]);
  for (const w of (process.env.WIDTHS ?? "320,360,390,412").split(",").map(Number)) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(120);
    const cut = await page.evaluate(() => [...document.querySelectorAll('.type-tile b')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.type-tile').parentElement).gridTemplateColumns.split(' ').length);
    if (cut.length) bad++;
    console.log(`${theme} ${w}: ${cols} columns, cut ${cut.length ? cut.join(', ') : 'none'}`);
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
