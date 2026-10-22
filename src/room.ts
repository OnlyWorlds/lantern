// The parlor's room inside a world (OW Parlor, the design sheet §1, `Orrery/parlor/design-sheet.md`):
// its lines, board entries, work items, specs, hearts, votes, sittings and member cards are elements of
// the world itself, each a type with its own supertype. A worldbuilder's lists read the world without
// them (the Captain, the sheet's note 2026-10-22: someone's lore must not read as polluted by meta), and
// one choice on the world's home shows them again. Atlas's twin: `core/parlor-room.ts` (1.70.0), the
// same pairs; both copies give way to the SDK's export of schema-dist's room profile (dist.44) once it ships.
//
// The pair AND the mark (dist.45): a room element carries `x_room_of`, the id of the world or the sitting
// its room belongs to, written by the parlor on everything it makes. Without the mark a Narrative with
// supertype Message is lore (a novel's letters, the Manifest's Wire) and stays in view. A pair, never a
// supertype alone: a Location called Board is a place. The charter (a Law, supertype Charter) stays in:
// it is the world's own rule, not a line said in the room. Type and supertype match in any case, trimmed. Per phone and per world, like Tonight; it never travels and never changes the world.
import type { OwElement } from '@onlyworlds/sdk';

export const ROOM_SUPERTYPES: ReadonlyArray<readonly [string, string]> = [
  ['narrative', 'message'],
  ['narrative', 'board'],
  ['relation', 'work item'],
  ['construct', 'spec'],
  ['relation', 'heart'],
  ['relation', 'vote'],
  ['event', 'sitting'],
  ['character', 'member'],
];

export function isRoomElement(el: OwElement): boolean {
  const sup = el.supertype;
  const mark = (el as Record<string, unknown>).x_room_of;
  if (typeof sup !== 'string' || typeof el.type !== 'string') return false;
  if (typeof mark !== 'string' || !mark.trim()) return false;
  // Both sides trimmed and case-blind, as schema-dist's room profile rules (dist.45).
  const s = sup.trim().toLowerCase();
  const t = el.type.trim().toLowerCase();
  return ROOM_SUPERTYPES.some(([type, word]) => t === type && s === word);
}

const key = (worldId: string) => `lantern-room-shown-${worldId}`;

/** Whether this phone shows the room's elements in the world's lists. Hidden unless chosen. */
export function roomShown(worldId: string): boolean {
  try {
    return localStorage.getItem(key(worldId)) === '1';
  } catch {
    return false;
  }
}

/** Returns whether the phone kept the choice. */
export function setRoomShown(worldId: string, on: boolean): boolean {
  try {
    if (on) localStorage.setItem(key(worldId), '1');
    else localStorage.removeItem(key(worldId));
    return true;
  } catch {
    return false;
  }
}
