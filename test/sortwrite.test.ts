// The morning after's writes, composed with the outbox (the S399 merge gate's confirmed findings,
// each now a guard): a late Finish writing is judged against the plan's base; a target with a
// conflict waiting is not added to; a target removed elsewhere is passed, not a dead end; the
// slice trims as keel does; a map's colour is never a row's to write. And upheld: with no PIN the
// writes wait, then send once each.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildWorldIndex, type OwElement } from '@onlyworlds/sdk';

const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { openWorld, forgetSession } = await import('../src/world');
const { setPin } = await import('../src/pin');
const db = await import('../src/db');
const { planWrites, buildSlice } = await import('../src/sortplan');
const { fixPlan, runWrites } = await import('../src/sortwrite');

type El = Record<string, unknown> & { id: string; type: string; change_seq: number };
/** A keel that answers what these cases need: the feed, creates, If-Match patches (412 with the current copy), the PIN on writes. */
class Keel {
  els = new Map<string, El>();
  dels: { id: string; type: string; seq: number }[] = [];
  seq = 0;
  pin = '1234';
  calls: string[] = [];
  put(el: Record<string, unknown> & { id: string; type: string }): El {
    const full = { ...el, change_seq: ++this.seq } as El;
    this.els.set(el.id, full);
    return full;
  }
  json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
  err(status: number, code: string, extra: Record<string, unknown> = {}) {
    return this.json(status, { error: { code, message: code, type: 'x' }, ...extra });
  }
  fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    this.calls.push(`${method} ${path}`);
    if (method !== 'GET' && headers.get('API-Pin') !== this.pin) return this.err(401, 'invalid_credentials');
    if (path === '/world') return this.json(200, { id: 'w', name: 'W' });
    if (path === '/changes') {
      const since = Number(url.searchParams.get('since') ?? '0');
      const changes = [
        ...[...this.els.values()].filter((e) => e.change_seq > since).map((e) => ({ op: 'upsert', id: e.id, type: e.type, element: e, change_seq: e.change_seq })),
        ...this.dels.filter((d) => d.seq > since).map((d) => ({ op: 'delete', id: d.id, type: d.type, change_seq: d.seq })),
      ];
      return this.json(200, { cursor: String(this.seq), changes, has_more: false, head: this.seq });
    }
    const [, type, id] = path.match(/^\/([a-z]+)\/?([^/]*)\/?$/)!;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (method === 'POST') return this.json(201, this.put({ ...body, type }));
    if (method === 'GET') return this.json(200, this.els.get(id));
    if (method === 'PATCH') {
      const el = this.els.get(id)!;
      const ifMatch = headers.get('If-Match');
      if (ifMatch !== null && Number(ifMatch.replace(/"/g, '')) !== el.change_seq) return this.err(412, 'precondition_failed', { current: el });
      return this.json(200, this.put({ ...el, ...body }));
    }
    return this.err(405, 'x');
  };
}

let keel: Keel;
let n = 0;
async function world(withPin = true) {
  const id = `sw-${++n}`;
  await db.putWorldRecord({ id, name: 'W', kind: 'online', apiKey: 'ow_w_' + 'a'.repeat(40), keyKind: 'write', addedAt: '' });
  if (withPin) setPin({ id }, '1234');
  forgetSession(id);
  return openWorld(id);
}
const settle = () => new Promise((r) => setTimeout(r, 30));
const ctxOf = (s: Awaited<ReturnType<typeof world>>) => ({
  base: (id: string) => s.serverCopy(id),
  waitsOnYou: (id: string) => [...s.pending(id).values()].some((r) => r.state === 'needs-you' || r.state === 'gone'),
});

const A = '0190a000-0000-7000-8000-00000000000a';
const N = '0190a000-0000-7000-8000-0000000000ff';
const addToA = (value: string) => ({ kind: 'add_to' as const, source_line: 'x', target: { id: A, type: 'Character', name: 'Ada' }, field: 'description', op: 'append' as const, value });

beforeEach(() => {
  keel = new Keel();
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
});

describe('the write run', () => {
  it("a late Finish writing meets a co-builder's change as a conflict, never overwriting it", async () => {
    keel.put({ id: A, type: 'character', name: 'Ada', description: 'Ada.' });
    keel.put({ id: N, type: 'narrative', name: 'note', supertype: 'Unsorted', description: 'Ada is a brewer' });
    const s = await world();
    await s.pull();
    const p = planWrites([{ key: '0', row: addToA('A brewer.') }], (id) => s.get(id), new Set([A]), ctxOf(s));
    // The plan is fixed; a co-builder rewrites Ada; the phone syncs; then Finish writing.
    keel.put({ ...keel.els.get(A)!, description: 'Ada, rewritten by a co-builder.' });
    await s.pull();
    await runWrites(s, { plan: p.writes, notes: [N] }, () => {});
    await s.flush();
    await settle();
    expect(keel.els.get(A)!.description).toBe('Ada, rewritten by a co-builder.');
    expect(s.outbox.filter((r) => r.state === 'needs-you').length).toBe(1);
  });

  it('a target with a conflict waiting for the person is not added to: settle it first', async () => {
    keel.put({ id: A, type: 'character', name: 'Ada', description: 'Ada.' });
    const s = await world();
    await s.pull();
    keel.put({ ...keel.els.get(A)!, description: 'Ada (theirs).' });
    await s.edit(A, { description: 'Ada (mine).' }, { ...keel.els.get(A)!, description: 'Ada.', change_seq: 1 });
    await s.flush();
    await settle();
    expect(s.outbox.some((r) => r.state === 'needs-you')).toBe(true);
    const p = planWrites([{ key: '0', row: addToA('A brewer.') }], (id) => s.get(id), new Set([A]), ctxOf(s));
    expect(p.writes).toEqual([]);
    expect(p.skipped[0]?.reason).toMatch(/waits for you/);
  });

  it('a target removed elsewhere is passed, the rest still written and the notes filed', async () => {
    keel.put({ id: A, type: 'character', name: 'Ada', description: 'Ada.' });
    keel.put({ id: N, type: 'narrative', name: 'note', supertype: 'Unsorted', description: 'x' });
    const s = await world();
    await s.pull();
    const make = { kind: 'make' as const, source_line: 'x', proposal: { type: 'Location', name: 'The Swoop', description: 'A cove.' } };
    const p = planWrites([{ key: '0', row: make }, { key: '1', row: addToA('B.') }], (id) => s.get(id), new Set([A]), ctxOf(s));
    keel.els.delete(A);
    keel.dels.push({ id: A, type: 'character', seq: ++keel.seq });
    await s.pull();
    const k = { plan: p.writes, notes: [N] };
    const { gone } = await runWrites(s, k, () => {});
    expect(gone).toBe(1);
    expect(k).toMatchObject({ step: 3 });
    await s.flush();
    await settle();
    expect([...keel.els.values()].some((e) => e.name === 'The Swoop')).toBe(true);
    expect(keel.els.get(N)!.supertype).toBe('Sorted');
  });

  it('a crash after a create is queued, before its step is kept, makes nothing twice (the id and key fixed with the plan)', async () => {
    keel.put({ id: N, type: 'narrative', name: 'note', supertype: 'Unsorted', description: 'x' });
    const make = { kind: 'make' as const, source_line: 'x', proposal: { type: 'Location', name: 'The Swoop', description: 'A cove.' } };
    const swoops = () => [...keel.els.values()].filter((e) => e.name === 'The Swoop').length;
    // Two crashes: one while the create still waits (no PIN), one after it reached keel.
    for (const sent of [false, true]) {
      const before = swoops();
      const posts = () => keel.calls.filter((c) => c === 'POST /location').length;
      const postsBefore = posts();
      const s = await world(sent);
      await s.pull();
      const plan = fixPlan(planWrites([{ key: '0', row: make }], (id) => s.get(id), new Set(), ctxOf(s)).writes);
      await runWrites(s, { plan, notes: [] }, () => {});
      // The create goes under the plan's own key, so keel replays it rather than making it again.
      if (!sent) expect(s.outbox.map((r) => [r.id, r.idempotencyKey])).toEqual([[plan[0].id, plan[0].idempotencyKey]]);
      if (sent) {
        await s.flush();
        await settle();
      }
      // The outbox row (or keel's copy) is kept; the step that would say so never reached storage.
      forgetSession(s.id);
      const again = await openWorld(s.id);
      await again.pull();
      await runWrites(again, { plan, notes: [], step: 0 }, () => {});
      setPin(again.rec, '1234');
      await again.flush();
      await settle();
      await again.flush();
      expect(swoops() - before, sent ? 'after keel had it' : 'while it waited').toBe(1);
      expect(posts() - postsBefore, 'one create sent').toBe(1);
      expect(again.outbox.length).toBe(0);
    }
  });

  it('with no PIN the writes wait, then send once each when it comes (upheld)', async () => {
    keel.put({ id: A, type: 'character', name: 'Ada', description: 'Ada.' });
    keel.put({ id: N, type: 'narrative', name: 'note', supertype: 'Unsorted', description: 'x' });
    const s = await world(false);
    await s.pull();
    const make = { kind: 'make' as const, source_line: 'x', proposal: { type: 'Location', name: 'The Swoop', description: 'A cove.' } };
    const p = planWrites([{ key: '0', row: make }, { key: '1', row: addToA('Brewer.') }], (id) => s.get(id), new Set([A]), ctxOf(s));
    await runWrites(s, { plan: p.writes, notes: [N] }, () => {});
    await s.flush();
    expect(s.needPin).toBe(true);
    expect(keel.calls.filter((c) => !c.startsWith('GET')).length).toBe(0);
    setPin(s.rec, '1234');
    await s.flush();
    await settle();
    await s.flush();
    expect(keel.calls.filter((c) => c.startsWith('POST')).length).toBe(1);
    expect(keel.els.get(A)!.description).toBe('Ada.\n\nBrewer.');
    expect(keel.els.get(N)!.supertype).toBe('Sorted');
    expect(s.outbox.length).toBe(0);
  });
});

describe('what a row may write, and what the slice sends', () => {
  it("a map's colour and a pin's element type are settings, never a row's to write", () => {
    const M = '0190a000-0000-7000-8000-0000000000aa';
    const get = (id: string) => (id === M ? ({ id: M, type: 'map', name: 'The Coast' } as OwElement) : undefined);
    const row = { kind: 'add_to' as const, source_line: 'x', target: { id: M, type: 'Map', name: 'The Coast' }, field: 'background_color', op: 'append' as const, value: 'url(https://evil.example/p.png)' };
    const p = planWrites([{ key: '0', row }], get, new Set([M]));
    expect(p.writes).toEqual([]);
    expect(p.skipped.length).toBe(1);
  });

  it("a name that keel's Python strips to nothing stays out of the slice (one bad item refuses the whole sort)", () => {
    const note = { id: N, type: 'narrative', name: 'Dot', supertype: 'Unsorted', description: 'Dot \u0085 fire' } as OwElement;
    const odd = { id: A, type: 'character', name: '\u0085\x1c', description: 'Dot fire' } as OwElement;
    const m = new Map([note, odd].map((e) => [e.id, e]));
    expect(buildSlice([note], buildWorldIndex([note, odd]), (id) => m.get(id)).map((x) => x.id)).not.toContain(A);
  });
});
