// Shared to Lantern (Android's share sheet, the manifest's share_target): the text arrives in the
// start URL's query, becomes one note, and waits for the catch screen of the world it goes to.
// Only a catch screen opened from the share screen (`?shared`) takes it: a share walked away from
// never fills a later note (the S395 gate). iPhone has no share target for web apps.

let pending: string | null = null;

/** Title, text and link as one note: a title the text begins with, or a link the text holds, is not repeated. */
export function composeShared(p: { title?: string | null; text?: string | null; url?: string | null }): string {
  const title = (p.title ?? '').trim();
  const text = (p.text ?? '').trim();
  const url = (p.url ?? '').trim();
  const parts: string[] = [];
  if (title && !text.toLowerCase().startsWith(title.toLowerCase())) parts.push(title);
  if (text) parts.push(text);
  if (url && !text.includes(url) && !title.includes(url)) parts.push(url);
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

/** The catch screen opened from the share screen takes the note, once. */
export function consumeShared(): string | null {
  const n = pending;
  pending = null;
  return n;
}
