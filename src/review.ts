// The review profile's proposed mark (schema-dist dist.52 `profiles/review.md`, Keel #565's reader
// rule, Skeld h29 #11116; Atlas 1.84.0's twin, conv. 168). An element whose `x_review_proposed` is an
// object was written as proposed (an AI seat's new element on a world whose keeper reviews them) and
// is not canon until a keeper settles it on onlyworlds.com: accept writes the mark null, decline
// deletes it.
//
// Lantern shows a world to its people, so a proposed element carries its word on a row and its page,
// and is never counted as what the world holds. Ask and the sort hand the world to keel's AI, so there
// a proposed element is left out, and Ask says how many.
//
// Two readings, on purpose. Shown as proposed: an object (the profile's point 4: any other value is
// ignored). Handed on as proposed: any value but null (Kael's pack: a doubt leaves it out).

export const PROPOSED_MARK = 'x_review_proposed';

export function isProposed(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const v = (el as Record<string, unknown>)[PROPOSED_MARK];
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function handsOnAsProposed(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const v = (el as Record<string, unknown>)[PROPOSED_MARK];
  return v !== undefined && v !== null;
}

/** Today as the profile writes a day, in UTC: keel reads a proposal lapsed from midnight UTC of its day. */
export function todayDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The word on a row and a page, or '' for a settled element. */
export function proposedWord(el: unknown, today = todayDay()): string {
  if (!isProposed(el)) return '';
  const exp = ((el as Record<string, unknown>)[PROPOSED_MARK] as Record<string, unknown>).expires;
  const lapsed = typeof exp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(exp) && exp <= today;
  return lapsed ? 'proposed, lapsed' : 'proposed';
}
