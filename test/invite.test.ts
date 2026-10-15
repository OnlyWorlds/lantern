// Invite someone. S407: offered only on a world the account list says you own. Since keel C1
// (48c10d4, Skeld h29 #5147) the owner makes the link on the phone through SDK 4.24, against a fake
// keel shaped by C1: POST /account/worlds/{id}/links with the account token, reader required, owner
// only (anyone else and an unknown world get 404), 201 with the code, the link and the line once.
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
const { accessUrl, canInvite, makeInvite, lastInviterName, SIGNUP_URL } = await import('../src/invite');

const MINE = '0aaa0000-0000-4000-8000-000000000001';
const THEIRS = '0bbb0000-0000-4000-8000-000000000002';

class FakeKeel {
  bodies: Record<string, unknown>[] = [];
  offline = false;

  json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const authed = new Headers(init.headers).get('Authorization') === 'Bearer ow_a_test';
    const m = path.match(/^\/account\/worlds\/([^/]+)\/links$/);
    if (m && method === 'POST') {
      if (!authed) return this.json(401, { error: { code: 'invalid_credentials' } });
      if (m[1] !== MINE) return this.json(404, { error: { code: 'not_found', message: 'Not found.' } });
      const body = JSON.parse(String(init.body));
      this.bodies.push(body);
      if (body.reader !== 'person' && body.reader !== 'agent') return this.json(400, { error: { code: 'invalid', message: 'reader' } });
      const code = 'ow_j_fresh1234';
      const who = body.inviter_name || 'Someone';
      return this.json(201, {
        id: 'link-1', reader: body.reader, role: body.role ?? 'contributor', label: '', inviter_name: body.inviter_name ?? '',
        with_character: false, last4: '1234', created_at: '2026-10-15T17:00:00Z', expires_at: '2026-10-22T17:00:00Z',
        uses: 0, status: 'pending', code, link: `https://www.onlyworlds.com/join#${code}`,
        line: `${who} invites you to The Reach: https://www.onlyworlds.com/join#${code}`,
      });
    }
    return this.json(500, { error: { code: 'unexpected', message: `${method} ${path}` } });
  };
}

let keel: FakeKeel;
beforeEach(async () => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
  await db.kvSet('accountToken', 'ow_a_test');
});

describe('invite', () => {
  it('only an online world you own', () => {
    expect(canInvite({ kind: 'online', role: 'owner' })).toBe(true);
    expect(canInvite({ kind: 'online', role: 'collaborator' })).toBe(false);
    expect(canInvite({ kind: 'online' })).toBe(false); // opened with a key: no account role known
    expect(canInvite({ kind: 'local', role: 'owner' })).toBe(false);
  });

  it('the world page at Access, and the sign-up page, on the API host', () => {
    expect(accessUrl('0e1f')).toBe('https://www.onlyworlds.com/account/worlds/0e1f#access');
    expect(accessUrl('a/b')).toBe('https://www.onlyworlds.com/account/worlds/a%2Fb#access');
    expect(SIGNUP_URL).toBe('https://www.onlyworlds.com/accounts/signup/');
  });

  it('the owner makes a link for a person, as the role picked, for seven days', async () => {
    const made = await makeInvite(MINE, 'guest', '  Titus ');
    expect(keel.bodies).toEqual([{ reader: 'person', role: 'guest', days: 7, inviter_name: 'Titus' }]);
    expect(made.link).toBe('https://www.onlyworlds.com/join#ow_j_fresh1234');
    expect(made.line).toBe('Titus invites you to The Reach: https://www.onlyworlds.com/join#ow_j_fresh1234');
    expect(lastInviterName()).toBe('Titus');
  });

  it('no name sends none (keel signs it "Someone")', async () => {
    await makeInvite(MINE, 'contributor', '   ');
    expect(keel.bodies[0]).toEqual({ reader: 'person', role: 'contributor', days: 7 });
  });

  it('refusals in a sentence: not the owner, no signal, not signed in', async () => {
    await expect(makeInvite(THEIRS, 'contributor', '')).rejects.toThrow('Only the world\'s owner can make an invite link for it.');
    keel.offline = true;
    await expect(makeInvite(MINE, 'contributor', '')).rejects.toThrow('No connection. Making an invite link needs signal.');
    keel.offline = false;
    await db.kvSet('accountToken', undefined);
    await expect(makeInvite(MINE, 'contributor', '')).rejects.toThrow(/Sign in first/);
    expect(keel.bodies).toHaveLength(0);
  });
});
