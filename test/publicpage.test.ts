// The public page switch on the world's record: a full pull writes it from GET /world, and a view
// asks for it (askPublicPage) only when the reader sees the world through that page, the answer is
// missing or old, there is signal, and no full pull is already under way. Against a small fake keel
// that counts its GET /world reads.
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

// Node has its own read-only navigator: replaced, so a test can take the signal away.
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

const { openWorld, forgetSession, setBuildBehind } = await import('../src/world');
const db = await import('../src/db');

const READ_KEY = 'ow_r_' + 'r'.repeat(40);
const OLD = Date.now() - 60 * 60 * 1000;

class FakeKeel {
  /** The body GET /world answers. */
  world: Record<string, unknown> = { id: 'w1', name: 'Fake world' };
  /** GET /world answers this status instead of the body (an error). */
  worldStatus = 200;
  /** GET /world fails as a network error. */
  worldThrows = false;
  /** GET /world waits on this before answering. */
  worldGate: Promise<void> | null = null;
  /** GET /changes waits on this before answering (a full pull held mid-read). */
  changesGate: Promise<void> | null = null;
  worldReads = 0;

  json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    if (method === 'GET' && path === '/world') {
      this.worldReads++;
      if (this.worldGate) await this.worldGate;
      if (this.worldThrows) throw new TypeError('Failed to fetch');
      if (this.worldStatus !== 200) return this.json(this.worldStatus, { error: { code: 'server_error', message: 'x', type: 'x', param: null } });
      return this.json(200, this.world);
    }
    if (method === 'GET' && path === '/changes') {
      if (this.changesGate) await this.changesGate;
      return this.json(200, { cursor: '0', changes: [], has_more: false, head: 0, epoch: null });
    }
    return this.json(404, { error: { code: 'not_found', message: 'x', type: 'x', param: null } });
  };
}

let keel: FakeKeel;
let n = 0;

async function freshWorld(patch: Partial<import('../src/db').WorldRecord> = {}) {
  const id = `pp-${++n}`;
  await db.putWorldRecord({ id, name: 'Fake world', kind: 'online', apiKey: READ_KEY, keyKind: 'read', addedAt: '', ...patch });
  forgetSession(id);
  return openWorld(id);
}

/** A moment for a fire-and-forget read (and its write) to land or to not happen. */
const settle = () => new Promise<void>((r) => setTimeout(r, 60));

function hold(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { gate, release };
}

const online = (on: boolean) => ((globalThis.navigator as { onLine: boolean }).onLine = on);

beforeEach(() => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  online(true);
  store.clear();
  setBuildBehind(false);
  vi.restoreAllMocks();
});

describe('a full pull keeps the World extension keys keel served', () => {
  it('the strand and another tool key are on the record for a copy, and one keel stops serving goes', async () => {
    const strand = { narrative: 'n1', event: 'e1', location: null };
    keel.world = { id: 'w1', name: 'Fake world', x_strand: strand, atlas_home: { grid: [] }, x_names: { version: 1 } };
    const s = await freshWorld();
    await s.pull();
    expect((await db.getWorldRecord(s.id))?.extensions).toEqual({ x_strand: strand, atlas_home: { grid: [] }, x_names: { version: 1 } });
    keel.world = { id: 'w1', name: 'Fake world' };
    await s.pull();
    expect((await db.getWorldRecord(s.id))?.extensions).toEqual({});
  });
});

describe('a full pull writes the switch', () => {
  it('public_read and public_page.on both true: on, with a time', async () => {
    keel.world = { id: 'w1', name: 'Fake world', public_read: true, public_page: { on: true } };
    const s = await freshWorld();
    await s.pull();
    const rec = await db.getWorldRecord(s.id);
    expect(rec?.publicPageOn).toBe(true);
    expect(typeof rec?.publicPageAt).toBe('number');
    expect(s.rec.publicPageOn).toBe(true);
  });

  it('public_page.on false: off', async () => {
    keel.world = { id: 'w1', name: 'Fake world', public_read: true, public_page: { on: false } };
    const s = await freshWorld({ publicPageOn: true });
    await s.pull();
    const rec = await db.getWorldRecord(s.id);
    expect(rec?.publicPageOn).toBe(false);
    expect(typeof rec?.publicPageAt).toBe('number');
  });

  it('the page on but public_read not true: off', async () => {
    for (const read of [false, undefined]) {
      keel.world = { id: 'w1', name: 'Fake world', public_read: read, public_page: { on: true } };
      const s = await freshWorld({ publicPageOn: true });
      await s.pull();
      expect((await db.getWorldRecord(s.id))?.publicPageOn).toBe(false);
    }
  });

  it('neither key present: off', async () => {
    const s = await freshWorld({ publicPageOn: true });
    await s.pull();
    const rec = await db.getWorldRecord(s.id);
    expect(rec?.publicPageOn).toBe(false);
    expect(typeof rec?.publicPageAt).toBe('number');
  });

  it('a quiet poll does not read the world or touch the switch', async () => {
    keel.world = { id: 'w1', name: 'Fake world', public_read: true, public_page: { on: true } };
    const s = await freshWorld();
    await s.pull(); // the first full read sets the cursor
    await db.updateWorldRecord(s.id, { publicPageOn: false, publicPageAt: OLD });
    keel.worldReads = 0;
    await s.pull(true);
    expect(keel.worldReads).toBe(0);
    const rec = await db.getWorldRecord(s.id);
    expect(rec?.publicPageOn).toBe(false);
    expect(rec?.publicPageAt).toBe(OLD);
  });
});

describe('askPublicPage', () => {
  beforeEach(() => {
    keel.world = { id: 'w1', name: 'Fake world', public_read: true, public_page: { on: true } };
  });

  it('a read key with no answer yet asks once, writes it, and tells subscribers once', async () => {
    const s = await freshWorld();
    let draws = 0;
    s.subscribe(() => draws++);
    s.askPublicPage();
    await vi.waitFor(() => expect(s.rec.publicPageAt).toBeTypeOf('number'));
    await settle();
    expect(keel.worldReads).toBe(1);
    expect(s.rec.publicPageOn).toBe(true);
    const rec = await db.getWorldRecord(s.id);
    expect(rec?.publicPageOn).toBe(true);
    expect(typeof rec?.publicPageAt).toBe('number');
    expect(draws).toBe(1);
  });

  it('called twice, it still reads once', async () => {
    const s = await freshWorld();
    s.askPublicPage();
    s.askPublicPage();
    await settle();
    s.askPublicPage();
    await settle();
    expect(keel.worldReads).toBe(1);
  });

  it('an answer that stands unchanged draws nothing', async () => {
    const s = await freshWorld({ publicPageOn: true, publicPageAt: OLD });
    let draws = 0;
    s.subscribe(() => draws++);
    s.askPublicPage();
    await vi.waitFor(() => expect(s.rec.publicPageAt).not.toBe(OLD));
    await settle();
    expect(keel.worldReads).toBe(1);
    expect(draws).toBe(0);
  });

  it('a member (an owner, or a collaborator) does not ask', async () => {
    for (const role of ['owner', 'collaborator'] as const) {
      const s = await freshWorld({ role });
      s.askPublicPage();
    }
    await settle();
    expect(keel.worldReads).toBe(0);
  });

  it('a fresh answer is not asked again', async () => {
    const s = await freshWorld({ publicPageOn: true, publicPageAt: Date.now() });
    s.askPublicPage();
    await settle();
    expect(keel.worldReads).toBe(0);
  });

  it('without signal it does not ask, and asks once the signal is back', async () => {
    const s = await freshWorld();
    online(false);
    s.askPublicPage();
    await settle();
    expect(keel.worldReads).toBe(0);
    online(true);
    s.askPublicPage();
    await vi.waitFor(() => expect(s.rec.publicPageAt).toBeTypeOf('number'));
    expect(keel.worldReads).toBe(1);
  });

  it('a world on this phone only, or without a key, does not ask', async () => {
    const local = await freshWorld({ kind: 'local' });
    local.askPublicPage();
    const keyless = await freshWorld({ apiKey: undefined });
    keyless.askPublicPage();
    await settle();
    expect(keel.worldReads).toBe(0);
  });

  for (const how of ['a 500', 'a network error'] as const) {
    it(`${how} changes nothing, and is not asked again`, async () => {
      if (how === 'a 500') keel.worldStatus = 500;
      else keel.worldThrows = true;
      const s = await freshWorld({ publicPageOn: true, publicPageAt: OLD });
      let draws = 0;
      s.subscribe(() => draws++);
      s.askPublicPage();
      await vi.waitFor(() => expect(keel.worldReads).toBeGreaterThan(0));
      await settle();
      const reads = keel.worldReads;
      const rec = await db.getWorldRecord(s.id);
      expect(rec?.publicPageOn).toBe(true);
      expect(rec?.publicPageAt).toBe(OLD);
      expect(s.rec.publicPageOn).toBe(true);
      expect(draws).toBe(0);
      s.askPublicPage();
      await settle();
      expect(keel.worldReads).toBe(reads);
    });
  }

  it('a session let go mid-read writes nothing and draws nothing', async () => {
    const h = hold();
    keel.worldGate = h.gate;
    const s = await freshWorld();
    let draws = 0;
    s.subscribe(() => draws++);
    s.askPublicPage();
    await vi.waitFor(() => expect(keel.worldReads).toBe(1));
    forgetSession(s.id);
    h.release();
    await settle();
    const rec = await db.getWorldRecord(s.id);
    expect(rec?.publicPageOn).toBeUndefined();
    expect(rec?.publicPageAt).toBeUndefined();
    expect(s.rec.publicPageOn).toBeUndefined();
    expect(draws).toBe(0);
  });

  it('a session let go while the answer is being written does not take it up or draw', async () => {
    const s = await freshWorld();
    let draws = 0;
    s.subscribe(() => draws++);
    const real = db.updateWorldRecord;
    const spy = vi.spyOn(db, 'updateWorldRecord').mockImplementation(async (id, patch) => {
      forgetSession(id);
      return real(id, patch);
    });
    s.askPublicPage();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    await settle();
    expect(s.rec.publicPageOn).toBeUndefined();
    expect(draws).toBe(0);
  });

  it('while a full pull is under way it does not ask; later, idle and still stale, it does', async () => {
    const h = hold();
    keel.changesGate = h.gate;
    const s = await freshWorld();
    const pull = s.pull();
    await vi.waitFor(() => expect(s.status).toBe('syncing'));
    // The pull has read GET /world itself (its own read), so the answer is fresh: age it, as if stale.
    await vi.waitFor(() => expect(keel.worldReads).toBe(1));
    await db.updateWorldRecord(s.id, { publicPageAt: OLD });
    s.rec = { ...s.rec, publicPageAt: OLD };
    s.askPublicPage();
    await settle();
    expect(keel.worldReads).toBe(1);
    h.release();
    await pull;
    expect(s.status).toBe('idle');
    // The pull wrote a fresh answer; make it stale again, and now the ask goes.
    s.rec = { ...s.rec, publicPageAt: OLD };
    s.askPublicPage();
    await vi.waitFor(() => expect(keel.worldReads).toBe(2));
    await vi.waitFor(() => expect(s.rec.publicPageAt).not.toBe(OLD));
  });
});
