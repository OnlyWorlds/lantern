// A world whose key keel refuses takes a new one in place (Atlas's twin): made from the
// account, or pasted. The copy on the phone stays (its elements, its cursor, its changes waiting);
// only the key changes. The fake keel follows keel's accounts/api.py (the mint, pin_required for a
// member with no PIN) and core/auth.py (a revoked key, an unknown one).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
const session = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  sessionStorage: {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => void session.set(k, v),
    removeItem: (k: string) => void session.delete(k),
  },
});

const db = await import('../src/db');
const { renewWorldKey, putKeyInPlace } = await import('../src/account');
const { keyRefusalOf, newKeyCures, keyRefusalText } = await import('../src/keyrefusal');

const W = '0ddd0000-0000-4000-8000-000000000004';
const OLD = 'ow_w_' + 'O'.repeat(32);
const WRITE = 'ow_w_' + 'W'.repeat(32);
const READ = 'ow_r_' + 'R'.repeat(32);
const PASTED = 'ow_w_' + 'P'.repeat(32);
const OTHER = 'ow_w_' + 'X'.repeat(32);

class FakeKeel {
  rows: Array<Record<string, unknown>> = [];
  hasPin = true;
  mints: string[] = [];
  /** World keys keel answers GET /world for, and the world each opens. */
  worlds = new Map<string, { id: string; name: string }>();
  revoked = new Set<string>();

  json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const headers = new Headers(init.headers);
    if (path.startsWith('/account')) {
      if (headers.get('Authorization') !== 'Bearer ow_a_test') return this.json(401, { error: { code: 'invalid_credentials', param: null } });
      if (path === '/account/worlds') return this.json(200, { data: this.rows });
      if (path === `/account/worlds/${W}/keys` && method === 'POST') {
        const scope = JSON.parse(String(init.body ?? '{}')).scope ?? 'write';
        const row = this.rows.find((r) => r.id === W);
        if (scope === 'write' && row?.role !== 'owner' && !this.hasPin) return this.json(409, { error: { code: 'pin_required', message: 'Set an account PIN first.', param: null } });
        this.mints.push(scope);
        const key = scope === 'read' ? READ : WRITE;
        this.worlds.set(key, { id: W, name: 'Kessel' });
        return this.json(201, { id: `k-${this.mints.length}`, last4: key.slice(-4), scope: scope.toUpperCase(), key });
      }
      return this.json(500, { error: { code: 'unexpected', message: `${method} ${path}` } });
    }
    const key = headers.get('API-Key') ?? '';
    if (this.revoked.has(key)) return this.json(401, { error: { code: 'key_revoked', message: 'This key has been revoked.', param: null } });
    const world = this.worlds.get(key);
    if (!world) return this.json(401, { error: { code: 'invalid_credentials', message: 'No valid API-Key.', param: null } });
    if (path === '/world') return this.json(200, world);
    return this.json(500, { error: { code: 'unexpected', message: `${method} ${path}` } });
  };
}

let keel: FakeKeel;
beforeEach(async () => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
  session.clear();
  await db.kvSet('accountToken', 'ow_a_test');
  await db.removeWorld(W); // fake IndexedDB outlives a test: each starts from one row
  await db.putWorldRecord({ id: W, name: 'Kessel', kind: 'online', apiKey: OLD, keyKind: 'write', role: 'collaborator', memberRole: 'co_builder', characterId: 'c-1', cursor: '42:0:0', addedAt: '' });
  await db.applyElements(W, [{ id: 'a', type: 'character', name: 'Ada' } as never]);
  await db.putOutboxRow(W, { id: 'a', type: 'character', op: 'patch', values: { name: 'Ada Vell' }, state: 'waiting' } as never);
});

const rec = async () => (await db.getWorldRecord(W))!;

describe('keel\'s refusals, read', () => {
  it('four causes, and only a key\'s are cured by a new key', () => {
    const e = (status: number, code: string, param: string | null = null) => Object.assign(new Error(code), { status, code, param });
    expect(keyRefusalOf(e(401, 'key_revoked'))).toBe('key_revoked');
    expect(keyRefusalOf(e(401, 'invalid_credentials'))).toBe('key_unknown');
    expect(keyRefusalOf(e(401, 'invalid_credentials', 'API-Pin'))).toBe('pin');
    expect(keyRefusalOf(e(403, 'permission_error'))).toBe('read_only_key');
    expect(keyRefusalOf(e(403, 'not_author'))).toBeNull();
    expect(newKeyCures('pin')).toBe(false);
    expect(newKeyCures('key_unknown')).toBe(true);
    for (const r of ['key_revoked', 'key_unknown', 'read_only_key'] as const) expect(keyRefusalText(r)).not.toMatch(/PIN|—/);
  });
});

describe('a key made from the account', () => {
  it('takes the dead key\'s place; the copy, its cursor and the change waiting stay', async () => {
    keel.rows = [{ id: W, name: 'Kessel', role: 'collaborator', member_role: 'co_builder' }];
    expect(await renewWorldKey(await rec(), 'key_unknown')).toEqual({ readOnly: false });
    const after = await rec();
    expect(after.apiKey).toBe(WRITE);
    expect(after.keyKind).toBe('write');
    expect(after.cursor).toBe('42:0:0');
    expect((await db.allElements(W)).map((e) => e.id)).toEqual(['a']);
    expect((await db.outboxRows(W)).map((r) => r.values)).toEqual([{ name: 'Ada Vell' }]);
    expect(keel.mints).toEqual(['write']);
  });

  it('a member with no PIN yet gets a read key, still better than a dead one', async () => {
    keel.rows = [{ id: W, name: 'Kessel', role: 'collaborator', member_role: 'contributor' }];
    keel.hasPin = false;
    expect(await renewWorldKey(await rec(), 'key_revoked')).toEqual({ readOnly: true });
    expect((await rec()).apiKey).toBe(READ);
    expect(keel.mints).toEqual(['read']);
  });

  it('a guest gets a read key and is never offered a write one', async () => {
    keel.rows = [{ id: W, name: 'Kessel', role: 'collaborator', member_role: 'guest' }];
    expect(await renewWorldKey(await rec(), 'key_revoked')).toEqual({ readOnly: true });
    expect(keel.mints).toEqual(['read']);
  });

  it('gone only when keel no longer knew the key; otherwise only not this account\'s', async () => {
    keel.rows = [];
    await expect(renewWorldKey(await rec(), 'key_unknown')).rejects.toThrow(/deleted there, or you were removed from it/);
    await expect(renewWorldKey(await rec(), 'key_revoked')).rejects.toThrow(/not on the account this phone is signed in to/);
    expect(keel.mints).toEqual([]);
    expect((await rec()).apiKey).toBe(OLD);
  });

  it('signed out, nothing is made', async () => {
    await db.kvSet('accountToken', undefined);
    await expect(renewWorldKey(await rec(), 'key_revoked')).rejects.toThrow(/Sign in first/);
  });
});

describe('a pasted key', () => {
  it('must open this world, and takes the old one\'s place with the copy kept', async () => {
    keel.worlds.set(OTHER, { id: 'someone-else', name: 'Elsewhere' });
    await expect(putKeyInPlace(await rec(), OTHER)).rejects.toThrow('That key is for another world, "Elsewhere"');
    await expect(putKeyInPlace(await rec(), OLD)).rejects.toThrow(/has now/);
    await expect(putKeyInPlace(await rec(), 'ow_a_' + 'z'.repeat(40))).rejects.toThrow(/account token/);
    keel.revoked.add(PASTED);
    await expect(putKeyInPlace(await rec(), PASTED)).rejects.toThrow(/revoked too/);
    keel.revoked.clear();
    await expect(putKeyInPlace(await rec(), PASTED)).rejects.toThrow(/does not know that key/);
    expect((await rec()).apiKey).toBe(OLD);

    keel.worlds.set(PASTED, { id: W, name: 'Kessel' });
    await putKeyInPlace(await rec(), `  ${PASTED} `);
    const after = await rec();
    expect(after.apiKey).toBe(PASTED);
    expect(after.characterId).toBeUndefined();
    expect(after.cursor).toBe('42:0:0');
    expect((await db.outboxRows(W)).length).toBe(1);
  });
});
