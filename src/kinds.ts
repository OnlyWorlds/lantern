// A value OnlyWorlds would store as another, found before Put it online sends anything.
//
// keel takes a wrong kind with a 200 and changes it: an integer field stores int(value) (2.5 as 2,
// "7" as 7, true as 1), a text field the text of any other value (12 as "12"). The SDK refuses such a
// value before sending, from the release after 4.219.3, with a TypeError that stops a whole /bulk. A
// world file written by another tool can hold one, and Put it online sends a file's elements as it
// holds them, so the phone finds the first one first and says which element, field and value.
//
// The predicate is the SDK client's `checkKinds`, copied: an integer field takes a whole number (never
// a boolean or a number as text), a text field a string, each or null; a field outside the schema and a
// link field are not read. To be replaced by the SDK's own when it exports it (asked).
import { FIELD_SCHEMA } from '@onlyworlds/sdk';

export interface KindFault {
  field: string;
  kind: 'integer' | 'text';
  /** As a person reads it: 2.5, "7", true, a list. */
  shown: string;
}

function shownValue(v: unknown): string {
  if (typeof v === 'string') return `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return 'a list';
  return 'a group of fields';
}

/** The first field, in the element's own order, whose value OnlyWorlds would store as another; or null. */
export function kindFault(type: string, element: Record<string, unknown>): KindFault | null {
  const fields = (FIELD_SCHEMA as unknown as Record<string, Record<string, { type: string }> | undefined>)[type];
  if (!fields) return null;
  for (const [field, value] of Object.entries(element)) {
    const kind = fields[field]?.type;
    if (value === null || value === undefined || kind === undefined) continue;
    if (kind === 'integer' && !(typeof value === 'number' && Number.isInteger(value))) return { field, kind, shown: shownValue(value) };
    if (kind === 'text' && typeof value !== 'string') return { field, kind, shown: shownValue(value) };
  }
  return null;
}
