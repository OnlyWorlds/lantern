// The outbox and the feed against a scrappy fake keel that refuses what keel refuses:
// a stale If-Match (412 with `current`), a write without the PIN (401), an id that exists (409).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { openWorld, forgetSession, setSessionPin, setBuildBehind } = await import('../src/world');
const db = await import('../src/db');

type El = Record<string, unknown> & { id: string; type: string; change_seq: number };

class FakeKeel {
  els = new Map<string, El>();
  deleted: { id: string; type: string; seq: number }[] = [];
  seq = 0;
  pin = '1234';
  offline = false;
  calls: string[] = [];
  resyncOnce = false;

  put(el: Omit<El, 'change_seq'>): El {
    const full = { ...el, change_seq: ++this.seq } as El;
    this.els.set(el.id, full);
    return full;
  }

  json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  err(status: number, code: string, extra: Record<string, unknown> = {}): Response {
    return this.json(status, { error: { code, message: code, type: 'x' }, ...extra });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    this.calls.push(`${method} ${path}`);
    const sentPin = headers.get('API-Pin');
    if (sentPin && sentPin !== this.pin) return this.err(401, 'invalid_credentials');
    if (method !== 'GET' && !sentPin) return this.err(401, 'invalid_credentials');

    if (path === '/world') return this.json(200, { id: 'w1', name: 'Fake world' });
    if (path === '/changes') {
      if (this.resyncOnce && url.searchParams.get('since')) {
        this.resyncOnce = false;
        return this.err(409, 'resync_required');
      }
      const since = Number(url.searchParams.get('since') ?? 0);
      const changes = [
        ...[...this.els.values()].filter((e) => e.change_seq > since).map((e) => ({ op: 'upsert', id: e.id, type: e.type, element: e, change_seq: e.change_seq })),
        ...this.deleted.filter((d) => d.seq > since).map((d) => ({ op: 'delete', id: d.id, type: d.type, change_seq: d.seq })),
      ].sort((a, b) => a.change_seq - b.change_seq);
      return this.json(200, { cursor: String(this.seq), changes, has_more: false, head: this.seq });
    }
    const m = path.match(/^\/([a-z]+)\/?([^/]*)\/?$/);
    if (!m) return this.err(404, 'not_found');
    const [, type, id] = m;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (method === 'POST') {
      if (this.els.has(body.id)) return this.err(409, 'id_conflict');
      return this.json(201, this.put({ ...body, type }));
    }
    if (method === 'GET') {
      const el = this.els.get(id);
      return el ? this.json(200, el) : this.err(404, 'not_found');
    }
    if (method === 'PATCH') {
      const el = this.els.get(id);
      if (!el) return this.err(404, 'not_found');
      const ifMatch = headers.get('If-Match');
      if (ifMatch !== null && Number(ifMatch.replace(/"/g, '')) !== el.change_seq) {
        return this.err(412, 'precondition_failed', { current: el });
      }
      return this.json(200, this.put({ ...el, ...body }));
    }
    return this.err(405, 'method_not_allowed');
  };
}

let keel: FakeKeel;
let n = 0;

async function freshWorld() {
  const id = `w-${++n}`;
  await db.putWorldRecord({ id, name: 'Fake world', kind: 'online', apiKey: 'ow_w_' + 'a'.repeat(40), keyKind: 'write', addedAt: '' });
  forgetSession(id);
  return openWorld(id);
}

beforeEach(() => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
  setBuildBehind(false);
});

describe('pull', () => {
  it('fetches the world from zero, then only what changed', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    keel.put({ id: 'b', type: 'location', name: 'Tharn' });
    const s = await freshWorld();
    await s.pull();
    expect(s.get('a')?.name).toBe('Ada');
    expect(s.rec.cursor).toBe('2');
    keel.put({ ...keel.els.get('a')!, name: 'Ada Vell' });
    keel.els.delete('b');
    keel.deleted.push({ id: 'b', type: 'location', seq: ++keel.seq });
    await s.pull();
    expect(s.get('a')?.name).toBe('Ada Vell');
    expect(s.get('b')).toBeUndefined();
    expect(keel.calls.filter((c) => c.startsWith('GET /changes')).length).toBe(2);
  });

  it('on resync_required drops the copy and walks from zero', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    keel.resyncOnce = true;
    await s.pull();
    expect(s.get('a')?.name).toBe('Ada');
    expect(s.status).toBe('idle');
  });

  it('offline: keeps what the phone has and says so', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    keel.offline = true;
    await s.pull();
    expect(s.status).toBe('offline');
    expect(s.get('a')?.name).toBe('Ada');
  });
});

describe('outbox', () => {
  it('an edit shows at once, waits for the PIN, then sends with If-Match', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    await s.edit('a', { name: 'Ada Vell' });
    await s.flush();
    expect(s.get('a')?.name).toBe('Ada Vell');
    expect(s.needPin).toBe(true);
    expect(s.waitingCount()).toBe(1);
    setSessionPin(s.id, '1234');
    await s.flush();
    expect(s.waitingCount()).toBe(0);
    expect(keel.els.get('a')?.name).toBe('Ada Vell');
    expect((await db.outboxRows(s.id)).length).toBe(0);
  });

  it('two edits to one element while waiting become one row', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    await s.edit('a', { name: 'Ada Vell' });
    await s.edit('a', { age: 54 });
    expect(s.outbox.length).toBe(1);
    expect(s.outbox[0].values).toEqual({ name: 'Ada Vell', age: 54 });
  });

  it('412 on an untouched field: re-sends by itself on the new copy', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada', age: 50 });
    const s = await freshWorld();
    await s.pull();
    await s.edit('a', { name: 'Ada Vell' });
    keel.put({ ...keel.els.get('a')!, age: 51 }); // someone else, another field
    setSessionPin(s.id, '1234');
    await s.flush();
    expect(s.waitingCount()).toBe(0);
    expect(s.needsYouCount()).toBe(0);
    expect(keel.els.get('a')).toMatchObject({ name: 'Ada Vell', age: 51 });
  });

  it('412 on the same field: needs you, and keep-mine sends on the new copy', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    await s.edit('a', { name: 'Ada Vell' });
    keel.put({ ...keel.els.get('a')!, name: 'Ada of Tharn' });
    setSessionPin(s.id, '1234');
    await s.flush();
    expect(s.needsYouCount()).toBe(1);
    const row = s.outbox[0];
    expect(row.state).toBe('needs-you');
    expect(row.current?.name).toBe('Ada of Tharn');
    await s.resolve(row, ['name']);
    await s.flush();
    expect(keel.els.get('a')?.name).toBe('Ada Vell');
    expect(s.outbox.length).toBe(0);
  });

  it('412 on the same field: take-theirs drops the edit and keeps their copy', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    await s.edit('a', { name: 'Ada Vell' });
    keel.put({ ...keel.els.get('a')!, name: 'Ada of Tharn' });
    setSessionPin(s.id, '1234');
    await s.flush();
    await s.resolve(s.outbox[0], []);
    expect(s.outbox.length).toBe(0);
    expect(s.get('a')?.name).toBe('Ada of Tharn');
    expect(keel.els.get('a')?.name).toBe('Ada of Tharn');
  });

  it('a link set compares as a set: a reordered array is not a conflict', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada', friends: ['x', 'y'] });
    const s = await freshWorld();
    await s.pull();
    await s.edit('a', { friends: ['x', 'y', 'z'] });
    keel.put({ ...keel.els.get('a')!, friends: ['y', 'x'] });
    setSessionPin(s.id, '1234');
    await s.flush();
    expect(s.needsYouCount()).toBe(0);
    expect(keel.els.get('a')?.friends).toEqual(['x', 'y', 'z']);
  });

  it('a wrong PIN stops the outbox and asks again, once', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    await s.edit('a', { name: 'Ada Vell' });
    setSessionPin(s.id, '9999');
    await s.flush();
    expect(s.needPin).toBe(true);
    expect(s.waitingCount()).toBe(1);
    expect(keel.calls.filter((c) => c.startsWith('PATCH')).length).toBe(1);
  });

  it('no network: the change stays waiting and the screen says so', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    keel.offline = true;
    setSessionPin(s.id, '1234');
    await s.edit('a', { name: 'Ada Vell' });
    await s.flush();
    expect(s.waitingCount()).toBe(1);
    expect(s.status).toBe('offline');
    keel.offline = false;
    await s.flush();
    expect(s.waitingCount()).toBe(0);
  });

  it('a create made offline carries its own id and lands once', async () => {
    const s = await freshWorld();
    await s.pull();
    keel.offline = true;
    setSessionPin(s.id, '1234');
    const id = await s.create('narrative', { name: 'A page', supertype: 'Unsorted' });
    expect(s.get(id)?.supertype).toBe('Unsorted');
    keel.offline = false;
    await s.flush();
    expect(keel.els.get(id)?.name).toBe('A page');
    expect(s.outbox.length).toBe(0);
  });

  it('a create whose answer was lost (409 id_conflict) takes the server copy', async () => {
    const s = await freshWorld();
    await s.pull();
    setSessionPin(s.id, '1234');
    keel.offline = true;
    const id = await s.create('narrative', { name: 'A page' });
    keel.offline = false;
    keel.put({ id, type: 'narrative', name: 'A page' }); // it reached the server before
    await s.flush();
    expect(s.outbox.length).toBe(0);
    expect(s.get(id)?.change_seq).toBeTypeOf('number');
  });

  it('deleted elsewhere: the edit offers keep-as-new', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    await s.edit('a', { name: 'Ada Vell' });
    keel.els.delete('a');
    setSessionPin(s.id, '1234');
    await s.flush();
    const row = s.outbox[0];
    expect(row.state).toBe('gone');
    await s.keepAsNew(row);
    await s.flush();
    const made = [...keel.els.values()].find((e) => e.name === 'Ada Vell');
    expect(made).toBeTruthy();
    expect(made!.id).not.toBe('a');
  });

  it('holds while the build is behind', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    setSessionPin(s.id, '1234');
    setBuildBehind(true);
    await s.edit('a', { name: 'Ada Vell' });
    await s.flush();
    expect(keel.calls.some((c) => c.startsWith('PATCH'))).toBe(false);
    setBuildBehind(false);
    await s.flush();
    expect(keel.els.get('a')?.name).toBe('Ada Vell');
  });

  it('a row caught mid-send goes back to waiting on reopen', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    await s.edit('a', { name: 'Ada Vell' });
    const row = (await db.outboxRows(s.id))[0];
    await db.putOutboxRow(s.id, { ...row, state: 'sending' });
    forgetSession(s.id);
    const s2 = await openWorld(s.id);
    expect(s2.outbox[0].state).toBe('waiting');
  });
});
