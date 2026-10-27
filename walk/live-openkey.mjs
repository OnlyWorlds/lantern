// Open with a key, on a live host: a write key with a wrong PIN is refused before the world is kept.
// The key comes from a JSON file ({ "key": "ow_w_..." }) named by OPENKEY_FILE, never printed; the PIN
// tried is one the key's seat does not hold. Nothing is written to the world.
//   OPENKEY_FILE=<path> node walk/live-openkey.mjs <base url> [chromium|firefox] [--expect-old]
// --expect-old: the build before the fix, where the wrong PIN opens the world (the control).
import { chromium, firefox } from 'playwright';
import { readFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'https://lantern.onlyworlds.com').replace(/\/$/, '');
const engine = process.argv[3] === 'firefox' ? firefox : chromium;
const expectOld = process.argv.includes('--expect-old');
const key = JSON.parse(readFileSync(process.env.OPENKEY_FILE, 'utf8')).key;
if (!/^ow_w_/.test(key)) throw new Error('OPENKEY_FILE must hold a write key (ow_w_)');
const WRONG = '0000';

const watchdog = setTimeout(() => { console.log('FAIL the walk hung past 90 s'); process.exit(2); }, 90_000);
const browser = await engine.launch();
let ok = false;
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const v = await (await page.request.get(`${base}/version.json`, { timeout: 15000 })).json().catch(() => ({}));
  await page.goto(`${base}/#/key`, { timeout: 30000 });
  await page.getByLabel('World key').fill(key);
  await page.getByLabel('PIN').fill(WRONG);
  await page.getByRole('button', { name: 'Open the world' }).click();
  // Either the form says the PIN is wrong, or the world opens (the hash moves to #/w/...).
  const outcome = await Promise.race([
    page.getByText('That PIN does not open this world.').waitFor({ timeout: 20000 }).then(() => 'refused'),
    page.waitForURL(/#\/w\//, { timeout: 20000 }).then(() => 'opened'),
  ]).catch(() => 'no answer');
  const kept = await page.evaluate(() => Object.keys(localStorage).filter(k => /pin/i.test(k)).length);
  console.log(`${base} version ${v.build ?? "?"}: a wrong PIN ${outcome}; PIN entries kept: ${kept}`);
  ok = expectOld ? outcome === 'opened' : outcome === 'refused' && page.url().endsWith('#/key');
  console.log(ok ? (expectOld ? 'ok   the old build opens with a wrong PIN (control red as expected)' : 'ok   a wrong PIN is refused and the world is not opened') : 'FAIL');
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
process.exit(ok ? 0 : 1);
