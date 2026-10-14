// A caught note's words, made into an element's: pure, so the rule is tested where it lives.

/** The note's first line, cut at 60 characters, at a word where there is one (Quillon's walk: "lighthouse kee…"). */
export function firstLine(text: string): string {
  const first = text.trim().split(/\n/)[0]?.trim() ?? '';
  const cps = [...first];
  if (cps.length <= 60) return first;
  const cut = cps.slice(0, 57).join('');
  const space = cut.lastIndexOf(' ');
  return (space >= 20 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

/** An Unsorted note's name: its first line, or what it is and the day. */
export function titleFrom(text: string, hasPhoto: boolean, now = new Date()): string {
  const first = firstLine(text);
  if (first) return first;
  const when = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return hasPhoto ? `A page, ${when}` : `A note, ${when}`;
}

/**
 * An element made from a note: the first line its name, the rest its description. A first line
 * cut short keeps the whole note as the description, so no word is lost.
 */
export function elementFromNote(text: string): { name: string; description?: string } {
  const body = text.trim();
  const name = firstLine(body);
  const firstRaw = body.split(/\n/)[0]?.trim() ?? '';
  const rest = name === firstRaw ? body.slice(body.indexOf(firstRaw) + firstRaw.length).trim() : body;
  return rest ? { name, description: rest } : { name };
}

/** A picture an element made from a note can take as it is: online, or held in a world on this phone. */
const TAKEN_PICTURE = /^(https:|data:image\/)/;

/**
 * The values an element made by hand from an Unsorted note starts with (src/views/makeit.ts): its
 * words as a typed catch takes them (the description holds the whole note), and its picture.
 */
export function valuesFromNote(note: { name?: unknown; description?: unknown; image_url?: unknown }): Record<string, unknown> {
  const text = typeof note.description === 'string' && note.description.trim() ? note.description : String(note.name ?? '');
  const values: Record<string, unknown> = { ...elementFromNote(text) };
  if (typeof note.image_url === 'string' && TAKEN_PICTURE.test(note.image_url)) values.image_url = note.image_url;
  return values;
}
