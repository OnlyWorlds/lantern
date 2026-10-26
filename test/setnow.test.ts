// Moving the world's now against a fake keel shaped by Skeld's read of keel's
// patch_world: the owner's key with the PIN moves it and gets
// the world back; a co-builder's key may send time_range_current alone (anything beside it is
// owner_only); any other member's key is refused with owner_only; a wrong PIN is a 401.
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

// Node 22 has its own read-only navigator: replaced, so the test can take the signal away.
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

const { openWorld, forgetSession } = await import('../src/world');
const { setPin, pinFor } = await import('../src/pin');
const db = await import('../src/db');

const OWNER = 'ow_w_' + 'o'.repeat(40);
const MEMBER = 'ow_w_' + 'm'.repeat(40);
const CO_BUILDER = 'ow_w_' + 'c'.repeat(40);
let world: Record<string, unknown>;
let patches: unknown[];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ownerOnly = () => json(403, { error: { code: 'owner_only', message: "Only the world's owner can change the world's own settings." } });
beforeEach(() => {
  world = { id: 'w-now', name: 'Fake world', time_range_current: 453, time_basic_unit: 'Year' };
  patches = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    if (url.pathname.replace(/\/+$/, '') !== '/api/v2/world' || (init.method ?? 'GET').toUpperCase() !== 'PATCH') return json(500, { error: { code: 'unexpected' } });
    const key = headers.get('API-Key');
    if (key !== OWNER && key !== CO_BUILDER) return ownerOnly();
    if (headers.get('API-Pin') !== '4321') return json(401, { error: { code: 'invalid_pin', message: 'PIN' } });
    const body = JSON.parse(String(init.body));
    if (key === CO_BUILDER && Object.keys(body).join() !== 'time_range_current') return ownerOnly();
    patches.push(body);
    world = { ...world, ...body };
    return json(200, world);
  }) as typeof fetch;
});

async function session(apiKey: string, role?: 'owner' | 'collaborator') {
  const id = `w-now-${Math.random().toString(36).slice(2)}`;
  await db.putWorldRecord({ id, name: 'Fake world', kind: 'online', apiKey, keyKind: 'write', addedAt: '', timeNow: 453, timeUnit: 'Year', ...(role ? { role } : {}) });
  forgetSession(id);
  return openWorld(id);
}

describe('moving now', () => {
  it("the owner's key with the PIN moves it, and the phone keeps keel's answer", async () => {
    const s = await session(OWNER, 'owner');
    setPin(s.rec, '4321');
    expect(s.canMoveNow).toBe(true);
    await s.setNow(460);
    expect(patches).toEqual([{ time_range_current: 460 }]);
    expect((await db.getWorldRecord(s.id))?.timeNow).toBe(460);
  });

  it("a co-builder is offered it and moves the now alone", async () => {
    // From the account list: a collaborator whose member role is co_builder.
    const listed = await session(CO_BUILDER, 'collaborator');
    listed.rec = { ...listed.rec, memberRole: 'co_builder' };
    expect(listed.canMoveNow).toBe(true);
    // A key whose member role keel's /me named.
    const s = await session(CO_BUILDER);
    s.rec = { ...s.rec, memberRole: 'co_builder' };
    expect(s.canMoveNow).toBe(true);
    setPin(s.rec, '4321');
    await s.setNow(470);
    expect(patches).toEqual([{ time_range_current: 470 }]);
    expect((await db.getWorldRecord(s.id))?.timeNow).toBe(470);
  });

  it("a contributor or a guest is not offered it, and a member's key that tries is told why", async () => {
    // A collaborator with no member role named (an older list): not offered.
    expect((await session(MEMBER, 'collaborator')).canMoveNow).toBe(false);
    for (const memberRole of ['contributor', 'guest'] as const) {
      const m = await session(MEMBER, 'collaborator');
      m.rec = { ...m.rec, memberRole };
      expect(m.canMoveNow).toBe(false);
    }
    // A key whose member role keel's /me named: not offered either.
    const c = await session(MEMBER);
    c.rec = { ...c.rec, memberRole: 'contributor' };
    expect(c.canMoveNow).toBe(false);
    const s = await session(MEMBER); // a key with no account role: let try
    setPin(s.rec, '4321');
    await expect(s.setNow(460)).rejects.toThrow(/Only the world's owner or a co-builder/);
    expect((await db.getWorldRecord(s.id))?.timeNow).toBe(453);
  });

  it('a wrong PIN is cleared, never retried, and nothing moves', async () => {
    const s = await session(OWNER, 'owner');
    setPin(s.rec, '0000');
    await expect(s.setNow(460)).rejects.toThrow(/PIN was not right/);
    expect(pinFor(s.rec)).toBeUndefined();
    expect(patches).toEqual([]);
    expect((await db.getWorldRecord(s.id))?.timeNow).toBe(453);
  });

  it('without signal it says so and sends nothing', async () => {
    const s = await session(OWNER, 'owner');
    setPin(s.rec, '4321');
    (globalThis.navigator as { onLine: boolean }).onLine = false;
    await expect(s.setNow(460)).rejects.toThrow(/needs signal/);
    (globalThis.navigator as { onLine: boolean }).onLine = true;
    expect(patches).toEqual([]);
  });
});
