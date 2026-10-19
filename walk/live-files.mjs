// S435: Lantern's Files on live keel, as a Pixel 7 taps it. One throwaway world on crew-walk-b with two
// Characters; a file added to one through the SDK (as Atlas adds it). Lantern opens the world with its
// key and PIN. Checks: the Character with no file shows no Files (the control); the one with a file
// lists it (label, name, the line); Download hands the browser the same bytes.
// Credentials from CREW_FILE, never printed; STATE (session scratch) keeps the world and the token for
// the teardown (Forge/tools/atlas/Notes/ui-snapshots/2026-10-19-s435/teardown.mjs).
// Run: CREW_FILE=<file> STATE=<json> LANTERN_URL=https://lantern.onlyworlds.com node walk/live-files.mjs
import './guard.mjs';
import { chromium, devices } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';
import fs from 'node:fs';

const API = 'https://www.onlyworlds.com/api/v2';
const BASE = process.env.LANTERN_URL ?? 'https://lantern.onlyworlds.com';
const OUT = 'walk/shots';
fs.mkdirSync(OUT, { recursive: true });
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [email, password] = lines.find((l) => l.startsWith('crew-walk-b ') && l.includes('@')).trim().split(/\s+/).slice(1);
const pin = lines.find((l) => /^crew-walk-b PIN /i.test(l))?.trim().split(/\s+/)[2];
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const signed = await new OwV2Client({}).signInWithPassword({ email, password, tokenName: 'S435 Lantern files walk (crew-walk-b)' });
const state = { b: { token: signed.token, id: signed.id }, name: 'S435 Lantern files walk (throwaway)' };
fs.writeFileSync(process.env.STATE, JSON.stringify(state));
const a0 = { Authorization: `Bearer ${signed.token}`, 'Content-Type': 'application/json' };
let res = await fetch(`${API}/account/worlds`, { method: 'POST', headers: a0, body: JSON.stringify({ name: state.name }) });
if (res.status === 422) res = await fetch(`${API}/account/worlds`, { method: 'POST', headers: a0, body: JSON.stringify({ name: state.name, pin }) });
const made = await res.json();
state.worldId = made.id;
fs.writeFileSync(process.env.STATE, JSON.stringify(state));
const wk = { 'API-Key': made.key, 'API-Pin': pin, 'Content-Type': 'application/json' };
const make = async (name) => (await (await fetch(`${API}/character`, { method: 'POST', headers: wk, body: JSON.stringify({ name }) })).json()).id;
const kid = await make('The Kid');
const holden = await make('Judge Holden');
const TEXT = '# The Kid\n\nBorn 1833, the year of the Leonid shower.\n'.repeat(40);
const owner = new OwV2Client({ apiKey: made.key, apiPin: pin, baseUrl: API });
await owner.uploadFile('character', kid, new Blob([TEXT]), { name: 'kid-notes.md', label: 'Background' });
console.log('setup: world', made.id.slice(0, 8), 'with The Kid (one file) and Judge Holden (none)');

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/key`);
  await page.locator('input[aria-label="World key"]').tap();
  await page.locator('input[aria-label="World key"]').fill(made.key);
  await page.locator('input[aria-label="PIN"]').fill(pin);
  await page.getByRole('button', { name: 'Open the world' }).tap();
  await page.waitForSelector('.type-tile', { timeout: 90000 });
  const wid = await page.evaluate(() => location.hash.match(/#\/w\/([^/?]+)/)?.[1]);
  const section = page.locator('[data-screen="element"] [data-section="files"]');
  const open = async (id) => {
    await page.goto(`${BASE}/#/w/${wid}/e/${id}`);
    await page.waitForSelector('[data-screen="element"] .el-head', { timeout: 30000 });
  };
  await open(holden);
  await page.waitForTimeout(3000);
  check((await section.count()) === 0, 'the control: Judge Holden has no file and no Files');
  await open(kid);
  await section.waitFor({ timeout: 15000 }).catch(() => {});
  const row = section.locator('[data-file-id]');
  const text = ((await row.first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  check((await row.count()) === 1 && /^Background/.test(text) && new RegExp(`md · ${Math.round(Buffer.byteLength(TEXT) / 1024)} KB · added by crew-walk-b · \\d{4}-\\d{2}-\\d{2}`).test(text), `The Kid's file: "${text}"`);
  await row.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/live-files-01.png` });
  const dl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await row.first().locator('[data-action="download-file"]').tap();
  const got = await dl;
  let same = false;
  if (got) {
    const p = `${OUT}/live-files-downloaded.md`;
    await got.saveAs(p);
    same = fs.readFileSync(p, 'utf8') === TEXT;
  }
  check(same, `Download hands the browser the same bytes (${got ? got.suggestedFilename() : 'no download'})`);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
