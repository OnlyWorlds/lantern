// The journey's storyboard frames (#388, Seethe's contract h57 #6785, #6788): one PNG per step of
// Forge/Notes/2026-10-15-journey-lantern.md, shot on the live lantern.onlyworlds.com with the crew
// accounts, b standing in for the Captain (the owner) and a for the friend. Each phone is a
// persistent profile, so a stage can be run again without the ones before it.
//
// Run from tools/lantern, one stage at a time:
//   CREW_FILE=<crew accounts file> FRAMES_STATE=<scratch dir> node walk/frames.mjs <stage>
// Stages: owner-in (L1-L3), owner-read (L4), owner-write (L5, L6, L19, L7), invite (L8),
//   friend-in (L9-L11), friend-note (L12), player (L13), party (L14), give (L15), share (L16),
//   refuse (L17). The site's member removals (L13, L18) are frames-site.mjs.
// Credentials are read from CREW_FILE and never printed.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const SITE = process.env.LANTERN_URL ?? 'https://lantern.onlyworlds.com';
const OUT = 'C:/Users/Titus/Carrier/Media/journey-walks/2026-10-18-lantern-shots';
const EXTRA = path.join(OUT, 'extra');
const STATE_DIR = process.env.FRAMES_STATE;
if (!STATE_DIR) throw new Error('FRAMES_STATE is the scratch dir for the two phones');
fs.mkdirSync(EXTRA, { recursive: true });
const stateFile = path.join(STATE_DIR, 'state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
function creds(acct) {
  const [, email, password] = lines.find((l) => l.startsWith(`${acct} `) && l.includes('@')).trim().split(/\s+/);
  const pin = lines.find((l) => l.startsWith(`${acct} PIN`)).trim().split(/\s+/)[2];
  return { email, password, pin };
}
const OWNER = 'crew-walk-b';
const FRIEND = 'crew-walk-a';

async function phone(who) {
  const ctx = await chromium.launchPersistentContext(path.join(STATE_DIR, who), {
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => console.log(`[${who}] page error:`, String(e)));
  return { ctx, page };
}
const frame = async (page, id) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${id}.png`) });
  console.log('frame', id);
};
const extra = async (page, name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(EXTRA, `${name}.png`) });
  console.log('extra', name);
};
const settle = async (page, ms = 1500) => page.waitForTimeout(ms);
async function signIn(page, acct) {
  const c = creds(acct);
  await page.fill('input[aria-label="Email or username"]', c.email);
  await page.fill('input[aria-label="Password"]', c.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).tap();
}
async function enterPinIfAsked(page, acct) {
  const pin = page.locator('input[aria-label="PIN"]:visible');
  if (await pin.count()) {
    await pin.first().fill(creds(acct).pin);
    await pin.first().press('Enter');
    await settle(page, 2500);
    return true;
  }
  return false;
}

const stages = {
  // L1 the first screen and L9 the sign-in screen's "No account yet?", on a phone that never signed in.
  async stranger() {
    const { ctx, page } = await phone('stranger');
    await page.goto(SITE);
    await page.waitForSelector('[data-screen]');
    await settle(page, 2000);
    await frame(page, 'l1');
    await page.goto(`${SITE}/#/signin`);
    await page.waitForSelector('[data-part="no-account"]');
    await frame(page, 'l9');
    await ctx.close();
  },
  // L2 signed in (Your worlds), L3 the world open.
  async 'owner-in'() {
    const { ctx, page } = await phone('owner');
    await page.goto(`${SITE}/#/signin`);
    await page.waitForSelector('input[aria-label="Email or username"]');
    await signIn(page, OWNER);
    await page.waitForSelector('[data-screen="worlds"]', { timeout: 30000 });
    await settle(page, 2500);
    await frame(page, 'l2');
    await page.getByText('Blood Meridian', { exact: true }).first().tap();
    await page.waitForFunction(() => location.hash.startsWith('#/w/'), null, { timeout: 30000 });
    state.worldId = (await page.evaluate(() => location.hash)).split('/')[2];
    console.log('world', state.worldId);
    await extra(page, 'l3-fetching');
    await page.waitForFunction(() => !document.body.innerText.includes('Fetching the world'), null, { timeout: 120000 }).catch(() => console.log('still fetching after 120 s'));
    await settle(page, 2000);
    await frame(page, 'l3');
    await ctx.close();
  },
  // L4 find the Judge, read him, follow a link; a place shown on the map.
  async 'owner-read'() {
    const { ctx, page } = await phone('owner');
    await page.goto(`${SITE}/#/w/${state.worldId}`);
    const search = page.locator('input[type="search"]').first();
    await search.waitFor();
    await search.tap();
    await search.pressSequentially('Judge', { delay: 80 });
    await settle(page, 1200);
    await extra(page, 'l4-search');
    await page.locator('.el-row', { hasText: 'Judge Holden' }).first().tap();
    await page.waitForSelector('.el-head h1');
    await settle(page);
    await frame(page, 'l4');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await extra(page, 'l4-judge-fields');
    await page.locator('.link-chip').first().tap();
    await page.waitForSelector('.el-head h1');
    await extra(page, 'l4-followed');
    await ctx.close();
  },
  async 'owner-map'() {
    const { ctx, page } = await phone('owner');
    await page.goto(`${SITE}/#/w/${state.worldId}`);
    const search = page.locator('input[type="search"]').first();
    await search.waitFor();
    await search.fill('Yuma');
    await settle(page, 1000);
    await page.locator('.el-row', { hasText: 'The Yuma Crossing' }).first().tap();
    await page.waitForSelector('.el-head h1');
    await extra(page, 'l4-yuma');
    await page.getByText('Show on map').first().tap();
    await page.waitForSelector('.leaflet-container', { timeout: 30000 });
    await settle(page, 4000);
    await extra(page, 'l4-map');
    await ctx.close();
  },
  // L5 a change saved with no signal, L6 a note to Unsorted, L19 Bartlett from the record, L7 Before now.
  async 'owner-write'() {
    const { ctx, page } = await phone('owner');
    await page.goto(`${SITE}/#/w/${state.worldId}`);
    const search = page.locator('input[type="search"]').first();
    await search.waitFor();
    await search.fill('Judge Holden');
    await settle(page, 1000);
    await page.locator('.el-row', { hasText: 'Judge Holden' }).first().tap();
    await page.waitForSelector('.el-head h1');
    await settle(page);
    await ctx.setOffline(true);
    await page.locator('.frow[data-field=supertype]').tap();
    const input = page.locator('.sheet input, .sheet textarea').first();
    await input.waitFor();
    await input.fill('Scalp hunter and judge');
    await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).tap();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, 'l5.png') });
    console.log('frame l5');
    await settle(page, 2500);
    await extra(page, 'l5-offline-after');
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await settle(page, 6000);
    await extra(page, 'l5-sent');

    await page.locator('.tabbar [data-tab=catch]').tap();
    await page.locator('textarea').waitFor();
    await page.locator('textarea').fill('The ferryman at the Yuma crossing owes the Judge a debt, and will not say what for.');
    await page.locator('[data-action=catch-save]').tap();
    await page.locator('[data-action=open-kept]').waitFor({ timeout: 15000 });
    await frame(page, 'l6');

    await page.locator('textarea').fill('John Russell Bartlett\nUS Boundary Commissioner, 1850 to 1853; crossed the Gila in 1852 and painted it.');
    await page.locator('[data-kind=character]').tap();
    await page.locator('[data-action=catch-save]').tap();
    await page.waitForSelector('.el-head h1', { timeout: 15000 });
    await settle(page, 3000);
    await frame(page, 'l19');

    await page.goto(`${SITE}/#/w/${state.worldId}/time`);
    await page.waitForSelector('[data-screen="time"]');
    await settle(page, 2000);
    await frame(page, 'l7');
    await page.evaluate(() => window.scrollBy(0, 900));
    await extra(page, 'l7-scrolled');
    await page.goto(`${SITE}/#/w/${state.worldId}`);
    await settle(page, 3000);
    await extra(page, 'l7-home-after');
    await ctx.close();
  },
  // The first write's PIN, asked where the changes wait (the home's banner); then L19 and L5 again
  // with the PIN on the phone, so the frames carry no waiting mark.
  async 'owner-pin'() {
    const { ctx, page } = await phone('owner');
    await page.goto(`${SITE}/#/w/${state.worldId}`);
    const enter = page.locator('.banner').getByRole('button', { name: 'Enter PIN' });
    await enter.waitFor({ timeout: 20000 });
    await extra(page, 'pin-1-banner');
    await enter.tap();
    await page.locator('.sheet input[aria-label="PIN"]').fill(creds(OWNER).pin);
    await extra(page, 'pin-2-sheet');
    await page.locator('.sheet').getByRole('button', { name: 'Send my changes' }).tap();
    await settle(page, 6000);
    await extra(page, 'pin-3-sent');
    const search = page.locator('input[type="search"]').first();
    await search.fill('Bartlett');
    await settle(page, 1000);
    await page.locator('.el-row', { hasText: 'John Russell Bartlett' }).first().tap();
    await page.waitForSelector('.el-head h1');
    await settle(page, 2000);
    await frame(page, 'l19');
    await page.goto(`${SITE}/#/w/${state.worldId}`);
    await search.waitFor();
    await search.fill('Judge Holden');
    await settle(page, 1000);
    await page.locator('.el-row', { hasText: 'Judge Holden' }).first().tap();
    await page.waitForSelector('.el-head h1');
    await settle(page);
    await ctx.setOffline(true);
    await page.locator('.frow[data-field=supertype]').tap();
    const input = page.locator('.sheet input, .sheet textarea').first();
    await input.waitFor();
    await input.fill('Scalp hunter, the gang\'s judge');
    await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).tap();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, 'l5.png') });
    console.log('frame l5');
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await settle(page, 6000);
    await extra(page, 'l5-sent');
    await ctx.close();
  },
  // L8 (and L13's second link): the owner's Invite someone. The name typed is the Captain's, since
  // the frames stand in for his walk; the caption says so.
  async invite() {
    const role = process.argv[3] === 'player' ? 'guest' : 'contributor';
    const { ctx, page } = await phone('owner');
    await page.goto(`${SITE}/#/w/${state.worldId}`);
    const invite = page.locator('[data-action=invite]');
    await invite.waitFor({ timeout: 20000 });
    await invite.scrollIntoViewIfNeeded();
    await invite.tap();
    await page.locator(`.sheet [data-role=${role}]`).tap();
    await page.locator('.sheet input').fill('Titus');
    await extra(page, `invite-${role}-sheet`);
    await page.locator('.sheet [data-action=make-invite]').tap();
    await page.locator('.sheet [data-role=invite-link]').waitFor({ timeout: 20000 });
    await page.locator('.sheet svg.invite-qr').waitFor({ timeout: 10000 });
    state[`link_${role}`] = (await page.locator('.sheet [data-role=invite-link]').innerText()).trim();
    if (role === 'contributor') await frame(page, 'l8');
    else await extra(page, 'l13-player-link');
    await ctx.close();
  },
  // L10 the friend looks at the invite, signs in and joins; L11 the world on their phone.
  async 'friend-in'() {
    const { ctx, page } = await phone('friend');
    await page.goto(`${SITE}/#/join`);
    await page.locator('input[aria-label="Invite link"]').fill(state.link_contributor);
    await page.getByRole('button', { name: 'Look at the invite' }).tap();
    await page.getByRole('button', { name: 'Sign in to join' }).waitFor({ timeout: 20000 });
    await frame(page, 'l10');
    await page.getByRole('button', { name: 'Sign in to join' }).tap();
    await page.locator('input[aria-label="Email or username"]').waitFor();
    await signIn(page, FRIEND);
    const join = page.getByRole('button', { name: /^Join / });
    await join.waitFor({ timeout: 30000 });
    await extra(page, 'l10-signed-in');
    await join.tap();
    await page.waitForFunction(() => location.hash.startsWith('#/w/'), null, { timeout: 30000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Fetching the world'), null, { timeout: 120000 }).catch(() => console.log('still fetching'));
    await settle(page, 3000);
    await frame(page, 'l11');
    const search = page.locator('input[type="search"]').first();
    await search.fill('Judge Holden');
    await settle(page, 1000);
    await page.locator('.el-row', { hasText: 'Judge Holden' }).first().tap();
    await page.waitForSelector('.el-head h1');
    await extra(page, 'l11-judge');
    await ctx.close();
  },
  // L12 the friend catches a note; it lands in the owner's Unsorted.
  async 'friend-note'() {
    const f = await phone('friend');
    await f.page.goto(`${SITE}/#/w/${state.worldId}/capture`);
    await f.page.locator('textarea').waitFor({ timeout: 20000 });
    await f.page.locator('textarea').fill('Saw Bartlett\'s watercolour of the Gila at the fort. The river in it is wider than the one we crossed.');
    await f.page.locator('[data-action=catch-save]').tap();
    await f.page.locator('[data-action=open-kept]').waitFor({ timeout: 15000 });
    await extra(f.page, 'l12-friend-added');
    const enter = f.page.locator('[data-action=kept-pin]');
    if (await enter.count()) {
      await enter.tap();
      await f.page.locator('.sheet input[aria-label="PIN"]').fill(creds(FRIEND).pin);
      await f.page.locator('.sheet button[type=submit]').tap();
      await settle(f.page, 5000);
      await extra(f.page, 'l12-friend-sent');
    }
    await f.ctx.close();
    const o = await phone('owner');
    await o.page.goto(`${SITE}/#/w/${state.worldId}`);
    await o.page.locator('input[type="search"]').first().waitFor();
    await settle(o.page, 8000);
    await extra(o.page, 'l12-owner-home');
    await o.page.getByText(/^Unsorted · \d/).first().tap();
    await settle(o.page, 2000);
    await frame(o.page, 'l12');
    await o.ctx.close();
  },
  // L13 the friend, taken out as a contributor on the site, joins again with a player's link.
  async player() {
    const { ctx, page } = await phone('friend');
    await page.goto(`${SITE}/#/join`);
    await page.locator('input[aria-label="Invite link"]').fill(state.link_guest);
    await page.getByRole('button', { name: 'Look at the invite' }).tap();
    const join = page.getByRole('button', { name: /^Join / });
    await join.waitFor({ timeout: 20000 });
    await extra(page, 'l13-invite');
    await join.tap();
    await page.waitForFunction(() => location.hash.startsWith('#/w/'), null, { timeout: 30000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Fetching the world'), null, { timeout: 120000 }).catch(() => console.log('still fetching'));
    await settle(page, 4000);
    await frame(page, 'l13');
    await ctx.close();
  },
  // L14 the party: a Collective made from Catch, the player's Character put in it.
  async party() {
    const { ctx, page } = await phone('owner');
    await page.goto(`${SITE}/#/w/${state.worldId}/capture`);
    await page.locator('textarea').waitFor({ timeout: 20000 });
    await page.locator('textarea').fill('The party');
    await page.locator('.kind-chip.more').tap();
    await page.locator('[data-kind=collective]').tap();
    await page.locator('[data-action=catch-save]').tap();
    await page.waitForSelector('.el-head h1', { timeout: 15000 });
    await settle(page, 2500);
    await page.locator('.frow[data-field=characters]').scrollIntoViewIfNeeded();
    await page.locator('.frow[data-field=characters]').tap();
    await page.locator('.sheet').waitFor();
    const find = page.locator('.sheet input[type="search"], .sheet input').first();
    if (await find.count()) await find.fill('crew-walk-a');
    await settle(page, 800);
    await page.locator('.sheet .el-row', { hasText: 'crew-walk-a' }).first().tap();
    await extra(page, 'l14-picker');
    const saveBtn = page.locator('.sheet').getByRole('button', { name: 'Save', exact: true });
    if (await saveBtn.count()) await saveBtn.tap();
    await settle(page, 3000);
    await page.locator('.frow[data-field=characters]').scrollIntoViewIfNeeded();
    await frame(page, 'l14');
    state.partyUrl = await page.evaluate(() => location.hash);
    await ctx.close();
  },
  // L15 the owner gives the judge's ledger to the party; the player's phone shows the reveal.
  async give() {
    const o = await phone('owner');
    await o.page.goto(`${SITE}/#/w/${state.worldId}`);
    const search = o.page.locator('input[type="search"]').first();
    await search.waitFor();
    await search.fill('ledger');
    await settle(o.page, 1000);
    await o.page.locator('.el-row', { hasText: "The judge's ledger" }).first().tap();
    await o.page.waitForSelector('.el-head h1');
    await o.page.getByText('Give it to the party').first().tap();
    const which = o.page.locator('.sheet .choice', { has: o.page.locator('b', { hasText: /^The party$/ }) });
    if (await which.count()) {
      await extra(o.page, 'l15-which');
      await which.first().tap();
    }
    await o.page.locator('.sheet textarea').waitFor();
    await o.page.locator('.sheet textarea').fill('Left open on the table at Fort Griffin. Every page is a drawing of something he has taken.');
    await extra(o.page, 'l15-give-sheet');
    await o.page.locator('.sheet').getByRole('button', { name: 'Give it', exact: true }).tap();
    await settle(o.page, 4000);
    await o.page.goto(`${SITE}/#/w/${state.worldId}`);
    await settle(o.page, 3000);
    await extra(o.page, 'l15-owner-given');
    await o.ctx.close();
    const f = await phone('friend');
    await f.page.goto(`${SITE}/#/w/${state.worldId}`);
    await f.page.locator('input[type="search"]').first().waitFor();
    const seen = await f.page.waitForFunction(() => document.body.innerText.includes("judge's ledger"), null, { timeout: 60000 }).then(() => true, () => false);
    console.log('the reveal on the player\'s phone:', seen);
    await settle(f.page, 1500);
    await frame(f.page, 'l15');
    await f.page.getByText("judge's ledger").first().tap().catch(() => {});
    await settle(f.page, 2000);
    await extra(f.page, 'l15-reveal-page');
    await f.ctx.close();
  },
  // L16 the player shares a note with the party; the owner reads it, told by the player's Character.
  async share() {
    const f = await phone('friend');
    await f.page.goto(`${SITE}/#/w/${state.worldId}/notes`);
    const box = f.page.locator('textarea[aria-label="A note"]');
    await box.waitFor({ timeout: 20000 });
    await box.fill('The innkeeper at Yuma lied about the ferry\nHe said the Glanton men had gone south. Their horses were still in his yard.');
    await f.page.getByRole('button', { name: 'Save the note' }).tap();
    await settle(f.page, 1000);
    await f.page.locator('[data-action=share-note]').first().tap();
    await f.page.locator('.sheet').waitFor();
    const pin = f.page.locator('.sheet input[aria-label="PIN"]');
    if (await pin.count()) await pin.fill(creds(FRIEND).pin);
    await extra(f.page, 'l16-share-sheet');
    await f.page.locator('.sheet').getByRole('button', { name: 'Share it' }).tap();
    await f.page.getByText(/Shared with/).first().waitFor({ timeout: 30000 });
    await settle(f.page, 1500);
    await frame(f.page, 'l16');
    await f.ctx.close();
    const o = await phone('owner');
    await o.page.goto(`${SITE}/#/w/${state.worldId}`);
    const search = o.page.locator('input[type="search"]').first();
    await search.waitFor();
    await settle(o.page, 6000);
    await search.fill('innkeeper');
    await settle(o.page, 1500);
    await o.page.locator('.el-row', { hasText: 'The innkeeper at Yuma lied' }).first().tap();
    await o.page.waitForSelector('.el-head h1');
    await settle(o.page, 1500);
    await extra(o.page, 'l16-owner-narrative');
    await o.ctx.close();
  },
  // L17 the owner's phone holds a player's world (a read key for the player's seat, minted here
  // from the friend's account and put in on the owner's phone); a note shared from it is refused
  // before anything is sent. The owner's own copy is replaced by it, so this runs last.
  async refuse() {
    const f = await phone('friend');
    await f.page.goto(`${SITE}/#/worlds`);
    await f.page.waitForSelector('[data-screen="worlds"]');
    const key = await f.page.evaluate(async (worldId) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('lantern'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const token = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get('accountToken'); q.onsuccess = () => res(q.result); });
      const r = await fetch(`https://www.onlyworlds.com/api/v2/account/worlds/${worldId}/keys`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope: 'read', name: 'temper 388 L17 read' }),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, state.worldId);
    console.log('read key mint', key.status, key.body?.key ? 'key made' : JSON.stringify(key.body));
    await f.ctx.close();
    if (!key.body?.key) return;
    const o = await phone('owner');
    await o.page.goto(`${SITE}/#/key`);
    await o.page.locator('input').first().waitFor();
    await o.page.locator('input').first().fill(key.body.key);
    await o.page.locator('button[type=submit]').first().tap();
    await o.page.waitForFunction(() => location.hash.startsWith('#/w/'), null, { timeout: 30000 });
    await settle(o.page, 5000);
    await extra(o.page, 'l17-player-world');
    await o.page.goto(`${SITE}/#/w/${state.worldId}/notes`);
    const box = o.page.locator('textarea[aria-label="A note"]');
    await box.waitFor({ timeout: 20000 });
    await box.fill('A note from this phone');
    await o.page.getByRole('button', { name: 'Save the note' }).tap();
    await settle(o.page, 1000);
    await o.page.locator('[data-action=share-note]').first().tap();
    await o.page.locator('.sheet').waitFor();
    const go = o.page.locator('.sheet').getByRole('button', { name: 'Share it' });
    if (await go.count()) await go.tap();
    await settle(o.page, 4000);
    await frame(o.page, 'l17');
    await o.ctx.close();
  },
};

const stage = process.argv[2];
if (!stages[stage]) throw new Error(`stage? ${Object.keys(stages).join(', ')}`);
await stages[stage]();
save();
