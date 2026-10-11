// Shared to Lantern (Android's share sheet, the manifest's share_target): the text arrives in the
// start URL's query, becomes one note, and waits for the catch screen of the world it goes to.
// iPhone has no share target for web apps; there the catch screen is the way in.

let pending: string | null = null;

/** Title, text and link as one note: each once (apps often repeat the link inside the text). */
export function composeShared(p: { title?: string | null; text?: string | null; url?: string | null }): string {
  let parts: string[] = [];
  for (const v of [p.title, p.text, p.url]) {
    const t = (v ?? '').trim();
    if (!t || parts.some((x) => x.includes(t))) continue;
    // A part this one repeats (a title the text begins with) gives way to it.
    parts = parts.filter((x) => !t.includes(x));
    parts.push(t);
  }
  return parts.join('\n');
}

/** At start: take a share out of the address (so a reload does not catch it twice). True if there was one. */
export function takeShared(): boolean {
  const q = new URLSearchParams(location.search);
  // A GET share target replaces the start URL's query with these three, so they are the sign.
  if (!q.has('title') && !q.has('text') && !q.has('url')) return false;
  const note = composeShared({ title: q.get('title'), text: q.get('text'), url: q.get('url') });
  history.replaceState(null, '', '/' + location.hash);
  if (!note) return false;
  pending = note;
  return true;
}

export function hasShared(): boolean {
  return pending !== null;
}

/** The catch screen takes the note once. */
export function consumeShared(): string | null {
  const n = pending;
  pending = null;
  return n;
}
