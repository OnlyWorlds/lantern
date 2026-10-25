// Lantern's /signin/callback read under Pages' own rules on a deployment (the S470 gate's G7),
// before production: the headers of the callback with and without a trailing slash, every script and
// stylesheet the returned shell names, and a browser boot there (workers allowed) that must land on
// Sign in with "That sign-in was not started here". Run: node walk/callback-host.mjs <origin> (a Pages deployment; vite preview has no _redirects). S470.
import { chromium } from 'playwright';
const origin = process.argv[2];
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
// The trailing-slash form is said, not judged: keel's registered address has none and never sends
// one, and Pages answers it 404 on Atlas's production too (Boss h56 #12794).
const slash = await fetch(`${origin}/signin/callback/?code=x&state=y`, { redirect: 'manual' });
console.log(`said /signin/callback/ (a slash keel never sends): ${slash.status}`);
for (const path of ['/signin/callback?code=x&state=y']) {
  const r = await fetch(origin + path, { redirect: 'manual' });
  const rp = r.headers.get('referrer-policy');
  check(r.status === 200 && !r.headers.get('location'), `${path}: ${r.status}${r.headers.get('location') ? ' to ' + r.headers.get('location') : ''}`);
  check(rp === 'no-referrer', `${path}: Referrer-Policy ${JSON.stringify(rp)}`);
  check((r.headers.get('cache-control') ?? '').includes('no-store'), `${path}: Cache-Control ${JSON.stringify(r.headers.get('cache-control'))}`);
  {
    const html = await r.text();
    const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    check(refs.length >= 2, `the shell names ${refs.length} assets`);
    for (const a of refs) {
      const ar = await fetch(origin + a);
      check(ar.status === 200 && /javascript|css/.test(ar.headers.get('content-type') ?? ''), `${a}: ${ar.status} ${ar.headers.get('content-type')}`);
    }
  }
}
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${origin}/signin/callback?code=x&state=y`);
const landed = await p.waitForSelector('[data-part="signin-notice"].error', { timeout: 30000 }).then(() => true, () => false);
const line = landed ? await p.locator('[data-part="signin-notice"]').textContent() : null;
check(landed && /not started here/.test(line ?? ''), `a boot at the callback lands on Sign in: ${JSON.stringify(line)} (${p.url()})`);
check(!/code=|state=/.test(p.url()), 'the code left the address');
check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await b.close();
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
