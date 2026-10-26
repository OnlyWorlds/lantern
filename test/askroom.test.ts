// Ask follows the phone's room switch (SDK 4.72's buildAskContext leaves the room out unless asked):
// a room the person chose to show is asked about like the rest; with the switch off it stays out and is counted in leftOut.room.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildWorldIndex, type OwElement, type OwLookupHit } from '@onlyworlds/sdk';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { askContext } = await import('../src/ask');
const { setRoomShown } = await import('../src/room');

const W = 'w-askroom';
const MARK = '0199c3a1-7b2e-7c3d-8e4f-5a6b7c8d9e0f';
const mira = { id: 'e1', type: 'character', name: 'Mira Thel', description: 'Holds Balkonon.' } as unknown as OwElement;
const note = { id: 'e2', type: 'narrative', supertype: 'Message', name: 'Bring the map', description: 'From the table.', x_room_of: MARK } as unknown as OwElement;
const hits = [mira, note].map((element) => ({ element })) as unknown as OwLookupHit<OwElement>[];
const index = buildWorldIndex([mira, note]);

describe('Ask and the room switch', () => {
  it('switch off: the room stays out, counted', () => {
    setRoomShown(W, false);
    const c = askContext(W, hits, index);
    expect(c.context.join('\n')).toContain('Mira Thel');
    expect(c.context.join('\n')).not.toContain('Bring the map');
    expect(c.leftOut.room).toEqual(['e2']);
  });
  it('switch on: the room is asked about like the rest', () => {
    setRoomShown(W, true);
    const c = askContext(W, hits, index);
    expect(c.context.join('\n')).toContain('Bring the map');
    expect(c.leftOut.room).toEqual([]);
  });
});
