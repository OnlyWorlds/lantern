// Give it to the party: the game master's one tap that shows the players a thing they found.
// The reveal is a Narrative of its own (Skeld's ruling, h37 #3432): it carries the thing's picture
// and the game master's line, and the party's Collective in `collectives`, so every Character in
// that Collective knows it (the Who-knows convention, keel D95). The thing itself stays hidden:
// the Narrative links it for the game master, and keel strips that link for a player.
import { FIELD_SCHEMA, type OwElement } from '@onlyworlds/sdk';

/**
 * Not given this way: map furniture; a Narrative (told by adding the party to it); a Collective,
 * since a Narrative's `collectives` are who knows it, so linking one there would tell it, not show it.
 */
const NOT_GIVEN = new Set(['narrative', 'collective', 'pin', 'marker', 'zone']);

export function canGive(type: string): boolean {
  return !NOT_GIVEN.has(type) && !!narrativeFieldFor(type);
}

/** The Narrative's link field for a type (objects for an Object), read from the schema. */
export function narrativeFieldFor(type: string): string | undefined {
  const fields = FIELD_SCHEMA.narrative as Record<string, { type: string; target?: string }>;
  return Object.entries(fields).find(([, f]) => f.type === 'multi_link' && f.target === type)?.[0];
}

const isParty = (e: OwElement) => /^part(y|ies)$/i.test((e.supertype ?? '').trim());

/** The world's Collectives to choose from: those with supertype Party first, then by name. */
export function partyChoices(elements: Iterable<OwElement>): OwElement[] {
  const cs = [...elements].filter((e) => e.type === 'collective');
  return cs.sort((a, b) => Number(isParty(b)) - Number(isParty(a)) || (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' }));
}

/** How many Characters are in the party: none means no player sees a reveal. */
export function partySize(party: OwElement | undefined): number {
  const cs = party?.characters;
  return Array.isArray(cs) ? cs.length : 0;
}

/** The reveal's values: its own name, line and picture, told to the party, linked to the thing. */
export function revealValues(thing: OwElement, partyId: string, name: string, line: string): Record<string, unknown> {
  // Never the thing's own name as a fallback: that is the game master's to give, in the sheet.
  const values: Record<string, unknown> = { name: name.trim() || 'Something found', collectives: [partyId] };
  if (line.trim()) values.description = line.trim();
  if (typeof thing.image_url === 'string' && /^(https:|data:image\/)/.test(thing.image_url)) values.image_url = thing.image_url;
  const field = narrativeFieldFor(thing.type);
  if (field && canGive(thing.type)) values[field] = [thing.id];
  return values;
}
