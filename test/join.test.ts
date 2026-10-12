// Joining with an invite link (Keel #212), against a fake keel that answers as keel's own tests
// say: preview needs no credential and spends nothing; /account/join wants the account token,
// 201 with the membership (world_id, role, roster_character), 404 for every bad code (one
// message), 409 already_member or pin_required with the code left unused.
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
  codes = new Map<string, { used: boolean; reader: 'person' | 'agent'; role: string }>([
    ['ow_j_good', { used: false, reader: 'person', role: 'guest' }],
    ['ow_j_agent', { used: false, reader: 'agent', role: 'contributor' }],
  ]);
  hasPin = true;
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
    if (path === '/account/join' && method === 'POST') {
      if (!authed) return this.json(401, { error: { code: 'invalid_credentials' } });
      const c = this.codes.get(body?.code);
      if (!c || c.used || c.reader !== 'person') return this.notFound();
      if (this.members.has(WORLD)) return this.json(409, { error: { code: 'already_member', message: 'already' } });
      if (!this.hasPin) return this.json(409, { error: { code: 'pin_required', message: 'pin' } });
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

  it('no PIN: its own sentence, the link unused and still waiting', async () => {
    keel.hasPin = false;
    await join.setPendingJoin('ow_j_good');
    await expect(join.acceptJoin('ow_j_good')).rejects.toThrow(/Set a PIN/);
    expect(keel.codes.get('ow_j_good')!.used).toBe(false);
    expect(await join.pendingJoin()).toBe('ow_j_good');
    expect(await db.getWorldRecord(WORLD)).toBeUndefined();
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

  it('a used or agent code, and no account: refused before anything is kept', async () => {
    await expect(join.acceptJoin('ow_j_agent')).rejects.toThrow(/does not work/);
    await db.kvSet('accountToken', undefined);
    await expect(join.acceptJoin('ow_j_good')).rejects.toThrow(/Sign in first/);
    expect(keel.calls.filter((c) => c.includes('/account/join'))).toHaveLength(1);
  });
});
