// The hidden mark on the phone (src/hidden.ts; folder spec §4.8; Atlas 1.86.0's twin): the one reading,
// the words, a create's body, and the sort slice leaving a hidden element out and counting it.
import { describe, expect, it } from 'vitest';
import { buildAskContext, buildWorldIndex, type OwElement } from '@onlyworlds/sdk';
import { handOnElements, handOnHold, heldBackLine, heldBackSortLine, hiddenLine, hiddenWord, isHidden, markWords, withHiddenForCreate } from '../src/hidden';
import { buildSlice } from '../src/sortplan';

const MARK = { by: '19e1c2e5-5e8e-4d46-8382-e5ad445d13a0', evidence: 'seat', expires: '2099-11-22' };

describe('the reading', () => {
  it('present and not null or false: a doubtful value counts, as the SDK and the Python package read it', () => {
    for (const v of [true, 'true', 1, 'yes', {}]) expect(isHidden({ hidden: v })).toBe(true);
    for (const v of [false, null, undefined]) expect(isHidden({ hidden: v })).toBe(false);
    expect(isHidden({})).toBe(false);
    expect(isHidden(null)).toBe(false);
  });

  it("the row's word and the page's line, online and on this phone", () => {
    expect(hiddenWord({ hidden: true })).toBe('hidden');
    expect(hiddenWord({ hidden: false })).toBe('');
    expect(hiddenLine({ hidden: true }, true)).toMatch(/^Hidden on OnlyWorlds: only the owner, co-builders and whoever made it/);
    expect(hiddenLine({ hidden: true }, false)).toBe('Hidden: shown to you here, and it goes online hidden.');
    expect(hiddenLine({}, true)).toBeNull();
  });

  it("a create's body: the boolean for a marked element, no key for any other", () => {
    expect(withHiddenForCreate({ id: 'a', hidden: 'true' })).toEqual({ id: 'a', hidden: true });
    expect(withHiddenForCreate({ id: 'a', hidden: false })).toEqual({ id: 'a' });
    expect(withHiddenForCreate({ id: 'a', hidden: null })).toEqual({ id: 'a' });
    expect(withHiddenForCreate({ id: 'a' })).toEqual({ id: 'a' });
    // The key keeps its place: a `true` body is the same bytes an earlier build sent under its Idempotency-Key.
    const body = { id: 'a', hidden: true, name: 'Wren' };
    expect(JSON.stringify(withHiddenForCreate(body))).toBe(JSON.stringify(body));
  });

  it('what was held back, said once, either reason or both', () => {
    expect(heldBackLine(0, 0)).toBe('');
    expect(heldBackLine(1, 0)).toBe('One hidden element is not sent.');
    expect(heldBackLine(2, 0)).toBe('2 hidden elements are not sent.');
    expect(heldBackLine(0, 1)).toBe('One proposed element, not yet reviewed, is not sent.');
    expect(heldBackLine(1, 2)).toBe('One hidden element and 2 proposed elements, not yet reviewed, are not sent.');
    expect(heldBackSortLine(0, 0)).toBe('');
    expect(heldBackSortLine(1, 1)).toBe('Not sent with your notes: one hidden element and one proposed element, not yet reviewed.');
  });
});

describe('what goes to keel\'s AI', () => {
  it("a pin placing a hidden place stays back with it, and no kept element's link names either (the hidden-elements gate, F1)", () => {
    const els = [
      { id: 'vault', type: 'location', name: 'The Sunken Vault', hidden: true },
      { id: 'pin1', type: 'pin', name: 'The Sunken Vault', map: 'map1', element_id: 'vault', element_type: 'location', x: 10, y: 20 },
      { id: 'map1', type: 'map', name: 'The Coast' },
      { id: 'ada', type: 'character', name: 'Ada', location: 'vault' },
      { id: 'quill', type: 'character', name: 'Quill', x_review_proposed: MARK },
      { id: 'pin2', type: 'pin', name: 'Quill', map: 'map1', element_id: 'quill', element_type: 'character' },
    ] as OwElement[];
    const m = new Map(els.map((e) => [e.id, e]));
    const get = (id: string) => m.get(id);
    expect(handOnHold(m.get('vault'), get)).toBe('hidden');
    expect(handOnHold(m.get('pin1'), get)).toBe('hidden');
    expect(handOnHold(m.get('pin2'), get)).toBe('proposed');
    expect(handOnHold(m.get('ada'), get)).toBeNull();
    const kept = handOnElements(els, get);
    expect(kept.map((e) => e.id).sort()).toEqual(['ada', 'map1']);
    const { context } = buildAskContext([m.get('ada')!, m.get('map1')!], buildWorldIndex(kept));
    expect(context.join('\n')).not.toContain('Sunken Vault');
    expect(context.join('\n')).toMatch(/not present/);
  });
});

describe('the sort slice hands the world on', () => {
  it('leaves a hidden element out and counts it, apart from a proposed one; takes it once unhidden', () => {
    const els = [
      { id: 'n1', type: 'narrative', name: 'note', supertype: 'Unsorted', description: 'Wren met Ada and Quill at the quay.' },
      { id: 'ada', type: 'character', name: 'Ada' },
      { id: 'wren', type: 'character', name: 'Wren', hidden: true },
      { id: 'quill', type: 'character', name: 'Quill', x_review_proposed: MARK },
    ] as OwElement[];
    const m = new Map(els.map((e) => [e.id, e]));
    const held = { hidden: new Set<string>(), proposed: new Set<string>() };
    const ids = buildSlice([m.get('n1')!], buildWorldIndex(els), (id) => m.get(id), held).map((x) => x.id);
    expect(ids).toContain('ada');
    expect(ids).not.toContain('wren');
    expect(ids).not.toContain('quill');
    expect([...held.hidden]).toEqual(['wren']);
    expect([...held.proposed]).toEqual(['quill']);
    // A kept element's anchor never names a hidden place.
    const placed = [
      { id: 'n2', type: 'narrative', name: 'note', supertype: 'Unsorted', description: 'Ada again.' },
      { id: 'ada', type: 'character', name: 'Ada', location: 'vault' },
      { id: 'vault', type: 'location', name: 'The Sunken Vault', hidden: true },
    ] as OwElement[];
    const pm = new Map(placed.map((e) => [e.id, e]));
    const ada = buildSlice([pm.get('n2')!], buildWorldIndex(placed), (id) => pm.get(id)).find((x) => x.id === 'ada');
    expect(ada).toBeTruthy();
    expect(ada?.anchor ?? '').not.toContain('Sunken Vault');
    const shown = els.map((e) => (e.id === 'wren' ? ({ ...e, hidden: false } as OwElement) : e));
    const s2 = new Map(shown.map((e) => [e.id, e]));
    expect(buildSlice([s2.get('n1')!], buildWorldIndex(shown), (id) => s2.get(id)).map((x) => x.id)).toContain('wren');
  });
});

describe('the words a name carries away from its row (the hidden-elements gate, F3)', () => {
  it('proposed first, then hidden, and none for a settled shown element', () => {
    expect(markWords({ hidden: true, x_review_proposed: MARK })).toEqual(['proposed', 'hidden']);
    expect(markWords({ hidden: true })).toEqual(['hidden']);
    expect(markWords({ x_review_proposed: MARK })).toEqual(['proposed']);
    expect(markWords({ hidden: false, x_review_proposed: null })).toEqual([]);
    expect(markWords(undefined)).toEqual([]);
  });
  it('a lapsed proposal says so, as its row does', () => {
    expect(markWords({ x_review_proposed: { ...MARK, expires: '2000-01-01' } })).toEqual(['proposed, lapsed']);
  });
});
