// The parlor's room (src/room.ts): which elements are the room's, and the phone's choice to show them.
import { describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { isRoomElement, roomShown, setRoomShown, ROOM_SUPERTYPES } = await import('../src/room');

const MARK = '0199c3a1-7b2e-7c3d-8e4f-5a6b7c8d9e0f';
const el = (type: string, supertype?: unknown, mark: unknown = MARK): OwElement =>
  ({ id: 'x', type, supertype, x_room_of: mark }) as unknown as OwElement;

describe('the room', () => {
  it("is the sheet's type and supertype pairs, in any case, trimmed", () => {
    for (const [type, word] of ROOM_SUPERTYPES) expect(isRoomElement(el(type, word))).toBe(true);
    expect(isRoomElement(el('narrative', 'Message'))).toBe(true);
    expect(isRoomElement(el('relation', ' Work item '))).toBe(true);
    expect(isRoomElement(el('event', 'SITTING'))).toBe(true);
  });

  it("is the pair AND the parlor's mark: a lore world's own letter stays lore (dist.45)", () => {
    expect(isRoomElement(el('narrative', 'Message'))).toBe(true);
    expect(isRoomElement({ id: 'x', type: 'narrative', supertype: 'Message' } as unknown as OwElement)).toBe(false);
    expect(isRoomElement(el('narrative', 'Message', ''))).toBe(false);
    expect(isRoomElement(el('event', 'Sitting', null))).toBe(false);
    expect(isRoomElement(el('location', 'Harbour'))).toBe(false);
  });

  it('is a pair, never a supertype alone', () => {
    expect(isRoomElement(el('location', 'Board'))).toBe(false);
    expect(isRoomElement(el('narrative', 'Vote'))).toBe(false);
    expect(isRoomElement(el('character', 'Messenger'))).toBe(false);
    expect(isRoomElement(el('event', 'Battle'))).toBe(false);
  });

  it("keeps the charter and a lore world's own things", () => {
    expect(isRoomElement(el('law', 'Charter'))).toBe(false);
    expect(isRoomElement(el('narrative', 'Unsorted'))).toBe(false);
    expect(isRoomElement(el('narrative'))).toBe(false);
    expect(isRoomElement(el('narrative', 42))).toBe(false);
  });

  it('is hidden unless this phone chose to show it, per world', () => {
    expect(roomShown('w1')).toBe(false);
    expect(setRoomShown('w1', true)).toBe(true);
    expect(roomShown('w1')).toBe(true);
    expect(roomShown('w2')).toBe(false);
    setRoomShown('w1', false);
    expect(roomShown('w1')).toBe(false);
  });
});

// schema-dist's room profile (v0.33.0-dist.45, profiles/room.fixture.json, copied whole): the
// conformance cases every reader of the room answers, until the SDK's export replaces this copy.
import fixture from './fixtures/room.fixture.json';

describe("the room profile's cases (dist.45)", () => {
  it('holds the profile pairs, no more, no less', () => {
    const want = fixture.pairs.map((p) => `${p.type}/${p.supertype.toLowerCase()}`).sort();
    expect(ROOM_SUPERTYPES.map(([t, w]) => `${t}/${w}`).sort()).toEqual(want);
  });
  for (const c of fixture.cases) {
    it(`${c.name}: ${c.in_room ? 'in the room' : 'lore'}`, () => {
      expect(isRoomElement(c.element as unknown as OwElement)).toBe(c.in_room);
    });
  }
});
