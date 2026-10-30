/**
 * Whether the OnlyWorlds mark (the SDK's Waymark) shows beside a name, and what it is given.
 * Pure: the facts it cannot read itself (a create still waiting, a stub) are handed in.
 *
 * The rule: the mark shows only where onlyworlds.com has a page for this reader. The site sends
 * the owner and every signed-in member of a world, at any role, to their own page for it, and an
 * element's address to a member whose role reads it; anyone else sees the public page while it is
 * on, and nothing when it is off. The site goes by the browser's own sign-in, which Lantern cannot
 * see, so a key alone never makes a member (a key someone lent, a role held aside while another
 * account is signed in, an agent's seat). So:
 * - a member by the account's role (owner, or any member role): the world's mark, and an
 *   element's once keel holds it;
 * - every other online world: only while the public page is on, and only for an element that
 *   page shows (not hidden, not a room element, not proposed as keel hands it on, not a Pin or a
 *   Marker);
 * - never a world on this phone only, never the demo.
 */

import { isDemoKey, type OwElement } from '@onlyworlds/sdk';
import type { WorldRecord } from './db';
import { isHidden } from './hidden';
import { handsOnAsProposed } from './review';
import { isRoomElement } from './room';

export type WaymarkReader = 'member' | 'public';

export interface WaymarkPlan {
  world: { id: string; name: string; x_names?: unknown };
  element: { id: string; type: string; name: string; [k: string]: unknown } | null;
  reader: WaymarkReader;
}

export interface WaymarkFacts {
  /** The element's create is still waiting to send: keel does not hold it yet. */
  creating?: boolean;
  /** A known-of stub (src/knownof.ts): only its name and type are known. */
  stub?: boolean;
  /** A change of mine waits to send: keel's last write is not what the page shows, so no door line. */
  editing?: boolean;
}

/** How long the record's public page answer stands before a view asks again (with signal). */
export const PUBLIC_PAGE_FRESH_MS = 5 * 60 * 1000;

/** The site's public page for the world is on, from keel's GET /world (Skeld's rule: both keys, exactly). */
export function publicPageOnFrom(meta: Record<string, unknown>): boolean {
  const page = meta.public_page as Record<string, unknown> | null | undefined;
  return meta.public_read === true && !!page && typeof page === 'object' && page.on === true;
}

/** Who reads the world on onlyworlds.com: a member by the signed-in account's role; anyone else, the public page. */
export function readerOf(rec: WorldRecord): WaymarkReader {
  return rec.role === 'owner' || rec.role === 'collaborator' ? 'member' : 'public';
}

/** The record's public page answer is missing or older than five minutes: a view with signal asks again. */
export function publicPageStale(rec: WorldRecord, now = Date.now()): boolean {
  return typeof rec.publicPageAt !== 'number' || now - rec.publicPageAt > PUBLIC_PAGE_FRESH_MS;
}

export function waymarkFor(rec: WorldRecord | null | undefined, el: OwElement | null, facts: WaymarkFacts = {}): WaymarkPlan | null {
  if (!rec || rec.kind !== 'online' || !rec.apiKey || isDemoKey(rec.apiKey)) return null;
  const reader = readerOf(rec);
  if (reader === 'public' && rec.publicPageOn !== true) return null;
  const names = rec.names && typeof rec.names === 'object' ? { x_names: rec.names } : {};
  const world = { id: rec.id, name: rec.name || 'Unnamed world', ...names };
  if (!el) return { world, element: null, reader };
  if (facts.creating) return null;
  // The public page shows no hidden element, no room element and nothing proposed; a Pin or a Marker
  // has no page of its own there.
  if (reader === 'public' && (isHidden(el) || isRoomElement(el) || handsOnAsProposed(el) || el.type === 'pin' || el.type === 'marker')) return null;
  const name = typeof el.name === 'string' && el.name ? el.name : '(unnamed)';
  const element = facts.stub || facts.editing || reader === 'public'
    ? { id: el.id, type: el.type, name }
    : { ...(el as Record<string, unknown>), id: el.id, type: el.type, name };
  return { world, element, reader };
}
