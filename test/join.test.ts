// Joining with an invite link (Keel #212), against a fake keel that answers as keel's own tests
// say: preview needs no credential and spends nothing; /account/join wants the account token,
// 201 with the membership (world_id, role, roster_character), 404 for every bad code (one
// message), 409 already_member with the code left unused. Accepting asks no PIN for any role
// (keel #297, ed73c90), so the fake has no pin_required at the accept.
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
const join = await import('../src/join');

const WORLD = '0aaa0000-0000-4000-8000-000000000001';
const CHAR = '0ccc0000-0000-4000-8000-000000000001';

class FakeKeel {
  codes = new Map<string, { used: boolean; reader: 'person' | 'agent' | 'player'; role: string }>([
    ['ow_j_good', { used: false, reader: 'person', role: 'guest' }],
    ['ow_j_agent', { used: false, reader: 'agent', role: 'contributor' }],
    ['ow_j_player', { used: false, reader: 'player', role: 'guest' }],
  ]);
  /** What POST /join last received: its body, and whether it carried a credential. */
  redeemed: { body: unknown; credential: boolean }[] = [];
  members = new Set<string>();
  calls: string[] = [];

  json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
  notFound() {
    return this.json(404, { error: { code: 'not_found', message: 'This join code is not valid.' } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    this.calls.push(`${method} ${path}`);
    const authed = headers.get('Authorization') === 'Bearer ow_a_test';

    if (path === '/join/preview' && method === 'POST') {
      const c = this.codes.get(body?.code);
      if (!c || c.used) return this.notFound();
      return this.json(200, { reader: c.reader, world: { name: 'The Reach', description: 'Salt and debts.' }, invited_by: 'Ada', owner_character: null, role: c.role, with_character: false, expires_at: '2026-10-19T00:00:00+00:00' });
    }
    // Keel #353 (keel PR 55, accounts/join_api.py): a player code redeems with no credential, 201
    // PlayerJoined; the code is spent; a person's code here is the one 404.
    if (path === '/join' && method === 'POST') {
      this.redeemed.push({ body, credential: headers.has('Authorization') || headers.has('API-Key') });
      const c = this.codes.get(body?.code);
      if (!c || c.used || c.reader !== 'player') return this.notFound();
      if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 80)) return this.json(422, { error: { code: 'invalid_request', param: 'name' } });
      c.used = true;
      return this.json(201, { kind: 'player', key: `ow_r_${'y'.repeat(30)}`, world: { id: WORLD, name: 'The Reach', description: 'Salt and debts.' }, character: { id: CHAR, name: body.name || 'Player' }, role: 'guest' });
    }
    if (path === '/account/join' && method === 'POST') {
      if (!authed) return this.json(401, { error: { code: 'invalid_credentials' } });
      const c = this.codes.get(body?.code);
      if (!c || c.used || c.reader !== 'person') return this.notFound();
      if (this.members.has(WORLD)) return this.json(409, { error: { code: 'already_member', message: 'already' } });
      c.used = true;
      this.members.add(WORLD);
      return this.json(201, { id: 'grant-1', world_id: WORLD, world_name: 'The Reach', role: c.role, roster_character: c.role === 'guest' ? CHAR : null });
    }
    if (path === '/account/worlds' && method === 'GET') {
      if (!authed) return this.json(401, { error: { code: 'invalid_credentials' } });
      return this.json(200, { data: this.members.has(WORLD) ? [{ id: WORLD, name: 'The Reach', role: 'collaborator', member_role: 'guest' }] : [] });
    }
    if (path === `/account/worlds/${WORLD}/keys` && method === 'POST') {
      if (!authed || !this.members.has(WORLD)) return this.json(404, { error: { code: 'not_found' } });
      return this.json(201, { key: `ow_r_${'r'.repeat(30)}`, scope: body.scope });
    }
    return this.json(500, { error: { code: 'unexpected', message: `${method} ${path}` } });
  };
}

let keel: FakeKeel;
beforeEach(async () => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  await db.kvSet('accountToken', 'ow_a_test');
  await db.kvSet('pendingJoin', undefined);
  await db.removeWorld(WORLD);
});

describe('an invite link', () => {
  it('the code is found in a link, a message, or alone', () => {
    expect(join.joinCode('https://www.onlyworlds.com/join#ow_j_Ab-9_x')).toBe('ow_j_Ab-9_x');
    expect(join.joinCode('Come play! https://www.onlyworlds.com/join#ow_j_abc see you')).toBe('ow_j_abc');
    expect(join.joinCode('ow_j_abc')).toBe('ow_j_abc');
    expect(join.joinCode('https://www.onlyworlds.com/join')).toBeNull();
  });

  it('preview says who, where and as what, and spends nothing', async () => {
    const p = await join.previewJoin('ow_j_good');
    expect(p).toMatchObject({ reader: 'person', role: 'guest', invited_by: 'Ada', world: { name: 'The Reach' } });
    expect(keel.codes.get('ow_j_good')!.used).toBe(false);
    expect(join.roleWords(p.role)).toBe('a player');
    await expect(join.previewJoin('ow_j_nope')).rejects.toThrow(/does not work/);
  });

  it('joining opens the world with its own key, and knows the Character', async () => {
    const r = await join.acceptJoin('ow_j_good');
    expect(r).toEqual({ worldId: WORLD });
    const rec = await db.getWorldRecord(WORLD);
    expect(rec).toMatchObject({ kind: 'online', memberRole: 'guest', characterId: CHAR });
    expect(rec?.apiKey?.startsWith('ow_r_')).toBe(true);
    expect(keel.calls).toContain(`POST /account/worlds/${WORLD}/keys`);
    // Spent: the same link is a bad link now, for everyone (keel's test_accept_makes_a_guest...).
    await expect(join.acceptJoin('ow_j_good')).rejects.toThrow(/does not work/);
    // A second, fresh link to a world already joined: said plainly, nothing new kept.
    keel.codes.set('ow_j_second', { used: false, reader: 'person', role: 'guest' });
    await expect(join.acceptJoin('ow_j_second')).resolves.toEqual({ already: true });
  });

  it('a dead link is let go, so the next sign-in does not come back to it; a sign-out lets go too (the third gate)', async () => {
    await join.setPendingJoin('ow_j_nope');
    await expect(join.previewJoin('ow_j_nope')).rejects.toThrow(/does not work/);
    expect(await join.pendingJoin()).toBeUndefined();
    await join.setPendingJoin('ow_j_good');
    const { signOut } = await import('../src/account');
    await signOut();
    expect(await join.pendingJoin()).toBeUndefined();
  });

  it('joined, but the world did not open: the person is told they are in (the third gate)', async () => {
    const real = keel.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes(`/account/worlds/${WORLD}/keys`) ? new Response('{}', { status: 500 }) : real(input, init)) as typeof fetch;
    await expect(join.acceptJoin('ow_j_good')).rejects.toThrow(/You are in The Reach now/);
    expect(keel.members.has(WORLD)).toBe(true);
  });

  it("a player joining on the game master's phone never sees the game master's copy, nor sends their changes (the security pass, F1)", async () => {
    const gm = { id: WORLD, name: 'The Reach', kind: 'online' as const, apiKey: `ow_w_${'g'.repeat(30)}`, keyKind: 'write' as const, role: 'owner', cursor: 'c-gm', appliedHead: 90, appliedEpoch: 0, addedAt: '' };
    const secret = { id: '0eee0000-0000-4000-8000-000000000001', type: 'object', name: 'The drowned crown' };
    await db.putWorldRecord(gm as db.WorldRecord);
    await db.applyElements(WORLD, [secret]);
    await db.putOutboxRow(WORLD, { op: 'patch', type: 'object', id: secret.id, values: { name: 'The crown' }, state: 'waiting' } as db.OutboxRow);
    // A change still waiting under the game master's key: refused, nothing minted, the copy kept for them.
    keel.members.add(WORLD);
    const { openAccountWorld } = await import('../src/account');
    const as = { id: WORLD, name: 'The Reach', role: 'collaborator', member_role: 'guest' as const };
    await expect(openAccountWorld(as)).rejects.toThrow(/1 change not sent yet/);
    expect(keel.calls.filter((c) => c.includes('/keys'))).toHaveLength(0);
    expect(await db.allElements(WORLD)).toHaveLength(1);
    // Sent (or dropped): the player's open reads the world afresh, from zero.
    for (const r of await db.outboxRows(WORLD)) await db.deleteOutboxRow(WORLD, r.seq!);
    const rec = await openAccountWorld(as);
    expect(await db.allElements(WORLD)).toHaveLength(0);
    expect(rec).toMatchObject({ memberRole: 'guest' });
    expect([rec.cursor, rec.appliedHead, rec.apiKey.startsWith('ow_r_')]).toEqual([undefined, undefined, true]);
  });

  it("a key that fails to mint after the copy went leaves a world that reads again from zero (the S402 gate, G1)", async () => {
    await db.putWorldRecord({ id: WORLD, name: 'The Reach', kind: 'online', apiKey: `ow_w_${'g'.repeat(30)}`, keyKind: 'write', role: 'owner', cursor: 'c-gm', appliedHead: 90, addedAt: '' } as db.WorldRecord);
    await db.applyElements(WORLD, [{ id: '0eee0000-0000-4000-8000-000000000001', type: 'object', name: 'The drowned crown' }]);
    keel.members.add(WORLD);
    const real = keel.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/keys') ? new Response('{}', { status: 503 }) : real(input, init)) as typeof fetch;
    const { openAccountWorld } = await import('../src/account');
    await expect(openAccountWorld({ id: WORLD, name: 'The Reach', role: 'collaborator', member_role: 'guest' })).rejects.toThrow();
    const rec = await db.getWorldRecord(WORLD);
    expect([rec?.cursor, rec?.appliedHead, (await db.allElements(WORLD)).length]).toEqual([undefined, undefined, 0]);
  });

  it('a world opened with another key: the old copy and where its walk stood go (F1)', async () => {
    await db.putWorldRecord({ id: WORLD, name: 'The Reach', kind: 'online', apiKey: `ow_w_${'g'.repeat(30)}`, keyKind: 'write', role: 'owner', cursor: 'c-gm', appliedHead: 90, addedAt: '' } as db.WorldRecord);
    await db.applyElements(WORLD, [{ id: '0eee0000-0000-4000-8000-000000000001', type: 'object', name: 'The drowned crown' }]);
    const real = keel.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).pathname.replace(/\/+$/, '') === '/api/v2/world'
        ? new Response(JSON.stringify({ id: WORLD, name: 'The Reach' }), { status: 200, headers: { 'content-type': 'application/json' } })
        : real(input, init)) as typeof fetch;
    const { openWithKey } = await import('../src/account');
    const rec = await openWithKey(`ow_r_${'p'.repeat(30)}`);
    expect(await db.allElements(WORLD)).toHaveLength(0);
    expect([rec.cursor, rec.appliedHead, rec.role]).toEqual([undefined, undefined, undefined]);
    // The same key again keeps what it has.
    await db.applyElements(WORLD, [{ id: '0eee0000-0000-4000-8000-000000000002', type: 'object', name: 'A known cup' }]);
    await openWithKey(`ow_r_${'p'.repeat(30)}`);
    expect(await db.allElements(WORLD)).toHaveLength(1);
  });

  it('a used or agent code, and no account: refused before anything is kept', async () => {
    await expect(join.acceptJoin('ow_j_agent')).rejects.toThrow(/does not work/);
    await db.kvSet('accountToken', undefined);
    await expect(join.acceptJoin('ow_j_good')).rejects.toThrow(/Sign in first/);
    expect(keel.calls.filter((c) => c.includes('/account/join'))).toHaveLength(1);
  });
});

describe('a player link, no account (Keel #353)', () => {
  beforeEach(async () => {
    await db.kvSet('accountToken', undefined);
  });

  it('the preview says player', async () => {
    const p = await join.previewJoin('ow_j_player');
    expect(join.isPlayerLink(p)).toBe(true);
    expect(join.isPlayerLink(await join.previewJoin('ow_j_good'))).toBe(false);
  });

  it('redeems with no credential and keeps the read key as a player seat; the link is spent', async () => {
    const r = await join.redeemPlayer('ow_j_player', '  Ana  ');
    expect(r).toEqual({ worldId: WORLD });
    expect(keel.redeemed[0]).toEqual({ body: { code: 'ow_j_player', name: 'Ana' }, credential: false });
    const rec = await db.getWorldRecord(WORLD);
    expect(rec).toMatchObject({ kind: 'online', apiKey: `ow_r_${'y'.repeat(30)}`, keyKind: 'read', memberRole: 'guest', characterId: CHAR, playerSeat: true });
    expect(rec?.role).toBeUndefined();
    await expect(join.redeemPlayer('ow_j_player')).rejects.toThrow(/does not work/);
  });

  it('a blank name is left out, so keel names the seat', async () => {
    await join.redeemPlayer('ow_j_player', '   ');
    expect(keel.redeemed[0].body).toEqual({ code: 'ow_j_player' });
  });

  it("never replaces the game master's own copy on this phone", async () => {
    await db.putWorldRecord({ id: WORLD, name: 'The Reach', kind: 'online', apiKey: `ow_w_${'g'.repeat(30)}`, keyKind: 'write', role: 'owner', addedAt: '' } as db.WorldRecord);
    await db.applyElements(WORLD, [{ id: '0eee0000-0000-4000-8000-000000000001', type: 'object', name: 'The drowned crown' }]);
    await expect(join.redeemPlayer('ow_j_player')).rejects.toThrow(/your own copy/);
    const rec = await db.getWorldRecord(WORLD);
    expect([rec?.apiKey, rec?.role, rec?.playerSeat]).toEqual([`ow_w_${'g'.repeat(30)}`, 'owner', undefined]);
    expect(await db.allElements(WORLD)).toHaveLength(1);
  });

  it('replaces a copy opened earlier with a key (a player who lost theirs and got a new link)', async () => {
    await db.putWorldRecord({ id: WORLD, name: 'The Reach', kind: 'online', apiKey: `ow_r_${'o'.repeat(30)}`, keyKind: 'read', memberRole: 'guest', addedAt: '' } as db.WorldRecord);
    await db.applyElements(WORLD, [{ id: '0eee0000-0000-4000-8000-000000000001', type: 'object', name: 'Seen with the old key' }]);
    await join.redeemPlayer('ow_j_player');
    expect((await db.getWorldRecord(WORLD))?.apiKey).toBe(`ow_r_${'y'.repeat(30)}`);
    expect(await db.allElements(WORLD)).toHaveLength(0);
  });

  it('no answer: says the code may be spent', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(join.redeemPlayer('ow_j_player')).rejects.toThrow(/did not reach this phone/);
    expect(await db.getWorldRecord(WORLD)).toBeUndefined();
  });
});
