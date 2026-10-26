// Sign in with OnlyWorlds:
// the SDK's real round trip against a fake keel shaped by the handoff sheet (§2: the authorize page
// sends back a code and the state; POST /auth/token checks the verifier against the challenge and
// answers the token and the account, or 400 invalid_grant). Each rule's guard is here.
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
const addresses: string[] = [];
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => void addresses.push(url) },
});

const db = await import('../src/db');
const signin = await import('../src/signin');
const { setPendingJoin } = await import('../src/join');
const { OwSignInError } = await import('@onlyworlds/sdk');

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class FakeKeel {
  calls: string[] = [];
  challenge = '';
  code = 'c0de';
  worldsDown = false;
  tokenAnswer: 'ok' | 'invalid_grant' | 'rate_limited' | 'hang' = 'ok';
  tokenKeptWhenWorldsAsked: string | undefined | null = null;

  json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/v2', '');
    this.calls.push(`${init.method ?? 'GET'} ${path}`);
    if (path === '/auth/token') {
      const body = JSON.parse(String(init.body));
      if (this.tokenAnswer === 'hang') return new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      if (this.tokenAnswer === 'rate_limited') return this.json(429, { error: { code: 'rate_limited', message: 'keel words' } });
      const ok = body.code === this.code && body.client_id === 'lantern'
        && body.redirect_uri === 'https://lantern.onlyworlds.com/signin/callback'
        && b64url(createHash('sha256').update(body.code_verifier).digest()) === this.challenge;
      if (!ok || this.tokenAnswer === 'invalid_grant') return this.json(400, { error: { code: 'invalid_grant', message: 'keel words' } });
      return this.json(200, { token: 'ow_a_fromhandoff', token_type: 'bearer', account: { id: 'acc-1', username: 'wren' } });
    }
    if (path === '/account/worlds') {
      this.tokenKeptWhenWorldsAsked = await db.kvGet<string>('accountToken');
      if (this.worldsDown) throw new TypeError('Failed to fetch');
      return this.json(200, { data: [{ id: 'w1', name: 'Ilios', role: 'owner' }] });
    }
    return this.json(404, { error: { code: 'not_found' } });
  };
}

let keel: FakeKeel;

/** Tap the button: the SDK keeps its record and names the authorize address; keel answers with a code. */
async function tapAndReturn(extra = ''): Promise<string> {
  let to = '';
  await signin.beginOnlyWorldsSignIn((u) => (to = u));
  const auth = new URL(to);
  expect(auth.origin + auth.pathname).toBe('https://www.onlyworlds.com/signin/authorize');
  expect(auth.searchParams.get('redirect_uri')).toBe('https://lantern.onlyworlds.com/signin/callback');
  expect(auth.searchParams.get('client_id')).toBe('lantern');
  keel.challenge = auth.searchParams.get('code_challenge')!;
  return `https://lantern.onlyworlds.com/signin/callback?code=${keel.code}&state=${auth.searchParams.get('state')}${extra}`;
}

beforeEach(async () => {
  store.clear();
  addresses.length = 0;
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  await db.kvSet('accountToken', undefined);
  await db.kvSet('accountWorlds', undefined);
  await db.kvSet('accountId', undefined);
  await db.kvSet('accountName', undefined);
  await setPendingJoin(undefined);
  signin.takeSignedInLine();
  signin.takeSignInNotice();
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'test' }, configurable: true });
});

describe('L1: the registered address only', () => {
  it('is offered on lantern.onlyworlds.com and nowhere else', () => {
    expect(signin.canSignInWithOnlyWorlds('https://lantern.onlyworlds.com')).toBe(true);
    for (const o of ['https://preview.lantern-6nd.pages.dev', 'http://localhost:5181', 'http://lantern.onlyworlds.com', 'https://lantern.onlyworlds.com.evil.example', '']) {
      expect(signin.canSignInWithOnlyWorlds(o)).toBe(false);
    }
  });

  it('the callback path is matched with or without a trailing slash, nothing else', () => {
    expect(signin.isSignInCallback('/signin/callback')).toBe(true);
    expect(signin.isSignInCallback('/signin/callback/')).toBe(true);
    expect(signin.isSignInCallback('/')).toBe(false);
    expect(signin.isSignInCallback('/signin')).toBe(false);
  });
});

describe('L3: the callback page can boot on /signin/callback', () => {
  it('no asset in the shell is document-relative, and the build keeps the root base', () => {
    const shells = ['index.html', ...(existsSync('dist/index.html') ? ['dist/index.html'] : [])];
    for (const f of shells) {
      const html = readFileSync(f, 'utf8');
      const refs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.filter((r) => !r.startsWith('/') && !/^https:/.test(r)), f).toEqual([]);
    }
    expect(readFileSync('vite.config.ts', 'utf8')).not.toMatch(/\bbase\s*:/);
  });

  it('the host serves the app at the callback with its two headers, and the worker precaches nothing there', () => {
    expect(readFileSync('public/_redirects', 'utf8')).toMatch(/^\/signin\/callback \/ 200$/m);
    const headers = readFileSync('public/_headers', 'utf8');
    const block = headers.slice(headers.indexOf('\n/signin/callback'));
    expect(block).toMatch(/! Referrer-Policy/);
    expect(block).toMatch(/Referrer-Policy: no-referrer/);
    expect(block).toMatch(/Cache-Control: no-store/);
    if (existsSync('dist/sw.js')) expect(readFileSync('dist/sw.js', 'utf8')).not.toMatch(/"\/signin/);
  });

  it('the address leaves the code behind before the exchange answers', async () => {
    const back = await tapAndReturn();
    const pending = signin.startSignInCallback(back, keel.fetch as typeof fetch);
    expect(addresses.at(-1)).toBe('/#/signing-in');
    expect(addresses.every((a) => !a.includes('code='))).toBe(true);
    expect((await pending).ok).toBe(true);
  });

  it('a hung exchange becomes the offline sentence within the time limit', async () => {
    const back = await tapAndReturn();
    keel.tokenAnswer = 'hang';
    const real = signin.SIGN_IN_EXCHANGE_LIMIT_MS;
    expect(real).toBe(20_000);
    // The limit is the fetch's own: run it here with the abort driven by a short stand-in.
    const quick: typeof fetch = (i, init) => {
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 20);
      return keel.fetch(i, { ...init, signal: ctl.signal });
    };
    const out = await signin.startSignInCallback(back, quick);
    expect(out.ok).toBe(false);
    expect(signin.signInCallbackLine(out as { cancelled: boolean; error: unknown })).toMatch(/could not be reached/);
  });
});

describe('L4: the token kept first', () => {
  it('a round trip keeps the token before the worlds are asked, then lands on Your worlds', async () => {
    const out = await signin.startSignInCallback(await tapAndReturn(), keel.fetch as typeof fetch);
    expect(await signin.applySignInOutcome(out)).toBe('#/worlds');
    expect(await db.kvGet('accountToken')).toBe('ow_a_fromhandoff');
    expect(keel.tokenKeptWhenWorldsAsked).toBe('ow_a_fromhandoff');
    expect(await db.kvGet('accountWorlds')).toEqual([{ id: 'w1', name: 'Ilios', role: 'owner' }]);
    expect(keel.calls.indexOf('POST /auth/token')).toBe(0);
  });

  it('keeps and says which account (the sign-in gate G1)', async () => {
    const out = await signin.startSignInCallback(await tapAndReturn(), keel.fetch as typeof fetch);
    await signin.applySignInOutcome(out);
    expect(await db.kvGet('accountId')).toBe('acc-1');
    expect(await db.kvGet('accountName')).toBe('wren');
    expect(signin.takeSignedInLine()).toBe('Signed in as wren.');
    expect(signin.takeSignedInLine()).toBeNull();
  });

  it('a token that is not an account token is never kept', async () => {
    const out = await signin.applySignInOutcome({ ok: true, token: 'not-a-token', account: { id: 'acc-1', username: 'wren' } });
    expect(out).toBe('#/signin');
    expect(await db.kvGet('accountToken')).toBeUndefined();
    expect(signin.takeSignInNotice()).toBe(signin.NOT_KEPT_LINE);
  });

  it('the worlds list failing leaves the token kept', async () => {
    keel.worldsDown = true;
    const out = await signin.startSignInCallback(await tapAndReturn(), keel.fetch as typeof fetch);
    expect(await signin.applySignInOutcome(out)).toBe('#/worlds');
    expect(await db.kvGet('accountToken')).toBe('ow_a_fromhandoff');
  });

  it('an invitation that waited through the round trip comes back', async () => {
    await setPendingJoin('abc-123');
    const out = await signin.startSignInCallback(await tapAndReturn(), keel.fetch as typeof fetch);
    expect(await signin.applySignInOutcome(out)).toBe('#/join');
  });
});

describe('L5: the record', () => {
  it('lives in localStorage and is gone after the return, success or refusal', async () => {
    const back = await tapAndReturn();
    expect(store.has(signin.SIGN_IN_RECORD_KEY)).toBe(true);
    await signin.startSignInCallback(back, keel.fetch as typeof fetch);
    expect(store.has(signin.SIGN_IN_RECORD_KEY)).toBe(false);
    keel.tokenAnswer = 'invalid_grant';
    const again = await tapAndReturn();
    await signin.startSignInCallback(again, keel.fetch as typeof fetch);
    expect(store.has(signin.SIGN_IN_RECORD_KEY)).toBe(false);
  });
});

describe('L6: a refusal is a sentence on the sign-in screen', () => {
  it("keel's Cancel", async () => {
    let to = '';
    await signin.beginOnlyWorldsSignIn((u) => (to = u));
    const state = new URL(to).searchParams.get('state');
    const out = await signin.startSignInCallback(`https://lantern.onlyworlds.com/signin/callback?error=access_denied&state=${state}`, keel.fetch as typeof fetch);
    expect(await signin.applySignInOutcome(out)).toBe('#/signin');
    expect(signin.takeSignInNotice()).toBe('Sign in with OnlyWorlds was cancelled. Nothing changed.');
    expect(await db.kvGet('accountToken')).toBeUndefined();
    expect(keel.calls).toEqual([]);
  });

  it('each reason in Lantern words, never keel text', () => {
    const line = (reason: string) => signin.signInCallbackLine({ cancelled: false, error: new OwSignInError(reason as never, 'keel words') });
    expect(line('state_mismatch')).toMatch(/not started here/);
    expect(line('invalid_grant')).toMatch(/waited too long/);
    expect(line('rate_limited')).toMatch(/Too many sign-ins/);
    expect(line('offline')).toMatch(/could not be reached/);
    expect(line('failed')).toBe('Signing in with OnlyWorlds did not work. Try again in a moment.');
    for (const r of ['state_mismatch', 'invalid_grant', 'rate_limited', 'offline', 'failed']) expect(line(r)).not.toMatch(/keel words|—/);
  });

  it('a used code is refused with its sentence and keeps nothing; a waiting invitation still waits', async () => {
    await setPendingJoin('abc-123');
    keel.tokenAnswer = 'invalid_grant';
    const out = await signin.startSignInCallback(await tapAndReturn(), keel.fetch as typeof fetch);
    expect(await signin.applySignInOutcome(out)).toBe('#/signin');
    expect(signin.takeSignInNotice()).toMatch(/waited too long/);
    expect(await db.kvGet('accountToken')).toBeUndefined();
    expect(await db.kvGet('pendingJoin')).toBe('abc-123');
  });

  it('a return to a phone that never started one, signed out, says so', async () => {
    const out = await signin.startSignInCallback('https://lantern.onlyworlds.com/signin/callback?code=x&state=y', keel.fetch as typeof fetch);
    expect(await signin.applySignInOutcome(out)).toBe('#/signin');
    expect(signin.takeSignInNotice()).toMatch(/not started here/);
  });
});

describe('L7: a return this phone did not start, while signed in, is silent', () => {
  it('silent too when a stale record from an abandoned tap is still here (the sign-in gate G5)', async () => {
    await db.kvSet('accountToken', 'ow_a_kept');
    store.set(signin.SIGN_IN_RECORD_KEY, JSON.stringify({ state: 'other', verifier: 'v', redirectUri: 'https://lantern.onlyworlds.com/signin/callback' }));
    const out = await signin.startSignInCallback('https://lantern.onlyworlds.com/signin/callback?code=x&state=y', keel.fetch as typeof fetch);
    expect(await signin.applySignInOutcome(out)).toBe('#/worlds');
    expect(signin.takeSignInNotice()).toBeNull();
  });

  it('Back after a finished sign-in: Your worlds, no line, the token unchanged', async () => {
    await db.kvSet('accountToken', 'ow_a_kept');
    const out = await signin.startSignInCallback('https://lantern.onlyworlds.com/signin/callback?code=x&state=y', keel.fetch as typeof fetch);
    expect(await signin.applySignInOutcome(out)).toBe('#/worlds');
    expect(signin.takeSignInNotice()).toBeNull();
    expect(await db.kvGet('accountToken')).toBe('ow_a_kept');
    expect(keel.calls).toEqual([]);
  });
});

describe('L2: no signal, no leaving', () => {
  it('the tap says so and the record is never written', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false, userAgent: 'test' }, configurable: true });
    let to = '';
    await expect(signin.beginOnlyWorldsSignIn((u) => (to = u))).rejects.toThrow(signin.NEEDS_SIGNAL_LINE);
    expect(to).toBe('');
    expect(store.has(signin.SIGN_IN_RECORD_KEY)).toBe(false);
  });
});
