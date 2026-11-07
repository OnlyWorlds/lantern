// A throwaway world for the walks that write on keel by a world key (live-write.mjs, live-agentmark.mjs).
// Their old probe-write world's key no longer answers, so each run makes its own world on crew-walk-b,
// hands the walk its key, and deletes that world after by the id keel answered, whatever happened.
//   1. The walk's own token by email and password, recorded.
//   2. POST /account/worlds with the account's PIN: the new world's id, name and key recorded at once.
//   3. The walk runs as a child with OW_WRITE_KEY and OW_PIN_FILE (a temporary file outside the repo,
//      removed after); its exit code is this run's.
//   4. Teardown: the world deleted on the site by its recorded id (its recorded name typed, and only when
//      that name is this run's), the account's list read to show it gone; the token revoked by id, read back 401.
// Secrets are never printed.
// Run from tools/lantern:
//   CREW_FILE=<crew-walk-accounts.txt> [LANTERN_URL=...] node walk/live-ground.mjs walk/live-write.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { OwV2Client } from '@onlyworlds/sdk';

const [, , walk = 'walk/live-write.mjs', ...rest] = process.argv;
const API = 'https://www.onlyworlds.com/api/v2';
const lines = fs.readFileSync(process.env.CREW_FILE, 'utf8').split(/\r?\n/);
const [, email, password] = lines.find((l) => l.startsWith('crew-walk-b ') && l.includes('@')).trim().split(/\s+/);
const pin = lines.find((l) => l.startsWith('crew-walk-b ') && /\bPIN\b/i.test(l))?.trim().split(/\s+/)[2];
const NAME = `Lantern walk ground ${Date.now().toString(36)}`;
const limit = () => ({ signal: AbortSignal.timeout(15000) });
const sdkFetch = (u, init = {}) => fetch(u, { ...init, signal: init.signal ?? AbortSignal.timeout(15000) });

let failures = 0;
const check = (ok, what) => { console.log(`[ground] ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; return ok; };
let token = null; // { id, token }
let world = null; // { id, name }
const pinFile = path.join(os.tmpdir(), `lantern-ground-${process.pid}-${Date.now()}.pin`);

try {
  if (!check(Boolean(pin), 'crew-walk-b has its PIN row')) throw new Error('stopped');
  const own = await new OwV2Client({ baseUrl: API, client: 'lantern', fetch: sdkFetch }).signInWithPassword({ email, password, tokenName: 'Lantern walk, ground' });
  token = { id: own.id, token: own.token };
  console.log(`[ground]      the walk's token ${own.id} (recorded)`);
  const r = await fetch(`${API}/account/worlds`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${own.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NAME, pin }),
    ...limit(),
  });
  const j = await r.json().catch(() => ({}));
  if (j?.id) { world = { id: j.id, name: j.name }; console.log(`[ground]      keel made world ${j.id} (recorded)`); }
  if (!check(r.status === 201 && j.name === NAME && Boolean(j.key), `keel made the walk's world with a key (${r.status})`)) throw new Error('stopped');
  fs.writeFileSync(pinFile, pin, { mode: 0o600 });
  const run = spawnSync(process.execPath, [walk, ...rest], {
    stdio: 'inherit',
    env: { ...process.env, OW_WRITE_KEY: j.key, OW_PIN_FILE: pinFile, LANTERN_URL: process.env.LANTERN_URL ?? 'https://lantern.onlyworlds.com' },
    timeout: 360000,
  });
  check(run.status === 0, `${walk} exited ${run.status ?? run.signal}`);
} catch (e) {
  if (e.message !== 'stopped') check(false, `threw: ${String(e).slice(0, 200)}`);
} finally {
  fs.rmSync(pinFile, { force: true });
  if (world) {
    const b = await chromium.launch();
    try {
      const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
      if (world.name !== NAME) check(false, `teardown: world ${world.id} is named ${JSON.stringify(world.name)}, not this run's: left alone`);
      else {
        const del = `https://www.onlyworlds.com/account/worlds/${world.id}/delete`;
        await page.goto(del);
        await page.waitForLoadState('networkidle');
        if (await page.locator('input[type="password"]').count()) {
          await page.evaluate(() => localStorage.setItem('cookieNoticeAccepted', 'true'));
          await page.locator('input[name="login"], input[type="email"], input[name="email"], input[name="username"]').first().fill(email);
          await page.locator('input[type="password"]').first().fill(password);
          await page.locator('button[type="submit"], input[type="submit"]').first().click();
          await page.waitForLoadState('networkidle');
          if (!page.url().includes(`/account/worlds/${world.id}/delete`)) await page.goto(del);
          await page.waitForLoadState('networkidle');
        }
        await page.locator('form input[type="text"], form input:not([type])').first().fill(world.name);
        await page.locator('form button[type="submit"], form input[type="submit"]').last().click();
        await page.waitForLoadState('networkidle');
        const listed = await (await fetch(`${API}/account/worlds`, { headers: { Authorization: `Bearer ${token.token}` }, ...limit() })).json().catch(() => null);
        check(Boolean(listed) && !(listed.data ?? []).some((x) => x.id === world.id), `teardown: the walk's world ${world.id} deleted on the site by its recorded id, then not on the account's list`);
      }
    } finally { await b.close(); }
  }
  if (token) {
    const r = await fetch(`${API}/account/tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.token}` }, ...limit() }).catch(() => null);
    const after = (await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${token.token}` }, ...limit() }).catch(() => null))?.status;
    check(after === 401, `teardown: the walk's token ${token.id} by recorded id, ${r?.status ?? 'no answer'}, then GET /account ${after}`);
  }
}
console.log(failures ? `[ground] ${failures} FAILED` : '[ground] all ok');
process.exit(failures ? 1 : 0);
