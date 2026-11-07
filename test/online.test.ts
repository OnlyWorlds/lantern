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
const { putOnline, PinNeeded, StartOverOffered, startOver, isPutting } = await import('../src/online');
const { openWorld, forgetSession } = await import('../src/world');

type El = Record<string, unknown> & { id: string; type: string; change_seq: number };

let madeWorlds = 0;

/** An object's keys reversed, at every depth: Postgres's jsonb does not keep the order a value was sent in. */
function reorder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reorder);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder((v as Record<string, unknown>)[k])]));
  return v;
}

class FakeAccountKeel {
  accountPin: string | null = null;
  worlds = new Map<string, { name: string; key: string; keys: string[]; els: Map<string, El>; meta: Record<string, unknown> }>();
  /** keel since 2026-11-07: the create and the hand-over replay an Idempotency-Key in the account's scope. Off: a keel before it, or rolled back. */
  replay = true;
  /** The account's replay store: route and key to the body sent and the answer given. */
  acctIdem = new Map<string, { sent: string; status: number; answer: Record<string, unknown> }>();
  /** The next hand-over or create commits and then its answer is lost. */
  loseHandoverAnswer = false;
  loseCreateAnswer = false;
  /** The next hand-over is refused (nothing written) and that answer is lost. */
  loseRefusalAnswer = false;
  handovers: Record<string, unknown>[] = [];
  handoverClient: string | null = null;
  /** Someone adds an element to the world online right after the hand-over makes it. */
  addAfterHandover = false;
  /** The next media ticket fails (a 503), once. */
  failTicketOnce = false;
  mints: Record<string, unknown>[] = [];
  /** Ids keel refuses in its first phase (a field it will not take): every item linking to one fails invalid_link. */
  refuseIds = new Set<string>();
  /** The hidden mark switched off on the server (keel's create_hidden: 422 param hidden). */
  hiddenOff = false;
  /** The account token another sign-in holds: it owns none of these worlds. */
  otherToken = 'ow_a_other';
  creates: Record<string, unknown>[] = [];
  patches: Record<string, unknown>[] = [];
  refuseProducer = false;
  /** keel before d98ba65: the create kept no prefixed key. */
  oldCreate = false;
  /** keel before 2026-11-07 (or rolled back): a pinned account's `pin` on the create is a 422, never checked. */
  pinOmitOnly = false;
  /** Wrong PINs before the account's lock answers 429 (core/auth's wall; the count here is the fake's). */
  pinTriesLeft = 5;
  /** A server that answers a PATCH 200 and keeps none of its prefixed keys: the read is the only witness. */
  losePatchedKeys = false;
  refuseSettings = false;
  extMax = 65536;
  otherWorldIds = new Set<string>();
  idem = new Map<string, string>();
  seq = 0;
  bulks = 0;
  failBulkOnce = false;
  cannotHide = false;
  sentBodies: Record<string, unknown>[] = [];
  uploads = 0;
  uploaded: { type: string; bytes: Uint8Array }[] = [];

  json(status: number, body: unknown, extra: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
  }
  err(status: number, code: string, param?: string) {
    return this.json(status, { error: { code, message: code, param } });
  }
  /** keel's AccountScope keys on the account, not the token: two sign-ins of one account share it. */
  accountOf(auth: string | null): string | null {
    if (auth === 'Bearer ow_a_test' || auth === 'Bearer ow_a_test2') return 'acct-a';
    if (auth === `Bearer ${this.otherToken}`) return 'acct-b';
    return null;
  }
  worldOfKey(key: string | null) {
    return [...this.worlds.entries()].find(([, w]) => !!key && w.keys.includes(key));
  }
  /** Ids held anywhere: keel's ids are global, so an id in any world answers id_conflict elsewhere. */
  held(id: string, but?: string) {
    if (this.otherWorldIds.has(id)) return true;
    return [...this.worlds.entries()].some(([wid, w]) => wid !== but && w.els.has(id));
  }
  /** keel's core/idempotency once(): a stored answer for the same body is replayed, another body is 409. */
  idemCheck(route: string, key: string | null, raw: string): Response | { replay: Record<string, unknown>; status: number } | null {
    if (!this.replay || !key) return null;
    const got = this.acctIdem.get(`${route}:${key}`);
    if (!got) return null;
    if (got.sent !== raw) return this.err(409, 'idempotency_error');
    return { replay: got.answer, status: got.status };
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;

    // The live host's connect-src names only https origins: a fetch of a data: address is refused
    // there in both engines.
    if (url.protocol !== 'https:') throw new TypeError('Failed to fetch');
    if (url.host === 'edge.test') {
      this.uploads++;
      if (init.body instanceof Blob) this.uploaded.push({ type: init.body.type, bytes: new Uint8Array(await init.body.arrayBuffer()) });
      return this.json(200, { url: `https://media.onlyworlds.com/w/${this.uploads}.webp`, key: `w/${this.uploads}.webp`, bytes: 1, type: 'image/webp', etag: 'x' });
    }
    if (path === '/account' && method === 'GET') {
      const acct = this.accountOf(headers.get('Authorization'));
      if (!acct) return this.err(401, 'invalid_credentials');
      return this.json(200, { id: acct, username: acct === 'acct-a' ? 'ada' : 'bo' });
    }
    if (path === '/account/worlds' && method === 'POST') {
      const acct = this.accountOf(headers.get('Authorization'));
      if (!acct) return this.err(401, 'invalid_credentials');
      // keel's _clean_new_world, in its order: the maker's line, the prefixed keys (taken as given, a null is
      // no key, an unprefixed stray ignored, the store under the cap: 422 param extensions), then the PIN
      // (since 2026-11-07 a pinned account's sent pin is checked before anything is written, a malformed one
      // counting as wrong: 401 param pin; past the lock, 429 with Retry-After; an account with no PIN needs
      // a valid new one, 1000-9999, else 422).
      if (body.producer !== undefined && this.refuseProducer) return this.err(422, 'invalid', 'producer');
      const ext: Record<string, unknown> = {};
      if (!this.oldCreate) for (const [k, v] of Object.entries(body)) if (/^(x_|atlas_|shadow_)/.test(k) && v !== null) ext[k] = v;
      if (JSON.stringify(ext).length > this.extMax) return this.err(422, 'invalid_request', 'extensions');
      if (this.accountPin && body.pin !== undefined) {
        if (this.pinOmitOnly) return this.err(422, 'invalid_request', 'pin');
        if (this.pinTriesLeft <= 0) return this.json(429, { error: { code: 'rate_limited', message: 'Too many attempts.' } }, { 'Retry-After': '300' });
        if (String(body.pin) !== this.accountPin) {
          this.pinTriesLeft--;
          return this.err(401, 'invalid_credentials', 'pin');
        }
      }
      if (!this.accountPin && !/^[1-9]\d{3}$/.test(String(body.pin ?? ''))) return this.err(422, 'invalid_request', 'pin');
      // keel since 2026-11-07: the create's checks run before once(); a replay answers the world without its key.
      const seen = this.idemCheck(`create:${acct}`, headers.get('Idempotency-Key'), String(init.body));
      if (seen instanceof Response) return seen;
      if (seen) return this.json(seen.status, seen.replay, { 'Idempotent-Replay': 'true' });
      this.creates.push(body);
      if (!this.accountPin) this.accountPin = body.pin;
      // Unique across the file's tests: the phone's store outlives each test's fake.
      const id = `0w${++madeWorlds}000000-0000-4000-8000-000000000000`;
      const key = `ow_w_${'k'.repeat(30)}${this.worlds.size}`;
      this.worlds.set(id, { name: body.name, key, keys: [key], els: new Map(), meta: { ...ext }, owner: acct } as never);
      const row = { id, name: body.name, role: 'owner', ...ext };
      const k = headers.get('Idempotency-Key');
      if (this.replay && k) this.acctIdem.set(`create:${acct}:${k}`, { sent: String(init.body), status: 201, answer: row });
      if (this.loseCreateAnswer) {
        this.loseCreateAnswer = false;
        throw new TypeError('Failed to fetch');
      }
      return this.json(201, { ...row, key });
    }
    if (path === '/account/worlds/handover' && method === 'POST') {
      const auth = this.accountOf(headers.get('Authorization'));
      if (!auth) return this.err(401, 'invalid_credentials');
      // keel's body cap (DATA_UPLOAD_MAX_MEMORY_SIZE, 2.5 MB): 413 before anything is read.
      if (String(init.body).length > 2_500_000) return this.json(413, { error: { code: 'payload_too_large', message: 'Request body too large.' } });
      const w = body.world;
      const items = body.items as { type: string; element: Record<string, unknown> }[];
      if (!w || typeof w !== 'object') return this.err(422, 'invalid_request', 'world');
      if (!Array.isArray(items) || !items.length) return this.err(422, 'invalid_request', 'items');
      // keel since 2026-11-07: once() wraps the write, so the key is read before the world's own checks.
      const seen = this.idemCheck(`handover:${auth}`, headers.get('Idempotency-Key'), String(init.body));
      if (seen instanceof Response) return seen;
      if (seen) return this.json(seen.status, seen.replay, { 'Idempotent-Replay': 'true' });
      // _clean_new_world's order (accounts/api.py): the maker's line, the prefixed keys, then the PIN.
      if (w.producer !== undefined && this.refuseProducer) return this.err(422, 'invalid', 'producer');
      const ext: Record<string, unknown> = {};
      if (!this.oldCreate) for (const [k, v] of Object.entries(w)) if (/^(x_|atlas_|shadow_)/.test(k) && v !== null) ext[k] = v;
      if (JSON.stringify(ext).length > this.extMax) return this.err(422, 'invalid_request', 'extensions');
      if (this.accountPin && w.pin !== undefined) {
        if (this.pinOmitOnly) return this.err(422, 'invalid_request', 'pin');
        if (this.pinTriesLeft <= 0) return this.json(429, { error: { code: 'rate_limited', message: 'Too many attempts.' } }, { 'Retry-After': '300' });
        if (String(w.pin) !== this.accountPin) {
          this.pinTriesLeft--;
          return this.err(401, 'invalid_credentials', 'pin');
        }
      }
      if (!this.accountPin && !/^[1-9]\d{3}$/.test(String(w.pin ?? ''))) return this.err(422, 'invalid_request', 'pin');
      this.handovers.push(body);
      this.handoverClient = headers.get('X-OW-Client');
      // The world's body, as the create's tests read it.
      this.creates.push(w);
      for (const it of items) this.sentBodies.push(it.element);
      // process_bulk(atomic) with actor None: phase 1 refuses what it will not take and, to a fixpoint,
      // every item linking to a refused one (invalid_link); apply finds an id held in another world.
      const first = new Set<string>();
      const slots: Record<string, unknown>[] = items.map((it) => {
        const el = it.element;
        if ('known_of' in el) return { status: 422, error: { code: 'invalid_request', message: 'Unknown field: known_of' } };
        if ('x_served_trimmed' in el) return { status: 422, error: { code: 'served_trimmed_not_writable', message: 'x_served_trimmed is served only.' } };
        if (this.hiddenOff && el.hidden === true) return { status: 422, error: { code: 'invalid_request', message: 'Hiding is off on this server.', param: 'hidden' } };
        if (this.refuseIds.has(el.id as string)) return { status: 422, error: { code: 'invalid_request', message: `Unknown field on ${el.name}` } };
        return null;
      }) as Record<string, unknown>[];
      slots.forEach((s, i) => s && first.add(items[i].element.id as string));
      const linksTo = (el: Record<string, unknown>) =>
        Object.entries(el).some(([k, v]) => k !== 'id' && (Array.isArray(v) ? v.some((x) => first.has(x as string)) : first.has(v as string)));
      for (let round = 0; round < items.length; round++) {
        let moved = false;
        items.forEach((it, i) => {
          if (!slots[i] && linksTo(it.element)) {
            slots[i] = { status: 400, error: { code: 'invalid_link', message: 'A link names an element that is not there.' } };
            first.add(it.element.id as string);
            moved = true;
          }
        });
        if (!moved) break;
      }
      items.forEach((it, i) => {
        if (!slots[i]) slots[i] = this.held(it.element.id as string) ? { status: 409, error: { code: 'id_conflict', message: 'id' } } : { status: 201, id: it.element.id };
      });
      const refusedSlots = slots.filter((s) => (s.status as number) >= 400);
      if (refusedSlots.length) {
        const conflict = refusedSlots.some((s) => (s.error as { code: string }).code === 'id_conflict');
        // A refusal raised inside once()'s write frees the key (core/idempotency): nothing is stored, a retry is refused again.
        if (this.loseRefusalAnswer) {
          this.loseRefusalAnswer = false;
          throw new TypeError('Failed to fetch');
        }
        return this.json(conflict ? 409 : 422, {
          error: { code: 'handover_refused', message: `Nothing was written: ${refusedSlots.length} of ${slots.length} items were refused.` },
          items: slots,
        });
      }
      if (!this.accountPin) this.accountPin = String(w.pin);
      const id = `0w${++madeWorlds}000000-0000-4000-8000-000000000000`;
      const els = new Map<string, El>();
      for (const it of items) els.set(it.element.id as string, { ...it.element, id: it.element.id as string, type: it.type, change_seq: ++this.seq });
      this.worlds.set(id, { name: w.name, key: '', keys: [], els, meta: { ...ext }, owner: auth } as never);
      const answer = { world: { id, name: w.name, role: 'owner', ...ext }, items: slots, door: `/worlds/${id}/` };
      if (this.addAfterHandover) {
        const extra = 'e9000000-0000-7000-8000-000000000001';
        els.set(extra, { id: extra, type: 'character', name: 'Added online', change_seq: ++this.seq });
      }
      const k = headers.get('Idempotency-Key');
      if (this.replay && k) this.acctIdem.set(`handover:${auth}:${k}`, { sent: String(init.body), status: 201, answer });
      if (this.loseHandoverAnswer) {
        this.loseHandoverAnswer = false;
        throw new TypeError('Failed to fetch');
      }
      return this.json(201, answer);
    }
    // keel's holding route: the world this account owns that holds a Narrative of that id; one 404 for anything else.
    const holding = path.match(/^\/account\/worlds\/holding\/([^/]+)$/);
    if (holding && method === 'GET') {
      const acct = this.accountOf(headers.get('Authorization'));
      if (!acct) return this.err(401, 'invalid_credentials');
      const hit = [...this.worlds.entries()].find(
        ([, w]) => ((w as unknown as { owner?: string }).owner ?? 'acct-a') === acct && w.els.get(holding[1])?.type === 'narrative',
      );
      return hit ? this.json(200, { world_id: hit[0], door: `/worlds/${hit[0]}/` }) : this.err(404, 'not_found');
    }
    // keel's list_worlds: the account's own worlds, each with every key it has (_world_row: last4s, revoked ones too).
    if (path === '/account/worlds' && method === 'GET') {
      const acct = this.accountOf(headers.get('Authorization'));
      if (!acct) return this.err(401, 'invalid_credentials');
      const data = [...this.worlds.entries()]
        .filter(([, w]) => ((w as unknown as { owner?: string }).owner ?? 'acct-a') === acct)
        .map(([id, w]) => ({
          id,
          name: w.name,
          role: 'owner',
          public_read: false,
          keys: w.keys.map((k) => ({ name: 'Key', last4: k.slice(-4), scope: 'write', revoked: false })),
        }));
      return this.json(200, { data });
    }
    const mint = path.match(/^\/account\/worlds\/([^/]+)\/keys$/);
    if (mint && method === 'POST') {
      const auth = this.accountOf(headers.get('Authorization'));
      if (!auth) return this.err(401, 'invalid_credentials');
      const w = this.worlds.get(mint[1]) as unknown as { keys: string[]; owner?: string } | undefined;
      // _owned_or_member_world: a world this account neither owns nor sits in is a 404.
      if (!w || (w.owner ?? 'acct-a') !== auth) return this.err(404, 'not_found');
      this.mints.push(body);
      const key = `ow_w_${'m'.repeat(30)}${this.mints.length}`;
      w.keys.push(key);
      return this.json(201, { id: `00000000-0000-4000-8000-${String(this.mints.length).padStart(12, '0')}`, key, scope: body?.scope ?? 'write' });
    }
    const found = this.worldOfKey(headers.get('API-Key'));
    if (!found) return this.err(401, 'invalid_credentials');
    const [worldId, world] = found;
    if (method !== 'GET' && headers.get('API-Pin') !== this.accountPin) return this.err(401, 'invalid_credentials', 'API-Pin');
    if (path === '/media/ticket' && this.failTicketOnce) {
      this.failTicketOnce = false;
      return this.json(503, { error: { code: 'server_busy', message: 'Busy.' } });
    }
    if (path === '/media/ticket') return this.json(200, { ticket: 't', upload_url: 'https://edge.test/up', prefix: 'w/', max_bytes: 15e6, exp: 0 });
    if (path === '/world') {
      // keel's clean_world_updates: a prefixed key merges onto the store (null removes it), an
      // unknown plain field is a 422; GET serves the store's keys beside the fields, reordered as jsonb does.
      if (method === 'PATCH') {
        this.patches.push(body);
        if (this.refuseSettings && 'description' in body) return this.err(422, 'invalid_request', 'description');
        for (const [k, v] of Object.entries(body)) {
          if (/^(x_|atlas_|shadow_)/.test(k)) {
            if (this.losePatchedKeys) continue;
            if (v === null) delete world.meta[k];
            else world.meta[k] = v;
          } else if (!['description', 'time_range_current', 'time_basic_unit'].includes(k)) return this.err(422, 'invalid_request', k);
          else if (k === 'time_basic_unit' && String(v).trim().length > 128) return this.err(422, 'invalid_request', k);
          else if (k === 'time_range_current' && !(Number.isInteger(v) && (v as number) >= -2147483648 && (v as number) <= 2147483647)) return this.err(422, 'invalid_request', k);
          else world.meta[k] = v;
        }
      }
      const served = Object.fromEntries(Object.entries(world.meta).map(([k, v]) => [k, reorder(v)]));
      return this.json(200, { id: worldId, name: world.name, ...served });
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
      // keel refuses a stub's flag as an unknown field (422, param known_of; probed live).
      // keel (probed live): `hidden: true` from a key that cannot hide is
      // a slot's 403 hidden_not_allowed; the slot never echoes the mark.
      // keel refuses a body carrying its served-trimmed mark (422 served_trimmed_not_writable; the SDK's
      // isServedTrimmedNotWritable, folder spec §4.4 rule 6).
      const slots = body.items.map((it: { element: { id: string; known_of?: unknown; hidden?: unknown } }) =>
        'known_of' in it.element
          ? { status: 422, error: { code: 'invalid_request', message: 'Unknown field: known_of' } }
          : 'x_served_trimmed' in it.element
            ? { status: 422, error: { code: 'served_trimmed_not_writable', message: 'x_served_trimmed is served only.' } }
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

  it("a world holding a stub (a player's view, from a world file) does not go online: nothing made, nothing sent, the copy stays (the stub gate, G1)", async () => {
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

  it('a message served in part goes up without its trimmed mark, the list it names kept (folder spec §4.4 rule 6)', async () => {
    keel.accountPin = '4321';
    const ids = ['e1000000-0000-7000-8000-000000000021', 'e1000000-0000-7000-8000-000000000022'];
    const local = await localWorld([
      { id: ids[0], type: 'character', name: 'Wren' },
      { id: ids[1], type: 'narrative', name: 'Orders', supertype: 'Message', characters: [ids[0]], x_served_trimmed: ['characters'] },
    ]);
    const id = await putOnline(local, '4321');
    const sent = new Map(keel.sentBodies.map((b) => [b.id, b]));
    expect(sent.get(ids[1])).not.toHaveProperty('x_served_trimmed');
    expect(sent.get(ids[1])?.characters).toEqual([ids[0]]);
    expect(keel.worlds.get(id)!.els.size).toBe(2);
  });

  it("a server with hiding switched off: said by the element's name, no world made, the phone copy stays and can be changed", async () => {
    keel.accountPin = '4321';
    keel.hiddenOff = true;
    const local = await localWorld([...ELS, { id: 'e1000000-0000-7000-8000-000000000015', type: 'character', name: 'Wren', hidden: true }]);
    await expect(putOnline(local, '4321')).rejects.toThrow(/would not take Wren \(Hiding is off on this server\.\)\. Nothing was made\./);
    expect(keel.worlds.size).toBe(0);
    expect((await db.allElements(local)).length).toBe(3);
    expect((await db.getWorldRecord(local))?.pendingOnline).toBeUndefined();
  });

  it('ids that live in another world: no world is made on the account, nothing sent, and the phone copy stays (2026-11-07)', async () => {
    keel.accountPin = '4321';
    keel.otherWorldIds.add(ELS[0].id);
    const local = await localWorld(ELS);
    await expect(putOnline(local, '4321')).rejects.toThrow(/another world online \(a world file of an online world\?\)\. Nothing was made\./);
    expect(keel.worlds.size).toBe(0);
    expect(keel.uploads).toBe(0);
    expect((await db.allElements(local)).length).toBe(2);
    expect((await db.getWorldRecord(local))?.pendingOnline).toBeUndefined();
  });

  it('a wrong PIN: refused at the create, no world made on the account, and the phone copy stays', async () => {
    keel.accountPin = '4321';
    const local = await localWorld(ELS);
    await expect(putOnline(local, '1111')).rejects.toThrow(/That PIN does not match your account\. Nothing was made\./);
    expect(keel.worlds.size).toBe(0);
    expect(keel.creates).toHaveLength(0);
    expect((await db.getWorldRecord(local))?.pendingOnline).toBeUndefined();
    expect((await db.allElements(local)).length).toBe(2);
    // The right PIN then makes one world, whole.
    const id = await putOnline(local, '4321');
    expect(keel.worlds.size).toBe(1);
    expect(keel.worlds.get(id)!.els.size).toBe(2);
  });

  it("the PIN goes with every create, and a pinned account's right PIN makes the world at once", async () => {
    keel.accountPin = '4321';
    const id = await putOnline(await localWorld(ELS), '4321');
    expect(keel.creates).toHaveLength(1);
    expect(keel.creates[0].pin).toBe('4321');
    expect(keel.worlds.get(id)!.els.size).toBe(2);
  });

  it("a sign-in keel no longer takes: said as the sign-in, never as the PIN, nothing made", async () => {
    keel.accountPin = '4321';
    await db.kvSet('accountToken', 'ow_a_gone');
    const local = await localWorld(ELS);
    await expect(putOnline(local, '4321')).rejects.toThrow(/no longer takes this phone's sign-in/);
    expect(keel.worlds.size).toBe(0);
  });

  it('too many wrong PINs: said with the wait, nothing made', async () => {
    keel.accountPin = '4321';
    keel.pinTriesLeft = 0;
    const local = await localWorld(ELS);
    await expect(putOnline(local, '4321')).rejects.toThrow(/Too many wrong PINs.*Try again in 5 minutes\. Nothing was made\./);
    expect(keel.worlds.size).toBe(0);
    expect((await db.allElements(local)).length).toBe(2);
  });

  it('a keel that refuses a pinned account its PIN on the create (before 2026-11-07, or rolled back): the create goes without it, as before', async () => {
    keel.accountPin = '4321';
    keel.pinOmitOnly = true;
    const id = await putOnline(await localWorld(ELS), '4321');
    expect(keel.creates).toHaveLength(1);
    expect(keel.creates[0]).not.toHaveProperty('pin');
    expect(keel.worlds.get(id)!.els.size).toBe(2);
  });

  it('an account with no PIN and digits keel will not take as one (0123): asks for a PIN from 1000, nothing made', async () => {
    const local = await localWorld(ELS);
    await expect(putOnline(local, '0123')).rejects.toBeInstanceOf(PinNeeded);
    expect(keel.worlds.size).toBe(0);
  });
});

// The World's own keys (keel d98ba65: POST /account/worlds takes the prefixed keys as PATCH /world does).
const STRAND = { story: ELS[0].id, happening: null, place: null, v: 1 };
const PRODUCER = { tool: 'lantern', version: 'abc', input: 'bare' };

async function keyedWorld() {
  const id = await localWorld(ELS);
  await db.updateWorldRecord(id, {
    extensions: { x_strand: STRAND, atlas_calendar_pick: 'cal-1', shadow_gone: null, x_names: { character: 'Old word' } },
    names: { character: 'Soul', characters: 'Souls' },
    producer: PRODUCER,
    timeNow: 1204,
    timeUnit: 'Year',
  });
  return id;
}

describe("put it online keeps the World's own keys", () => {
  it('they go with the create, a null left out and the names as the world uses them; the maker line too; the now and the description after; the online copy holds them', async () => {
    keel.accountPin = '4321';
    const local = await keyedWorld();
    const id = await putOnline(local, '4321');
    const sent = keel.creates[0];
    expect(sent.x_strand).toEqual(STRAND);
    expect(sent.atlas_calendar_pick).toBe('cal-1');
    expect(sent).not.toHaveProperty('shadow_gone');
    expect(sent.x_names).toEqual({ character: 'Soul', characters: 'Souls' });
    expect(sent.producer).toEqual(PRODUCER);
    expect(keel.patches[0]).toEqual({ description: 'Ideas at the bus stop', time_range_current: 1204, time_basic_unit: 'Year' });
    // Nothing went twice: the read served every key as sent, so no second PATCH.
    expect(keel.patches).toHaveLength(1);
    const rec = (await db.getWorldRecord(id))!;
    expect(rec.extensions?.x_strand).toEqual(STRAND);
    expect(rec.names).toEqual({ character: 'Soul', characters: 'Souls' });
    expect(rec.timeNow).toBe(1204);
    expect(rec.producer).toEqual(PRODUCER);
    expect(await db.getWorldRecord(local)).toBeUndefined();
  });

  it('a create that kept none of them (a retry over a world made before): the missing ones go by PATCH, and the world is read again', async () => {
    keel.accountPin = '4321';
    keel.oldCreate = true;
    const local = await keyedWorld();
    const id = await putOnline(local, '4321');
    expect(keel.patches[1]).toEqual({ x_strand: STRAND, atlas_calendar_pick: 'cal-1', x_names: { character: 'Soul', characters: 'Souls' } });
    expect((await db.getWorldRecord(id))!.extensions?.x_strand).toEqual(STRAND);
    expect(await db.getWorldRecord(local)).toBeUndefined();
  });

  it('a server that answers 200 and keeps none: the read says so, the phone copy stays with its keys', async () => {
    keel.accountPin = '4321';
    keel.oldCreate = true;
    keel.losePatchedKeys = true;
    const local = await keyedWorld();
    await expect(putOnline(local, '4321')).rejects.toThrow(/own settings did not read back \(x_strand, atlas_calendar_pick, x_names\)/);
    const rec = (await db.getWorldRecord(local))!;
    expect(rec.kind).toBe('local');
    expect(rec.extensions?.x_strand).toEqual(STRAND);
    expect((await db.allElements(local)).length).toBe(2);
  });

  it('a maker line keel refuses: the world is made without it, its keys still with it', async () => {
    keel.accountPin = '4321';
    keel.refuseProducer = true;
    const local = await keyedWorld();
    const id = await putOnline(local, '4321');
    expect(keel.creates).toHaveLength(1);
    expect(keel.creates[0]).not.toHaveProperty('producer');
    expect(keel.worlds.get(id)!.meta.x_strand).toEqual(STRAND);
  });

  it('keys past keel\'s cap: said before anything is made, the phone copy stays', async () => {
    keel.accountPin = '4321';
    keel.extMax = 10;
    const local = await keyedWorld();
    await expect(putOnline(local, '4321')).rejects.toThrow(/would not take this world's own settings.*Nothing was sent/);
    expect(keel.worlds.size).toBe(0);
    expect((await db.getWorldRecord(local))?.pendingOnline).toBeUndefined();
  });

  // What keel would refuse in the settings is said before the world is made: made and then refused on every
  // retry, a world would sit half online for good (the gate's M1, S1, S3).
  for (const [what, change, said] of [
    ['a time unit past 128 characters', { timeUnit: 'Y'.repeat(129) }, /time unit is longer than OnlyWorlds keeps/],
    ['a now that is not a whole number', { timeNow: 12.5 }, /now \(12\.5\) is not a whole number/],
    ['a now past keel\'s 32-bit range', { timeNow: 2147483648 }, /is not a whole number OnlyWorlds keeps/],
    ['a NUL in the description', { description: 'cut\u0000here' }, /description holds a character/],
    ['half an emoji in a key', { extensions: { x_note: 'cut \uD83D' } }, /setting x_note holds a character/],
    ['keys past 64 KB', { extensions: { x_big: 'é'.repeat(33000) } }, /\(66\d{3} bytes, at most 65536\)/],
  ] as const) {
    it(`${what}: said before anything is made, the phone copy stays`, async () => {
      keel.accountPin = '4321';
      const local = await keyedWorld();
      await db.updateWorldRecord(local, change as never);
      await expect(putOnline(local, '4321')).rejects.toThrow(said);
      expect(keel.creates).toHaveLength(0);
      expect(keel.worlds.size).toBe(0);
      expect((await db.getWorldRecord(local))?.kind).toBe('local');
    });
  }

  it('the lowest number keel holds is a now it takes', async () => {
    keel.accountPin = '4321';
    const local = await keyedWorld();
    await db.updateWorldRecord(local, { timeNow: -2147483648 });
    await putOnline(local, '4321');
    expect(keel.patches[0].time_range_current).toBe(-2147483648);
  });

  it("keel's served-trimmed word is never sent up as a World key", async () => {
    keel.accountPin = '4321';
    const local = await keyedWorld();
    await db.updateWorldRecord(local, { extensions: { x_strand: STRAND, x_served_trimmed: ['description'] } });
    await putOnline(local, '4321');
    expect(keel.creates[0]).not.toHaveProperty('x_served_trimmed');
  });

  it('settings keel refuses: said, the phone copy stays, and the retry sends nothing twice', async () => {
    keel.accountPin = '4321';
    keel.refuseSettings = true;
    const local = await keyedWorld();
    await expect(putOnline(local, '4321')).rejects.toThrow(/would not take its settings/);
    expect((await db.getWorldRecord(local))?.kind).toBe('local');
    keel.refuseSettings = false;
    const id = await putOnline(local, '4321');
    expect(keel.worlds.size).toBe(1);
    expect(keel.worlds.get(id)!.els.size).toBe(2);
    expect(keel.worlds.get(id)!.meta.description).toBe('Ideas at the bus stop');
  });
});

// Since 2026-11-07: the world and its elements in one write, keel's hand-over, under an Idempotency-Key
// the account replays; the phone copy holds still while the put is under way.
describe('put it online on the hand-over', () => {
  const PICS = Array.from({ length: 3 }, (_, i) => ({
    id: `e1000000-0000-7000-8000-00000000003${i}`,
    type: 'character',
    name: `Face ${i}`,
    image_url: 'data:image/png;base64,iVBORw0KGgo=',
  }));

  it('one write: the world and every element, no picture data sent; then a kept key, the pictures by one bulk, Lantern named as the client', async () => {
    keel.accountPin = '4321';
    const local = await localWorld([...ELS, ...PICS]);
    const id = await putOnline(local, '4321');
    expect(keel.handovers).toHaveLength(1);
    const sent = (keel.handovers[0].items as { element: Record<string, unknown> }[]).map((x) => x.element);
    expect(sent.some((e) => typeof e.image_url === 'string' && String(e.image_url).startsWith('data:'))).toBe(false);
    expect(keel.handoverClient).toBe('lantern');
    expect(keel.mints).toEqual([expect.objectContaining({ scope: 'write', keep: true })]);
    expect(keel.uploads).toBe(4);
    expect(keel.bulks).toBe(1);
    const w = keel.worlds.get(id)!;
    expect(w.els.size).toBe(5);
    for (const p of [ELS[1], ...PICS]) expect(w.els.get(p.id)?.image_url).toMatch(/^https:\/\/media\.onlyworlds\.com\//);
    const rec = await db.getWorldRecord(id);
    expect(rec?.keyMint?.id).toMatch(/^00000000-/);
    expect(await db.getWorldRecord(local)).toBeUndefined();
  });

  it('the phone copy holds still while a put is under way: no edit, no catch, no now, and it is no notes world', async () => {
    keel.accountPin = '4321';
    const local = await localWorld(ELS);
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer from OnlyWorlds/);
    const rec = await db.getWorldRecord(local);
    expect(isPutting(rec)).toBe(true);
    forgetSession(local);
    const s = await openWorld(local);
    expect(s.canWrite).toBe(false);
    expect(s.takesNotes).toBe(false);
    expect(s.canMoveNow).toBe(false);
    await expect(s.edit(ELS[0].id, { name: 'Changed' })).rejects.toThrow(/read-only/);
    await expect(s.create('character', { name: 'New' })).rejects.toThrow(/read-only/);
    await expect(s.remove(ELS[0].id)).rejects.toThrow(/read-only/);
    await expect(s.setNow(5)).rejects.toThrow(/read-only/);
  });

  it('a lost answer: the retry under the same key gets the first world back, one world, whole', async () => {
    keel.accountPin = '4321';
    const local = await localWorld([...ELS, ...PICS]);
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    expect(keel.worlds.size).toBe(1);
    const id = await putOnline(local, '4321');
    expect(keel.worlds.size).toBe(1);
    expect(keel.handovers).toHaveLength(1);
    expect(keel.worlds.get(id)!.els.size).toBe(5);
    expect(await db.getWorldRecord(local)).toBeUndefined();
  });

  it('a lost answer on a keel that does not replay: the world that holds the sent story is found and the put finishes', async () => {
    keel.accountPin = '4321';
    keel.replay = false;
    const local = await localWorld(ELS);
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    const id = await putOnline(local, '4321');
    expect(keel.worlds.size).toBe(1);
    expect(keel.worlds.get(id)!.els.get(ELS[1].id)?.image_url).toMatch(/^https:/);
    expect(await db.getWorldRecord(local)).toBeUndefined();
  });

  it('a lost answer on a keel that does not replay, and no story sent to find it by: the way out is offered, the copy stays held until taken', async () => {
    keel.accountPin = '4321';
    keel.replay = false;
    const local = await localWorld([ELS[1]]);
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    await expect(putOnline(local, '4321')).rejects.toBeInstanceOf(StartOverOffered);
    await expect(putOnline(local, '4321')).rejects.toThrow(/may already have put this world on your account: look in Your worlds\. Keep it on this phone/);
    expect(isPutting(await db.getWorldRecord(local))).toBe(true);
    expect(keel.worlds.size).toBe(1);
    await startOver(local);
    expect((await db.getWorldRecord(local))?.pendingOnline).toBeUndefined();
    expect((await db.allElements(local)).length).toBe(1);
  });

  it("a world file of the person's own online world, its refusal's answer lost: the retry never takes the original world as the one it made", async () => {
    keel.accountPin = '4321';
    const orig = '0worig00-0000-4000-8000-000000000000';
    const online = new Map<string, El>(ELS.map((el, i) => [el.id, { ...el, name: `${el.name} (newer online)`, image_url: undefined, change_seq: i + 1 } as El]));
    keel.worlds.set(orig, { name: 'Bus stop ideas', key: 'ow_w_orig', keys: ['ow_w_orig'], els: online, meta: { description: 'Online, newer' }, owner: 'acct-a' } as never);
    const local = await localWorld(ELS);
    keel.loseRefusalAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    await expect(putOnline(local, '4321')).rejects.toBeInstanceOf(StartOverOffered);
    // Nothing written to the original: no key minted there, no settings, no element replaced.
    expect(keel.mints).toHaveLength(0);
    expect(keel.patches).toHaveLength(0);
    expect(keel.bulks).toBe(0);
    expect([...keel.worlds.get(orig)!.els.values()].map((e) => e.name)).toEqual(['The ferryman (newer online)', 'Ferryman (newer online)']);
    expect(keel.worlds.size).toBe(1);
    expect(isPutting(await db.getWorldRecord(local))).toBe(true);
  });

  it('a lost answer on a keel that does not replay: the found world already has a key (not the one the put made): nothing is written to it', async () => {
    keel.accountPin = '4321';
    keel.replay = false;
    const local = await localWorld(ELS);
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    const [, made] = [...keel.worlds.entries()][0];
    made.keys.push('ow_w_from_the_site');
    await expect(putOnline(local, '4321')).rejects.toBeInstanceOf(StartOverOffered);
    expect(keel.mints).toHaveLength(0);
    expect(keel.bulks).toBe(0);
  });

  it('a PIN typed differently on the retry: the replay still answers (the body goes as first sent), the wrong PIN is said at the next write, then the right one finishes', async () => {
    keel.accountPin = '4321';
    const local = await localWorld(ELS);
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    const e = await putOnline(local, '9999').catch((x) => x);
    expect(e).toMatchObject({ status: 401, param: 'API-Pin' });
    expect(keel.handovers).toHaveLength(1);
    expect(isPutting(await db.getWorldRecord(local))).toBe(true);
    const id = await putOnline(local, '4321');
    expect(keel.worlds.size).toBe(1);
    expect(keel.worlds.get(id)!.els.size).toBe(2);
  });

  it('a first world whose answer was lost set the PIN: a retry with other digits never says nothing was made', async () => {
    const local = await localWorld(ELS);
    keel.replay = false;
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    const e = await putOnline(local, '5555').catch((x) => x as Error);
    expect(e.message).not.toMatch(/Nothing was made/);
    expect(isPutting(await db.getWorldRecord(local))).toBe(true);
  });

  it('under another sign-in a held put is refused before anything is sent, and Start over too', async () => {
    keel.accountPin = '4321';
    await db.kvSet('accountId', 'acct-a');
    await db.kvSet('accountName', 'ada');
    const local = await localWorld(ELS);
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    await db.kvSet('accountId', 'acct-b');
    await db.kvSet('accountToken', keel.otherToken);
    const sends = keel.handovers.length;
    await expect(putOnline(local, '4321')).rejects.toThrow(/being put online under ada\. Sign in as it to finish\./);
    await expect(startOver(local)).rejects.toThrow(/under ada/);
    expect(keel.handovers.length).toBe(sends);
    expect(keel.mints).toHaveLength(0);
    await db.kvSet('accountId', undefined);
    await db.kvSet('accountName', undefined);
  });

  it("a refusal is said by the refused element's name, not by one that only links to it", async () => {
    keel.accountPin = '4321';
    const moss = { id: 'e1000000-0000-7000-8000-000000000041', type: 'character', name: 'Moss' };
    const ash = { id: 'e1000000-0000-7000-8000-000000000040', type: 'character', name: 'Ash', friends: [moss.id] };
    keel.refuseIds.add(moss.id);
    const local = await localWorld([ash, moss]);
    await expect(putOnline(local, '4321')).rejects.toThrow(/would not take Moss \(Unknown field on Moss\)\. Nothing was made\./);
    expect(keel.worlds.size).toBe(0);
  });

  it('more pictures than keel takes for a new world in a day, or more text than one write: said before anything is made', async () => {
    keel.accountPin = '4321';
    const many = Array.from({ length: 201 }, (_, i) => ({ id: `e2000000-0000-7000-8000-${String(i).padStart(12, '0')}`, type: 'character', name: `P${i}`, image_url: 'data:image/png;base64,iVBORw0KGgo=' }));
    const a = await localWorld(many);
    await expect(putOnline(a, '4321')).rejects.toThrow(/holds 201 pictures; OnlyWorlds takes 200 .* Nothing was made\./);
    const b = await localWorld([{ id: 'e3000000-0000-7000-8000-000000000001', type: 'character', name: 'Long', description: 'x'.repeat(2_500_000) }]);
    await expect(putOnline(b, '4321')).rejects.toThrow(/more than OnlyWorlds takes in one go .* Nothing was made\./);
    expect(keel.worlds.size).toBe(0);
    expect((await db.getWorldRecord(a))?.pendingOnline).toBeUndefined();
  });

  it('a world with no elements goes by the create under a kept key: a lost answer replays the world without its key, and the phone mints one', async () => {
    keel.accountPin = '4321';
    const local = await localWorld([]);
    keel.loseCreateAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    const id = await putOnline(local, '4321');
    expect(keel.worlds.size).toBe(1);
    expect(keel.creates).toHaveLength(1);
    expect(keel.mints).toHaveLength(1);
    expect((await db.getWorldRecord(id))?.apiKey).toMatch(/^ow_w_m/);
  });

  it('a put an earlier Lantern began (its world made, its key kept) finishes on the old path, no second world', async () => {
    keel.accountPin = '4321';
    const wid = '0w9999000000-0000-4000-8000-000000000000';
    keel.worlds.set(wid, { name: 'Bus stop ideas', key: 'ow_w_old', keys: ['ow_w_old'], els: new Map(), meta: {} });
    const local = await localWorld(ELS);
    await db.updateWorldRecord(local, { pendingOnline: { serverId: wid, key: 'ow_w_old', bulkKey: 'b-1' } });
    const id = await putOnline(local, '4321');
    expect(id).toBe(wid);
    expect(keel.worlds.size).toBe(1);
    expect(keel.handovers).toHaveLength(0);
    expect(keel.worlds.get(wid)!.els.size).toBe(2);
  });

  it('an earlier put whose elements another world holds: Start over is offered, naming the empty world it left', async () => {
    keel.accountPin = '4321';
    const wid = '0w9998000000-0000-4000-8000-000000000000';
    keel.worlds.set(wid, { name: 'Bus stop ideas', key: 'ow_w_old2', keys: ['ow_w_old2'], els: new Map(), meta: {} });
    keel.otherWorldIds.add(ELS[0].id);
    const local = await localWorld(ELS);
    await db.updateWorldRecord(local, { pendingOnline: { serverId: wid, key: 'ow_w_old2', bulkKey: 'b-2' } });
    const e = await putOnline(local, '4321').catch((x) => x);
    expect(e).toBeInstanceOf(StartOverOffered);
    expect(String(e.message)).toMatch(/An empty world of this name stays on your account/);
    await startOver(local);
    expect((await db.getWorldRecord(local))?.pendingOnline).toBeUndefined();
  });

  it('a picture the media host does not take (a GIF): said before anything is made', async () => {
    keel.accountPin = '4321';
    const gif = { id: 'e4000000-0000-7000-8000-000000000001', type: 'character', name: 'Spin', image_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' };
    const local = await localWorld([gif]);
    await expect(putOnline(local, '4321')).rejects.toThrow(/picture of Spin is a kind OnlyWorlds does not take .* Nothing was made\./);
    expect(keel.worlds.size).toBe(0);
    expect((await db.getWorldRecord(local))?.pendingOnline).toBeUndefined();
  });

  it('an element added to the online world meanwhile is no reason to keep the phone copy', async () => {
    keel.accountPin = '4321';
    keel.addAfterHandover = true;
    const local = await localWorld(ELS);
    const id = await putOnline(local, '4321');
    expect(keel.worlds.get(id)!.els.size).toBe(3);
    expect(await db.getWorldRecord(local)).toBeUndefined();
  });

  it("the phone's key taken back meanwhile: said as the key, not the PIN; the next try makes a new one and finishes", async () => {
    keel.accountPin = '4321';
    keel.failTicketOnce = true;
    const local = await localWorld(ELS);
    await expect(putOnline(local, '4321')).rejects.toThrow(/its pictures did not arrive/);
    for (const w of keel.worlds.values()) w.keys = [];
    await expect(putOnline(local, '4321')).rejects.toThrow(/key for it no longer works\. Try again: a new key is made\./);
    const id = await putOnline(local, '4321');
    expect(keel.mints).toHaveLength(2);
    expect(keel.worlds.get(id)!.els.get(ELS[1].id)?.image_url).toMatch(/^https:/);
  });

  it('a failed read back leaves no online world on the phone, so it is never opened or signed out of here while the put holds the copy', async () => {
    keel.accountPin = '4321';
    keel.oldCreate = true;
    keel.losePatchedKeys = true;
    const local = await keyedWorld();
    await expect(putOnline(local, '4321')).rejects.toThrow(/own settings did not read back/);
    const made = [...keel.worlds.keys()][0];
    expect(await db.getWorldRecord(made)).toBeUndefined();
    expect(isPutting(await db.getWorldRecord(local))).toBe(true);
  });

  it('a session opened before the put (another tab) cannot change the copy once the put holds it', async () => {
    keel.accountPin = '4321';
    const local = await localWorld(ELS);
    const before = await openWorld(local);
    expect(before.canWrite).toBe(true);
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    await expect(before.edit(ELS[0].id, { name: 'Changed in tab B' })).rejects.toThrow(/being put online/);
    // The first refusal brings the session's record up to date, so the next writes meet the plain read-only line.
    await expect(before.create('character', { name: 'New in tab B' })).rejects.toThrow(/read-only here/);
    await expect(before.remove(ELS[0].id)).rejects.toThrow(/read-only here/);
    expect(before.canWrite).toBe(false);
  });

  it('a copy that changed anyway while it went is never dropped: said, the copy kept, the online world not on the phone', async () => {
    keel.accountPin = '4321';
    const local = await localWorld(ELS);
    keel.failTicketOnce = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/pictures did not arrive/);
    await db.applyElements(local, [{ ...ELS[0], name: 'Changed by a path the lock missed' } as never]);
    await expect(putOnline(local, '4321')).rejects.toThrow(/this phone copy changed while it went/);
    expect((await db.allElements(local)).find((x) => x.id === ELS[0].id)?.name).toBe('Changed by a path the lock missed');
    expect(await db.getWorldRecord([...keel.worlds.keys()][0])).toBeUndefined();
  });

  it('a phone that does not know its account yet learns it before the put, so another sign-in is refused later', async () => {
    keel.accountPin = '4321';
    await db.kvSet('accountId', undefined);
    const local = await localWorld(ELS);
    keel.loseHandoverAnswer = true;
    await expect(putOnline(local, '4321')).rejects.toThrow(/No answer/);
    expect(await db.kvGet('accountId')).toBe('acct-a');
    await db.kvSet('accountToken', keel.otherToken);
    await db.kvSet('accountId', 'acct-b');
    await expect(putOnline(local, '4321')).rejects.toThrow(/being put online under ada/);
    await db.kvSet('accountId', undefined);
    await db.kvSet('accountName', undefined);
    await startOver(local);
    expect((await db.getWorldRecord(local))?.pendingOnline).toBeUndefined();
  });
});
