import { describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';
import { movedFields } from '../src/world';

// OnlyWorlds keeps each element of a multi-link once and drops a repeat on write. A send of
// mine that landed with its answer lost comes back on the retry's 412 as `current` with the repeat gone:
// that is my own edit landed, never a conflict.
type Row = Parameters<typeof movedFields>[0];
const row = (base: Record<string, unknown>, values: Record<string, unknown>) => ({ base, values }) as unknown as Row;
const el = (o: Record<string, unknown>) => ({ id: 'e', type: 'narrative', ...o }) as unknown as OwElement;

describe('movedFields: a multi-link compared as a set', () => {
  it('my send landed, its repeat dropped by keel: no field moved', () => {
    expect(movedFields(row({ characters: ['a', 'a', 'c'] }, { characters: ['a', 'a', 'b', 'c'] }), el({ characters: ['a', 'b', 'c'] }))).toEqual([]);
  });

  it('the base held a repeat and keel served it once, nothing else changed: no field moved', () => {
    expect(movedFields(row({ characters: ['a', 'a'] }, { characters: ['a', 'a', 'b'] }), el({ characters: ['a'] }))).toEqual([]);
  });

  it('someone else changed the list: it moved (the control)', () => {
    expect(movedFields(row({ characters: ['a'] }, { characters: ['a', 'b'] }), el({ characters: ['a', 'z'] }))).toEqual(['characters']);
  });
});
