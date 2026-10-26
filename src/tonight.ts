// Tonight's cast (the old Flutter app's key elements, without the game around them; Titus,
// 2026-10-13): a handful of a world's elements kept at the top of its home for a session.
// Per phone and per world, in the order kept, like a pinned world; it never travels and never
// changes the world.
const key = (worldId: string) => `lantern-tonight-${worldId}`;

export function tonight(worldId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(worldId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function keep(worldId: string, ids: string[]): boolean {
  try {
    if (ids.length) localStorage.setItem(key(worldId), JSON.stringify(ids));
    else localStorage.removeItem(key(worldId));
    return true;
  } catch {
    return false;
  }
}

/** Kept, or let go. Returns whether the phone kept the change. */
export function toggleTonight(worldId: string, id: string): boolean {
  const now = tonight(worldId);
  return keep(worldId, now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
}

export function clearTonight(worldId: string): void {
  keep(worldId, []);
}
