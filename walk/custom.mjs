// Custom fields (h37 #4050): a world file whose Character carries Atlas's custom fields (x_mood and
// the rest) opens on this phone; they read under "Your fields", Atlas's machinery (atlas_) never shows,
// text and numbers change from their row, a list reads only, find finds them, nothing spills at 320.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/custom.mjs [webkit|chromium]
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

const wid = '0f0f0f0f-0000-4000-8000-0000000c0570';
const ada = 'c0570000-0000-4000-8000-000000000001';
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const zip = Buffer.from(
  writeWorldFile(
    [
      { path: 'world.json', data: enc({ id: wid, name: 'Custom walk' }) },
      {
        path: 'elements/character/ada--00000001.json',
        data: enc({
          id: ada,
          name: 'Ada',
          description: 'A ferrywoman.',
          x_mood: 'grim',
          x_height_cm: 172,
          x_tags: ['harbour', 'night'],
          x_oath: 'Never to cross the river after dark, whatever the fare, whoever asks.',
          x_blank: '',
          x_gone: null,
          atlas_aliases: ['The ferrywoman'],
          physicality: 'Broad hands, a boatman’s back.',
        }),
      },
      // A second Character whose own field's name is offered when adding one to Ada.
      { path: 'elements/character/bo--00000002.json', data: enc({ id: 'c0570000-0000-4000-8000-000000000002', name: 'Bo', x_rank: 'Bosun' }) },
    ],
    'custom-walk',
  ),
);

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
  await page.locator('input[aria-label="A world file"]').setInputFiles({ name: 'custom-walk.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  await page.goto(`${BASE}/#/w/${wid}/e/${ada}`);
  await page.waitForSelector('[data-section=custom]');

  const rows = () =>
    page.$$eval('[data-section=custom] .frow', (rs) => rs.map((r) => [r.getAttribute('data-field'), r.querySelector('.k')?.textContent, r.querySelector('.v')?.textContent]));
  const got = await rows();
  check(tag, (await page.locator('.section-label', { hasText: 'Your fields' }).count()) === 1, 'the custom fields sit under "Your fields"');
  check(
    tag,
    JSON.stringify(got.map((r) => r[0])) === JSON.stringify(['x_height_cm', 'x_mood', 'x_oath', 'x_tags']),
    `the four with a value, by label (${JSON.stringify(got)})`,
  );
  check(tag, got.some((r) => r[1] === 'Height cm' && r[2] === '172') && got.some((r) => r[1] === 'Tags' && r[2] === 'harbour, night'), 'named without the prefix; a list reads as one line');
  const text = await page.locator('main').innerText();
  check(tag, !/ferrywoman/i.test(text.replace('A ferrywoman.', '')) && !/aliases|Gone/i.test(text), "Atlas's machinery (atlas_aliases) and a deleted field (null) never show");
  await page.locator('main').screenshot({ path: `${OUT}/custom-${tag}-01-page.png` });

  // Text: the row opens the sheet; the value changes on screen.
  await page.locator('.frow[data-field=x_mood]').tap();
  await page.waitForSelector('.sheet textarea');
  await page.locator('.sheet textarea').fill('hopeful');
  await page.locator('.sheet').getByRole('button', { name: 'Save' }).tap();
  await page.waitForFunction(() => document.querySelector('.frow[data-field=x_mood] .v')?.textContent === 'hopeful');
  check(tag, true, 'a text field changes from its row');

  // A number stays a number, and may have a point.
  await page.locator('.frow[data-field=x_height_cm]').tap();
  await page.waitForSelector('.sheet input[type=number]');
  await page.locator('.sheet input[type=number]').fill('172.5');
  await page.locator('.sheet').getByRole('button', { name: 'Save' }).tap();
  await page.waitForFunction(() => document.querySelector('.frow[data-field=x_height_cm] .v')?.textContent === '172.5');
  const stored = await page.evaluate(
    ([w, id]) =>
      new Promise((res) => {
        const r = indexedDB.open(`lantern-world-${w}`);
        r.onsuccess = () => {
          try {
            const t = r.result.transaction('elements').objectStore('elements').get(id);
            t.onsuccess = () => res(t.result ? typeof t.result.x_height_cm + ':' + t.result.x_height_cm : 'none');
            t.onerror = () => res('error');
          } catch (e) {
            res('no store: ' + e.message);
          }
        };
        r.onerror = () => res('no db');
      }),
    [wid, ada],
  );
  check(tag, stored === 'number:172.5', `a number field changes from its row and stays a number (stored: ${stored})`);

  // A list reads only: its row opens nothing.
  await page.locator('.frow[data-field=x_tags]').tap();
  await page.waitForTimeout(400);
  check(tag, (await page.locator('.sheet').count()) === 0, 'a list opens no sheet');

  // The empty one waits with the empty fields, and is filled from there.
  const toggle = page.getByRole('button', { name: /Show the \d+ empty fields/ });
  await toggle.tap();
  await page.waitForSelector('.frow[data-field=x_blank]');
  check(tag, (await page.locator('.frow[data-field=x_blank] .k').innerText()) === 'Blank', 'an empty custom field waits with the empty fields');

  // Nothing runs out of the page at 320.
  await page.setViewportSize({ width: 320, height: 780 });
  const spill = await page.evaluate(() => [...document.querySelectorAll('[data-section=custom] *')].filter((n) => n.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length);
  check(tag, spill === 0, `nothing spills at 320 (${spill})`);
  await page.locator('main').screenshot({ path: `${OUT}/custom-${tag}-02-320.png` });
  await page.setViewportSize({ width: 360, height: 780 });

  // Find finds a word that lives only in a custom field.
  await page.goto(`${BASE}/#/w/${wid}`);
  await page.waitForSelector('[data-screen="home"] input[type=search]');
  await page.locator('[data-screen="home"] input[type=search]').fill('whoever');
  await page.waitForSelector('.results .el-row');
  const hit = await page.locator('.results').innerText();
  check(tag, /Ada/.test(hit) && /in your fields/.test(hit), `find reaches a custom field (${JSON.stringify(hit)})`);

  // Step 2 (h37 #4061): add a field of your own, remove one, and the setting for which fields show.
  const storedOf = (field) =>
    page.evaluate(
      ([w, id, f]) =>
        new Promise((res) => {
          const r = indexedDB.open(`lantern-world-${w}`);
          r.onsuccess = () => {
            const t = r.result.transaction('elements').objectStore('elements').get(id);
            t.onsuccess = () => res(t.result ? JSON.stringify(f in t.result ? t.result[f] : 'absent') : 'none');
          };
        }),
      [wid, ada, field],
    );
  await page.goto(`${BASE}/#/w/${wid}/e/${ada}`);
  await page.waitForSelector('[data-action=add-field]');
  await page.locator('[data-action=add-field]').tap();
  await page.waitForSelector('.sheet input[aria-label="Field name"]');
  const offered = await page.$$eval('.sheet datalist option', (os) => os.map((o) => o.value));
  check(tag, JSON.stringify(offered) === JSON.stringify(['Rank']), `the world's own names are offered, not this one's (${JSON.stringify(offered)})`);
  await page.locator('.sheet input[aria-label="Field name"]').fill('Height');
  await page.locator('.sheet').getByRole('button', { name: 'Add' }).tap();
  const said = await page.locator('.sheet .error').innerText();
  check(tag, /already a field of every Character/.test(said), `a name the type already has is refused (${JSON.stringify(said)})`);
  await page.locator('.sheet input[aria-label="Field name"]').fill('Eye colour');
  await page.locator('.sheet textarea[aria-label="Value"]').fill('grey');
  await page.locator('.sheet').getByRole('button', { name: 'Add' }).tap();
  await page.waitForSelector('.frow[data-field=x_eye_colour]');
  check(tag, (await page.locator('.frow[data-field=x_eye_colour] .v').innerText()) === 'grey' && (await storedOf('x_eye_colour')) === '"grey"', 'a new field is stored as Atlas would name it (x_eye_colour)');
  await page.locator('[data-section=custom]').screenshot({ path: `${OUT}/custom-${tag}-03-added.png` });

  await page.locator('.frow[data-field=x_mood]').tap();
  await page.waitForSelector('.sheet [data-action=remove-field]');
  await page.locator('.sheet [data-action=remove-field]').tap();
  check(tag, (await page.locator('.sheet').count()) === 1 && /and its value/.test(await page.locator('.sheet [data-action=remove-field]').innerText()), 'the first tap on Remove asks');
  await page.locator('.sheet [data-action=remove-field]').tap();
  await page.waitForFunction(() => !document.querySelector('.frow[data-field=x_mood]'));
  check(tag, (await storedOf('x_mood')) === 'null', `the second removes it, as an explicit null (${await storedOf('x_mood')})`);

  // Yours: the type's fields wait behind the toggle; your own show.
  await page.goto(`${BASE}/#/settings`);
  await page.locator('[data-fields=own]').tap();
  await page.goto(`${BASE}/#/w/${wid}/e/${ada}`);
  await page.waitForSelector('[data-section=custom]');
  check(tag, (await page.locator('.frow[data-field=physicality]').count()) === 0 && (await page.locator('.frow[data-field=x_blank]').count()) === 1, "Yours: the type's fields hidden, your empty one showing");
  const tog = page.locator('[data-action=toggle-fields]');
  check(tag, /Show the Character's \d+ fields/.test(await tog.innerText()), `the toggle names what it holds (${JSON.stringify(await tog.innerText())})`);
  await tog.tap();
  await page.waitForSelector('.frow[data-field=physicality]');
  check(tag, true, "the toggle brings the type's fields back");
  // All: the empty ones show from the start.
  await page.goto(`${BASE}/#/settings`);
  await page.locator('[data-fields=all]').tap();
  await page.goto(`${BASE}/#/w/${wid}/e/${ada}`);
  await page.waitForSelector('[data-section=custom]');
  check(tag, (await page.locator('.frow[data-field=height]').count()) === 1, 'All: an empty field shows at once');
  await page.goto(`${BASE}/#/settings`);
  await page.locator('[data-fields=filled]').tap();
  await page.locator('main').screenshot({ path: `${OUT}/custom-${tag}-04-settings.png` });

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'chromium');
if (only !== 'chromium') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
