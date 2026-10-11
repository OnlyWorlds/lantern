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
  /** Writes wait on this before answering (a send held in flight). */
  gate: Promise<void> | null = null;
  /** The next write is applied, then its answer is lost, and the network stays down. */
  dropAnswerOnce = false;
  /** The next write answers this error instead. */
  nextError: { status: number; code: string } | null = null;
  /** A walk from zero fails (a resync whose walk drops). */
  failZeroWalk = false;
  idem = new Map<string, string>();

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
      if (this.failZeroWalk && !url.searchParams.get('since')) throw new TypeError('Failed to fetch');
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
    if (method !== 'GET') {
      if (this.gate) await this.gate;
      if (this.nextError) {
        const e = this.nextError;
        this.nextError = null;
        return this.err(e.status, e.code);
      }
    }
    const answer = (r: Response): Response => {
      if (method !== 'GET' && this.dropAnswerOnce) {
        this.dropAnswerOnce = false;
        this.offline = true;
        throw new TypeError('Failed to fetch');
      }
      return r;
    };
    if (method === 'POST') {
      const key = headers.get('Idempotency-Key');
      if (key && this.idem.has(key)) {
        if (this.idem.get(key) !== String(init.body)) return this.err(409, 'idempotency_error');
        return this.json(201, this.els.get(body.id));
      }
      if (key && !this.els.has(body.id)) this.idem.set(key, String(init.body));
      if (this.els.has(body.id)) return this.err(409, 'id_conflict');
      return answer(this.json(201, this.put({ ...body, type })));
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
      return answer(this.json(200, this.put({ ...el, ...body })));
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

  // ---------- the gate's findings (S394), each a case ----------

  it('an edit made while its create is in flight follows it, and both land', async () => {
    const s = await freshWorld();
    await s.pull();
    setSessionPin(s.id, '1234');
    let release!: () => void;
    keel.gate = new Promise((r) => (release = r));
    const id = await s.create('narrative', { name: 'A page' });
    const flushing = s.flush();
    await new Promise((r) => setTimeout(r, 20));
    expect(s.outbox[0].state).toBe('sending');
    await s.edit(id, { description: 'Written while it was sending' });
    expect(s.outbox.length).toBe(2);
    expect(s.outbox[1].op).toBe('patch');
    keel.gate = null;
    release();
    await flushing;
    await s.flush();
    expect(keel.els.get(id)).toMatchObject({ name: 'A page', description: 'Written while it was sending' });
    expect(s.outbox.length).toBe(0);
  });

  it('an edit made while a patch is in flight is no conflict with itself', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    setSessionPin(s.id, '1234');
    let release!: () => void;
    keel.gate = new Promise((r) => (release = r));
    await s.edit('a', { name: 'Ada Vell' });
    await new Promise((r) => setTimeout(r, 20));
    await s.edit('a', { name: 'Ada Vell of Tharn' });
    keel.gate = null;
    release();
    await s.flush();
    await s.flush();
    expect(s.needsYouCount()).toBe(0);
    expect(keel.els.get('a')?.name).toBe('Ada Vell of Tharn');
  });

  it('a patch that landed but lost its answer settles quietly on the re-send', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    const s = await freshWorld();
    await s.pull();
    setSessionPin(s.id, '1234');
    keel.dropAnswerOnce = true;
    await s.edit('a', { name: 'Ada Vell' });
    await s.flush();
    expect(s.waitingCount()).toBe(1);
    keel.offline = false;
    await s.flush();
    expect(keel.calls.filter((c) => c.startsWith('PATCH')).length).toBe(2);
    expect(s.needsYouCount()).toBe(0);
    expect(s.outbox.length).toBe(0);
    expect(s.get('a')?.name).toBe('Ada Vell');
  });

  it('a create that landed but lost its answer, then edited: the edit is sent as a patch', async () => {
    const s = await freshWorld();
    await s.pull();
    setSessionPin(s.id, '1234');
    keel.dropAnswerOnce = true;
    const id = await s.create('narrative', { name: 'A page' });
    await s.flush();
    expect(s.outbox[0].state).toBe('waiting');
    await s.edit(id, { description: 'Added after' });
    expect(s.outbox.length).toBe(1); // merged into the waiting create
    keel.offline = false;
    await s.flush();
    expect(keel.calls.filter((c) => c.startsWith('PATCH')).length).toBe(1);
    expect(keel.els.get(id)).toMatchObject({ name: 'A page', description: 'Added after' });
    expect(s.outbox.length).toBe(0);
  });

  it('busy, throttled or a server fault: the row waits and nothing after it is sent', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    keel.put({ id: 'b', type: 'character', name: 'Bo' });
    const s = await freshWorld();
    await s.pull();
    setSessionPin(s.id, '1234');
    for (const status of [429, 503, 502]) {
      keel.offline = true;
      await s.edit('a', { name: `Ada ${status}` });
      await s.edit('b', { name: `Bo ${status}` });
      await s.flush();
      keel.offline = false;
      keel.nextError = { status, code: 'x' };
      const before = keel.calls.filter((c) => c.startsWith('PATCH')).length;
      await s.flush();
      expect(s.outbox.filter((r) => r.state === 'refused').length).toBe(0);
      expect(keel.calls.filter((c) => c.startsWith('PATCH')).length - before).toBe(1);
      await s.flush();
      expect(s.outbox.length).toBe(0);
    }
  });

  it('a feed page older than a settled send does not put the old copy back', async () => {
    // The race: the feed carries another hand's edit (seq 2) while my send, re-sent on that copy,
    // settles at seq 3. Applying the page after the settle would put seq 2 back.
    keel.put({ id: 'a', type: 'character', name: 'Ada', age: 50 });
    const s = await freshWorld();
    await s.pull();
    const theirs = keel.put({ ...keel.els.get('a')!, age: 51 });
    setSessionPin(s.id, '1234');
    await s.edit('a', { name: 'Ada Vell' });
    await s.flush();
    expect(s.get('a')).toMatchObject({ name: 'Ada Vell', change_seq: 3 });
    keel.els.set('a', { ...theirs }); // the feed still answers with seq 2
    await s.pull();
    expect(s.get('a')).toMatchObject({ name: 'Ada Vell', change_seq: 3 });
  });

  it('a resync whose walk drops keeps the old copy whole', async () => {
    keel.put({ id: 'a', type: 'character', name: 'Ada' });
    keel.put({ id: 'b', type: 'location', name: 'Tharn' });
    const s = await freshWorld();
    await s.pull();
    keel.resyncOnce = true;
    keel.failZeroWalk = true;
    await s.pull();
    expect(s.get('a')?.name).toBe('Ada');
    expect(s.get('b')?.name).toBe('Tharn');
    expect(s.status).toBe('offline');
  });
});
