// Signing out on a shared phone (the security pass, F2): Sign out keeps the
// worlds as before; "Sign out and remove your worlds" removes the account's (the records with a role)
// after a second tap that says what goes with them, and keeps a world opened with someone's key.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/signout.mjs [webkit|chromium]
import './guard.mjs';
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

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const zipOf = (id, name) =>
  Buffer.from(
    writeWorldFile(
      [
        { path: 'world.json', data: enc({ id, name }) },
        { path: `elements/character/ada--${id.slice(-8)}.json`, data: enc({ id: `${id.slice(0, 24)}aaaaaaaaaaaa`, name: 'Ada' }) },
      ],
      name,
    ),
  );
const MINE = '0f0f0f0f-0000-4000-8000-0000000000a1';
const LENT = '0f0f0f0f-0000-4000-8000-0000000000b2';

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // keel never reached: the fake token would be refused, and nothing here needs it.
  await page.route('**/api/v2/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  // A world leaving the phone takes back the key Lantern made for it (keel's DELETE, 204).
  const keyDeletes = [];
  await page.route(/\/api\/v2\/account\/worlds\/[^/]+\/keys\/[^/]+$/, (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback();
    keyDeletes.push(new URL(r.request().url()).pathname.replace('/api/v2', ''));
    return r.fulfill({ status: 204, body: '' });
  });

  for (const [id, name] of [[MINE, 'My world'], [LENT, 'Lent world']]) {
    await page.goto(`${BASE}/#/worlds`);
    await page.waitForSelector('input[aria-label="A world file"]', { state: 'attached' });
    await page.locator('input[aria-label="A world file"]').setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zipOf(id, name) });
    await page.waitForSelector('[data-screen="home"]', { timeout: 30000 });
  }
  // One is the account's (a role, a key minted for it), one was opened with a key someone gave; one change waits.
  await page.evaluate(
    ([mine, lent]) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction(['worlds', 'kv'], 'readwrite');
          const st = t.objectStore('worlds');
          const a = st.get(mine);
          // The key Lantern made for it, with the id kept at its mint (its last eight beside the id).
          a.onsuccess = () => st.put({ ...a.result, kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'm'.repeat(30), keyKind: 'write', keyMint: { id: '0f0f0f0f-0000-4000-8000-00000000c0de', tail: 'm'.repeat(8) } });
          const b = st.get(lent);
          b.onsuccess = () => st.put({ ...b.result, kind: 'online', apiKey: 'ow_r_' + 'l'.repeat(30), keyKind: 'read' });
          t.objectStore('kv').put('ow_a_' + 'w'.repeat(40), 'accountToken');
          t.oncomplete = () => {
            const w = indexedDB.open(`lantern-world-${mine}`);
            w.onsuccess = () => {
              const o = w.result.transaction('outbox', 'readwrite');
              o.objectStore('outbox').put({ op: 'patch', type: 'character', id: 'x', values: { name: 'B' }, state: 'waiting' });
              o.oncomplete = () => {
                w.result.close(); // an open connection would block the delete under test
                res(true);
              };
            };
          };
          t.onerror = () => rej(t.error);
        };
      }),
    [MINE, LENT],
  );

  await page.goto(`${BASE}/#/settings`);
  const btn = page.locator('[data-action=sign-out-remove]');
  await btn.waitFor();
  check(tag, /remove your 1 world from this phone/.test(await btn.innerText()), `the offer counts the account's worlds only (${JSON.stringify(await btn.innerText())})`);
  await btn.tap();
  check(tag, /1 change not sent yet go with them\. Tap again\./.test(await btn.innerText()), `the first tap says what goes with them (${JSON.stringify(await btn.innerText())})`);
  await page.locator('main').screenshot({ path: `${OUT}/signout-${tag}-01-armed.png` });
  await btn.tap();
  await page.waitForFunction(() => !document.querySelector('[data-action=sign-out-remove]'));
  const left = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction(['worlds', 'kv']);
          const all = t.objectStore('worlds').getAll();
          const tok = t.objectStore('kv').get('accountToken');
          t.oncomplete = () => res({ worlds: all.result.map((w) => w.name), token: tok.result ?? null });
        };
      }),
  );
  check(tag, JSON.stringify(left) === JSON.stringify({ worlds: ['Lent world'], token: null }), `signed out, the account's world gone, the lent one kept (${JSON.stringify(left)})`);
  const gone = await page.evaluate((id) => indexedDB.databases?.().then((ds) => ds.some((d) => d.name === `lantern-world-${id}`)) ?? 'unknown', MINE);
  check(tag, gone === false || gone === 'unknown', `its copy and outbox are gone too (${gone})`);
  check(
    tag,
    JSON.stringify(keyDeletes) === JSON.stringify([`/account/worlds/${MINE}/keys/0f0f0f0f-0000-4000-8000-00000000c0de`]),
    `the key Lantern made for it is taken back by its id, and nothing of the lent world (${JSON.stringify(keyDeletes)})`,
  );
  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

if (only !== 'webkit') await walk(chromium, 'chromium');
if (only !== 'chromium') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
