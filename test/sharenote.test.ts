// A player shares a note with the party, against a fake keel shaped by
// keel #241 (elements/service.py, db48d30): a guest's Narrative is narrated by its own Character
// (filled in when left out, 422 when another is named), names only Collectives that Character is in
// (any other answers as a missing link, 400), and a seat with no Character gets 403
// guest_not_supported. A write needs the member's account PIN (401 without it).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';

const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { openWorld, forgetSession, setBuildBehind } = await import('../src/world');
const { setPin } = await import('../src/pin');
const { circlesOf, sharedNoteValues } = await import('../src/party');
const db = await import('../src/db');
const { mintPlayerKey } = await import('../src/account');
const { addNote, notes, markShared, unmarkShared, clearNotes } = await import('../src/notes');

type El = Record<string, unknown> & { id: string; type: string; change_seq: number };

class GuestKeel {
  els = new Map<string, El>();
  seq = 0;
  pin = '1234';
  /** The guest's roster Character (null: a seat with none). */
  character: string | null = 'mira';
  posts: Record<string, unknown>[] = [];

  put(el: Omit<El, 'change_seq'>): El {
    const full = { ...el, change_seq: ++this.seq } as El;
    this.els.set(el.id, full);
    return full;
  }

  json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  err(status: number, code: string, param?: string): Response {
    return this.json(status, { error: { code, message: code, type: 'x', ...(param ? { param } : {}) } });
  }

  circles(): string[] {
    return [...this.els.values()].filter((e) => e.type === 'collective' && Array.isArray(e.characters) && e.characters.includes(this.character)).map((e) => e.id);
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const path = url.pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const sentPin = headers.get('API-Pin');
    if (sentPin && sentPin !== this.pin) return this.err(401, 'invalid_credentials');
    if (method !== 'GET' && !sentPin) return this.err(401, 'invalid_credentials');
    if (path === '/world') return this.json(200, { id: 'w1', name: 'The Reach' });
    if (path === '/changes') {
      const changes = [...this.els.values()].map((e) => ({ op: 'upsert', id: e.id, type: e.type, element: e, change_seq: e.change_seq }));
      return this.json(200, { cursor: String(this.seq), changes, has_more: false, head: this.seq, epoch: 0 });
    }
    const m = path.match(/^\/([a-z]+)\/?([^/]*)$/);
    if (!m || method !== 'POST') return this.err(404, 'not_found');
    const type = m[1];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    this.posts.push({ type, ...body });
    if (type === 'narrative') {
      if (!this.character) return this.err(403, 'guest_not_supported');
      if (body.narrator == null) body.narrator = this.character;
      else if (body.narrator !== this.character) return this.err(422, 'invalid_request', 'narrator');
      const mine = this.circles();
      if (Array.isArray(body.collectives) && body.collectives.some((c) => !mine.includes(c as string))) return this.err(400, 'invalid_request', 'collectives');
    }
    return this.json(201, this.put({ ...body, type } as El));
  };
}

let keel: GuestKeel;
let n = 0;

async function playerWorld(key: string) {
  const id = `p-${++n}`;
  await db.putWorldRecord({ id, name: 'The Reach', kind: 'online', apiKey: key, keyKind: key.startsWith('ow_w_') ? 'write' : 'read', role: 'collaborator', memberRole: 'guest', characterId: keel.character, addedAt: '' });
  forgetSession(id);
  return openWorld(id);
}

const WRITE = 'ow_w_' + 'm'.repeat(40);
const READ = 'ow_r_' + 'm'.repeat(40);

beforeEach(() => {
  keel = new GuestKeel();
  keel.put({ id: 'mira', type: 'character', name: 'Mira' });
  keel.put({ id: 'party', type: 'collective', name: 'The Party', supertype: 'Party', characters: ['mira', 'tor'] });
  keel.put({ id: 'guild', type: 'collective', name: 'Thieves', characters: ['tor'] });
  globalThis.fetch = keel.fetch as typeof fetch;
  store.clear();
  setBuildBehind(false);
});

const settled = async (s: Awaited<ReturnType<typeof playerWorld>>) => {
  for (let i = 0; i < 50 && s.waitingCount(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('a player shares a note', () => {
  it("a player's write key changes nothing in the world from the screens: it only shares notes", async () => {
    const s = await playerWorld(WRITE);
    expect([s.canWrite, s.takesNotes, s.playerCanSend]).toEqual([false, true, true]);
    await expect(s.create('character', { name: 'Someone' })).rejects.toThrow(/read-only/);
  });

  it('goes as a Narrative to the party, told by their own Character (keel fills it in), and lands in their world', async () => {
    const s = await playerWorld(WRITE);
    await s.pull();
    setPin(s.rec, '1234');
    const id = await s.shareNote(sharedNoteValues('The innkeeper lied\nHe said the road was clear. Tor saw tracks.', 'party'), 'n-1');
    await settled(s);
    expect(keel.posts).toHaveLength(1);
    expect(keel.posts[0]).not.toHaveProperty('narrator');
    expect(keel.posts[0]).toMatchObject({ type: 'narrative', name: 'The innkeeper lied', description: 'He said the road was clear. Tor saw tracks.', collectives: ['party'] });
    expect(s.get(id)).toMatchObject({ narrator: 'mira', collectives: ['party'] });
    expect(s.waitingCount()).toBe(0);
  });

  it('waits for the PIN, then sends', async () => {
    const s = await playerWorld(WRITE);
    await s.shareNote(sharedNoteValues('Tracks by the mill', 'party'), 'n-2');
    await s.flush();
    expect([keel.posts.length, s.needPin, s.waitingCount()]).toEqual([0, true, 1]);
    setPin(s.rec, '1234');
    await s.flush();
    expect([keel.posts.length, s.waitingCount()]).toEqual([1, 0]);
  });

  it("a player's read key cannot send; the key taken for the first share keeps the copy and where the feed stood", async () => {
    const s = await playerWorld(READ);
    await s.pull();
    expect(s.playerCanSend).toBe(false);
    await expect(s.shareNote(sharedNoteValues('x', 'party'), 'n-3')).rejects.toThrow();
    const cursor = s.rec.cursor;
    await s.takePlayerKey(WRITE);
    expect([s.playerCanSend, s.canWrite, s.rec.apiKey, s.rec.cursor, s.get('mira')?.name]).toEqual([true, false, WRITE, cursor, 'Mira']);
  });

  it('a seat with no Character is refused, and the refusal is kept, not retried', async () => {
    keel.character = null;
    const s = await playerWorld(WRITE);
    setPin(s.rec, '1234');
    const id = await s.shareNote(sharedNoteValues('Nobody tells this', 'party'), 'n-4');
    await s.flush();
    expect(s.pending(id).get('*')).toBeUndefined();
    expect(s.needsYouCount()).toBe(1);
    expect(s.status).not.toBe('error');
    expect(s.refusedRow(id)?.error).toMatch(/no Character/);
  });

  it('a group their Character is not in is refused with a sentence, and the outbox goes on (the shared-notes gate, G8)', async () => {
    const s = await playerWorld(WRITE);
    setPin(s.rec, '1234');
    const bad = await s.shareNote(sharedNoteValues('To the thieves', 'guild'), 'n-5');
    const good = await s.shareNote(sharedNoteValues('To the party', 'party'), 'n-6');
    await settled(s);
    expect(s.refusedRow(bad)?.error).toMatch(/not in that group/);
    expect(s.get(good)).toMatchObject({ narrator: 'mira' });
  });
});

describe("the first share's key (the shared-notes gate, G1)", () => {
  const signedIn = async (worlds: { id: string; role: string; member_role?: string }[], me: { role: string; character: string | null }) => {
    await db.kvSet('accountToken', 'ow_a_' + 't'.repeat(40));
    const minted: unknown[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname.replace('/api/v2', '').replace(/\/+$/, '');
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (path === '/account/worlds') return json(200, { data: worlds.map((w) => ({ name: 'The Reach', ...w })) });
      if (path.endsWith('/keys') && init.method === 'POST') {
        minted.push(JSON.parse(String(init.body)));
        return json(201, { key: WRITE, scope: 'write' });
      }
      if (path === '/me' || path === '/me/') return json(200, me);
      return json(404, { error: { code: 'not_found', message: 'x', type: 'x' } });
    }) as typeof fetch;
    return minted;
  };

  it("mints this player's seat", async () => {
    const minted = await signedIn([{ id: 'w1', role: 'collaborator', member_role: 'guest' }], { role: 'guest', character: 'mira' });
    expect(await mintPlayerKey('w1', 'mira')).toBe(WRITE);
    expect(minted).toHaveLength(1);
  });

  it("refuses on the game master's phone before minting anything", async () => {
    const minted = await signedIn([{ id: 'w1', role: 'owner' }], { role: 'owner', character: null });
    await expect(mintPlayerKey('w1', 'mira')).rejects.toThrow(/another account/);
    expect(minted).toHaveLength(0);
  });

  it("refuses another player's seat of the same world", async () => {
    await signedIn([{ id: 'w1', role: 'collaborator', member_role: 'guest' }], { role: 'guest', character: 'tor' });
    await expect(mintPlayerKey('w1', 'mira')).rejects.toThrow(/another account/);
  });
});

describe('a note shared, unshared, and kept by whoever holds the key', () => {
  it('marks, unmarks and clears', () => {
    expect(addNote('w9', 'a clue')).toBe(true);
    const [n] = notes('w9');
    markShared('w9', n.id, 'narr-1', 'The Party');
    expect(notes('w9')[0].shared).toMatchObject({ id: 'narr-1', to: 'The Party' });
    unmarkShared('w9', n.id);
    expect(notes('w9')[0]).not.toHaveProperty('shared');
    clearNotes('w9');
    expect(notes('w9')).toEqual([]);
  });
});

describe("the groups a player's Character is in", () => {
  const els = [
    { id: 'guild', type: 'collective', name: 'Thieves', characters: ['mira'] },
    { id: 'party', type: 'collective', name: 'The Party', supertype: 'Party', characters: ['mira', 'tor'] },
    { id: 'court', type: 'collective', name: 'The Court', characters: ['tor'] },
    { id: 'mira', type: 'character', name: 'Mira' },
  ] as OwElement[];

  it('only theirs, the Party first; none without a Character', () => {
    expect(circlesOf(els, 'mira').map((c) => c.id)).toEqual(['party', 'guild']);
    expect(circlesOf(els, null)).toEqual([]);
    expect(circlesOf(els, 'nobody')).toEqual([]);
  });

  it("a shared note's values: first line the name, the rest the description, no narrator", () => {
    expect(sharedNoteValues('  Tracks by the mill  ', 'party')).toEqual({ name: 'Tracks by the mill', collectives: ['party'] });
    const long = 'The innkeeper said the road north was clear but Tor saw fresh tracks by the mill pond';
    const v = sharedNoteValues(long, 'party');
    expect(v.description).toBe(long);
    expect(String(v.name).endsWith('…')).toBe(true);
    expect(v).not.toHaveProperty('narrator');
  });
});
