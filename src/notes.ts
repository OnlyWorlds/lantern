// A player's own notes (Titus, 2026-10-13): what a player jots down at the table stays
// on their phone, per world. Since keel #241 one can be shared with the party (Titus,
// 2026-10-14): it goes to the world as a Narrative, and the note here keeps where it went.
const key = (worldId: string) => `lantern-notes-${worldId}`;

export interface Note {
  id: string;
  text: string;
  at: string;
  /** Shared with the party: the Narrative made from it, the Collective's name then, and when. */
  shared?: { id: string; to: string; at: string };
}

export function notes(worldId: string): Note[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(worldId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is Note => !!x && typeof x.id === 'string' && typeof x.text === 'string' && typeof x.at === 'string') : [];
  } catch {
    return [];
  }
}

function keep(worldId: string, list: Note[]): boolean {
  try {
    if (list.length) localStorage.setItem(key(worldId), JSON.stringify(list));
    else localStorage.removeItem(key(worldId));
    return true;
  } catch {
    return false;
  }
}

/** Newest first. Returns whether the phone kept it. */
export function addNote(worldId: string, text: string, now = new Date()): boolean {
  const t = text.trim();
  if (!t) return true;
  return keep(worldId, [{ id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, text: t, at: now.toISOString() }, ...notes(worldId)]);
}

/** The note as shared with the party. Returns whether the phone kept it. */
export function markShared(worldId: string, id: string, narrativeId: string, to: string, now = new Date()): boolean {
  return keep(worldId, notes(worldId).map((n) => (n.id === id ? { ...n, shared: { id: narrativeId, to, at: now.toISOString() } } : n)));
}

/** The note as not shared again (its share never reached the outbox). */
export function unmarkShared(worldId: string, id: string): void {
  keep(worldId, notes(worldId).map((n) => (n.id === id ? { id: n.id, text: n.text, at: n.at } : n)));
}

/** Every note of a world: they belong to whoever held its key. */
export function clearNotes(worldId: string): void {
  keep(worldId, []);
}

export function removeNote(worldId: string, id: string): void {
  keep(worldId, notes(worldId).filter((n) => n.id !== id));
}
