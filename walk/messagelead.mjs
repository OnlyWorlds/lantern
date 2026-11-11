// A message's words lead: a world file holding a Message and a plain story opens on this phone;
// on the Message the story row stands first among the rows (before the kind rows and the
// narrative's other fields), on the plain story it keeps the schema's place.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/messagelead.mjs [webkit|chromium]
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

const wid = '0f0f0f0f-0000-4000-8000-0000000e5501';
const msg = 'e5501000-0000-4000-8000-000000000001';
const saga = 'e5501000-0000-4000-8000-000000000002';
const kit = 'e5501000-0000-4000-8000-000000000003';
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: wid, name: 'Message walk' }) },
      { path: 'elements/character/kit--00000003.json', data: enc({ id: kit, name: 'Kit' }) },
      {
        path: 'elements/narrative/msg--00000001.json',
        data: enc({ id: msg, name: 'Re: the tide tables', supertype: 'Message', description: 'About the tide tables', story: 'The tables are wrong for the spring tides. Check them before Friday.', narrator: kit, characters: [] }),
      },
      {
        path: 'elements/narrative/saga--00000002.json',
        data: enc({ id: saga, name: 'The long crossing', supertype: 'Saga', description: 'A tale', story: 'Once, a ferry crossed in the dark.', narrator: kit }),
      },
    ],
    'message-walk',
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
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'message-walk.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  const fields = () => page.$$eval('main .frow[data-field]', (rs) => rs.map((r) => r.getAttribute('data-field')));

  await page.goto(`${BASE}/#/w/${wid}/e/${msg}`);
  await page.waitForSelector('main .frow[data-field=story]');
  const m = await fields();
  check(tag, m[0] === 'story', `on a message the story is the first row (${JSON.stringify(m)})`);
  check(tag, m.includes('supertype') && m.indexOf('supertype') > m.indexOf('story'), 'the kind rows follow the story');
  await page.locator('main').screenshot({ path: `${OUT}/messagelead-${tag}-01-message.png` });

  await page.goto(`${BASE}/#/w/${wid}/e/${saga}`);
  await page.waitForSelector('main .frow[data-field=story]');
  const s = await fields();
  check(tag, s[0] === 'supertype' && s.indexOf('story') > 0, `a plain story keeps the schema's place (${JSON.stringify(s)})`);

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'webkit');
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
