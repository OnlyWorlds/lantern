// A world's reading aids (schema-dist profiles/charter.md): the Charter (the rules here), the Guide (start
// here) and the Domains (the places in the world). Each is an element of one of the profile's pairs that
// carries the mark `x_charter_of`, read by presence; the pair without the mark is lore (a kingdom's charter
// in a novel) and stays in every view. Rule 1: a lore view (the lists, the counts, search, Before now, a
// link picker, Ask's lookup) leaves them out by default, and the switch is the person's, kept per phone and
// per world, like the room's (src/room.ts). Rule 2: a world's home shows them first, in that order, and
// draws nothing for what is absent. Atlas's twin: `core/charter.ts` (1.101.0).
//
// The pick is the SDK's own `charterOf`, never a copy of its rule. It reads the phone's copy at the owner
// rung: the copy already is what this phone's key was served, so a hidden aid a contributor was never
// served is not in it, and a guest's known-of stub carries no mark and reads as lore.
import { charterOf, handsOnAsProposed, isCharterElement, readingAidOf, type OwElement, type OwReadingAids } from '@onlyworlds/sdk';

export type AidKind = 'charter' | 'guide' | 'domain';

/**
 * A reading aid as Lantern counts one, everywhere: the pair and the mark (the SDK's test) and not proposed.
 * A proposed aid is in no reader's view until a keeper settles it (the profile, serial 94), so it stays lore.
 */
export function isReadingAid(el: OwElement): boolean {
  // A pre-filter for every lore view's pass: no mark is never an aid, and the SDK's test folds the pair first.
  const mark = (el as Record<string, unknown>).x_charter_of;
  if (mark === undefined || mark === null) return false;
  return isCharterElement(el) && !handsOnAsProposed(el);
}

/** Which aid the element's pair makes it, the mark ignored (the SDK's `readingAidOf`). */
export function aidKind(el: OwElement): AidKind | null {
  return readingAidOf(el);
}

export interface AidsRead {
  /** The SDK's packet: the leading Charter and Guide, every marked Domain in its order. */
  packet: OwReadingAids;
  /** How many marked aids the world holds, by kind. */
  charters: number;
  guides: number;
  domains: number;
  count: number;
}

const NONE: OwReadingAids = { charter: null, guide: null, domains: [] };

/** The packet and the counts for a world's elements. The SDK's whole reading only when there is an aid to read. */
export function readAids(elements: readonly OwElement[]): AidsRead {
  let charters = 0;
  let guides = 0;
  let domains = 0;
  for (const el of elements) {
    // The SDK's reading skips an element with no string id, so the counts do too.
    if (typeof el.id !== 'string' || !isReadingAid(el)) continue;
    const k = aidKind(el);
    if (k === 'charter') charters++;
    else if (k === 'guide') guides++;
    else if (k === 'domain') domains++;
  }
  const count = charters + guides + domains;
  const packet = count ? charterOf({ elements }, { rung: 'owner' }) : NONE;
  return { packet, charters, guides, domains, count };
}

/** "the charter, the guide and 3 domains": what the world holds, named by kind, for the home's switch. */
export function aidsWords(a: Pick<AidsRead, 'charters' | 'guides' | 'domains'>): string {
  const parts: string[] = [];
  if (a.charters) parts.push(a.charters === 1 ? 'the charter' : `${a.charters} charters`);
  if (a.guides) parts.push(a.guides === 1 ? 'the guide' : `${a.guides} guides`);
  if (a.domains) parts.push(a.domains === 1 ? '1 domain' : `${a.domains} domains`);
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The opening of an aid's description for the home: its first paragraph, cut at a word near `max`. */
export function aidLead(el: OwElement, max = 200): string {
  const text = typeof el.description === 'string' ? el.description.trim() : '';
  if (!text) return '';
  const first = text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The line under an aid's name on its own page: which aid it is, whether it leads (an older marked Charter
 * or Guide is superseded, the profile's "which one"), and that the lists leave it out while the aids are hidden.
 * Null for anything that is not a marked aid.
 */
export function aidLine(el: OwElement, packet: OwReadingAids, shown: boolean, nameOf: (id: string) => string): string | null {
  if (!isReadingAid(el)) return null;
  const kind = aidKind(el);
  const out = shown ? '' : ' It stays out of the lists and search.';
  if (kind === 'domain') return `One of this world's domains, on its home.${out}`;
  const lead = kind === 'charter' ? packet.charter : packet.guide;
  const word = kind === 'charter' ? 'charter' : 'guide';
  if (lead?.id === el.id) return `This world's ${word}, first on its home.${out}`;
  return lead ? `Also marked as a ${word}: ${nameOf(lead.id)} is the one that leads.${out}` : `Marked as a ${word}.${out}`;
}

const key = (worldId: string) => `lantern-aids-shown-${worldId}`;

/** Whether this phone shows the reading aids in the world's lists. Hidden unless chosen. */
export function aidsShown(worldId: string): boolean {
  try {
    return localStorage.getItem(key(worldId)) === '1';
  } catch {
    return false;
  }
}

/** Returns whether the phone kept the choice. */
export function setAidsShown(worldId: string, on: boolean): boolean {
  try {
    if (on) localStorage.setItem(key(worldId), '1');
    else localStorage.removeItem(key(worldId));
    return true;
  } catch {
    return false;
  }
}
