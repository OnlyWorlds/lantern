// The morning after, the pure part: the world's slice a sort sends with its notes, and the rows a
// person ticked turned into writes. The rows' shape is Simmer's contract (h37 #3571,
// Fold/magelet/work/2026-10-12-lantern-row-shape-reply.md); the route is Skeld's (h37 #3591,
// POST /account/sort). Nothing here writes: the screen hands the plan to the outbox.
import { lookupWorld, type OwElement, type OwWorldIndex } from '@onlyworlds/sdk';
import { fieldInfo, isType } from './schema';

/** One element the notes may be about, as the route takes it. */
export interface SliceItem {
  id: string;
  type: string;
  name: string;
  anchor?: string;
}

export interface Target extends SliceItem {}

export interface MakeRow {
  kind: 'make';
  source_line: string;
  proposal: { type: string; name: string; description?: string };
}
export interface AddToRow {
  kind: 'add_to';
  source_line: string;
  target: Target;
  field: string;
  op?: 'append' | 'set';
  value: string;
}
export interface LinkRow {
  kind: 'link';
  source_line: string;
  target: Target;
  field: string;
  value_id: string;
  value_name?: string;
}
/** A question for the person: which one, or is it new. `then` (if the route sends it) is the row it stands for, its target filled by the pick. */
export interface AskRow {
  kind: 'ask';
  source_line: string;
  question: string;
  candidates: Target[];
  then?: (Omit<AddToRow, 'target' | 'source_line'> | Omit<LinkRow, 'target' | 'source_line'>) & { kind: 'add_to' | 'link' };
}
export type SortRow = MakeRow | AddToRow | LinkRow | AskRow;

export const SLICE_MAX = 40;
/** The route's limits (h37 #3591): 1 to 8 notes, each up to 4,000 characters, 16,000 in all. */
export const NOTES_MAX = 8;
export const NOTE_CHARS = 4000;
export const NOTES_CHARS = 16000;
/** What a sorted note becomes (Q2's lean: kept, the source every row points at). */
export const SORTED = 'Sorted';

/** A note's words as the model reads them: its text, else its name. */
export function noteText(note: OwElement): string {
  const d = typeof note.description === 'string' ? note.description.trim() : '';
  const n = typeof note.name === 'string' ? note.name.trim() : '';
  const t = d || n;
  return [...t].slice(0, NOTE_CHARS).join('');
}

/** The notes' texts within the route's total, oldest dropped last: a note that does not fit is left for the next sort. */
export function fitNotes(notes: OwElement[]): OwElement[] {
  const out: OwElement[] = [];
  let total = 0;
  for (const n of notes.slice(0, NOTES_MAX)) {
    const len = [...noteText(n)].length;
    if (!len || total + len > NOTES_CHARS) continue;
    total += len;
    out.push(n);
  }
  return out;
}

/** The one line that tells two of a name apart (Simmer: the anchor the card shows). */
export function anchorOf(el: OwElement, get: (id: string) => OwElement | undefined): string | undefined {
  const parts: string[] = [];
  if (typeof el.supertype === 'string' && el.supertype.trim()) parts.push(el.supertype.trim());
  for (const f of ['location', 'parent_location', 'species']) {
    const v = el[f];
    const id = Array.isArray(v) ? v[0] : v;
    const t = typeof id === 'string' ? get(id) : undefined;
    if (t?.name) {
      parts.push(String(t.name));
      break;
    }
  }
  if (!parts.length && typeof el.description === 'string' && el.description.trim()) {
    const cps = [...el.description.trim().split(/\n/)[0]];
    parts.push(cps.length > 48 ? cps.slice(0, 46).join('').trimEnd() + '…' : cps.join(''));
  }
  return parts.length ? parts.join(', ') : undefined;
}

const NOT_IN_SLICE = new Set(['pin', 'marker']);

/**
 * The elements the notes name or touch, best first across all notes, at most 40: the phone's own
 * lookup (free, offline) picks them, so the model sees only what the world already has to offer.
 */
export function buildSlice(
  notes: OwElement[],
  index: OwWorldIndex<OwElement>,
  get: (id: string) => OwElement | undefined,
): SliceItem[] {
  const noteIds = new Set(notes.map((n) => n.id));
  const best = new Map<string, number>();
  for (const n of notes) {
    // Each line of a note is its own question: a name on line three still counts.
    const lines = noteText(n).split(/\n+/).filter((l) => l.trim());
    for (const line of lines.length ? lines : [noteText(n)]) {
      for (const hit of lookupWorld(index, line, { limit: 12 })) {
        const el = hit.element;
        if (noteIds.has(el.id) || NOT_IN_SLICE.has(el.type)) continue;
        if (el.type === 'narrative' && (el.supertype === 'Unsorted' || el.supertype === SORTED)) continue;
        best.set(el.id, Math.max(best.get(el.id) ?? 0, hit.score));
      }
    }
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, SLICE_MAX)
    .map(([id]) => {
      const el = get(id)!;
      const anchor = anchorOf(el, get);
      return { id, type: el.type, name: String(el.name ?? ''), ...(anchor ? { anchor } : {}) };
    });
}

// ---------- from ticked rows to writes ----------

export type Write =
  | { op: 'create'; key: string; type: string; values: Record<string, unknown> }
  | { op: 'edit'; id: string; values: Record<string, unknown> };

export interface Planned {
  writes: Write[];
  /** Rows that cannot be written as they stand, each with its reason (said on the screen, never silent). */
  skipped: { row: SortRow; reason: string }[];
}

/** A row the person ticked, with what they changed on its card. */
export interface Ticked {
  key: string;
  row: SortRow;
  /** A make's name and type as edited on the card. */
  name?: string;
  type?: string;
  /** An ask's pick: a candidate's id. */
  pick?: string;
}

const IDENTITY = new Set(['name', 'type', 'id']);
const TEXT_BASE = new Set(['description', 'supertype', 'subtype']);

function lower(t: string): string {
  return (t || '').trim().toLowerCase();
}

function textField(type: string, field: string): boolean {
  if (TEXT_BASE.has(field)) return true;
  return fieldInfo(type, field)?.type === 'text';
}

/**
 * The writes for what was ticked, makes first so nothing waits on them, then one edit per element
 * with every addition and link to it merged (the outbox sends each element's edits in order).
 * Every check the route already makes is made again here: the page writes only what it can see is
 * sound (the target exists, the field is the type's, a link points at the field's own type).
 */
export function planWrites(ticked: Ticked[], get: (id: string) => OwElement | undefined): Planned {
  const writes: Write[] = [];
  const skipped: Planned['skipped'] = [];
  const working = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  const touch = (id: string): Record<string, unknown> => {
    if (!working.has(id)) {
      working.set(id, {});
      order.push(id);
    }
    return working.get(id)!;
  };
  const current = (id: string, field: string): unknown => {
    const w = working.get(id);
    return w && field in w ? w[field] : get(id)?.[field];
  };

  const apply = (row: AddToRow | LinkRow, t: Ticked) => {
    const target = get(row.target.id);
    if (!target) return skipped.push({ row: t.row, reason: 'It is not in this world on this phone.' });
    if (IDENTITY.has(row.field)) return skipped.push({ row: t.row, reason: 'A name is changed by hand, on its page.' });
    if (row.kind === 'add_to') {
      if (!textField(target.type, row.field)) return skipped.push({ row: t.row, reason: `${row.field} is not a text field of a ${target.type}.` });
      const value = String(row.value ?? '').trim();
      if (!value) return skipped.push({ row: t.row, reason: 'Nothing to add.' });
      const cur = current(target.id, row.field);
      const had = typeof cur === 'string' ? cur.trim() : '';
      if (row.op === 'set' && had) return skipped.push({ row: t.row, reason: `${target.name} already has a ${row.field}: it is added to, never replaced.` });
      touch(target.id)[row.field] = had ? `${had}\n\n${value}` : value;
      return;
    }
    const info = fieldInfo(target.type, row.field);
    if (!info || (info.type !== 'single_link' && info.type !== 'multi_link'))
      return skipped.push({ row: t.row, reason: `${row.field} is not a link of a ${target.type}.` });
    const value = get(row.value_id);
    if (!value) return skipped.push({ row: t.row, reason: 'What it links to is not on this phone.' });
    if (info.target && value.type !== info.target) return skipped.push({ row: t.row, reason: `${row.field} takes a ${info.target}, not a ${value.type}.` });
    if (value.id === target.id) return skipped.push({ row: t.row, reason: 'It cannot link to itself.' });
    if (info.type === 'single_link') {
      const cur = current(target.id, row.field);
      if (typeof cur === 'string' && cur && cur !== value.id)
        return skipped.push({ row: t.row, reason: `${target.name}'s ${row.field} is already set: change it on its page.` });
      touch(target.id)[row.field] = value.id;
    } else {
      const cur = current(target.id, row.field);
      const ids = Array.isArray(cur) ? cur.map(String) : [];
      if (!ids.includes(value.id)) touch(target.id)[row.field] = [...ids, value.id];
    }
  };

  for (const t of ticked) {
    const row = t.row;
    if (row.kind === 'make') {
      const type = lower(t.type ?? row.proposal.type);
      const name = (t.name ?? row.proposal.name ?? '').trim();
      if (!isType(type)) {
        skipped.push({ row, reason: 'Choose what kind of thing it is.' });
        continue;
      }
      if (!name) {
        skipped.push({ row, reason: 'It needs a name.' });
        continue;
      }
      const values: Record<string, unknown> = { name };
      const d = row.proposal.description?.trim();
      if (d) values.description = d;
      writes.push({ op: 'create', key: t.key, type, values });
    } else if (row.kind === 'add_to' || row.kind === 'link') {
      apply(row, t);
    } else if (row.kind === 'ask') {
      // A pick with nothing behind it writes nothing: the question was the whole row.
      if (!t.pick || !row.then) continue;
      const cand = row.candidates.find((c) => c.id === t.pick);
      if (!cand) {
        skipped.push({ row, reason: 'That choice is not one of its candidates.' });
        continue;
      }
      apply({ ...row.then, source_line: row.source_line, target: cand } as AddToRow | LinkRow, t);
    }
  }
  for (const id of order) writes.push({ op: 'edit', id, values: working.get(id)! });
  return { writes, skipped };
}
