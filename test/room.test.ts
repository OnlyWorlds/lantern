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

const el = (type: string, supertype?: unknown): OwElement => ({ id: 'x', type, supertype }) as unknown as OwElement;

describe('the room', () => {
  it("is the sheet's type and supertype pairs, in any case, trimmed", () => {
    for (const [type, word] of ROOM_SUPERTYPES) expect(isRoomElement(el(type, word))).toBe(true);
    expect(isRoomElement(el('narrative', 'Message'))).toBe(true);
    expect(isRoomElement(el('relation', ' Work item '))).toBe(true);
    expect(isRoomElement(el('event', 'SITTING'))).toBe(true);
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
