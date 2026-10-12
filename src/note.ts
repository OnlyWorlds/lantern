// A caught note's words, made into an element's: pure, so the rule is tested where it lives.

/** The note's first line, cut at 60 characters. */
export function firstLine(text: string): string {
  const first = text.trim().split(/\n/)[0]?.trim() ?? '';
  const cps = [...first];
  return cps.length > 60 ? cps.slice(0, 57).join('').trimEnd() + '…' : first;
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
