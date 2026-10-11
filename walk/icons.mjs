// Renders public/icon.svg to the PNG sizes the manifest and iOS want. Run: node walk/icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icon.svg', 'utf8');
// The maskable icon keeps the mark inside the safe circle: a full-bleed square, the mark at 70%.
const maskable = svg.replace('rx="112"', 'rx="0"').replace('translate(64 64) scale(16)', 'translate(122 122) scale(11.2)').replace('stroke-width="22"', 'stroke-width="24"');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, src] of [
  ['icon-180.png', 180, svg.replace('rx="112"', 'rx="0"')],
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-512-maskable.png', 512, maskable],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${src}`);
  await page.screenshot({ path: `public/${name}`, omitBackground: true });
  console.log('wrote', name);
}
await browser.close();
