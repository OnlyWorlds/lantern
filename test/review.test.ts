// The reader rule on the phone (src/review.ts; schema-dist dist.52 `profiles/review.md`; Atlas
// 1.84.0's twin, conv. 168): the two readings, the row's word, the sort slice leaving a proposed element out.
import { describe, expect, it } from 'vitest';
import { buildWorldIndex, type OwElement } from '@onlyworlds/sdk';
import { handsOnAsProposed, isProposed, proposedWord, todayDay } from '../src/review';
import { buildSlice } from '../src/sortplan';

// keel's own shape, as served live (as Atlas probed it).
const MARK = { by: '19e1c2e5-5e8e-4d46-8382-e5ad445d13a0', evidence: 'seat', expires: '2026-11-22' };

describe('the readings', () => {
  it('shown as proposed: an object; handed on: any value but null', () => {
    expect(isProposed({ x_review_proposed: MARK })).toBe(true);
    expect(isProposed({ x_review_proposed: null })).toBe(false);
    expect(isProposed({ x_review_proposed: 'yes' })).toBe(false);
    expect(isProposed({})).toBe(false);
    expect(handsOnAsProposed({ x_review_proposed: 'yes' })).toBe(true);
    expect(handsOnAsProposed({ x_review_proposed: null })).toBe(false);
  });

  it('lapsed from its expires day, in UTC as keel reads it', () => {
    expect(proposedWord({ x_review_proposed: MARK }, '2026-11-21')).toBe('proposed');
    expect(proposedWord({ x_review_proposed: MARK }, '2026-11-22')).toBe('proposed, lapsed');
    expect(proposedWord({}, '2026-11-22')).toBe('');
    expect(todayDay(new Date('2026-11-22T04:30:00.000Z'))).toBe('2026-11-22');
  });

  it("is the SDK's reader: the profile's white space trimmed, a bad day refused", () => {
    expect(proposedWord({ x_review_proposed: { ...MARK, expires: ' 2026-11-22\t' } }, '2026-11-22')).toBe('proposed, lapsed');
    expect(() => proposedWord({ x_review_proposed: MARK }, '22 Nov')).toThrow(TypeError);
  });
});

describe('the sort slice hands the world on', () => {
  it('leaves a proposed element out, keeps the settled one, takes it once accepted', () => {
    const els = [
      { id: 'n1', type: 'narrative', name: 'note', supertype: 'Unsorted', description: 'Quill met Ada at the quay.' },
      { id: 'ada', type: 'character', name: 'Ada' },
      { id: 'quill', type: 'character', name: 'Quill', x_review_proposed: MARK },
    ] as OwElement[];
    const m = new Map(els.map((e) => [e.id, e]));
    const ids = buildSlice([m.get('n1')!], buildWorldIndex(els), (id) => m.get(id)).map((x) => x.id);
    expect(ids).toContain('ada');
    expect(ids).not.toContain('quill');
    const settled = els.map((e) => (e.id === 'quill' ? ({ ...e, x_review_proposed: null } as OwElement) : e));
    const s2 = new Map(settled.map((e) => [e.id, e]));
    expect(buildSlice([s2.get('n1')!], buildWorldIndex(settled), (id) => s2.get(id)).map((x) => x.id)).toContain('quill');
  });
});
