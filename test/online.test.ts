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

class FakeAccountKeel {
  accountPin: string | null = null;
  worlds = new Map<string, { name: string; key: string; els: Map<string, El> }>();
  otherWorldIds = new Set<string>();
  idem = new Map<string, string>();
  seq = 0;
  bulks = 0;
  failBulkOnce = false;
  uploads = 0;

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

    if (url.host === 'edge.test') {
      this.uploads++;
      return this.json(200, { url: `https://media.onlyworlds.com/w/${this.uploads}.webp`, key: `w/${this.uploads}.webp`, bytes: 1, type: 'image/webp', etag: 'x' });
    }
    if (path === '/account/worlds' && method === 'POST') {
      if (headers.get('Authorization') !== 'Bearer ow_a_test') return this.err(401, 'invalid_credentials');
      if (this.accountPin && body.pin) return this.err(422, 'invalid', 'pin');
      if (!this.accountPin && !body.pin) return this.err(422, 'required', 'pin');
      if (body.pin) this.accountPin = body.pin;
      const id = `0w${this.worlds.size}000000-0000-4000-8000-000000000000`;
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
      const k = headers.get('Idempotency-Key')!;
      if (this.idem.has(k)) {
        if (this.idem.get(k) !== init.body) return this.err(409, 'idempotency_error');
        return this.json(200, { errors: false, items: body.items.map(() => ({ status: 201 })) });
      }
      const slots = body.items.map((it: { element: { id: string } }) =>
        this.otherWorldIds.has(it.element.id) ? { status: 409, error: { code: 'id_conflict', message: 'id' } } : { status: 201, id: it.element.id },
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
    expect(w.els.get(ELS[0].id)).not.toHaveProperty('created_at');
    expect(await db.getWorldRecord(local)).toBeUndefined();
    expect((await db.getWorldRecord(id))?.kind).toBe('online');
    expect(keel.worlds.size).toBe(1);
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
