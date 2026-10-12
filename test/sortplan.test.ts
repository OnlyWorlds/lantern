// The morning after's pure part: what a sort sends, and what the ticked rows write.
import { describe, expect, it } from 'vitest';
import { buildWorldIndex, type OwElement } from '@onlyworlds/sdk';
import { buildSlice, fitNotes, notesPayload, planWrites, sanitizeRows, tooLong, type SortRow, type Ticked } from '../src/sortplan';

const els: OwElement[] = [
  { id: 'swoop', type: 'location', name: 'The Swoop' },
  { id: 'dot', type: 'character', name: 'Dot', location: 'swoop', description: "The fisher's girl." },
  { id: 'dotma', type: 'character', name: 'Dot-ma', supertype: 'Brewer' },
  { id: 'pipit', type: 'character', name: 'Pipit', description: 'Keeps foxes.' },
  { id: 'fox', type: 'creature', name: 'Red Fox' },
  { id: 'n1', type: 'narrative', name: 'Dot was at the fire', supertype: 'Unsorted', description: 'Dot was at the fire\nPipit weaned the fox kit' },
  { id: 'n0', type: 'narrative', name: 'Older note about Dot', supertype: 'Unsorted', description: 'Dot again' },
  { id: 'pin1', type: 'pin', name: 'Dot' },
];
const byId = new Map(els.map((e) => [e.id, e]));
const get = (id: string) => byId.get(id);

describe('buildSlice', () => {
  const index = buildWorldIndex(els);
  const slice = buildSlice([byId.get('n1')!], index, get);
  const ids = slice.map((s) => s.id);

  it('holds what the note names, from any line of it', () => {
    expect(ids).toContain('dot');
    expect(ids).toContain('pipit');
  });

  it('never the notes themselves, other notes waiting to be sorted, or map pins', () => {
    expect(ids).not.toContain('n1');
    expect(ids).not.toContain('n0');
    expect(ids).not.toContain('pin1');
  });

  it("gives each its anchor: a place it is in, else its kind, else its description's start", () => {
    expect(slice.find((s) => s.id === 'dot')?.anchor).toBe('The Swoop');
    expect(slice.find((s) => s.id === 'pipit')?.anchor).toBe('Keeps foxes.');
  });
});

describe('notesPayload', () => {
  it('a note goes with its picture only once the picture is online, four a sort at most', () => {
    const note = (id: string, image_url?: string) => ({ id, type: 'narrative', name: id, description: `words of ${id}`, ...(image_url ? { image_url } : {}) }) as OwElement;
    const online = (k: string) => `https://media.onlyworlds.com/w/abc/${k}.webp`;
    const { notes, held } = notesPayload([
      note('a'),
      note('b', online('b')),
      note('c', 'blob:http://localhost/123'),
      note('d', 'data:image/webp;base64,AAAA'),
      note('e', online('e')),
      note('f', online('f')),
      note('g', online('g')),
      note('h', online('h')),
    ]);
    expect(notes[0]).toBe('words of a');
    expect(notes[1]).toEqual({ text: 'words of b', image_url: online('b') });
    expect(notes[2]).toBe('words of c');
    expect(notes[3]).toBe('words of d');
    expect(notes.filter((n) => typeof n !== 'string').length).toBe(4);
    expect(notes[7]).toBe('words of h');
    expect(held).toBe(3);
  });
});

describe('sanitizeRows', () => {
  it('keeps rows of the contract\'s shape and leaves out the rest with a reason', () => {
    const { rows, dropped } = sanitizeRows([
      { kind: 'make', source_line: 'a', proposal: { type: 'Character', name: 'Ember', description: '' } },
      { kind: 'ask', source_line: 'b', question: 'Which?' },
      { kind: 'add_to', source_line: 'c', target: { id: 'dot', type: 'character', name: 'Dot' }, value: 'x' },
      { kind: 'link', source_line: 'd', target: { id: 'dot', type: 'character', name: 'Dot' }, field: 'location', value_id: 'swoop' },
      { kind: 'ask', source_line: 'e', question: 'Which?', candidates: [], then: { kind: 'make' } },
      'not a row',
    ]);
    expect(rows.map((r) => r.source_line)).toEqual(['a', 'd']);
    expect(dropped.map((d) => d.source_line)).toEqual(['b', 'c', 'e', '']);
  });
});

describe('fitNotes', () => {
  it('never takes a note longer than a sort reads: it is not cut and filed', () => {
    const long = { id: 'long', type: 'narrative', name: 'long', description: 'y'.repeat(4001) } as OwElement;
    expect(tooLong(long)).toBe(true);
    expect(fitNotes([long, byId.get('n1')!]).map((n) => n.id)).toEqual(['n1']);
  });

  it('keeps notes within the route\'s total, leaving the rest for the next sort', () => {
    const big = (id: string) => ({ id, type: 'narrative', name: id, description: 'x'.repeat(4000) }) as OwElement;
    const fit = fitNotes([big('a'), big('b'), big('c'), big('d'), big('e')]);
    expect(fit.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

const tick = (row: SortRow, extra: Partial<Ticked> = {}): Ticked => ({ key: Math.random().toString(36), row, ...extra });
const t = (id: string) => ({ id, type: byId.get(id)!.type, name: String(byId.get(id)!.name) });

describe('planWrites', () => {
  it('makes come first; additions to one element merge into one edit, in the order ticked', () => {
    const { writes, skipped } = planWrites(
      [
        tick({ kind: 'add_to', source_line: 'a', target: t('pipit'), field: 'description', op: 'append', value: 'Weaned the fox kit.' }),
        tick({ kind: 'make', source_line: 'b', proposal: { type: 'Character', name: 'Ember', description: 'Tends the fire.' } }),
        tick({ kind: 'add_to', source_line: 'c', target: t('pipit'), field: 'description', value: 'Was at the fire.' }),
      ],
      get,
    );
    expect(skipped).toEqual([]);
    expect(writes[0]).toMatchObject({ op: 'create', type: 'character', values: { name: 'Ember', description: 'Tends the fire.' } });
    expect(writes[1]).toEqual({ op: 'edit', id: 'pipit', values: { description: 'Keeps foxes.\n\nWeaned the fox kit.\n\nWas at the fire.' } });
    expect(writes.length).toBe(2);
  });

  it("a make's card edits win: its name and its type", () => {
    const { writes } = planWrites([tick({ kind: 'make', source_line: 'b', proposal: { type: 'Character', name: 'Ember' } }, { name: 'Embers', type: 'collective' })], get);
    expect(writes[0]).toMatchObject({ type: 'collective', values: { name: 'Embers' } });
  });

  it('a link sets a single link, adds to a multi link once, and points only at the field\'s own type', () => {
    const { writes, skipped } = planWrites(
      [
        tick({ kind: 'link', source_line: 'x', target: t('dotma'), field: 'location', value_id: 'swoop' }),
        tick({ kind: 'link', source_line: 'y', target: t('dotma'), field: 'friends', value_id: 'dot' }),
        tick({ kind: 'link', source_line: 'y2', target: t('dotma'), field: 'friends', value_id: 'dot' }),
        tick({ kind: 'link', source_line: 'z', target: t('dotma'), field: 'location', value_id: 'fox' }),
      ],
      get,
    );
    expect(writes).toEqual([{ op: 'edit', id: 'dotma', values: { location: 'swoop', friends: ['dot'] } }]);
    expect(skipped.map((s) => s.row.source_line)).toEqual(['z']);
    // The type rule alone, on a field nothing set before (above, "already set" also stops z).
    const alone = planWrites([tick({ kind: 'link', source_line: 'w', target: t('pipit'), field: 'location', value_id: 'fox' })], get);
    expect(alone.writes).toEqual([]);
    expect(alone.skipped[0]?.reason).toMatch(/takes a location/);
  });

  it('refuses what it cannot write soundly, each with a reason', () => {
    const { writes, skipped } = planWrites(
      [
        tick({ kind: 'add_to', source_line: '1', target: t('dot'), field: 'name', value: 'Dorothy' }),
        tick({ kind: 'link', source_line: '2', target: t('dot'), field: 'location', value_id: 'swoop' }),
        tick({ kind: 'link', source_line: '3', target: t('dotma'), field: 'location', value_id: 'nowhere' }),
        tick({ kind: 'add_to', source_line: '4', target: { id: 'gone', type: 'character', name: 'Gone' }, field: 'description', value: 'x' }),
        tick({ kind: 'add_to', source_line: '5', target: t('dot'), field: 'description', op: 'set', value: 'A new one.' }),
        tick({ kind: 'make', source_line: '6', proposal: { type: 'Thing', name: 'X' } }),
      ],
      get,
    );
    // Dot's location is already the Swoop: setting it again is no change, not a refusal.
    expect(writes).toEqual([{ op: 'edit', id: 'dot', values: { location: 'swoop' } }]);
    expect(skipped.map((s) => s.row.source_line)).toEqual(['1', '3', '4', '5', '6']);
    expect(skipped.every((s) => s.reason.length > 5)).toBe(true);
  });

  it('never a picture address, a kind word added onto another, or a target the phone did not send (the S398 sort gate)', () => {
    const { writes, skipped } = planWrites(
      [
        tick({ kind: 'add_to', source_line: 'pic', target: t('pipit'), field: 'image_url', op: 'set', value: 'https://evil.example/x.png' }),
        tick({ kind: 'add_to', source_line: 'kind', target: t('dotma'), field: 'supertype', value: 'Smuggler' }),
        tick({ kind: 'add_to', source_line: 'kind-empty', target: t('pipit'), field: 'supertype', value: 'Fox keeper' }),
        tick({ kind: 'add_to', source_line: 'unsent', target: t('fox'), field: 'description', value: 'x' }),
        tick({ kind: 'link', source_line: 'sent-value', target: t('dotma'), field: 'friends', value_id: 'pipit' }),
      ],
      get,
      new Set(['pipit', 'dotma', 'dot', 'swoop']),
    );
    expect(writes).toEqual([
      { op: 'edit', id: 'pipit', values: { supertype: 'Fox keeper' } },
      { op: 'edit', id: 'dotma', values: { friends: ['pipit'] } },
    ]);
    expect(skipped.map((s) => s.row.source_line)).toEqual(['pic', 'kind', 'unsent']);
    // pipit was sent: friends -> pipit is fine; only what was never sent is refused.
    expect(planWrites([tick({ kind: 'link', source_line: 'x', target: t('dotma'), field: 'friends', value_id: 'fox' })], get, new Set(['dotma'])).skipped.length).toBe(1);
  });

  it('an ask writes only through its pick and the row it stands for', () => {
    const ask: SortRow = {
      kind: 'ask',
      source_line: 'Dot was at the fire',
      question: 'Which Dot?',
      candidates: [t('dot'), t('dotma')],
      then: { kind: 'add_to', field: 'description', op: 'append', value: 'Was at the fire.' },
    };
    expect(planWrites([tick(ask)], get).writes).toEqual([]);
    expect(planWrites([tick(ask, { pick: 'dotma' })], get).writes).toEqual([{ op: 'edit', id: 'dotma', values: { description: 'Was at the fire.' } }]);
    expect(planWrites([tick(ask, { pick: 'pipit' })], get).skipped.length).toBe(1);
    const bare: SortRow = { ...ask, then: undefined };
    expect(planWrites([tick(bare, { pick: 'dot' })], get).writes).toEqual([]);
  });
});
