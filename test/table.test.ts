// The party link (keel 0cb5871): one player link for a table, each player
// picking a Character from the owner's list. The fake answers as PR 110's `_table_pick` and
// `table_preview` do: the preview adds max_uses, uses_left, name_required and characters (owner's
// order, taken by any live seat); the door takes `character` (off the list or hidden: 422
// invalid_request param character; taken: 422 character_taken param character), or on an empty
// list a required `name` (422 param name, and a `character` there is refused); a full link is the
// one 404; the world's cap of 50 players is 422 world_full, after the pick. A refusal spends nothing.
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
const join = await import('../src/join');

const WORLD = '0aaa0000-0000-4000-8000-000000000002';
const WHITE = '0ccc0000-0000-4000-8000-0000000000a1';
const DONIPHAN = '0ccc0000-0000-4000-8000-0000000000a2';
const LINCOLN = '0ccc0000-0000-4000-8000-0000000000a3';
const OFF = '0ccc0000-0000-4000-8000-0000000000ff';

type Pass = { max: number; list: string[]; seats: string[] };

class TableKeel {
  names: Record<string, string> = { [WHITE]: 'Captain White', [DONIPHAN]: 'Alexander Doniphan', [LINCOLN]: 'A. L. Lincoln' };
  passes = new Map<string, Pass>([
    ['ow_j_table', { max: 5, list: [WHITE, LINCOLN, DONIPHAN], seats: [] }],
    ['ow_j_named', { max: 3, list: [], seats: [] }],
  ]);
  /** Characters a live seat plays, from any link (keel's taken_characters). */
  played = new Set<string>([LINCOLN]);
  hidden = new Set<string>();
  full = false;
  bodies: unknown[] = [];

  json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
  bad(param: string | null, message = 'Pick one of the Characters this link lists.') {
    return this.json(422, { error: { type: 'invalid_request', code: 'invalid_request', message, ...(param ? { param } : {}) } });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const path = new URL(String(input)).pathname.replace('/api/v2', '').replace(/\/+$/, '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const p = this.passes.get(body?.code);
    if (path === '/join/preview') {
      if (!p || p.seats.length >= p.max) return this.json(404, { error: { code: 'not_found' } });
      const listed = p.list.filter((id) => !this.hidden.has(id));
      return this.json(200, {
        reader: 'player', role: 'guest', world: { name: 'BM walk copy', description: '' }, invited_by: 'Seethe', owner_character: null, with_character: false,
        expires_at: '2026-10-26T00:00:00+00:00', max_uses: p.max, uses_left: p.max - p.seats.length, name_required: p.list.length === 0,
        characters: listed.map((id) => ({ id, name: this.names[id], image_url: null, taken: this.played.has(id) })),
      });
    }
    if (path === '/join') {
      this.bodies.push(body);
      if (!p || p.seats.length >= p.max) return this.json(404, { error: { code: 'not_found', message: 'This join code is not valid.' } });
      let ch: string;
      let name = typeof body.name === 'string' ? body.name.trim() : '';
      if (p.list.length === 0) {
        if (body.character != null && body.character !== '') return this.bad('character', 'This link has no list: send name, not character.');
        if (!name) return this.bad('name', 'name is required: your name, as the game master sees it.');
        ch = `0ddd0000-0000-4000-8000-00000000000${p.seats.length + 1}`;
        this.names[ch] = name;
      } else {
        if (typeof body.character !== 'string' || !p.list.includes(body.character) || this.hidden.has(body.character)) return this.bad('character');
        if (this.played.has(body.character)) return this.json(422, { error: { type: 'invalid_request', code: 'character_taken', param: 'character', message: 'That Character is taken: pick another from the list.' } });
        ch = body.character;
        name ||= this.names[ch];
      }
      // After the pick, as `redeem_player` counts the world's live players (PR 110 03bfb59).
      if (this.full) return this.json(422, { error: { type: 'invalid_request', code: 'world_full', message: 'This world is full: it can have at most 50 players.' } });
      p.seats.push(ch);
      this.played.add(ch);
      return this.json(201, { kind: 'player', key: `ow_r_${'t'.repeat(30)}`, world: { id: WORLD, name: 'BM walk copy', description: '' }, character: { id: ch, name: this.names[ch] }, role: 'guest' });
    }
    return this.json(500, { error: { code: 'unexpected', message: path } });
  };
}

let keel: TableKeel;
beforeEach(async () => {
  keel = new TableKeel();
  globalThis.fetch = keel.fetch as typeof fetch;
  await db.kvSet('pendingJoin', undefined);
  await db.removeWorld(WORLD);
});

describe('a link for the table', () => {
  it("is told apart from a link for one by max_uses, and lists the owner's picks in order, taken ones last", async () => {
    const p = await join.previewJoin('ow_j_table');
    expect(join.isTable(p)).toBe(true);
    expect(join.tablePicks(p).map((c) => [c.name, c.taken])).toEqual([['Captain White', false], ['Alexander Doniphan', false], ['A. L. Lincoln', true]]);
    expect(join.isTable({ ...p, max_uses: undefined } as typeof p)).toBe(false);
  });

  it('a pick opens the world as that Character, and sends only the pick and the name typed', async () => {
    const r = await join.redeemPlayer('ow_j_table', '  Mara ', { character: DONIPHAN });
    expect(r).toEqual({ worldId: WORLD });
    expect(keel.bodies.at(-1)).toEqual({ code: 'ow_j_table', character: DONIPHAN, name: 'Mara' });
    expect((await db.getWorldRecord(WORLD))?.characterId).toBe(DONIPHAN);
    // The next person's preview has it taken now, and one place fewer.
    const p = await join.previewJoin('ow_j_table');
    expect([p.uses_left, join.tablePicks(p).find((c) => c.id === DONIPHAN)?.taken]).toEqual([4, true]);
  });

  it('a pick taken since the preview, or off the list, is a PickRefused, and spends nothing', async () => {
    keel.played.add(WHITE);
    await expect(join.redeemPlayer('ow_j_table', '', { character: WHITE })).rejects.toBeInstanceOf(join.PickRefused);
    await expect(join.redeemPlayer('ow_j_table', '', { character: WHITE })).rejects.toThrow(/took that Character a moment ago/);
    keel.hidden.add(DONIPHAN);
    await expect(join.redeemPlayer('ow_j_table', '', { character: DONIPHAN })).rejects.toThrow(/can no longer be picked/);
    await expect(join.redeemPlayer('ow_j_table', '', { character: OFF })).rejects.toBeInstanceOf(join.PickRefused);
    expect(keel.passes.get('ow_j_table')!.seats).toHaveLength(0);
    expect(await db.getWorldRecord(WORLD)).toBeUndefined();
  });

  it('a table with no list asks each name, and the fresh Character takes it', async () => {
    const p = await join.previewJoin('ow_j_named');
    expect([join.isTable(p), p.name_required, join.tablePicks(p)]).toEqual([true, true, []]);
    await expect(join.redeemPlayer('ow_j_named', '', {})).rejects.toThrow(/Type your name/);
    expect(keel.bodies.at(-1)).toEqual({ code: 'ow_j_named' });
    await join.redeemPlayer('ow_j_named', 'Briony', {});
    expect(keel.bodies.at(-1)).toEqual({ code: 'ow_j_named', name: 'Briony' });
  });

  it('a full link is "no places left", and a full world says so, never a name being too long', async () => {
    keel.passes.get('ow_j_table')!.seats.push('a', 'b', 'c', 'd', 'e');
    await expect(join.redeemPlayer('ow_j_table', '', { character: WHITE })).rejects.toThrow(/no places left/);
    keel.passes.get('ow_j_table')!.seats = [];
    keel.full = true;
    await expect(join.redeemPlayer('ow_j_table', '', { character: WHITE })).rejects.toThrow(/as many players as it can seat/);
    await expect(join.redeemPlayer('ow_j_named', 'Briony', {})).rejects.toThrow(/as many players as it can seat/);
    expect(keel.passes.get('ow_j_table')!.seats).toHaveLength(0);
  });
});
