// The map, walked on the demo world (Moppetopia: two maps with pictures online, pins, zones from
// markers) as a phone taps it, both engines. Read only, so it runs against live keel safely.
// Run: npm run build && (npx vite preview &) && node walk/map.mjs [webkit|chromium]
import './guard.mjs';
// WebKit logs the viewport's interactive-widget key (Android Chrome's keyboard rule) as unknown: harmless.
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const API = 'https://www.onlyworlds.com/api/v2';
const KEY = '0000000001';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;

function check(tag, ok, what) {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

async function list(type) {
  const r = await fetch(`${API}/${type}/?limit=500`, { headers: { 'API-Key': KEY } });
  return (await r.json()).data;
}

// What the walk expects, read from keel itself, not written into the walk.
const [maps, pins, markers] = await Promise.all([list('map'), list('pin'), list('marker')]);
const overview = maps.find((m) => m.name === 'MoppetopiaMap');
const placed = pins.find((p) => p.map === overview.id && p.element_id);
const placedEl = (await list(placed.element_type)).find((e) => e.id === placed.element_id);
const pinsOn = pins.filter((p) => p.map === overview.id).length;
const zonesOn = new Set(markers.filter((m) => m.map === overview.id && m.zone).map((m) => m.zone)).size;
console.log(`keel: ${overview.name} ${overview.width}x${overview.height}, ${pinsOn} pins, ${zonesOn} zones; walking to ${placedEl.name} (${placed.element_type})`);

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...devices[deviceName] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && errors.push('console: ' + m.text()));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/map-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });

  await page.goto(BASE);
  await page.waitForSelector('[data-screen="welcome"]');
  await page.getByRole('button', { name: /Explore Moppetopia/ }).tap();
  await page.waitForSelector('.type-tile', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 60000 }).catch(() => {});
  const worldId = await page.evaluate(() => location.hash.split('/')[2]);

  // 1. The placed element's page offers the map
  await page.goto(`${BASE}/#/w/${worldId}/e/${placedEl.id}`);
  await page.waitForSelector('[data-screen="element"] .el-head');
  const links = await page.locator('.map-links a').allInnerTexts();
  check(tag, links.length >= 1 && links.some((t) => /Show on map|On MoppetopiaMap/.test(t)), `the element page offers the map: ${JSON.stringify(links)}`);
  await shot('element');

  // 2. Show on map: the picture, the pins, the zones, centred on this pin
  const link = page.locator('.map-links a', { hasText: links.length > 1 ? 'MoppetopiaMap' : 'Show on map' });
  await link.tap();
  await page.waitForSelector('[data-screen="map"] .leaflet-image-layer', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.leaflet-image-layer')?.complete && document.querySelector('.leaflet-image-layer').naturalWidth > 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  const drawn = await page.evaluate(() => ({
    circles: document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive, .leaflet-overlay-pane path').length,
    note: document.querySelector('.map-note:not([hidden])')?.textContent ?? '',
    card: document.querySelector('.map-card:not([hidden])')?.textContent ?? '',
    title: document.querySelector('.map-title')?.textContent ?? '',
  }));
  check(tag, drawn.title === overview.name, `the map is named: ${JSON.stringify(drawn.title)}`);
  check(tag, !drawn.note, `no note over the map (${JSON.stringify(drawn.note)})`);
  // pins (the focus drawn as two rings) + zones
  check(tag, drawn.circles >= pinsOn + zonesOn, `${drawn.circles} paths drawn for ${pinsOn} pins and ${zonesOn} zones`);
  check(tag, drawn.card.includes(placedEl.name), `the card names the pin: ${JSON.stringify(drawn.card)}`);
  // The focus pin is at the centre of the screen.
  const centred = await page.evaluate(() => {
    const ring = [...document.querySelectorAll('.leaflet-overlay-pane path')].at(-1).getBoundingClientRect();
    const box = document.querySelector('.map-box').getBoundingClientRect();
    return { dx: Math.round(ring.x + ring.width / 2 - box.width / 2), dy: Math.round(ring.y + ring.height / 2 - box.height / 2) };
  });
  // Near an edge the bounds hold the view, so "centred" allows that slack.
  check(tag, Math.abs(centred.dx) < 140 && Math.abs(centred.dy) < 260, `the pin sits near the centre (${centred.dx}, ${centred.dy})`);
  const labels = await page.locator('.map-label').allInnerTexts();
  check(tag, labels.length > 0 && labels.length <= 30 && labels.includes(placedEl.name), `names beside the pins in view (${labels.length}), this one's among them: ${JSON.stringify(labels.slice(0, 6))}`);
  // The rendered ink, not the model: the names' real boxes against each other and every drawn pin.
  const clash = await page.evaluate(() => {
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const names = [...document.querySelectorAll('.map-label')].map((e) => ({ t: e.textContent, r: e.getBoundingClientRect() }));
    // Pins are circle paths (an arc in d); the shown pin's ring is one too.
    const dots = [...document.querySelectorAll('.leaflet-overlay-pane path')].filter((p) => /a\d/.test(p.getAttribute('d') ?? '')).map((p) => p.getBoundingClientRect());
    const out = [];
    names.forEach((a, i) => {
      names.forEach((b, j) => j > i && hit(a.r, b.r) && out.push(`${a.t} / ${b.t}`));
      // Its own pin sits beside it: a name touching only the dots at its own row's edge is its own.
      dots.forEach((d) => hit(a.r, d) && out.push(`${a.t} on a pin at ${Math.round(d.left)},${Math.round(d.top)}`));
    });
    return out;
  });
  check(tag, clash.length === 0, `no name covers another name or a pin, as drawn${clash.length ? ': ' + clash.join('; ') : ''}`);
  await shot('map-focus');

  // 3. A tap on empty water closes the card: a point clear of every drawn pin and zone by a
  // finger (zones answer taps now, so "empty" is measured, not assumed).
  const box = await page.locator('.map-box').boundingBox();
  const empty = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.leaflet-overlay-pane path')].map((p) => p.getBoundingClientRect());
    for (let y = innerHeight - 160; y > 90; y -= 20)
      for (let x = 12; x < innerWidth - 12; x += 20)
        if (rects.every((r) => x < r.left - 30 || x > r.right + 30 || y < r.top - 30 || y > r.bottom + 30)) return { x, y };
    return null;
  });
  check(tag, !!empty, `an empty point is on screen (${JSON.stringify(empty)})`);
  await page.touchscreen.tap(empty?.x ?? box.x + 8, empty?.y ?? box.y + box.height / 2);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector('.map-card:not([hidden])')?.textContent ?? '');
  check(tag, !after, `a tap far from any pin closes the card (${JSON.stringify(after)})`);

  // 3b. A tap inside a zone, away from every pin, opens the zone's card (the drawn area itself
  // says where it is: a point its own fill holds, at least a finger from any pin).
  const inZone = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('.leaflet-overlay-pane path')];
    const dots = paths.filter((p) => /a\d/.test(p.getAttribute('d') ?? '')).map((p) => {
      const r = p.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    const areas = paths.filter((p) => /z/i.test(p.getAttribute('d') ?? '') && !/a\d/.test(p.getAttribute('d') ?? ''));
    for (const a of areas) {
      const r = a.getBoundingClientRect();
      const inv = a.getScreenCTM().inverse();
      for (let gy = 0.1; gy < 1; gy += 0.1)
        for (let gx = 0.1; gx < 1; gx += 0.1) {
          const x = r.x + r.width * gx, y = r.y + r.height * gy;
          if (x < 10 || y < 80 || x > innerWidth - 10 || y > innerHeight - 140) continue;
          const p = new DOMPoint(x, y).matrixTransform(inv);
          if (a.isPointInFill(p) && dots.every(([dx, dy]) => Math.hypot(dx - x, dy - y) > 40)) return { x, y };
        }
    }
    return null;
  });
  check(tag, !!inZone, 'a point inside a zone, away from the pins, is on screen');
  if (inZone) {
    await page.touchscreen.tap(inZone.x, inZone.y);
    await page.waitForTimeout(300);
    const zc = await page.evaluate(() => document.querySelector('.map-card:not([hidden])')?.textContent ?? '');
    check(tag, /· zone/.test(zc) && /Open$/.test(zc), `a tap inside a zone opens its card: ${JSON.stringify(zc)}`);
    await shot('map-zone');
  }

  // 4. Zoom to the ceiling: the zoom-in button stops
  for (let i = 0; i < 12; i++) {
    const zin = page.locator('.leaflet-control-zoom-in');
    if (await zin.evaluate((e) => e.classList.contains('leaflet-disabled'))) break;
    await zin.tap();
    await page.waitForTimeout(300);
  }
  check(tag, await page.locator('.leaflet-control-zoom-in').evaluate((e) => e.classList.contains('leaflet-disabled')), 'zoom in stops at the ceiling');
  await shot('map-ceiling');

  // 5. Open: from the card to the element; back returns to the map
  await page.goto(`${BASE}/#/w/${worldId}/map/${overview.id}`);
  await page.waitForSelector('[data-screen="map"] .leaflet-image-layer', { timeout: 20000 });
  await page.waitForTimeout(400);
  await shot('map-whole');
  // A tap on a drawn pin (a circle: an arc path, fully filled) opens its card.
  const dot = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.leaflet-overlay-pane path')].find((e) => /a\d/.test(e.getAttribute('d') ?? '') && e.getAttribute('fill-opacity') === '1');
    const r = p?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  check(tag, !!dot, 'a pin is drawn on the whole map');
  if (dot) {
    // A finger lands a little off the dot.
    await page.touchscreen.tap(dot.x + 9, dot.y - 6);
    await page.waitForTimeout(300);
    const c = await page.evaluate(() => document.querySelector('.map-card:not([hidden])')?.textContent ?? '');
    check(tag, /Open$/.test(c), `a tap beside a pin opens its card: ${JSON.stringify(c)}`);
    await shot('map-tap');
    await page.locator('.map-card a', { hasText: 'Open' }).tap();
    await page.waitForSelector('[data-screen="element"]');
    check(tag, true, 'Open on the card goes to the element');
    await page.goBack();
    await page.waitForSelector('[data-screen="map"] .leaflet-image-layer', { timeout: 20000 });
    check(tag, true, 'Back returns to the map');
  }

  // 5b. The other map (wider than tall): the whole of it fits the phone
  const space = maps.find((m) => m.id !== overview.id && m.image_url);
  // The map just left is still drawn when the new address lands, and the new screen measures its
  // picture before it builds the map: a wait on any layer passed on the old one, then found none
  // (red at this step on HEAD's build too). The old layer is marked, and only a new one counts.
  await page.evaluate(() => document.querySelectorAll('.leaflet-image-layer').forEach((i) => (i.dataset.left = '1')));
  await page.goto(`${BASE}/#/w/${worldId}/map/${space.id}`);
  const LAYER = '.leaflet-image-layer:not([data-left])';
  await page.waitForFunction((sel) => document.querySelector(sel)?.complete && document.querySelector(sel).naturalWidth > 0, LAYER, { timeout: 20000 });
  await page.waitForTimeout(400);
  const fits = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { w: Math.round(r.width), vw: innerWidth };
  }, LAYER);
  check(tag, fits.w <= fits.vw + 1 && fits.w > fits.vw * 0.8, `${space.name} opens whole (${fits.w} of ${fits.vw} px wide)`);
  await shot('map-space');

  // 6. A map with no picture shows a sentence, not a blank map
  await page.goto(`${BASE}/#/w/${worldId}/map/not-a-map`);
  await page.waitForSelector('main');
  const none = await page.locator('main').innerText();
  check(tag, /no picture online/.test(none), `a map without a picture says so: ${JSON.stringify(none.split('\n').at(-1))}`);

  // 7. Past a thousand pins: clusters. A world file on this phone, the overview's picture, 1,200 pins.
  const W = overview.width, H = overview.height;
  const wid = '0f0f0f0f-0000-4000-8000-00000000c1a5';
  const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const files = [
    { path: 'world.json', data: enc({ id: wid, name: 'Cluster walk' }) },
    { path: 'spatial/map/sea.json', data: enc({ id: 'c0000000-0000-4000-8000-000000000000', name: 'Sea', image_url: overview.image_url, width: W, height: H }) },
  ];
  for (let i = 0; i < 1200; i++) {
    const id = `c0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    files.push({ path: `spatial/pin/p${i}.json`, data: enc({ id, name: `Pin ${i}`, map_id: 'c0000000-0000-4000-8000-000000000000', x: Math.round(rnd() * W), y: Math.round(rnd() * H) }) });
  }
  const zip = Buffer.from(writeWorldFile(files, 'cluster-walk'));
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'cluster-walk.zip', mimeType: 'application/zip', buffer: zip });
  // WebKit on this machine stores 1,201 elements in about 18 s (Chromium: 0.1 s), so wait long.
  const t0 = Date.now();
  await page.waitForSelector('[data-screen="home"] .type-tile', { timeout: 90000 });
  console.log(`[${tag}] (the world file opened in ${Date.now() - t0} ms)`);
  await page.goto(`${BASE}/#/w/${wid}/map/c0000000-0000-4000-8000-000000000000`);
  await page.waitForSelector('.marker-cluster', { timeout: 20000 });
  const clusters = await page.locator('.marker-cluster').count();
  check(tag, clusters > 0 && clusters < 300, `1,200 pins draw as ${clusters} clusters`);
  check(tag, (await page.locator('.map-label').count()) === 0, 'too many named pins in view to read: no names drawn');
  await shot('map-clusters');
  const z0 = await page.evaluate(() => document.querySelector('.leaflet-image-layer').getBoundingClientRect().width);
  // The cluster nearest the middle (one at an edge can sit under the bar or the zoom buttons).
  const mid = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('.marker-cluster')].map((e) => e.getBoundingClientRect());
    const c = cs.sort((a, b) => Math.hypot(a.x - innerWidth / 2, a.y - innerHeight / 2) - Math.hypot(b.x - innerWidth / 2, b.y - innerHeight / 2))[0];
    return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  });
  await page.touchscreen.tap(mid.x, mid.y);
  await page.waitForTimeout(800);
  const z1 = await page.evaluate(() => document.querySelector('.leaflet-image-layer').getBoundingClientRect().width);
  check(tag, z1 > z0, `a tap on a cluster zooms in (${Math.round(z0)} to ${Math.round(z1)} px)`);
  // Leave a clustered map while it is still opening, twice: nothing may run after it (the gate, C1).
  for (const wait of [30, 250]) {
    await page.goto(`${BASE}/#/w/${wid}`);
    await page.waitForSelector('[data-screen="home"]');
    await page.evaluate(() => (location.hash = location.hash + '/map/c0000000-0000-4000-8000-000000000000'));
    await page.waitForTimeout(wait);
    await page.evaluate(() => history.back());
  }
  await page.waitForTimeout(1500);

  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
