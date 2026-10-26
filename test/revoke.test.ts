// Sign out revokes the token Lantern made (S476, Atlas 1.93.0's twin; contract
// `Forge/Notes/2026-10-25-s476-lantern-token-revoke-contract.md`), against a fake keel shaped by
// what S475 probed on a crew account: DELETE /account/tokens/{id} with the token as its own bearer
// answers 204, then 401 to that token; 404 when the id is not the bearer's account's (still live).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const db = await import('../src/db');
const { signIn, signInWithPassword, signOut, signedOutLine, revokeIfNotKept, TOKEN_MAY_WORK } = await import('../src/account');
const settle = () => new Promise((r) => setTimeout(r, 50));
const { applySignInOutcome } = await import('../src/signin');
const { mintedTokenId, mintOf, revokeToken } = await import('../src/revoke');
import type { TokenMint } from '../src/revoke';

const ID_A = '0b6f2a4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
const ID_B = '9e8d7c6b-5a49-4382-9716-a5b4c3d2e1f0';
const TOKEN_A = 'ow_a_minted0000aaaa1111';
const TOKEN_PASTED = 'ow_a_pasted0000bbbb2222';

interface Deleted { id: string; bearer: string | null; keepalive: boolean | undefined }

class FakeKeel {
  live = new Map<string, string>([[TOKEN_A, ID_A], [TOKEN_PASTED, ID_B]]);
  deletes: Deleted[] = [];
  profileDown = false;
  deleteStatus: number | null = null;
  refuseKeepalive = false;
  offline = false;

  json(status: number, body?: unknown) {
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const bearer = new Headers(init.headers).get('Authorization')?.replace(/^Bearer /, '') ?? null;
    if (path === '/auth/app/v1/auth/login' && method === 'POST') {
      return this.json(200, { status: 200, data: { user: { username: 'ana' } }, meta: { is_authenticated: true, session_token: 'sess-1' } });
    }
    if (path === '/auth/app/v1/auth/session' && method === 'DELETE') return this.json(401, { status: 401, meta: { is_authenticated: false } });
    if (path === '/account/tokens' && method === 'POST') {
      return this.json(201, { id: ID_A, name: JSON.parse(String(init.body)).name, last4: '1111', token: TOKEN_A });
    }
    const del = path.match(/^\/account\/tokens\/([^/]+)$/);
    if (del && method === 'DELETE') {
      if (init.keepalive && this.refuseKeepalive) throw new TypeError('keepalive refused');
      this.deletes.push({ id: decodeURIComponent(del[1]), bearer, keepalive: init.keepalive });
      if (this.deleteStatus !== null) return this.json(this.deleteStatus, {});
      if (!bearer || !this.live.has(bearer)) return this.json(401, { error: { code: 'key_revoked' } });
      if (this.live.get(bearer) !== decodeURIComponent(del[1])) return this.json(404, { error: { code: 'not_found' } });
      this.live.delete(bearer);
      return this.json(204);
    }
    if (!bearer || !this.live.has(bearer)) return this.json(401, { error: { code: 'invalid_credentials' } });
    if (path === '/account' && method === 'GET') {
      if (this.profileDown) return this.json(500, {});
      return this.json(200, { id: 'acc-ana', username: 'ana' });
    }
    if (path === '/account/worlds' && method === 'GET') return this.json(200, { data: [] });
    return this.json(404, { error: { code: 'not_found' } });
  };
}

let keel: FakeKeel;
beforeEach(async () => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
  for (const k of ['accountToken', 'accountTokenMint', 'accountId', 'accountName', 'accountWorlds']) await db.kvSet(k, undefined);
});

describe('the revoke itself', () => {
  it('sends DELETE by the id with the token as its bearer, keepalive; 204 and 401 are revoked', async () => {
    expect(await revokeToken(TOKEN_A, ID_A)).toBe('revoked');
    expect(keel.deletes).toEqual([{ id: ID_A, bearer: TOKEN_A, keepalive: true }]);
    expect(keel.live.has(TOKEN_A)).toBe(false);
    // Again: the token works no more (401), which is revoked too.
    expect(await revokeToken(TOKEN_A, ID_A)).toBe('revoked');
  });

  it('a 404 means the token is still live; a 500, no answer and the time limit are not revoked', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await revokeToken(TOKEN_A, ID_B)).toBe('kept');
    expect(keel.live.has(TOKEN_A)).toBe(true);
    keel.deleteStatus = 500;
    expect(await revokeToken(TOKEN_A, ID_A)).toBe('kept');
    keel.deleteStatus = null;
    keel.offline = true;
    expect(await revokeToken(TOKEN_A, ID_A)).toBe('kept');
    const hang = (() => new Promise<Response>((_, reject) => setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 50))) as typeof fetch;
    expect(await revokeToken(TOKEN_A, ID_A, { fetch: hang, limitMs: 10 })).toBe('kept');
    err.mockRestore();
    warn.mockRestore();
  });

  it('a refused keepalive request is sent once more without it', async () => {
    keel.refuseKeepalive = true;
    expect(await revokeToken(TOKEN_A, ID_A)).toBe('revoked');
    expect(keel.deletes).toEqual([{ id: ID_A, bearer: TOKEN_A, keepalive: false }]);
  });

  it('never sends an id that is not keel-shaped', async () => {
    expect(await revokeToken(TOKEN_A, 'tok-1')).toBe('kept');
    expect(await revokeToken(TOKEN_A, '../worlds')).toBe('kept');
    expect(keel.deletes).toEqual([]);
  });

  it('an id counts only beside the token it came with', () => {
    const mint = mintOf(TOKEN_A, ID_A)!;
    expect(mintedTokenId(TOKEN_A, mint)).toBe(ID_A);
    // An older Lantern in another window wrote a new token and left the record standing.
    expect(mintedTokenId(TOKEN_PASTED, mint)).toBeUndefined();
    expect(mintedTokenId(undefined, mint)).toBeUndefined();
    expect(mintOf(TOKEN_A, 'tok-1')).toBeUndefined();
    expect(mintOf(TOKEN_A, null)).toBeUndefined();
  });
});

describe('Sign out', () => {
  it('a password sign-in keeps the id; Sign out lets go first, then revokes, and says so', async () => {
    await signInWithPassword('ana', 'right');
    expect(await db.kvGet('accountTokenMint')).toEqual({ id: ID_A, tail: TOKEN_A.slice(-8) });
    const { revoking } = await signOut();
    // Signed out before keel answered.
    expect(await db.kvGet('accountToken')).toBeUndefined();
    expect(await db.kvGet('accountTokenMint')).toBeUndefined();
    expect(revoking).not.toBeNull();
    expect(await revoking).toBe('revoked');
    expect(keel.deletes).toEqual([{ id: ID_A, bearer: TOKEN_A, keepalive: true }]);
    expect(keel.live.has(TOKEN_A)).toBe(false);
  });

  it('Sign in with OnlyWorlds keeps the id from the exchange, and Sign out revokes it', async () => {
    await applySignInOutcome({ ok: true, token: TOKEN_A, tokenId: ID_A, account: { id: 'acc-ana', username: 'ana' } });
    expect(await db.kvGet('accountTokenMint')).toEqual({ id: ID_A, tail: TOKEN_A.slice(-8) });
    expect(await (await signOut()).revoking).toBe('revoked');
    expect(keel.deletes.map((d) => d.id)).toEqual([ID_A]);
  });

  it('Sign out never waits on keel: signed out while the DELETE is still pending', async () => {
    await signInWithPassword('ana', 'right');
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const inner = keel.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'DELETE' && String(input).includes('/account/tokens/')) await held;
      return inner(input, init);
    }) as typeof fetch;
    const out = await Promise.race([signOut(), new Promise<'waited'>((r) => setTimeout(() => r('waited'), 500))]);
    expect(out).not.toBe('waited');
    expect(await db.kvGet('accountToken')).toBeUndefined();
    release();
    expect(await (out as { revoking: Promise<string> | null }).revoking).toBe('revoked');
  });

  it('a step after the token is let go that fails still leaves the revoke sent (the S476 gate S4)', async () => {
    await signInWithPassword('ana', 'right');
    const kvSet = db.kvSet;
    const spy = vi.spyOn(db, 'kvSet').mockImplementation(async (k: string, v: unknown) => {
      if (k === 'pendingJoin') throw new Error('closed');
      return kvSet(k, v);
    });
    await expect(signOut()).rejects.toThrow();
    spy.mockRestore();
    await vi.waitFor(() => expect(keel.deletes.map((d) => d.id)).toEqual([ID_A]));
  });

  it('a pasted token is never revoked, and its keep clears the record of the one before (which it lets go)', async () => {
    await signInWithPassword('ana', 'right');
    await signIn(TOKEN_PASTED);
    expect(await db.kvGet('accountTokenMint')).toBeUndefined();
    // The minted token the paste replaced is taken back (2026-10-26); the paste never is.
    await vi.waitFor(() => expect(keel.deletes.map((d) => [d.id, d.bearer])).toEqual([[ID_A, TOKEN_A]]));
    expect((await signOut()).revoking).toBeNull();
    expect(keel.deletes).toHaveLength(1);
    expect(keel.live.has(TOKEN_PASTED)).toBe(true);
  });

  it('a record that does not match the token sends nothing', async () => {
    await signIn(TOKEN_PASTED);
    await db.kvSet('accountTokenMint', mintOf(TOKEN_A, ID_A));
    expect((await signOut()).revoking).toBeNull();
    expect(keel.deletes).toEqual([]);
  });

  it('offline: signed out all the same, and the line says it could not confirm', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await signInWithPassword('ana', 'right');
    keel.offline = true;
    const { revoking } = await signOut();
    expect(await db.kvGet('accountToken')).toBeUndefined();
    expect(await revoking).toBe('kept');
    warn.mockRestore();
  });

  it('says each outcome in its own words', () => {
    expect(signedOutLine('revoked', 'Worlds already on this phone stay.')).toBe("Signed out. Lantern's token is revoked on OnlyWorlds. Worlds already on this phone stay.");
    expect(signedOutLine('kept', 'Worlds already on this phone stay.')).toBe(`Signed out here. Worlds already on this phone stay. ${TOKEN_MAY_WORK}`);
    // The remove button's news survives a revoke that did not answer (the S476 gate's S3).
    expect(signedOutLine('kept', '2 worlds removed from this phone.')).toContain('2 worlds removed from this phone.');
    expect(signedOutLine(null, '2 worlds removed from this phone.')).toBe('Signed out. 2 worlds removed from this phone.');
    for (const o of ['revoked', 'kept', null] as const) expect(signedOutLine(o, 'x')).not.toMatch(/—/);
  });
});

describe('a token minted and not kept', () => {
  it('the password door: the profile fails after the mint, so the minted token is revoked at once', async () => {
    keel.profileDown = true;
    await expect(signInWithPassword('ana', 'right')).rejects.toThrow();
    // The refusal came first; the revoke follows (the S476 gate's S2).
    expect(await db.kvGet('accountToken')).toBeUndefined();
    await vi.waitFor(() => expect(keel.deletes).toEqual([{ id: ID_A, bearer: TOKEN_A, keepalive: true }]));
  });

  it('the refusal is said without waiting on the revoke', async () => {
    keel.profileDown = true;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const inner = keel.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'DELETE' && String(input).includes('/account/tokens/')) await held;
      return inner(input, init);
    }) as typeof fetch;
    const out = await Promise.race([signInWithPassword('ana', 'right').catch(() => 'refused'), new Promise((r) => setTimeout(() => r('waited'), 500))]);
    expect(out).toBe('refused');
    release();
    await vi.waitFor(() => expect(keel.deletes).toHaveLength(1));
  });

  it('a store that does not answer leaves the token alone: it may have landed (the S476 gate S1)', async () => {
    const spy = vi.spyOn(db, 'kvGet').mockRejectedValue(new Error('closed'));
    await revokeIfNotKept(TOKEN_A, ID_A);
    spy.mockRestore();
    expect(keel.deletes).toEqual([]);
  });

  it('Sign in with OnlyWorlds: a keep that fails revokes the token it was given', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const kvSet = db.kvSet;
    const spy = vi.spyOn(db, 'kvSet').mockImplementation(async (k: string, v: unknown) => {
      if (k === 'accountToken' && v) throw new Error('quota');
      return kvSet(k, v);
    });
    expect(await applySignInOutcome({ ok: true, token: TOKEN_A, tokenId: ID_A, account: { id: 'acc-ana', username: 'ana' } })).toBe('#/signin');
    spy.mockRestore();
    warn.mockRestore();
    await vi.waitFor(() => expect(keel.deletes.map((d) => [d.id, d.bearer])).toEqual([[ID_A, TOKEN_A]]));
  });

  it('a token the phone holds is never revoked by a failed sign-in', async () => {
    keel.live.set(TOKEN_A, ID_A);
    await signInWithPassword('ana', 'right');
    keel.deletes = [];
    // The same account again, the profile down this time: the token kept before is the same string.
    keel.profileDown = true;
    await expect(signInWithPassword('ana', 'right')).rejects.toThrow();
    await settle();
    expect(keel.deletes).toEqual([]);
  });
});

describe('a sign-in over a token Lantern minted (2026-10-26)', () => {
  const TOKEN_C = 'ow_a_minted0000cccc3333';
  const ID_C = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';

  it('lets the old token go by its id, after the new one is kept', async () => {
    keel.live.set(TOKEN_C, ID_C);
    await signInWithPassword('ana', 'right');
    let keptFirst: string | undefined;
    const send = keel.fetch;
    keel.fetch = async (input, init = {}) => {
      if ((init.method ?? 'GET').toUpperCase() === 'DELETE') {
        const mint = await db.kvGet<TokenMint>('accountTokenMint');
        // Both writes are done before the old token is sent away (the gate's S3).
        keptFirst = mint?.id === ID_C ? await db.kvGet<string>('accountToken') : 'mint not written yet';
      }
      return send(input, init);
    };
    globalThis.fetch = keel.fetch as typeof fetch;
    await applySignInOutcome({ ok: true, token: TOKEN_C, tokenId: ID_C, account: { id: 'acc-ana', username: 'ana' } });
    await vi.waitFor(() => expect(keel.deletes.map((d) => [d.id, d.bearer])).toEqual([[ID_A, TOKEN_A]]));
    expect(keptFirst).toBe(TOKEN_C);
    expect(keel.live.has(TOKEN_A)).toBe(false);
    expect(keel.live.has(TOKEN_C)).toBe(true);
    expect(await db.kvGet('accountTokenMint')).toEqual({ id: ID_C, tail: TOKEN_C.slice(-8) });
  });

  it('the same token kept again, a pasted token before, or nothing before: nothing is sent', async () => {
    await signInWithPassword('ana', 'right');
    // The fake mints the same token again: kept again, never sent away.
    await signInWithPassword('ana', 'right');
    await settle();
    expect(keel.deletes).toEqual([]);
    expect(keel.live.has(TOKEN_A)).toBe(true);
    // A paste over it lets the minted one go (the Sign out case above); what follows the paste is the case here.
    await signIn(TOKEN_PASTED);
    await settle();
    keel.deletes = [];
    keel.live.set(TOKEN_C, ID_C);
    await applySignInOutcome({ ok: true, token: TOKEN_C, tokenId: ID_C, account: { id: 'acc-ana', username: 'ana' } });
    await settle();
    expect(keel.deletes).toEqual([]);
  });

  it('a token write that fails sends nothing: the old token stays the working one', async () => {
    await signInWithPassword('ana', 'right');
    keel.deletes = [];
    const set = db.kvSet;
    const spy = vi.spyOn(db, 'kvSet').mockImplementation(async (k: string, v: unknown) => {
      if (k === 'accountToken' && v === TOKEN_C) throw new Error('store refused');
      return set(k, v);
    });
    keel.live.set(TOKEN_C, ID_C);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await applySignInOutcome({ ok: true, token: TOKEN_C, tokenId: ID_C, account: { id: 'acc-ana', username: 'ana' } }).catch(() => undefined);
    expect(spy).toHaveBeenCalledWith('accountToken', TOKEN_C);
    spy.mockRestore();
    await settle();
    expect(keel.deletes.filter((d) => d.id === ID_A)).toEqual([]);
    expect(keel.live.has(TOKEN_A)).toBe(true);
  });

  it('a store that does not answer what it holds sends nothing (never a guess), and the sign-in still lands', async () => {
    await signInWithPassword('ana', 'right');
    keel.deletes = [];
    const get = db.kvGet;
    const spy = vi.spyOn(db, 'kvGet').mockImplementation(async (k: string) => {
      if (k === 'accountTokenMint') throw new Error('store down');
      return get(k);
    });
    keel.live.set(TOKEN_C, ID_C);
    await applySignInOutcome({ ok: true, token: TOKEN_C, tokenId: ID_C, account: { id: 'acc-ana', username: 'ana' } }).catch(() => undefined);
    expect(spy).toHaveBeenCalledWith('accountTokenMint');
    spy.mockRestore();
    await settle();
    expect(keel.deletes).toEqual([]);
    expect(await db.kvGet('accountToken')).toBe(TOKEN_C);
  });
});
