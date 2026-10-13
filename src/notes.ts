// A player's own notes (the Captain h37 #4113, option B): a guest's key only reads, so what a
// player jots down at the table stays on their phone, per world, and is never sent. Letting a guest
// write into the world (option A) would be keel's rule to change, kept for later.
const key = (worldId: string) => `lantern-notes-${worldId}`;

export interface Note {
  id: string;
  text: string;
  at: string;
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

export function removeNote(worldId: string, id: string): void {
  keep(worldId, notes(worldId).filter((n) => n.id !== id));
}
