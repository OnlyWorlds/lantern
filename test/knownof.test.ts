// keel's "known of" stubs (keel PR 113, B16; the folder spec §4.4) against a fake keel shaped by
// the live probes (before and after keel PR 117): a stub keeps id, type, name,
// description, supertype, subtype, image_url and the stamps, and a Character's public fields
// (physicality, height, weight, species, reputation); every other field is served unset; its stamp does not move with its shape; a stub arriving or leaving answers
// the old cursor 409 resync_required, reason view.
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
// Node 22 has its own read-only navigator: replaced, so the files ask sees signal (as setnow.test.ts).
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

const { openWorld, forgetSession, setBuildBehind } = await import('../src/world');
const { buildSlice } = await import('../src/sortplan');
const { buildWorldIndex, writeWorldFile } = await import('@onlyworlds/sdk');
const { setPin } = await import('../src/pin');
const { KNOWN_OF_REFUSAL } = await import('../src/knownof');
const { toWorldFile, openWorldFile } = await import('../src/worldfile');
const db = await import('../src/db');

type El = Record<string, unknown> & { id: string; type: string; change_seq: number };

const KID = '01a15929-6709-7dac-9589-d52189313466';
const ANA = '01a15929-652c-7231-b0d1-cc2b1697a180';

/** Ana as the owner holds her: whole. */
const ANA_WHOLE = { id: ANA, type: 'character', name: 'Ana', description: 'Sells mules.', supertype: '', subtype: '', image_url: '', physicality: 'Tall', reputation: 'Honest', mentality: 'Sly', location: null, friends: [], created_at: 'c', updated_at: 'u', created_by: 'owner-id', changed_via: null };

class FakeKeel {
  els = new Map<string, El>();
  /** Ids this player knows of only (served as stubs). */
  stubs = new Set<string>();
  seq = 0;
  /** The view's epoch: moved when what the player sees changes shape. */
  epoch = 1;
  calls: string[] = [];

  put(el: Record<string, unknown> & { id: string; type: string }): El {
    const full = { ...el, change_seq: ++this.seq } as El;
    this.els.set(el.id, full);
    return full;
  }

  /** keel's stub: the kept keys and the public fields as they are, every other field unset ("" for text, null, []). */
  served(el: El): Record<string, unknown> {
    if (!this.stubs.has(el.id)) return el;
    const keep = new Set(['id', 'type', 'name', 'description', 'supertype', 'subtype', 'image_url', 'created_at', 'updated_at', 'change_seq', 'physicality', 'height', 'weight', 'species', 'reputation']);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el)) out[k] = keep.has(k) ? v : Array.isArray(v) ? [] : typeof v === 'string' && !k.endsWith('_by') ? '' : null;
    out.known_of = true;
    return out;
  }

  json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    this.calls.push(`${method} ${path}`);
    if (path === '/world') return this.json(200, { id: 'w1', name: 'Blood Meridian' });
    if (path === '/changes') {
      const cur = (seq: number) => `${seq}:ffffffff:${this.epoch}`;
      if (url.searchParams.get('head') === 'true') return this.json(200, { head: this.seq, cursor: cur(this.seq), changes: [], has_more: false, epoch: this.epoch });
      const sinceRaw = url.searchParams.get('since');
      if (sinceRaw && sinceRaw.split(':')[2] !== String(this.epoch)) {
        return this.json(409, { error: { type: 'invalid_request', code: 'resync_required', message: 'Your view of this world changed (reason view).', param: 'since', reason: 'view' } });
      }
      const since = Number((sinceRaw ?? '0').split(':')[0]);
      const changes = [...this.els.values()]
        .filter((e) => e.change_seq > since)
        .sort((a, b) => a.change_seq - b.change_seq)
        .map((e) => ({ op: 'upsert', id: e.id, type: e.type, element: this.served(e), change_seq: e.change_seq }));
      return this.json(200, { cursor: cur(this.seq), changes, has_more: false, head: this.seq, epoch: this.epoch, epoch_reason: 'view' });
    }
    // A stub's files are keel's 404.
    if (/\/files$/.test(path)) return this.json(200, { results: [] });
    if (method !== 'GET') return this.json(500, { error: { code: 'unexpected_write', message: `${method} ${path}` } });
    return this.json(404, { error: { code: 'not_found', message: 'not_found' } });
  };
}

let keel: FakeKeel;
let n = 0;

async function playerWorld(extra: Partial<db.WorldRecord> = {}) {
  const id = `pw-${++n}`;
  await db.putWorldRecord({ id, name: 'Blood Meridian', kind: 'online', apiKey: 'ow_r_' + 'r'.repeat(40), keyKind: 'read', memberRole: 'guest', characterId: KID, addedAt: '', ...extra });
  forgetSession(id);
  return openWorld(id);
}

beforeEach(() => {
  keel = new FakeKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
  keel.put({ id: KID, type: 'character', name: 'The Kid', friends: [ANA], created_at: 'c', updated_at: 'u' });
  keel.put(ANA_WHOLE);
});

describe('a stub is stored as a stub (rule 1)', () => {
  it('the copy and the store hold the kept keys, the shared fields with a value and known_of, nothing served unset', async () => {
    keel.stubs.add(ANA);
    const s = await playerWorld();
    await s.pull();
    const held = (await db.allElements(s.id)).find((e) => e.id === ANA)!;
    expect(Object.keys(held).sort()).toEqual(['change_seq', 'created_at', 'description', 'id', 'image_url', 'known_of', 'name', 'physicality', 'reputation', 'subtype', 'supertype', 'type', 'updated_at']);
    expect(held.physicality).toBe('Tall');
    expect(held.known_of).toBe(true);
    expect(s.get(ANA)).toEqual(held);
    expect(s.isStub(ANA)).toBe(true);
    // The whole Character beside it is as keel served it.
    expect(s.get(KID)?.friends).toEqual([ANA]);
    expect(s.isStub(KID)).toBe(false);
  });
});

describe("a change of shape, the stamp unmoved (rules 4 and 5)", () => {
  it('a stub that comes whole on the view reset is stored whole, and known_of goes', async () => {
    keel.stubs.add(ANA);
    const s = await playerWorld();
    await s.pull();
    // The owner tells the Kid about Ana: keel moves the view, not Ana's stamp.
    keel.stubs.delete(ANA);
    keel.epoch++;
    await s.pull();
    const held = (await db.allElements(s.id)).find((e) => e.id === ANA)!;
    expect(held.known_of).toBeUndefined();
    expect(held.physicality).toBe('Tall');
    expect(s.isStub(ANA)).toBe(false);
  });

  it('a whole copy meeting a stub on the view reset takes the stub, trimmed', async () => {
    const s = await playerWorld();
    await s.pull();
    expect(s.get(ANA)?.physicality).toBe('Tall');
    keel.stubs.add(ANA);
    keel.epoch++;
    await s.pull();
    const held = (await db.allElements(s.id)).find((e) => e.id === ANA)!;
    expect(held.known_of).toBe(true);
    expect(held).not.toHaveProperty('mentality');
    expect(held).not.toHaveProperty('created_by');
    expect(held.reputation).toBe('Honest');
  });

  it('a whole copy the cursor walk passes over stays whole until the reset (the stamp alone says nothing)', async () => {
    const s = await playerWorld();
    await s.pull();
    // keel serves Ana as a stub now but the view has not been reset: no change past the cursor.
    keel.stubs.add(ANA);
    await s.pull();
    expect(s.isStub(ANA)).toBe(false);
    keel.epoch++;
    await s.pull();
    expect(s.isStub(ANA)).toBe(true);
  });
});

describe('a stub is never changed, deleted or sent from here (rules 3 and 5)', () => {
  it('in a world you can write (an owner key holding one): edit and delete refuse, nothing queued or sent', async () => {
    keel.stubs.add(ANA);
    const s = await playerWorld({ apiKey: 'ow_w_' + 'w'.repeat(40), keyKind: 'write', memberRole: undefined, role: 'owner', characterId: null });
    setPin(s.rec, '1234');
    await s.pull();
    await expect(s.edit(ANA, { name: 'Anabel' })).rejects.toThrow(KNOWN_OF_REFUSAL);
    await expect(s.remove(ANA)).rejects.toThrow(KNOWN_OF_REFUSAL);
    expect(s.outbox).toHaveLength(0);
    expect(await db.outboxRows(s.id)).toHaveLength(0);
    expect(s.get(ANA)?.name).toBe('Ana');
    expect(keel.calls.filter((c) => !c.startsWith('GET'))).toEqual([]);
    // The whole one beside it still changes: the refusal is the stub's, not the world's.
    await s.edit(KID, { name: 'The Kid, older' });
    expect(s.outbox).toHaveLength(1);
  });

  it('a world file keeps the stub a stub, and the phone-only world it opens as refuses to change it', async () => {
    keel.stubs.add(ANA);
    const s = await playerWorld();
    await s.pull();
    const file = toWorldFile({ ...s.rec, id: 'f1000000-0000-4000-8000-000000000001' }, s.elements());
    const local = await openWorldFile(file.bytes);
    forgetSession(local);
    const l = await openWorld(local);
    expect(l.isLocal).toBe(true);
    expect(l.isStub(ANA)).toBe(true);
    expect(l.get(ANA)).not.toHaveProperty('mentality');
    expect(l.get(ANA)?.physicality).toBe('Tall');
    await expect(l.edit(ANA, { name: 'Anabel' })).rejects.toThrow(KNOWN_OF_REFUSAL);
    await expect(l.remove(ANA)).rejects.toThrow(KNOWN_OF_REFUSAL);
    expect(l.get(ANA)?.name).toBe('Ana');
  });

  it("a row carrying the stub's flag is refused, never left waiting for signal", async () => {
    const s = await playerWorld({ apiKey: 'ow_w_' + 'w'.repeat(40), keyKind: 'write', memberRole: undefined, role: 'owner', characterId: null });
    setPin(s.rec, '1234');
    await s.pull();
    // Hand-built, as no path makes one: the SDK refuses the body before it is sent (4.40).
    await db.putOutboxRow(s.id, { op: 'create', type: 'character', id: '01a15929-0000-7000-8000-00000000000a', values: { name: 'Ana', known_of: true }, idempotencyKey: 'k', state: 'waiting', createdAt: '' });
    forgetSession(s.id);
    const again = await openWorld(s.id);
    await again.flush();
    expect(again.outbox[0].state).toBe('refused');
    expect(again.outbox[0].error).toBe(KNOWN_OF_REFUSAL);
    expect(again.status).not.toBe('offline');
    expect(keel.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
  });
});

describe('the stub gate', () => {
  it('G5: a change queued while the element was whole is refused once keel narrows it to a stub, never sent', async () => {
    const s = await playerWorld({ apiKey: 'ow_w_' + 'w'.repeat(40), keyKind: 'write', memberRole: undefined, role: 'owner', characterId: null });
    setPin(s.rec, '1234');
    await s.pull();
    setBuildBehind(true); // the outbox held, so the change waits through the reset
    await s.edit(ANA, { reputation: 'Shifty' });
    keel.stubs.add(ANA);
    keel.epoch++;
    await s.pull();
    setBuildBehind(false);
    await s.flush();
    expect(s.outbox[0].state).toBe('refused');
    expect(s.outbox[0].error).toBe(KNOWN_OF_REFUSAL);
    expect(keel.calls.filter((c) => !c.startsWith('GET'))).toEqual([]);
    // The screen shows the stub as keel holds it, not the refused change.
    expect(s.get(ANA)?.reputation).toBe('Honest');
  });

  it("G3: the sort's slice never offers a stub, so no row is planned onto one", () => {
    const stub = { id: ANA, type: 'character', name: 'Ana', description: 'Sells mules.', known_of: true } as never;
    const whole = { ...ANA_WHOLE } as never;
    const note = { id: 'n1', type: 'narrative', name: 'Ana sold us a lame mule', supertype: 'Unsorted' } as never;
    const slice = (el: never) => buildSlice([note], buildWorldIndex([el, note]), (id) => (id === ANA ? el : id === 'n1' ? note : undefined)).map((x) => x.id);
    expect(slice(whole)).toEqual([ANA]); // the control: the same Ana whole is offered
    expect(slice(stub)).toEqual([]);
  });

  it("G4: a world file's stub opens trimmed, whatever the file kept on it", async () => {
    const enc = new TextEncoder();
    const loose = { ...ANA_WHOLE, mentality: '', atlas_note: '', known_of: true };
    delete (loose as Record<string, unknown>).type;
    const bytes = writeWorldFile(
      [
        { path: 'world.json', data: enc.encode(JSON.stringify({ id: 'f2000000-0000-4000-8000-000000000002', name: 'From Atlas' })) },
        { path: 'elements/character/ana.json', data: enc.encode(JSON.stringify(loose)) },
      ],
      'from-atlas',
    );
    const id = await openWorldFile(bytes);
    const held = (await db.allElements(id)).find((e) => e.id === ANA)!;
    expect(held.known_of).toBe(true);
    expect(held).not.toHaveProperty('mentality');
    expect(held).not.toHaveProperty('atlas_note');
    expect(held).not.toHaveProperty('created_by');
    expect(held.physicality).toBe('Tall');
  });
});

describe('a stub asks for no files', () => {
  it('its files are keel 404s: never asked; a whole element beside it is', async () => {
    keel.stubs.add(ANA);
    const s = await playerWorld();
    await s.pull();
    expect(s.files('character', ANA)).toBeNull();
    s.files('character', KID);
    await new Promise((r) => setTimeout(r, 0));
    expect(keel.calls.filter((c) => c.includes('/files'))).toEqual([`GET /character/${KID}/files`]);
  });
});
