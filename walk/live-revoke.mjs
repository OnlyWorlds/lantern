// Sign out revokes Lantern's token, read live on a crew account. Signs
// in by email and password on the phone's sign-in screen, records the token's id from keel's mint
// answer (the walk's own record), taps Sign out, and asks keel whether the token still works. A
// build with the revoke: 401, "Signed out. Lantern's token is revoked on OnlyWorlds. ..." The build
// before (the control): the token still works (200), so the walk revokes it itself by the id it
// recorded. Tokens and secrets are never printed.
// Run from tools/lantern: CREW_FILE=<crew-walk-accounts.txt> node walk/live-revoke.mjs [url] [chromium|webkit] [tag]
import fs from 'node:fs';
import { chromium, webkit, devices } from 'playwright';

const [, , url = 'https://lantern.onlyworlds.com', engine = 'chromium', tag = 'live'] = process.argv;
const OUT = 'walk/shots';
fs.mkdirSync(OUT, { recursive: true });
const API = 'https://www.onlyworlds.com/api/v2';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith('crew-walk-b ') && l.includes('@')).trim().split(/\s+/);
let failures = 0;
const check = (ok, what) => { console.log(`[${engine} ${tag}] ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const b = await (engine === 'webkit' ? webkit : chromium).launch();
const p = await (await b.newContext({ ...devices[engine === 'webkit' ? 'iPhone 13' : 'Pixel 7'], viewport: { width: 360, height: 780 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
const minted = [];
p.on('response', async (r) => {
  if (r.request().method() === 'POST' && r.url().startsWith(`${API}/account/tokens`) && r.status() === 201) {
    try { const j = await r.json(); minted.push({ id: j.id, token: j.token }); } catch { /* not json */ }
  }
});
// Every request of the walk's own has a limit, and the walk a watchdog: a WebKit run on production hung
// 32 minutes after its Sign out, its teardown never reached.
const alive = async (tok) => (await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(15000) })).status;
setTimeout(() => { console.log(`[${engine} ${tag}] FAIL the walk hung past 3 minutes; minted ids: ${minted.map((m) => m.id).join(', ') || 'none'}`); process.exit(2); }, 180000).unref();

try {
  await p.goto(url);
  console.log(`[${engine} ${tag}] build`, await (await fetch(new URL('/version.json', url))).text().catch(() => '?'));
  await p.goto(new URL('/#/signin', url).href);
  await p.getByLabel('Email or username').fill(email);
  await p.getByLabel('Password').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).tap();
  await p.waitForURL(/#\/(worlds|join)/, { timeout: 30000 });
  const kept = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('lantern'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('accountToken'); g.onsuccess = () => res(g.result ?? null); }; }));
  const mint = minted[0];
  check(Boolean(mint?.id) && mint.token === kept, 'keel minted the token Lantern kept (the walk recorded its id)');
  check((await alive(mint.token)) === 200, 'the token works before Sign out');

  await p.goto(new URL('/#/settings', url).href);
  await p.getByRole('button', { name: 'Sign out', exact: true }).tap();
  await p.waitForSelector('.toast', { timeout: 15000 });
  await p.waitForTimeout(400);
  const line = (await p.locator('.toast').textContent()).trim();
  await p.screenshot({ path: `${OUT}/live-revoke-${engine}-${tag}.png` });
  await p.waitForTimeout(1500);
  const after = await alive(mint.token);
  check(after === 401, `after Sign out the token no longer works (GET /account ${after})`);
  check(line === "Signed out. Lantern's token is revoked on OnlyWorlds. Worlds already on this phone stay.", `the line says revoked (${line})`);
} finally {
  // Teardown: anything this walk recorded and keel still honours is revoked by its recorded id.
  for (const m of minted) {
    if ((await alive(m.token)) === 200) {
      const r = await fetch(`${API}/account/tokens/${encodeURIComponent(m.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${m.token}` }, signal: AbortSignal.timeout(15000) });
      console.log(`[${engine} ${tag}] teardown revoke by recorded id: ${r.status}, then ${await alive(m.token)}`);
    }
  }
}
check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 15000))]);
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
