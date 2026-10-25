// The Captain's first phone walk (h37 #3552, 2026-10-12), each thing he hit walked as fixed, on a
// world on this phone: Add to home screen does something; Catch makes a Character at once and
// opens it with its empty fields; a linked field changes from its pencil while its chip still
// opens the place; a picture added after the element was made (camera or gallery); the tab bar on
// every screen, World going home; Ask says why it gives no sentence.
// Run: npm run build && (npx vite preview --port 5181 &) && node walk/first-walk.mjs [webkit|chromium]
import './guard.mjs';
// WebKit logs the viewport's interactive-widget key (Android Chrome's keyboard rule, S404) as unknown: harmless.
const VIEWPORT_KEY = /Viewport argument key "interactive-widget" not recognized/;
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { writeWorldFile } from '@onlyworlds/sdk';

const BASE = process.env.LANTERN_URL ?? 'http://localhost:5181';
const OUT = 'walk/shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let failures = 0;

function check(tag, ok, what) {
  console.log(`[${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

async function walk(engine, tag) {
  const browser = await engine.launch();
  const base = engine === webkit ? devices['iPhone 13'] : devices['Pixel 7'];
  const ctx = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  let cutOff = false; // keel cut off on purpose (step 7): its failed loads are expected
  page.on('console', (m) => m.type() === 'error' && !VIEWPORT_KEY.test(m.text()) && !(cutOff && /Failed to load resource/.test(m.text())) && errors.push('console: ' + m.text()));
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${OUT}/first-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });
  const screen = () => page.evaluate(() => document.querySelector('main')?.dataset.screen ?? '?');

  // 1. Add to home screen is a button, and it does something (here: no browser dialog, so the steps).
  await page.goto(`${BASE}/#/welcome`);
  await page.waitForSelector('[data-screen="welcome"]');
  await page.locator('[data-action=install]').tap();
  await page.waitForSelector('.sheet');
  const steps = await page.locator('.sheet .steps li').allInnerTexts();
  check(tag, steps.length === 2, `the install button opens the steps (${JSON.stringify(steps[0] ?? '')})`);
  await shot('install-steps');
  await page.locator('.sheet').getByRole('button', { name: 'Got it' }).tap();
  // S407: Sign in says where an account comes from (an invited friend lands here with none).
  await page.goto(`${BASE}/#/signin`);
  await page.waitForSelector('[data-screen="signin"]');
  const signup = page.locator('[data-part="no-account"] a');
  check(tag, (await signup.getAttribute('href')) === 'https://www.onlyworlds.com/accounts/signup/' && (await signup.getAttribute('target')) === '_blank', 'Sign in links to making an account, in a new tab');
  await shot('signin-no-account');
  await page.goto(`${BASE}/#/settings`);
  // Settings draws after the storage question, which WebKit answers slowly.
  await page.waitForSelector('[data-screen="settings"] [data-action=install]', { timeout: 5000 }).catch(() => {});
  check(tag, (await page.locator('[data-action=install]').count()) === 1, 'Settings keeps the install button');

  // 2. A world on this phone; Catch from the tab bar makes a Location, then a Character.
  await page.goto(`${BASE}/#/new`);
  await page.locator('input[aria-label="World name"]').fill('First walk');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  check(tag, (await page.locator('[data-action=invite]').count()) === 0, 'a world on this phone only offers no invite (S407)');
  const catchTab = page.locator('.tabbar [data-tab=catch]');
  check(tag, (await catchTab.count()) === 1, 'the tab bar has Catch');
  await catchTab.tap();
  await page.waitForSelector('[data-screen="capture"]');
  check(tag, (await page.locator('[data-kind=Unsorted][aria-checked=true]').count()) === 1, 'Unsorted is chosen first');
  check(tag, (await page.locator('[data-photo=camera][capture]').count()) === 1 && (await page.locator('[data-photo=gallery]:not([capture])').count()) === 1, 'Camera opens the camera, Gallery the picker');
  await page.locator('textarea').fill('Lower Town');
  await page.locator('[data-kind=location]').tap();
  const saveLabel = await page.locator('button[type=submit]').innerText();
  check(tag, saveLabel === 'Make the location', `the button says what it makes (${JSON.stringify(saveLabel)})`);
  await shot('catch-location');
  await page.locator('button[type=submit]').tap();
  await page.waitForSelector('[data-screen="element"] .el-head');
  const kind1 = await page.locator('.el-head .muted').innerText();
  check(tag, /^Location/.test(kind1), `a Location was made (${JSON.stringify(kind1)})`);
  check(tag, (await page.locator('.frow[data-field=description]').count()) === 1, 'made from a one-line note, it offers a description among its empty fields');

  await page.locator('.tabbar [data-tab=catch]').tap();
  await page.waitForSelector('[data-screen="capture"]');
  await page.locator('textarea').fill('Mira Vell\nA smith in the lower town.');
  await page.locator('[data-kind=character]').tap();
  await page.locator('button[type=submit]').tap();
  await page.waitForSelector('[data-screen="element"] .el-head');
  check(tag, (await page.locator('.el-head h1').innerText()).startsWith('Mira Vell'), 'the first line is the name');
  check(tag, (await page.locator('.prose').innerText()).startsWith('A smith in the lower town.'), 'the rest is the description');
  const emptyRows = await page.locator('.fields .frow[data-field]').count();
  check(tag, emptyRows > 5, `made from Catch, it opens with its empty fields showing (${emptyRows} rows)`);  check(tag, (await page.locator('.tabbar').count()) === 1, 'the element page has the tab bar');
  await shot('character-fill');

  // 3. The location field: empty, the row opens the sheet; set, the pencil does, and the chip opens the place.
  await page.locator('.frow[data-field=location]').tap();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet .el-row', { hasText: 'Lower Town' }).tap();
  await page.waitForSelector('.frow[data-field=location] .link-chip');
  const pencil = page.locator('.frow[data-field=location] .edit-btn');
  check(tag, (await pencil.count()) === 1, 'a set link field has its pencil');
  await pencil.tap();
  await page.waitForSelector('.sheet');
  check(tag, (await screen()) === 'element' && (await page.locator('.sheet h2').innerText()) === 'Location', 'the pencil opens the link sheet, not the place');
  await shot('pencil-sheet');
  await page.locator('.sheet').getByRole('button', { name: 'Cancel' }).tap();
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  // His second walk (#3660): a single link laid out like a multi link, the chip under its label line.
  const lay = await page.evaluate(() => {
    const row = document.querySelector('.frow[data-field=location]');
    const k = row?.querySelector('.k')?.getBoundingClientRect();
    const chip = row?.querySelector('.link-chip')?.getBoundingClientRect();
    return { block: row?.classList.contains('block'), below: !!k && !!chip && chip.top >= k.bottom - 1 };
  });
  check(tag, lay.block && lay.below, `a single link's chip sits under its label, as a multi link's does (${JSON.stringify(lay)})`);
  // h37 #4050: the pencil at the label line's far right; its glyph's right edge on the row's, inside the page.
  const right = await page.evaluate(() => {
    const row = document.querySelector('.frow[data-field=location]')?.getBoundingClientRect();
    const svg = document.querySelector('.frow[data-field=location] .edit-btn svg')?.getBoundingClientRect();
    return row && svg ? { gap: Math.round(row.right - svg.right), page: document.documentElement.clientWidth - Math.ceil(svg.right) } : null;
  });
  check(tag, !!right && Math.abs(right.gap) <= 2 && right.page >= 0, `the pencil sits at the far right of its row (${JSON.stringify(right)})`);
  await page.locator('.frow[data-field=location]').screenshot({ path: `walk/shots/first-${tag}-04b-pencil-right.png` });
  await page.locator('.frow[data-field=location] .link-chip').tap();
  await page.waitForFunction(() => /Lower Town/.test(document.querySelector('.el-head h1')?.textContent ?? ''));
  check(tag, true, 'the chip still opens the place');
  await page.goBack();
  await page.waitForFunction(() => /Mira/.test(document.querySelector('.el-head h1')?.textContent ?? ''));

  // 4. A picture after the element was made, from the gallery. The empty picture itself opens the
  // same sheet (#3660).
  await page.locator('[data-action=avatar-picture]').tap();
  await page.waitForSelector('.sheet [data-photo=gallery]', { state: 'attached' });
  check(tag, (await page.locator('.sheet [data-photo=camera]').count()) === 1, 'tapping the empty picture offers Camera or Gallery');
  await page.locator('.sheet').getByRole('button', { name: 'Cancel' }).tap();
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  await page.locator('[data-action=picture]').tap();
  await page.waitForSelector('.sheet [data-photo=gallery]', { state: 'attached' });
  const png = await page.screenshot({ type: 'png' });
  await page.locator('.sheet [data-photo=gallery]').setInputFiles({ name: 'mira.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => /url\("data:image/.test(document.querySelector('.avatar')?.style.backgroundImage ?? ''), null, { timeout: 15000 });
  check(tag, (await page.locator('img.picture').count()) === 1, 'the picture shows on the page');
  check(tag, (await page.locator('[data-action=picture]').innerText()).trim() === 'Change the picture','the button now offers to change it');
  check(tag, (await page.locator('[data-action=avatar-picture]').count()) === 0, 'and the picture is no longer a button to add one');
  await shot('picture');
  await page.locator('[data-action=picture]').tap();
  await page.locator('.sheet').getByRole('button', { name: 'Remove the picture' }).tap();
  await page.waitForFunction(() => !document.querySelector('img.picture'));
  check(tag, true, 'Remove the picture removes it');

  // 5. World goes home from anywhere; Ask says why there is no sentence.
  await page.locator('.tabbar [data-tab=world]').tap();
  await page.waitForSelector('[data-screen="home"] .type-tile');
  check(tag, true, 'World in the tab bar lands on the world home');
  // On the home itself, the tab goes up a level and says so (#3675).
  const up = page.locator('.tabbar [data-tab=world]');
  check(tag, (await up.innerText()).trim() === 'Worlds' && (await up.getAttribute('href')) === '#/worlds', 'on the world home, the tab reads Worlds and goes to Your worlds');
  await up.tap();
  await page.waitForSelector('[data-screen="worlds"]');
  await page.goBack();
  await page.waitForSelector('[data-screen="home"] .type-tile');
  await page.locator('.tabbar [data-tab=ask]').tap();
  await page.waitForSelector('[data-screen="ask"]');
  await page.locator('[data-screen="ask"] input').fill('the king of the north');
  await page.waitForSelector('[data-answer=none]');
  const why = await page.locator('[data-why]').getAttribute('data-why');
  check(tag, why === 'local', `Ask says why a world on this phone gives no sentence (${why})`);
  await shot('ask-why');
  // Typing hides the tab bar (the keyboard would carry it); leaving the field brings it back.
  await page.locator('[data-screen="ask"] input').focus();
  check(tag, !(await page.locator('.tabbar').isVisible()), 'typing hides the tab bar');
  await page.locator('[data-screen="ask"] input').blur();
  check(tag, await page.locator('.tabbar').waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false), 'and it comes back, a moment after');
  const worldId = page.url().match(/#\/w\/([^/?]+)/)[1];

  // 6. Pin a world (#3660): it leads the list under Pinned, through a reload, until unpinned.
  await page.goto(`${BASE}/#/new`);
  await page.locator('input[aria-label="World name"]').fill('Second world');
  await page.getByRole('button', { name: 'Start the world' }).tap();
  await page.waitForSelector('[data-screen="home"]');
  await page.goto(`${BASE}/#/worlds`);
  await page.waitForSelector('[data-screen="worlds"] .world-card');
  const labels = () => page.locator('[data-screen="worlds"] .section-label').allInnerTexts();
  check(tag, !(await labels()).includes('Pinned'), 'no Pinned section before a pin');
  await page.locator(`[data-pin="${worldId}"]`).tap();
  await page.waitForSelector('[aria-pressed=true][data-pin]');
  const firstSection = async () =>
    page.evaluate(() => {
      const s = document.querySelector('[data-screen="worlds"] .stack');
      return { label: s?.querySelector('.section-label')?.textContent, worlds: [...(s?.querySelectorAll('[data-world]') ?? [])].map((x) => x.getAttribute('data-world')) };
    });
  let first = await firstSection();
  check(tag, first.label === 'Pinned' && first.worlds.length === 1 && first.worlds[0] === worldId, `a pinned world leads the list under Pinned (${JSON.stringify(first)})`);
  check(tag, (await page.locator(`[data-world="${worldId}"]`).count()) === 1, 'and is not also in its own section');
  await shot('pinned');
  await page.reload();
  await page.waitForSelector('[data-screen="worlds"] .world-card');
  first = await firstSection();
  check(tag, first.label === 'Pinned' && first.worlds[0] === worldId, 'the pin is kept through a reload');
  await page.locator(`[data-pin="${worldId}"]`).tap();
  await page.waitForFunction(() => ![...document.querySelectorAll('.section-label')].some((l) => l.textContent === 'Pinned'));
  check(tag, true, 'unpinned, the Pinned section goes');

  // 7. A change waiting on the PIN says so where it waits, and asks for it there (#3660). The first
  // world made an owner's account world with a write key; keel cut off, so nothing is sent.
  cutOff = true;
  await page.route('**/api/v2/**', (r) => r.abort());
  await page.evaluate(
    (id) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('lantern');
        r.onsuccess = () => {
          const t = r.result.transaction('worlds', 'readwrite');
          const st = t.objectStore('worlds');
          const g = st.get(id);
          g.onsuccess = () => st.put({ ...g.result, kind: 'online', role: 'owner', apiKey: 'ow_w_' + 'x'.repeat(40), keyKind: 'write' });
          r.result.transaction('kv', 'readwrite').objectStore('kv').put('ow_a_' + 'w'.repeat(40), 'accountToken'); // the owner signed in
          t.oncomplete = () => res(true);
          t.onerror = () => rej(t.error);
        };
      }),
    worldId,
  );
  await page.goto(`${BASE}/#/w/${worldId}`);
  await page.waitForSelector('[data-screen="home"]');
  // S411: an owner's online world offers Invite someone, and the link is made here (keel C1, routed
  // as keel answers: 201 with the code, the link and the line, shown once).
  const sent = [];
  // Held until the walk has tried to change the choice during the wait (Atlas 1.47's gate, H1).
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/api/v2/account/worlds/*/links', async (r) => {
    sent.push(JSON.parse(r.request().postData() ?? '{}'));
    await held;
    const code = 'ow_j_walk1234';
    await r.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'link-1', reader: 'person', role: 'guest', label: '', inviter_name: 'Ada', with_character: false, last4: '1234', created_at: '2026-10-15T17:00:00Z', expires_at: '2026-10-22T17:00:00Z', uses: 0, status: 'pending', code, link: `https://www.onlyworlds.com/join#${code}`, line: `Ada invites you to First world: https://www.onlyworlds.com/join#${code}` }),
    });
  });
  const invite = page.locator('[data-action=invite]');
  await invite.scrollIntoViewIfNeeded();
  await shot('invite');
  await invite.tap();
  await page.waitForSelector('.sheet [data-action=make-invite]');
  await page.locator('.sheet [data-role=guest]').tap();
  await page.locator('.sheet input').fill('Ada');
  await shot('invite-sheet');
  await page.locator('.sheet [data-action=make-invite]').tap();
  await page.waitForFunction(() => document.querySelector('.sheet [data-role=contributor]')?.disabled === true);
  check(tag, await page.locator('.sheet [data-role=contributor]').isDisabled() && await page.locator('.sheet input').isDisabled(), 'while the link is made, the choice and the name are locked');
  // S477 (S414's left gap): a tap on the backdrop while keel makes the link leaves the sheet, so the link is shown.
  await page.locator('.backdrop').tap({ position: { x: 12, y: 12 } });
  check(tag, (await page.locator('.sheet').count()) === 1, 'a tap on the backdrop during the wait keeps the sheet');
  release();
  await page.waitForSelector('.sheet [data-role=invite-link]');
  check(tag, /as a player with an account:$/.test((await page.locator(".sheet p").first().innerText()).trim()), "the link says the role it was made for (S433: a guest link is a player with an account)");
  check(tag, (await page.locator('.sheet [data-role=invite-link]').innerText()).trim() === 'https://www.onlyworlds.com/join#ow_j_walk1234', 'Invite someone makes the link on the phone and shows it');
  check(tag, JSON.stringify(sent) === JSON.stringify([{ reader: 'person', role: 'guest', days: 7, inviter_name: 'Ada' }]), `for a person, as a player, signed with the name typed (${JSON.stringify(sent)})`);
  check(tag, await page.locator('.sheet svg.invite-qr').waitFor({ timeout: 5000 }).then(() => true, () => false), 'with its QR code');
  check(tag, (await page.locator('.sheet [data-action=copy-invite]').count()) === 1, 'and Copy');
  await shot('invite-made');
  await page.locator('.backdrop').tap({ position: { x: 12, y: 12 } });
  check(tag, (await page.locator('.sheet [data-role=invite-link]').count()) === 1, 'shown only now: a tap on the backdrop keeps the link on screen, Done closes it');
  await page.locator('.sheet').getByRole('button', { name: 'Done' }).tap();
  await page.waitForSelector('.sheet', { state: 'detached' });
  await page.goto(`${BASE}/#/w/${worldId}/t/character`);
  await page.locator('.el-row').first().tap();
  await page.waitForSelector('[data-screen="element"] .el-head');
  await page.locator('.prose').tap();
  await page.waitForSelector('.sheet textarea');
  await page.locator('.sheet textarea').fill('A smith in the lower town, and a good one.');
  await page.locator('.sheet button[type=submit]').tap();
  const mark = page.locator('.wait-pin');
  await mark.waitFor({ timeout: 10000 });
  check(tag, (await mark.innerText()) === 'Needs your PIN', 'the waiting change says it needs the PIN');
  await shot('needs-pin');
  await mark.tap();
  await page.waitForSelector('.sheet h2');
  const sheetText = await page.locator('.sheet').innerText();
  check(tag, /Your PIN/.test(sheetText) && /all your worlds/.test(sheetText), 'tapping it asks for the PIN, kept for all your worlds');
  await page.locator('.sheet .sheet-close, .sheet [aria-label=Close]').first().tap().catch(() => page.keyboard.press('Escape'));
  await page.goto(`${BASE}/#/w/${worldId}/outbox`);
  await page.waitForSelector('[data-screen="outbox"]');
  check(
    tag,
    (await page.getByRole('button', { name: 'Enter your PIN', exact: true }).count()) === 1 && (await page.locator('[data-action=send-now]').count()) === 0,
    'Waiting to send asks for the PIN, and offers no Send now that could not send',
  );

  check(tag, errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

  // S434 (#417's live walk): a friend sends a world file to a phone with nothing on it yet. The
  // welcome's "I have a world file" opens it; before, the door was only on Your worlds.
  {
    const fresh = await browser.newContext({ ...base, viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
    const p = await fresh.newPage();
    await p.goto(`${BASE}/`);
    await p.waitForSelector('[data-screen="welcome"]');
    const door = p.getByRole('button', { name: 'I have a world file' });
    check(tag, (await door.count()) === 1, 'a fresh phone\'s welcome offers I have a world file');
    if (await door.count()) {
      const chooser = p.waitForEvent('filechooser', { timeout: 10000 });
      await door.tap();
      const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
      const sent = writeWorldFile([
        { path: 'world.json', data: enc({ id: '0f0f0f0f-0000-4000-8000-00000000f17e', name: 'Sent by a friend' }) },
        { path: 'elements/character/elrod--0000f17e.json', data: enc({ id: 'f17e0000-0000-4000-8000-000000000001', name: 'Elrod' }) },
      ], 'sent-by-a-friend');
      // S467: sent as the standard names it (.owworld, what the toolkit's carry writes), with no type
      // a phone knows; the picker must offer it, or a phone's file picker hides it (OW-1).
      const picker = await chooser;
      const accept = await picker.element().getAttribute('accept');
      check(tag, (accept ?? '').split(',').includes('.owworld'), `the world file picker offers .owworld (accept: ${accept})`);
      await picker.setFiles({ name: 'sent-by-a-friend.owworld', mimeType: '', buffer: Buffer.from(sent) });
      await p.waitForSelector('[data-screen="home"]', { timeout: 15000 });
      check(tag, /Sent by a friend/.test(await p.locator('main').innerText()), 'the world file opens as a world on this phone');
      await p.screenshot({ path: `${OUT}/first-${tag}-${String(++n).padStart(2, '0')}-welcome-world-file.png` });
    }
    await fresh.close();
  }
  await browser.close();
}

if (!only || only === 'chromium') await walk(chromium, 'chromium');
if (!only || only === 'webkit') await walk(webkit, 'webkit');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
