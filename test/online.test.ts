// Put it online, against a fake keel that keeps keel's rules: an account's first world sets its
// PIN and a later one refuses a PIN; /bulk wants the PIN, is atomic on request, and replays an
// Idempotency-Key; an id living in another world is a 409 slot.
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
const { putOnline, PinNeeded } = await import('../src/online');

type El = Record<string, unknown> & { id: string; type: string; change_seq: number };

let madeWorlds = 0;

class FakeAccountKeel {
  accountPin: string | null = null;
  worlds = new Map<string, { name: string; key: string; els: Map<string, El> }>();
  otherWorldIds = new Set<string>();
  idem = new Map<string, string>();
  seq = 0;
  bulks = 0;
  failBulkOnce = false;
  cannotHide = false;
  sentBodies: Record<string, unknown>[] = [];
  uploads = 0;
  uploaded: { type: string; bytes: Uint8Array }[] = [];

  json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
  err(status: number, code: string, param?: string) {
    return this.json(status, { error: { code, message: code, param } });
  }
  worldOfKey(key: string | null) {
    return [...this.worlds.entries()].find(([, w]) => w.key === key);
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;

    // The live host's connect-src names only https origins: a fetch of a data: address is refused
    // there in both engines (S409, Forge/tools/atlas/Notes/ui-snapshots/2026-10-15-s409/data-fetch-live.mjs).
    if (url.protocol !== 'https:') throw new TypeError('Failed to fetch');
    if (url.host === 'edge.test') {
      this.uploads++;
      if (init.body instanceof Blob) this.uploaded.push({ type: init.body.type, bytes: new Uint8Array(await init.body.arrayBuffer()) });
      return this.json(200, { url: `https://media.onlyworlds.com/w/${this.uploads}.webp`, key: `w/${this.uploads}.webp`, bytes: 1, type: 'image/webp', etag: 'x' });
    }
    if (path === '/account/worlds' && method === 'POST') {
      if (headers.get('Authorization') !== 'Bearer ow_a_test') return this.err(401, 'invalid_credentials');
      if (this.accountPin && body.pin) return this.err(422, 'invalid', 'pin');
      if (!this.accountPin && !body.pin) return this.err(422, 'required', 'pin');
      if (body.pin) this.accountPin = body.pin;
      // Unique across the file's tests: the phone's store outlives each test's fake.
      const id = `0w${++madeWorlds}000000-0000-4000-8000-000000000000`;
      const key = `ow_w_${'k'.repeat(30)}${this.worlds.size}`;
      this.worlds.set(id, { name: body.name, key, els: new Map() });
      return this.json(201, { id, name: body.name, role: 'owner', key });
    }
    const found = this.worldOfKey(headers.get('API-Key'));
    if (!found) return this.err(401, 'invalid_credentials');
    const [worldId, world] = found;
    if (method !== 'GET' && headers.get('API-Pin') !== this.accountPin) return this.err(401, 'invalid_credentials');
    if (path === '/media/ticket') return this.json(200, { ticket: 't', upload_url: 'https://edge.test/up', prefix: 'w/', max_bytes: 15e6, exp: 0 });
    if (path === '/world') {
      if (method === 'PATCH') return this.json(200, { id: worldId, name: world.name, ...body });
      return this.json(200, { id: worldId, name: world.name });
    }
    if (path === '/bulk') {
      if (this.failBulkOnce) {
        this.failBulkOnce = false;
        throw new TypeError('Failed to fetch');
      }
      this.bulks++;
      for (const it of body.items) this.sentBodies.push(it.element);
      const k = headers.get('Idempotency-Key')!;
      if (this.idem.has(k)) {
        if (this.idem.get(k) !== init.body) return this.err(409, 'idempotency_error');
        return this.json(200, { errors: false, items: body.items.map(() => ({ status: 201 })) });
      }
      // keel refuses a stub's flag as an unknown field (422, param known_of; probed live S443).
      // keel #587 (probed live, Atlas S461 probe-48.log): `hidden: true` from a key that cannot hide is
      // a slot's 403 hidden_not_allowed; the slot never echoes the mark.
      const slots = body.items.map((it: { element: { id: string; known_of?: unknown; hidden?: unknown } }) =>
        'known_of' in it.element
          ? { status: 422, error: { code: 'invalid_request', message: 'Unknown field: known_of' } }
          : this.cannotHide && it.element.hidden === true
            ? { status: 403, error: { code: 'hidden_not_allowed', message: 'Only the owner and co-builders can create an element hidden.' } }
            : this.otherWorldIds.has(it.element.id) ? { status: 409, error: { code: 'id_conflict', message: 'id' } } : { status: 201, id: it.element.id },
      );
      const errors = slots.some((x: { status: number }) => x.status >= 400);
      if (!(errors && body.atomic)) {
        for (const it of body.items) world.els.set(it.element.id, { ...it.element, type: it.type, change_seq: ++this.seq });
      }
      if (!errors) this.idem.set(k, String(init.body));
      return this.json(200, { errors, items: slots });
    }
    if (path === '/changes') {
      const changes = [...world.els.values()].map((e) => ({ op: 'upsert', id: e.id, type: e.type, element: e, change_seq: e.change_seq }));
      return this.json(200, { cursor: String(this.seq), changes, has_more: false, head: this.seq });
    }
    return this.err(404, 'not_found');
  };
}

let keel: FakeAccountKeel;
let n = 0;

async function localWorld(els: Record<string, unknown>[]) {
  const id = `lw-${++n}`;
  await db.putWorldRecord({ id, name: 'Bus stop ideas', description: 'Ideas at the bus stop', kind: 'local', addedAt: '', count: els.length });
  await db.applyElements(id, els as never);
  return id;
}

const ELS = [
  { id: 'e1000000-0000-7000-8000-000000000001', type: 'narrative', name: 'The ferryman', supertype: 'Unsorted', characters: ['e1000000-0000-7000-8000-000000000002'], created_at: 'x', updated_at: 'y' },
  { id: 'e1000000-0000-7000-8000-000000000002', type: 'character', name: 'Ferryman', image_url: 'data:image/png;base64,iVBORw0KGgo=' },
];

beforeEach(async () => {
  keel = new FakeAccountKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
  await db.kvSet('accountToken', 'ow_a_test');
});

describe('put it online', () => {
  it('an account without a PIN: asks for one, then the world, its pictures and its elements arrive and the phone copy goes', async () => {
    const local = await localWorld(ELS);
    await expect(putOnline(local, '')).rejects.toBeInstanceOf(PinNeeded);
    const id = await putOnline(local, '4321');
    const w = keel.worlds.get(id)!;
    expect(w.els.size).toBe(2);
    expect(w.els.get(ELS[1].id)?.image_url).toMatch(/^https:\/\/media\.onlyworlds\.com\//);
    // The picture's own bytes reach the edge (the PNG signature the data address holds).
    expect(keel.uploaded).toHaveLength(1);
    expect(keel.uploaded[0].type).toBe('image/png');
    expect([...keel.uploaded[0].bytes]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(w.els.get(ELS[0].id)).not.toHaveProperty('created_at');
    expect(await db.getWorldRecord(local)).toBeUndefined();
    expect((await db.getWorldRecord(id))?.kind).toBe('online');
    expect(keel.worlds.size).toBe(1);
  });

  it("a world's records move with it to the online copy, byte for byte, and never reach keel (folder spec §4.5 rule 6a)", async () => {
    const local = await localWorld(ELS);
    const recs = [{ path: 'records/lab/ledger.bin', data: new Uint8Array([0, 1, 2, 255]) }];
    const media = [{ path: 'media/a.png', data: new Uint8Array([137, 80, 78, 71]) }];
    await db.putRecords(local, recs);
    await db.putMedia(local, media);
    const id = await putOnline(local, '4321');
    expect(await db.getRecords(id)).toEqual(recs);
    expect(await db.getMedia(id)).toEqual(media);
    expect(await db.getRecords(local)).toEqual([]);
    expect(await db.getMedia(local)).toEqual([]);
    expect(keel.worlds.get(id)!.els.size).toBe(2);
  });

  it('a dropped bulk: the retry reuses the world and the key, nothing twice', async () => {
    keel.accountPin = '4321';
    const local = await localWorld(ELS);
    keel.failBulkOnce = true;
    await expect(putOnline(local, '4321')).rejects.toThrow();
    expect((await db.getWorldRecord(local))?.pendingOnline).toBeTruthy();
    const id = await putOnline(local, '4321');
    expect(keel.worlds.size).toBe(1);
    expect(keel.uploads).toBe(1);
    expect(keel.worlds.get(id)!.els.size).toBe(2);
  });

  it("a world holding a stub (a player's view, from a world file) does not go online: nothing made, nothing sent, the copy stays (the S444 gate, G1)", async () => {
    keel.accountPin = '4321';
    const stub = { id: 'e1000000-0000-7000-8000-000000000003', type: 'character', name: 'Ana', description: 'Sells mules.', known_of: true };
    const kid = { id: 'e1000000-0000-7000-8000-000000000004', type: 'character', name: 'The Kid', friends: [stub.id] };
    const local = await localWorld([kid, stub]);
    await expect(putOnline(local, '4321')).rejects.toThrow(/player's view of a world online \(1 known of in it\)/);
    expect(keel.worlds.size).toBe(0);
    expect(keel.bulks).toBe(0);
    expect((await db.allElements(local)).length).toBe(2);
  });

  it('a hidden element goes up hidden, as the boolean keel takes; a false or null mark is never sent (folder spec §4.8)', async () => {
    keel.accountPin = '4321';
    const ids = ['e1000000-0000-7000-8000-000000000011', 'e1000000-0000-7000-8000-000000000012', 'e1000000-0000-7000-8000-000000000013', 'e1000000-0000-7000-8000-000000000014'];
    const local = await localWorld([
      { id: ids[0], type: 'character', name: 'Wren', hidden: true },
      { id: ids[1], type: 'character', name: 'Moss', hidden: 'true' },
      { id: ids[2], type: 'character', name: 'Fern', hidden: false },
      { id: ids[3], type: 'character', name: 'Reed', hidden: null },
    ]);
    const id = await putOnline(local, '4321');
    const sent = new Map(keel.sentBodies.map((b) => [b.id, b]));
    expect(sent.get(ids[0])?.hidden).toBe(true);
    expect(sent.get(ids[1])?.hidden).toBe(true);
    expect(sent.get(ids[2])).not.toHaveProperty('hidden');
    expect(sent.get(ids[3])).not.toHaveProperty('hidden');
    expect(keel.worlds.get(id)!.els.size).toBe(4);
  });

  it("a key keel will not take a hidden element from: said, nothing sent, the phone copy stays", async () => {
    keel.accountPin = '4321';
    keel.cannotHide = true;
    const local = await localWorld([...ELS, { id: 'e1000000-0000-7000-8000-000000000015', type: 'character', name: 'Wren', hidden: true }]);
    await expect(putOnline(local, '4321')).rejects.toThrow(/would not take a hidden element/);
    expect([...keel.worlds.values()][0].els.size).toBe(0);
    expect((await db.allElements(local)).length).toBe(3);
  });

  it('ids that live in another world: nothing is sent and the phone copy stays', async () => {
    keel.accountPin = '4321';
    keel.otherWorldIds.add(ELS[0].id);
    const local = await localWorld(ELS);
    await expect(putOnline(local, '4321')).rejects.toThrow(/another world online/);
    expect([...keel.worlds.values()][0].els.size).toBe(0);
    expect((await db.allElements(local)).length).toBe(2);
  });

  it('a wrong PIN: refused, and the phone copy stays', async () => {
    keel.accountPin = '4321';
    const local = await localWorld(ELS);
    await expect(putOnline(local, '1111')).rejects.toThrow();
    expect((await db.allElements(local)).length).toBe(2);
    expect(await db.getWorldRecord(local)).toBeTruthy();
  });
});
