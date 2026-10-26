// keel's "known of" stub (keel PR 113, B16) on a player's phone, both engines, on a fake keel
// shaped by the live probe:
// a player link opens The Reach as Tor, whose friend Ana comes as a stub. The list says "known of"
// beside Ana and not beside Tor; Ana's page shows her name, description and the public fields keel
// shares (PR 117) as rows nothing changes, with "Known of: …", no empty-field toggle, Linked from
// Tor, and asks keel for no files; Tor's page, the control, shows his fields.
// Run: npm run build && (npx vite preview &) && node walk/knownof.mjs [webkit|chromium]
import './guard.mjs';
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = process.env.SHOTS ?? 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;
const check = (tag, ok, what) => {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const WID = '0aaa0000-0000-4000-8000-0000000000ab';
const TOR = '0ccc0000-0000-4000-8000-0000000000cc';
const ANA = '0ccc0000-0000-4000-8000-0000000000ad';
const KEY = 'ow_r_' + 'q'.repeat(30);

// As keel serves them to Tor's player: Tor whole, Ana a stub (every field but the kept ones unset).
const TOR_EL = { id: TOR, type: 'character', name: 'Tor', description: 'A ferryman.', supertype: '', subtype: '', image_url: '', physicality: 'Broad', friends: [ANA], species: [], created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', change_seq: 2, created_by: null, changed_by: null, changed_via: null };
// After keel PR 117 (#448) a Character's public fields come with a stub: physicality, height, weight, species, reputation.
const ANA_STUB = { id: ANA, type: 'character', name: 'Ana', description: 'Sells mules.', supertype: '', subtype: '', image_url: '', physicality: 'Tall', mentality: '', reputation: 'Honest', height: null, birth_date: null, location: null, friends: [], species: [], traits: [], created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', change_seq: 1, created_by: null, changed_by: null, changed_via: null, known_of: true };

async function walk(engine, deviceName, tag) {
  const browser = await engine.launch();
  const page = await (await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !/ERR_FAILED|cancelled/i.test(m.text()) && errors.push(m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/knownof-${tag}-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });

  const asked = [];
  // keel's API host only: the page itself may be lantern.onlyworlds.com (the control on live).
  await page.route(/www\.onlyworlds\.com\/api\//, async (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const h = req.headers();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    asked.push(`${req.method()} ${path}`);
    if (req.method() === 'POST' && path === '/join/preview') {
      return json(200, { reader: 'player', world: { name: 'The Reach', description: 'Salt and debts.' }, invited_by: 'Ada', owner_character: null, role: 'guest', with_character: true, expires_at: '2026-10-27T00:00:00+00:00' });
    }
    if (req.method() === 'POST' && path === '/join') {
      return json(201, { kind: 'player', key: KEY, world: { id: WID, name: 'The Reach', description: 'Salt and debts.' }, character: { id: TOR, name: 'Tor' }, role: 'guest' });
    }
    if (h['api-key'] !== KEY || req.method() !== 'GET') return r.abort();
    if (path === '/world') return json(200, { id: WID, name: 'The Reach', description: 'Salt and debts.' });
    if (path === '/me') return json(200, { kind: 'player', role: 'guest', character: TOR, scope: 'read' });
    if (path === '/changes') {
      const changes = [ANA_STUB, TOR_EL].map((e) => ({ op: 'upsert', id: e.id, type: e.type, element: e, change_seq: e.change_seq }));
      return json(200, { cursor: '2:ffffffff:1', changes, has_more: false, head: 2, epoch: 1, epoch_reason: 'view' });
    }
    if (/\/files$/.test(path)) return json(200, { results: [] });
    return json(404, { error: { code: 'not_found', message: 'not_found' } });
  });

  await page.goto(`${BASE}/?from=keel#/join/ow_j_knownof`);
  await page.waitForSelector('.invite', { timeout: 15000 });
  await page.getByRole('button', { name: 'Open The Reach' }).tap();
  await page.waitForSelector('[data-screen="home"] .el-row', { timeout: 15000 });
  const rowOf = (name) => page.locator('[data-screen="home"] .el-row', { hasText: name }).first().innerText();
  const anaRow = await rowOf('Ana');
  const torRow = await rowOf('Tor');
  check(tag, /known of/.test(anaRow), `Ana's row says known of: ${JSON.stringify(anaRow)}`);
  check(tag, !/known of/.test(torRow), `Tor's row does not: ${JSON.stringify(torRow)}`);
  await shot('home');

  // Ana's page: the stub as known of.
  await page.goto(`${BASE}/?ana#/w/${WID}/e/${ANA}`);
  await page.waitForSelector('[data-screen="element"] h1', { timeout: 15000 });
  await page.waitForTimeout(400);
  const ana = page.locator('[data-screen="element"]');
  check(tag, (await ana.locator('h1').innerText()).startsWith('Ana'), 'the name heads the page');
  check(tag, (await ana.locator('p.prose').innerText()) === 'Sells mules.', 'the description shows');
  const line = ana.locator('[data-part="known-of"]');
  check(tag, (await line.count()) === 1 && (await line.innerText()) === 'Known of: you know only what anyone could see of Ana.', 'the known-of line says so');
  const fields = await ana.locator('.frow[data-field]').evaluateAll((rs) => rs.map((r) => `${r.getAttribute('data-field')}=${r.querySelector('.v')?.textContent}:${r.getAttribute('role') ?? 'plain'}`));
  check(tag, JSON.stringify(fields) === JSON.stringify(['physicality=Tall:plain', 'reputation=Honest:plain']), `only the shared fields, read only: ${JSON.stringify(fields)}`);
  check(tag, (await ana.locator('[data-action="toggle-fields"]').count()) === 0, 'no empty-field toggle');
  check(tag, /Tor/.test(await ana.locator('.frow.block', { hasText: 'Linked from' }).innerText()), 'Linked from Tor stays');
  check(tag, (await ana.locator('[data-action="picture"], [data-action="avatar-picture"], [data-action="add-field"]').count()) === 0, 'nothing on it changes it');
  check(tag, (await ana.getByRole('button', { name: 'Keep for tonight' }).count()) === 1, "Keep for tonight stays (this phone's own list)");
  await shot('ana');

  // Tor's page, the control: a whole Character shows its fields and no known-of line.
  await page.goto(`${BASE}/?tor#/w/${WID}/e/${TOR}`);
  await page.waitForSelector('[data-screen="element"] h1', { timeout: 15000 });
  await page.waitForTimeout(400);
  const tor = page.locator('[data-screen="element"]');
  check(tag, (await tor.locator('.frow[data-field]').count()) >= 2, `Tor shows his fields (${await tor.locator('.frow[data-field]').count()})`);
  check(tag, (await tor.locator('[data-part="known-of"]').count()) === 0, 'and no known-of line');
  await shot('tor');

  check(tag, !asked.some((a) => a.includes(`/${ANA}/files`)), `no files asked for Ana (${asked.filter((a) => a.includes('/files')).join(', ') || 'none'})`);
  check(tag, asked.some((a) => a.includes(`/${TOR}/files`)), "Tor's files were asked: the control can move");
  check(tag, errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'Pixel 7', 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'iPhone 13', 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
