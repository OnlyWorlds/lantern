// The journey's storyboard frames on onlyworlds.com (#388): the owner's Access pane, where a member
// is taken out (L13's setup, L18). The owner's phone (crew-walk-b, standing in for the Captain) as a
// persistent profile beside frames.mjs's two.
//
//   CREW_FILE=<crew accounts file> FRAMES_STATE=<scratch dir> node walk/frames-site.mjs <stage> [frame id]
// Stages: probe (the Access pane's members, printed), remove <frame id> (removes crew-walk-a).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://www.onlyworlds.com';
const OUT = process.env.LANTERN_SHOTS ?? path.join(os.homedir(), 'Carrier/Media/journey-walks/2026-10-18-lantern-shots');
const STATE_DIR = process.env.FRAMES_STATE;
const state = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'state.json'), 'utf8'));
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const password = lines.find((l) => l.startsWith('crew-walk-b ') && l.includes('@')).trim().split(/\s+/)[2];

const ctx = await chromium.launchPersistentContext(path.join(STATE_DIR, 'owner-site'), {
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('dialog', (d) => d.accept());
const WURL = `${BASE}/account/worlds/${state.worldId}`;

let r = await page.goto(WURL, { waitUntil: 'load' });
if (page.url().includes('/accounts/login')) {
  await page.evaluate(() => localStorage.setItem('cookieNoticeAccepted', 'true'));
  await page.locator('input[name=login]').fill('crew-walk-b');
  await page.locator('input[name=password]').fill(password);
  await page.locator('form button[type=submit], form input[type=submit]').filter({ hasText: /sign in|log in/i }).first().click();
  await page.waitForLoadState('load');
  r = await page.goto(WURL, { waitUntil: 'load' });
}
await page.evaluate(() => localStorage.setItem('cookieNoticeAccepted', 'true'));
console.log('world page', r?.status(), page.url());
const access = async () => {
  await page.locator('a[data-pane=access]').first().click();
  await page.waitForTimeout(500);
  await page.locator('#members').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
};
await access();

const stage = process.argv[2];
if (stage === 'probe') {
  console.log((await page.locator('#members').innerText()).slice(0, 1500));
  console.log((await page.locator('#members').innerHTML()).replace(/\s+/g, ' ').slice(0, 3000));
  await page.screenshot({ path: path.join(STATE_DIR, 'probe-members.png') });
} else if (stage === 'remove') {
  const id = process.argv[3];
  const row = page.locator('#members tbody tr', { hasText: 'crew-walk-a' }).first();
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'extra', `${id}-before.png`) });
  await row.getByRole('button', { name: /remove/i }).first().click();
  await page.waitForLoadState('load');
  await access();
  await page.screenshot({ path: path.join(OUT, id.startsWith('l') && !id.includes('-') ? `${id}.png` : path.join('extra', `${id}.png`)) });
  console.log('after:', (await page.locator('#members').innerText()).slice(0, 800));
}
await ctx.close();
