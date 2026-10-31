// The Waymark's trail on an element page: keel's door record, newest first, in the SDK's words;
// the newest of the copy and keel's read of the element, whole, never merged.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';
import { doorTrail, readCovers, trailLines } from '../src/doortrail';

const NOW = new Date('2026-10-31T06:00:00Z');
const base = { id: 'e1', type: 'character', name: 'Ada' } as OwElement;

afterEach(() => vi.useRealTimers());

describe('doorTrail', () => {
  it('reads every door, newest first, in the Waymark\'s words', () => {
    const el = {
      ...base,
      updated_at: '2026-10-31T05:57:00+00:00',
      doors: { atlas: '2026-10-30T06:00:00+00:00', lantern: '2026-10-31T05:57:00+00:00', site: '2026-10-21T06:00:00+00:00' },
    } as OwElement;
    expect(doorTrail(el).map((s) => s.where)).toEqual(['in Lantern', 'in Atlas', 'on onlyworlds.com']);
  });

  it('an element written before the field reads its last write\'s door', () => {
    const el = { ...base, updated_at: '2026-10-31T05:57:00+00:00', changed_via: 'mcp' } as OwElement;
    expect(doorTrail(el)).toEqual([{ where: 'with an AI', at: '2026-10-31T05:57:00+00:00' }]);
  });

  it('nothing when OnlyWorlds has said nothing, and nothing on a stub', () => {
    expect(doorTrail(base)).toEqual([]);
    expect(doorTrail(base, null)).toEqual([]);
    const stub = { ...base, known_of: true, updated_at: '2026-10-31T05:57:00+00:00', doors: { atlas: '2026-10-31T05:57:00+00:00' } } as OwElement;
    expect(doorTrail(stub)).toEqual([]);
    expect(doorTrail(stub, { doors: { lantern: '2026-10-31T05:57:00+00:00' }, updated_at: '2026-10-31T05:57:00+00:00' })).toEqual([]);
  });

  it('a pulled copy (no doors: the feed serves none) reads keel\'s answer for the same write', () => {
    const pulled = { ...base, updated_at: '2026-10-31T05:57:00+00:00', changed_client: 'lantern', changed_via: 'api' } as OwElement;
    expect(doorTrail(pulled).map((s) => s.where)).toEqual(['in Lantern']);
    const read = { doors: { lantern: '2026-10-31T05:57:00+00:00', atlas: '2026-10-30T06:00:00+00:00' }, updated_at: '2026-10-31T05:57:00+00:00' };
    expect(doorTrail(pulled, read).map((s) => s.where)).toEqual(['in Lantern', 'in Atlas']);
  });

  it('a copy newer than the read is the trail until it is read again, whole', () => {
    const read = { doors: { lantern: '2026-10-31T05:50:00+00:00', atlas: '2026-10-30T06:00:00+00:00' }, updated_at: '2026-10-31T05:50:00+00:00' };
    const pulled = { ...base, updated_at: '2026-10-31T05:58:00+00:00', changed_client: 'atlas', changed_via: 'api' } as OwElement;
    expect(readCovers(read, pulled.updated_at)).toBe(false);
    expect(doorTrail(pulled, read)).toEqual([{ where: 'in Atlas', at: '2026-10-31T05:58:00+00:00' }]);
    // A copy that is keel's own answer to a write carries its whole record.
    const written = { ...base, updated_at: '2026-10-31T05:59:00+00:00', doors: { lantern: '2026-10-31T05:59:00+00:00', atlas: '2026-10-30T06:00:00+00:00' } } as OwElement;
    expect(doorTrail(written, read).map((s) => s.at)).toEqual(['2026-10-31T05:59:00+00:00', '2026-10-30T06:00:00+00:00']);
  });

  it('a scrub moves the time and no door: once read, the door keeps its own time (the gate\'s M1)', () => {
    // Atlas wrote on 10-21; a link to a deleted element was scrubbed on 10-31, keeping the door fields.
    const scrubbed = { ...base, updated_at: '2026-10-31T05:59:00+00:00', changed_client: 'atlas', changed_via: 'api' } as OwElement;
    const read = { doors: { atlas: '2026-10-21T06:00:00+00:00' }, updated_at: '2026-10-31T05:59:00+00:00' };
    expect(doorTrail(scrubbed, read)).toEqual([{ where: 'in Atlas', at: '2026-10-21T06:00:00+00:00' }]);
  });

  it('a read of an element keel has no door record on keeps its last write\'s door (the Atlas gate\'s M1)', () => {
    // keel added `doors` on 2026-10-29 without filling it: an element not written since reads null.
    const pulled = { ...base, updated_at: '2026-10-20T06:00:00+00:00', changed_client: 'lantern', changed_via: 'api' } as OwElement;
    const read = { doors: null, updated_at: '2026-10-20T06:00:00+00:00', changed_client: 'lantern', changed_via: 'api' };
    expect(doorTrail(pulled, read)).toEqual([{ where: 'in Lantern', at: '2026-10-20T06:00:00+00:00' }]);
  });

  it('"in code" stands for many doors: its newest says it, once', () => {
    const el = {
      ...base,
      updated_at: '2026-10-31T05:57:00+00:00',
      doors: { api: '2026-10-31T05:57:00+00:00', sdk: '2026-10-30T06:00:00+00:00', atlas: '2026-10-29T06:00:00+00:00', sync: '2026-10-28T06:00:00+00:00' },
    } as OwElement;
    expect(doorTrail(el)).toEqual([
      { where: 'in code', at: '2026-10-31T05:57:00+00:00' },
      { where: 'in Atlas', at: '2026-10-29T06:00:00+00:00' },
    ]);
  });
});

describe('trailLines', () => {
  it('the last door, then the rest on one line', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const el = {
      ...base,
      updated_at: '2026-10-31T05:57:00+00:00',
      doors: { atlas: '2026-10-30T06:00:00+00:00', lantern: '2026-10-31T05:57:00+00:00', site: '2026-10-21T06:00:00+00:00' },
    } as OwElement;
    expect(trailLines(el)).toEqual([
      'On OnlyWorlds: last shaped in Lantern, 3 min ago',
      'Before that: in Atlas, yesterday · on onlyworlds.com, 10 days ago',
    ]);
  });

  it('one door is one line; none is no line', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(trailLines({ ...base, updated_at: '2026-10-31T05:00:00Z', doors: { sdk: '2026-10-31T05:00:00Z' } } as OwElement))
      .toEqual(['On OnlyWorlds: last shaped in code, an hour ago']);
    expect(trailLines(base)).toEqual([]);
  });
});
