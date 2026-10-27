// keel's "known of" stubs (B16; the folder spec §4.4 rules 1 to 5; Atlas's
// twin). A player reads what their own
// Character points to, one step out; an element reached only that way comes as a stub,
// `known_of: true`, with what anyone could see of it and every other field served unset. Those
// empties are not values: Lantern keeps it as a stub, never sends or changes it, and shows it as
// known of.
import { isKnownOf, type OwElement } from '@onlyworlds/sdk';
import { isEmptyValue } from './schema';

export { isKnownOf };

/** The keys every stub keeps, set or not (probed live; `change_seq` for the pull's newer-copy rule). */
export const KNOWN_OF_KEPT_KEYS: readonly string[] = [
  'id', 'type', 'name', 'description', 'supertype', 'subtype', 'image_url', 'created_at', 'updated_at', 'change_seq',
];

/** Who wrote it: null on every stub keel serves (the SDK's `known_of` doc), so never kept on one, whatever a file held. */
const AUTHOR_KEYS: readonly string[] = ['created_by', 'changed_by', 'changed_via'];

/**
 * Rule 1: a stub as it is, `known_of: true`, the kept keys and the fields keel shares on a stub
 * (PR 117: a Character's physicality, height, weight, species and reputation, from a
 * public tag in keel's schema). keel serves every other field unset, so a field with a value is
 * one keel shares: read from the wire, never from a list here that keel's schema can outgrow
 * (a list kept here once dropped PR 117's fields the hour it shipped). The unset fields are left out.
 */
export function stubShape(el: OwElement): OwElement {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el)) {
    if (AUTHOR_KEYS.includes(k)) continue;
    if (KNOWN_OF_KEPT_KEYS.includes(k) || !isEmptyValue(v)) out[k] = v;
  }
  out.known_of = true;
  return out as OwElement;
}

/** An element as it comes off the wire: a stub trimmed to what keel shares, a whole one as it is. */
export function fromWire(el: OwElement): OwElement {
  return isKnownOf(el) ? stubShape(el) : el;
}

/** What the phone says when a stub would be changed, deleted or sent (rules 3 and 5). */
export const KNOWN_OF_REFUSAL = 'You know only what anyone could see of this one, so it cannot be changed here.';

/**
 * The line on a stub's page (rule 2): what shows is all that is shared, the rest unknown. In the
 * words of keel's own stub page, named, never a pronoun.
 */
export function knownOfLine(name: string): string {
  return `Known of: you know only what anyone could see of ${name}.`;
}
