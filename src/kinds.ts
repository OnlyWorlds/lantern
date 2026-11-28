// A value OnlyWorlds would store as another, found before Put it online sends anything.
//
// keel takes a wrong kind with a 200 and changes it: an integer field stores int(value) (2.5 as 2,
// "7" as 7, true as 1), a text field the text of any other value (12 as "12"). The SDK refuses such a
// value before sending, with a TypeError that stops a whole /bulk. A world file written by another
// tool can hold one, and Put it online sends a file's elements as it holds them, so the phone asks the
// SDK's own rule (`kindFaults`, since 4.222.0) first and says which element, field and value.
import { kindFaults } from '@onlyworlds/sdk';
import { fieldLabel } from './schema';

export interface KindFault {
  field: string;
  kind: 'integer' | 'text';
  /** As a person reads it: 2.5, "7", yes, a list. */
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
  const first = kindFaults(type, element)[0];
  return first ? { field: first.field, kind: first.kind, shown: shownValue(first.value) } : null;
}

/** The fault in words, after the element's name: 'height holds "7", and that field takes a whole number: ...'. */
export function kindFaultWords(fault: KindFault): string {
  return `${fieldLabel(fault.field)} holds ${fault.shown}, and that field takes ${fault.kind === 'integer' ? 'a whole number' : 'text'}: OnlyWorlds would store it as another value.`;
}
