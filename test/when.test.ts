import { describe, expect, it } from 'vitest';
import { earlierFirst, newestFirst } from '../src/when';
import { zonePoints } from '../src/maps';
import { readCovers } from '../src/doortrail';
import type { OwElement } from '@onlyworlds/sdk';

// The message profile's order (schema-dist serial 120 and 121): created_at read as an instant, an
// offset and a fraction counted, no offset read as UTC, an unreadable time after every readable one.
describe('times as instants', () => {
  it('a fraction and an offset count, where text order would not', () => {
    const xs = ['2026-10-26T09:00:00.500Z', '2026-10-26T09:00:00Z', '2026-10-26T10:59:59.999+02:00'];
    expect([...xs].sort(earlierFirst)).toEqual(['2026-10-26T10:59:59.999+02:00', '2026-10-26T09:00:00Z', '2026-10-26T09:00:00.500Z']);
    expect([...xs].sort(newestFirst)).toEqual(['2026-10-26T09:00:00.500Z', '2026-10-26T09:00:00Z', '2026-10-26T10:59:59.999+02:00']);
  });
  it('no offset is UTC, and an unreadable time comes last both ways', () => {
    expect(earlierFirst('2026-11-12T10:00:00', '2026-11-12T10:00:00Z')).toBe(0);
    const xs = ['nope', '2026-10-26T09:00:00Z', '', '2026-10-26T08:00:00Z'];
    expect([...xs].sort(earlierFirst)).toEqual(['2026-10-26T08:00:00Z', '2026-10-26T09:00:00Z', 'nope', '']);
    expect([...xs].sort(newestFirst)).toEqual(['2026-10-26T09:00:00Z', '2026-10-26T08:00:00Z', 'nope', '']);
  });
  it('a read covers a copy by instant: a fraction and no offset count', () => {
    const r = (updated_at: string) => ({ id: 'e', type: 'character', updated_at }) as never;
    expect(readCovers(r('2026-10-26T09:00:00.000500Z'), '2026-10-26T09:00:00.000900Z')).toBe(false);
    expect(readCovers(r('2026-10-26T09:00:00.000900Z'), '2026-10-26T09:00:00.000500Z')).toBe(true);
    expect(readCovers(r('2026-10-26T09:00:00'), '2026-10-26T09:00:00Z')).toBe(true);
    expect(readCovers(r('2026-10-26T08:59:59'), '2026-10-26T09:00:00Z')).toBe(false);
    expect(readCovers(r('no time'), '2026-10-26T09:00:00Z')).toBe(false);
    expect(readCovers(r('2026-10-26T09:00:00Z'), null)).toBe(true);
  });
  it("a zone's unordered markers follow oldest first, as instants", () => {
    const m = (id: string, x: number, created_at: string) => ({ id, type: 'marker', x, y: 0, created_at }) as unknown as OwElement;
    const pts = zonePoints([m('a', 1, '2026-10-26T09:00:00.500Z'), m('b', 2, '2026-10-26T09:00:00Z'), m('c', 3, '2026-10-26T10:59:59.999+02:00')]);
    expect(pts.map(p => p[0])).toEqual([3, 2, 1]);
  });
});
