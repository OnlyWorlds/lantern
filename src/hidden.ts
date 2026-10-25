// The hidden mark (folder spec §4.8, RULED 2026-10-23; Atlas 1.86.0's twin). An element's `hidden`
// means hidden from whoever the world is handed to, never from the person holding it: keel serves the
// mark only to those who can still see the element (the owner, a co-builder, its maker), and a world
// file keeps it as the source wrote it.
//
// Lantern shows a world to its holder, so a hidden element carries its word on a row and its page and
// counts like any other. Ask and the sort hand the world to keel's AI, so there it is left out and
// counted. Put it online sends the mark on the create, the only write keel takes it on (keel #587).

import { handsOnAsProposed, proposedWord } from './review';

export const HIDDEN_KEY = 'hidden';

/** The one reading (SDK 4.70.0's writeWorldFile, Python's is_hidden): present and not null or false. */
export function isHidden(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const v = (el as Record<string, unknown>)[HIDDEN_KEY];
  return v !== undefined && v !== null && v !== false;
}

/** An outbox create keel refused for its mark (403 hidden_not_allowed). */
export const HIDDEN_REFUSAL = 'This element is hidden, and only the owner and co-builders can put a hidden element on OnlyWorlds. It stays on this phone.';

/** The word in a row's hint, or '' for an element nobody hid. */
export function hiddenWord(el: unknown): string {
  return isHidden(el) ? 'hidden' : '';
}

/**
 * The words a name carries wherever it shows without its row (the S462 gate's F3): a link chip,
 * Linked from, the map's card, Waiting to send, the party pickers. Proposed first, as a row says it.
 */
export function markWords(el: unknown): string[] {
  return [proposedWord(el), hiddenWord(el)].filter(Boolean);
}

/** The line on its page: who can see it online, or what the phone does with it. */
export function hiddenLine(el: unknown, online: boolean): string | null {
  if (!isHidden(el)) return null;
  return online
    ? 'Hidden on OnlyWorlds: only the owner, co-builders and whoever made it can see it.'
    : 'Hidden: shown to you here, and it goes online hidden.';
}

/**
 * A create's body as keel takes it: `hidden: true` for a marked element, no key for any other. The key
 * keeps its place, so a `true` body is byte for byte what an earlier build sent under the same
 * Idempotency-Key.
 */
export function withHiddenForCreate(body: Record<string, unknown>): Record<string, unknown> {
  if (!(HIDDEN_KEY in body)) return body;
  if (isHidden(body)) return { ...body, [HIDDEN_KEY]: true };
  const { [HIDDEN_KEY]: _mark, ...rest } = body;
  return rest;
}

/**
 * Why an element stays back from keel's AI, or null: hidden or proposed itself, or a pin or marker
 * placing one (a pin is named for what it places, the S462 gate's F1).
 */
export function handOnHold(el: unknown, get: (id: string) => unknown): 'hidden' | 'proposed' | null {
  if (isHidden(el)) return 'hidden';
  if (handsOnAsProposed(el)) return 'proposed';
  const placed = el && typeof el === 'object' ? (el as Record<string, unknown>).element_id : undefined;
  const t = typeof placed === 'string' ? get(placed) : undefined;
  if (t && isHidden(t)) return 'hidden';
  if (t && handsOnAsProposed(t)) return 'proposed';
  return null;
}

/** The elements what goes to keel's AI may name: none held back by handOnHold. */
export function handOnElements<T>(els: T[], get: (id: string) => unknown): T[] {
  return els.filter((e) => !handOnHold(e, get));
}

/** What the sort's slice held back: elements the notes name that stayed on the phone. */
export function heldBackSortLine(hidden: number, proposed: number): string {
  const parts: string[] = [];
  if (hidden) parts.push(hidden === 1 ? 'one hidden element' : `${hidden} hidden elements`);
  if (proposed) parts.push(proposed === 1 ? 'one proposed element, not yet reviewed' : `${proposed} proposed elements, not yet reviewed`);
  return parts.length ? `Not sent with your notes: ${parts.join(' and ')}.` : '';
}

/** What Ask held back from keel's AI, said in one sentence; '' when nothing was. */
export function heldBackLine(hidden: number, proposed: number): string {
  const parts: string[] = [];
  if (hidden) parts.push(hidden === 1 ? 'One hidden element is' : `${hidden} hidden elements are`);
  if (proposed) parts.push(proposed === 1 ? 'one proposed element, not yet reviewed, is' : `${proposed} proposed elements, not yet reviewed, are`);
  if (!parts.length) return '';
  const s = parts.length === 2 ? `${parts[0].replace(/ (is|are)$/, '')} and ${parts[1].replace(/ (is|are)$/, '')} are` : parts[0];
  return `${s[0].toUpperCase()}${s.slice(1)} not sent.`;
}
