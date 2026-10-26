// The parlor's room inside a world (the parlor's design sheet §1):
// its lines, board entries, work items, specs, hearts, votes, sittings and member cards are elements of
// the world itself, each a type with its own supertype. A worldbuilder's lists read the world without
// them (Titus, the sheet's note 2026-10-22: someone's lore must not read as polluted by meta), and
// one choice on the world's home shows them again. Atlas's twin: `core/parlor-room.ts` (1.70.0), the
// same pairs; since SDK 4.55.0 both read the SDK's rule and pairs, generated from schema-dist's room profile.
//
// The pair AND the mark (dist.45): a room element carries `x_room_of`, the id of the world or the sitting
// its room belongs to, written by the parlor on everything it makes. Without the mark a Narrative with
// supertype Message is lore (a novel's letters, the Manifest's Wire) and stays in view. A pair, never a
// supertype alone: a Location called Board is a place. The charter (a Law, supertype Charter) stays in:
// it is the world's own rule, not a line said in the room. Type and supertype match in any case, trimmed. Per phone and per world, like Tonight; it never travels and never changes the world.
import { ROOM_PAIRS, isRoomElement as sdkIsRoomElement, type OwElement } from '@onlyworlds/sdk';

/** The room profile's pairs as the SDK carries them (4.55.0, generated from the profile), lower-cased. */
export const ROOM_SUPERTYPES: ReadonlyArray<readonly [string, string]> = ROOM_PAIRS.map((p) => [p.type, p.supertype.toLowerCase()] as const);

/** The SDK's rule (4.55.0): the pair, trimmed and case-folded, AND the mark. A body whose type, supertype or mark is not a string is lore. */
export function isRoomElement(el: OwElement): boolean {
  const r = el as Record<string, unknown>;
  if (typeof r.type !== 'string' || typeof r.supertype !== 'string' || typeof r.x_room_of !== 'string') return false;
  return sdkIsRoomElement({ type: r.type, supertype: r.supertype, x_room_of: r.x_room_of });
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
