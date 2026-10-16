// #347 live: one scratch Character written to W11 (keel's probe-write world, never Hyperion) by a
// client that declares itself an agent (SDK `agent: true`, keel records `changed_via: declared`),
// then read on live Lantern: the quiet line under its kind; a person's element shows none. The
// scratch element is deleted at the end, whatever happened. Keys never reach a screenshot or a log.
//   OW_PIN_FILE=... node walk/live-agentmark.mjs   (LANTERN_URL defaults to the live host)
import './guard.mjs';
import { chromium, devices } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { OwV2Client } from '@onlyworlds/sdk';
import { WRITE_WORLD_KEY } from './live-world.mjs';

const BASE = process.env.LANTERN_URL ?? 'https://lantern.onlyworlds.com';
const KEY = process.env.OW_WRITE_KEY ?? WRITE_WORLD_KEY;
const PIN = readFileSync(process.env.OW_PIN_FILE, 'utf8').trim();
if (!KEY || !PIN) throw new Error('OW_WRITE_KEY and OW_PIN_FILE are needed');
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const agent = new OwV2Client({ apiKey: KEY, apiPin: PIN, agent: true });
const person = new OwV2Client({ apiKey: KEY, apiPin: PIN });
let failures = 0;
const check = (ok, what) => {
  console.log(`[live] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

if (process.env.DELETE_PROBE) {
  await person.delete('character', process.env.DELETE_PROBE).catch(() => {});
  const gone = await person.get('character', process.env.DELETE_PROBE).then(() => false, (e) => e?.status === 404);
  check(gone, 'the kept probe is deleted (404 after)');
  process.exit(failures ? 1 : 0);
}

let made = null;
let browser = null;
try {
  made = await agent.create('character', { name: 'Agent mark probe, delete me', description: 'A scratch element from #347\'s live walk.' });
  const back = await person.get('character', made.id);
  check(back.changed_via === 'declared', `keel recorded the declared door (${back.changed_via})`);
  const page1 = await person.list('character', { limit: 50 });
  const theirs = (page1.data ?? []).find((e) => e.id !== made.id && e.changed_via !== 'seat' && e.changed_via !== 'mcp' && e.changed_via !== 'declared');
  check(Boolean(theirs), `a person's element to compare (door ${String(theirs?.changed_via)})`);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/key`);
  await page.locator('input[aria-label="World key"]').tap();
  await page.locator('input[aria-label="World key"]').fill(KEY);
  await page.locator('input[aria-label="PIN"]').fill(PIN);
  await page.getByRole('button', { name: 'Open the world' }).tap();
  await page.waitForSelector('.type-tile', { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 90000 });
  const wid = await page.evaluate(() => location.hash.match(/#\/w\/([^/?]+)/)?.[1]);
  const mark = page.locator('[data-screen="element"] [data-role="agent-mark"]');
  await page.goto(`${BASE}/#/w/${wid}/e/${made.id}`);
  await page.waitForSelector('[data-screen="element"] .el-head', { timeout: 30000 });
  await page.waitForSelector('[data-screen="element"] [data-role="agent-mark"]', { timeout: 10000 }).catch(() => {});
  check((await mark.textContent().catch(() => '')) === 'Last changed by an agent (the tool said so)', 'Lantern live: the declared write is marked');
  await page.screenshot({ path: `${OUT}/live-agentmark-01-declared.png` });
  if (theirs) {
    await page.goto(`${BASE}/#/w/${wid}/e/${theirs.id}`);
    await page.waitForSelector('[data-screen="element"] .el-head', { timeout: 30000 });
    await page.waitForTimeout(800);
    check((await mark.count()) === 0, "Lantern live: a person's element is not");
  }
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  console.log(`[live] the probe's id, for Atlas's half: ${made.id}`);
  if (process.env.KEEP_PROBE) {
    console.log('[live] KEEP_PROBE set: the probe stays for Atlas, delete it with DELETE_PROBE=<id>');
    made = null;
  }
} finally {
  if (browser) await browser.close();
  if (made) {
    await person.delete('character', made.id).catch((e) => console.log('[live] delete failed:', e?.message));
    const gone = await person.get('character', made.id).then(() => false, (e) => e?.status === 404);
    check(gone, 'the probe is deleted (404 after)');
  }
}
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
