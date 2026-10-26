// A member who joined with no PIN on their account (#294's walk, 2026-10-16): the world opens to read,
// the home says why, and once they set a PIN "try again" puts a write key in place of the read one.
// The fake keel follows keel's accounts/api.py: POST /account/worlds/{id}/keys answers 409
// pin_required for a member's write key while the account has no PIN; GET lists the member's own
// keys (last4 only); DELETE /keys/{key_id} takes one back (204).
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
const { openAccountWorld, readsForWantOfPin, takeNoPinMark, upgradeMemberKey, NO_PIN_YET } = await import('../src/account');

const W = '0ccc0000-0000-4000-8000-000000000003';
const READ = 'ow_r_' + 'R'.repeat(28) + 'RRRR';
const WRITE = 'ow_w_' + 'W'.repeat(28) + 'WWWW';
const kid = (n: number) => `0ccc0000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

class FakeKeel {
  hasPin = false;
  keys: Array<{ id: string; last4: string; scope: 'READ' | 'WRITE' }> = [];
  deleted: string[] = [];

  json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    if (new Headers(init.headers).get('Authorization') !== 'Bearer ow_a_test') return this.json(401, { error: { code: 'invalid_credentials' } });
    if (path === `/account/worlds/${W}/keys` && method === 'POST') {
      const scope = JSON.parse(String(init.body ?? '{}')).scope ?? 'write';
      if (scope === 'write' && !this.hasPin) return this.json(409, { error: { code: 'pin_required', message: 'Set an account PIN first.' } });
      const key = scope === 'read' ? READ : WRITE;
      // keel's key ids are UUIDs (accounts/api.py `_key_row`: str(wk.id)).
      const row = { id: kid(this.keys.length + 1), last4: key.slice(-4), scope: scope === 'read' ? 'READ' as const : 'WRITE' as const };
      this.keys.push(row);
      return this.json(201, { ...row, name: '', revoked: false, key });
    }
    if (path === `/account/worlds/${W}/keys` && method === 'GET') return this.json(200, { data: this.keys });
    const del = path.match(new RegExp(`^/account/worlds/${W}/keys/([^/]+)$`));
    if (del && method === 'DELETE') {
      this.deleted.push(del[1]);
      this.keys = this.keys.filter((k) => k.id !== del[1]);
      return new Response(null, { status: 204 });
    }
    return this.json(500, { error: { code: 'unexpected', message: `${method} ${path}` } });
  };
}

const ROW = { id: W, name: 'Temper walk', role: 'collaborator' as const, member_role: 'contributor' as const };

let keel: FakeKeel;
beforeEach(async () => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
  session.clear();
  await db.kvSet('accountToken', 'ow_a_test');
});

describe('a member with no PIN', () => {
  it('opens to read, is marked as reading for want of a PIN, and the home says so once', async () => {
    const rec = await openAccountWorld(ROW);
    expect(rec.apiKey).toBe(READ);
    expect(readsForWantOfPin(rec)).toBe(true);
    expect(takeNoPinMark(W)).toBe(true);
    expect(takeNoPinMark(W)).toBe(false);
  });

  it('is never a guest, an owner, or a member already on a write key', () => {
    const base = { id: W, name: 'x', kind: 'online' as const, addedAt: '' };
    expect(readsForWantOfPin({ ...base, role: 'collaborator', memberRole: 'guest', apiKey: READ })).toBe(false);
    expect(readsForWantOfPin({ ...base, role: 'owner', apiKey: READ })).toBe(false);
    expect(readsForWantOfPin({ ...base, role: 'collaborator', memberRole: 'contributor', apiKey: WRITE })).toBe(false);
    expect(readsForWantOfPin({ ...base, apiKey: READ })).toBe(false); // opened with a key someone gave
  });

  it('try again with still no PIN says so and keeps the read key', async () => {
    const rec = await openAccountWorld(ROW);
    await expect(upgradeMemberKey(rec)).rejects.toThrow(NO_PIN_YET);
    expect((await db.getWorldRecord(W))?.apiKey).toBe(READ);
    expect(keel.deleted).toEqual([]);
  });

  it('once a PIN is set, a write key takes the read key\'s place, and the read key is taken back', async () => {
    const rec = await openAccountWorld(ROW);
    keel.hasPin = true;
    await upgradeMemberKey(rec);
    const after = await db.getWorldRecord(W);
    expect(after?.apiKey).toBe(WRITE);
    expect(after?.keyKind).toBe('write');
    expect(readsForWantOfPin(after!)).toBe(false);
    expect(keel.deleted).toEqual([kid(1)]);
    expect(keel.keys.map((k) => k.scope)).toEqual(['WRITE']);
  });

  it('takes back only the read key it minted, never another of the member\'s keys that ends the same', async () => {
    // Another read key of the member's, made elsewhere, listed first and ending in the same four.
    keel.keys.push({ id: kid(90), last4: READ.slice(-4), scope: 'READ' });
    const rec = await openAccountWorld(ROW);
    keel.hasPin = true;
    await upgradeMemberKey(rec);
    expect(keel.deleted).toEqual([kid(2)]);
    expect(keel.keys.map((k) => k.id)).toContain(kid(90));
  });

  it('a record from before mint records, or a key put in by hand since, takes nothing back', async () => {
    const rec = await openAccountWorld(ROW);
    keel.hasPin = true;
    await upgradeMemberKey({ ...rec, keyMint: undefined });
    expect(keel.deleted).toEqual([]);
    const rec2 = await openAccountWorld(ROW);
    await upgradeMemberKey({ ...rec2, apiKey: 'ow_r_' + 'P'.repeat(28) + 'RRRR' });
    expect(keel.deleted).toEqual([]);
  });
});
