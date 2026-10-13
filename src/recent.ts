// Recent on a world's home (the after-v1 note's pocket road; the Captain h37 #4087): the elements
// last opened on this phone, newest first. Per phone and per world, like tonight's cast; it never
// travels and never changes the world.
const key = (worldId: string) => `lantern-recent-${worldId}`;
const KEEP = 12;

export function recent(worldId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(worldId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** An element's page opened: it moves to the front. */
export function noteOpened(worldId: string, id: string): void {
  try {
    localStorage.setItem(key(worldId), JSON.stringify([id, ...recent(worldId).filter((x) => x !== id)].slice(0, KEEP)));
  } catch {
    /* storage refused: Recent stays as it was */
  }
}
