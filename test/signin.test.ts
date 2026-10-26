// Sign in with a password through SDK 4.31's signInWithPassword (as Atlas 1.52
// does the same), against a fake keel shaped by the app client's answers: login gives a session,
// POST /account/tokens with that session mints the phone's token, the session is ended either way.
// Only the token is kept; a refusal is said in Lantern's words, never keel's.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

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
const { accountName, signInWithPassword, signOut } = await import('../src/account');

class FakeKeel {
  logins: Record<string, unknown>[] = [];
  minted: string[] = [];
  ended = 0;
  verified = true;
  accountId = 'acc-ana';
  worldsDown = false;
  offline = false;

  json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const headers = new Headers(init.headers);
    if (path === '/auth/app/v1/auth/login' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      this.logins.push(body);
      const who = body.email ?? body.username;
      if ((who !== 'ana@example.com' && who !== 'ana') || body.password !== 'right') {
        return this.json(400, { status: 400, errors: [{ message: 'The email address and/or password you specified are not correct.', code: 'email_password_mismatch' }] });
      }
      if (!this.verified) {
        return this.json(401, { status: 401, data: { flows: [{ id: 'verify_email', is_pending: true }] }, meta: { is_authenticated: false } });
      }
      return this.json(200, { status: 200, data: { user: { username: 'ana' } }, meta: { is_authenticated: true, session_token: 'sess-1' } });
    }
    if (path === '/auth/app/v1/auth/session' && method === 'DELETE') {
      this.ended++;
      return this.json(401, { status: 401, meta: { is_authenticated: false } });
    }
    if (path === '/account/tokens' && method === 'POST') {
      if (headers.get('X-Session-Token') !== 'sess-1') return this.json(401, { error: { code: 'invalid_credentials' } });
      const name = JSON.parse(String(init.body)).name;
      this.minted.push(name);
      return this.json(201, { id: 'tok-1', name, last4: 'abcd', token: 'ow_a_minted0000abcd' });
    }
    if (path === '/account' && method === 'GET') {
      // keel's profile, unwrapped (accounts/api.py _profile): which account the token is.
      if (headers.get('Authorization') !== 'Bearer ow_a_minted0000abcd') return this.json(401, { error: { code: 'invalid_credentials' } });
      return this.json(200, { id: this.accountId, username: 'ana', email: 'ana@example.com', date_joined: null });
    }
    if (path === '/account/worlds' && method === 'GET') {
      if (headers.get('Authorization') !== 'Bearer ow_a_minted0000abcd') return this.json(401, { error: { code: 'invalid_credentials' } });
      if (this.worldsDown) throw new TypeError('Failed to fetch');
      return this.json(200, { data: [{ id: 'w1', name: 'Blood Meridian', role: 'owner' }] });
    }
    return this.json(404, { error: { code: 'not_found' } });
  };
}

let keel: FakeKeel;
beforeEach(async () => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
  await db.kvSet('accountToken', undefined);
  await db.kvSet('accountId', undefined);
  await db.kvSet('accountName', undefined);
  await db.kvSet('accountWorlds', undefined);
  for (const w of await db.listWorlds()) await db.removeWorld(w.id);
});

describe('signing in with a password', () => {
  it('keeps only the phone\'s own token, named for it, and ends the session', async () => {
    const worlds = await signInWithPassword(' ana@example.com ', 'right');
    expect(worlds.map((w) => w.name)).toEqual(['Blood Meridian']);
    expect(await db.kvGet('accountToken')).toBe('ow_a_minted0000abcd');
    expect(keel.logins).toEqual([{ email: 'ana@example.com', password: 'right' }]);
    expect(keel.minted).toHaveLength(1);
    expect(keel.minted[0]).toMatch(/^Lantern on /);
    expect(keel.ended).toBe(1);
    const kept = JSON.stringify([...store.values()]);
    expect(kept.includes('right')).toBe(false);
  });

  it('keeps which account it is, so Lantern can name it', async () => {
    await signInWithPassword('ana', 'right');
    expect(await db.kvGet('accountId')).toBe('acc-ana');
    expect(await accountName()).toBe('ana');
  });

  it('another account than the last holds the old role aside, with its PIN slot and list let go (the sign-in gate G6)', async () => {
    await signInWithPassword('ana', 'right');
    await db.putWorldRecord({ id: 'w-ana', name: 'Ana own', kind: 'online', apiKey: 'k', role: 'collaborator', memberRole: 'contributor' } as never);
    store.set('lantern-pin-account', '1234');
    // The same account again, no sign-out between: nothing let go.
    await signInWithPassword('ana', 'right');
    expect((await db.getWorldRecord('w-ana'))?.role).toBe('collaborator');
    expect(store.get('lantern-pin-account')).toBe('1234');
    expect(await db.kvGet('accountWorlds')).not.toBeUndefined();
    // Another account, straight over the first (no sign-out to clear anything first).
    keel.accountId = 'acc-bo';
    keel.worldsDown = true;
    // A tap on Sign in with OnlyWorlds abandoned before this: its record goes with the sign-in.
    store.set('ow_signin:lantern', '{"state":"s"}');
    await signInWithPassword('ana', 'right');
    const held = await db.getWorldRecord('w-ana');
    expect(held?.role).toBeUndefined();
    expect(held?.heldRole).toBe('collaborator');
    expect(held?.heldBy).toBe('acc-ana');
    expect(held?.memberRole).toBe('contributor');
    expect(store.has('lantern-pin-account')).toBe(false);
    expect(await db.kvGet('accountWorlds')).toBeUndefined();
    expect(store.has('ow_signin:lantern')).toBe(false);
    expect(await db.kvGet('accountId')).toBe('acc-bo');
    // The first account again: its role comes back (the code gate C1).
    keel.accountId = 'acc-ana';
    await signInWithPassword('ana', 'right');
    const back = await db.getWorldRecord('w-ana');
    expect(back?.role).toBe('collaborator');
    expect(back?.heldBy).toBeUndefined();
    expect(back?.memberRole).toBe('contributor');
  });

  it('a phone with no account id kept treats the next account as unknown, never as another', async () => {
    await db.putWorldRecord({ id: 'w-x', name: 'X', kind: 'online', apiKey: 'k', role: 'owner' } as never);
    keel.accountId = 'acc-bo';
    await signInWithPassword('ana', 'right');
    expect((await db.getWorldRecord('w-x'))?.role).toBe('owner');
  });

  it('a list that fails after the token is kept is no failed sign-in (the code gate C4)', async () => {
    keel.worldsDown = true;
    await expect(signInWithPassword('ana', 'right')).resolves.toEqual([]);
    expect(await db.kvGet('accountToken')).toBe('ow_a_minted0000abcd');
  });

  it('takes a username as well as an email', async () => {
    await signInWithPassword('ana', 'right');
    expect(keel.logins).toEqual([{ username: 'ana', password: 'right' }]);
    expect(await db.kvGet('accountToken')).toBe('ow_a_minted0000abcd');
  });

  it('says a wrong password, an unconfirmed email and no signal in Lantern\'s words, and keeps nothing', async () => {
    await expect(signInWithPassword('ana@example.com', 'wrong')).rejects.toThrow('That email or username and password did not match an OnlyWorlds account.');
    keel.verified = false;
    await expect(signInWithPassword('ana@example.com', 'right')).rejects.toThrow('Confirm your email first');
    keel.offline = true;
    await expect(signInWithPassword('ana@example.com', 'right')).rejects.toThrow('No connection. Signing in needs signal.');
    expect(await db.kvGet('accountToken')).toBeUndefined();
    expect(keel.minted).toHaveLength(0);
  });
});
