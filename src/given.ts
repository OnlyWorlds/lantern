// Given tonight (Titus, 2026-10-13): the reveals this phone gave the party, so the game master
// sees the night's handouts in one place, and the morning after has them at hand. A reveal is an
// ordinary Narrative with nothing marking it (Skeld's ruling, 2026-10-11), so the phone that gave it
// keeps the list: per phone and per world, never sent, nothing added to the world.
const key = (worldId: string) => `lantern-given-${worldId}`;
const KEEP = 60;
/** "Tonight" is the last day: a session that ran past midnight, and the morning after, still see it. */
export const TONIGHT_MS = 24 * 60 * 60 * 1000;

export interface Given {
  id: string;
  at: string;
}

export function given(worldId: string): Given[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(worldId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is Given => !!x && typeof x.id === 'string' && typeof x.at === 'string') : [];
  } catch {
    return [];
  }
}

export function noteGiven(worldId: string, id: string, now = new Date()): void {
  try {
    localStorage.setItem(key(worldId), JSON.stringify([{ id, at: now.toISOString() }, ...given(worldId).filter((g) => g.id !== id)].slice(0, KEEP)));
  } catch {
    /* storage refused: the reveal is given all the same, only not listed */
  }
}

/** Given within the last day, newest first. */
export function givenTonight(worldId: string, now = Date.now()): Given[] {
  return given(worldId).filter((g) => now - Date.parse(g.at) < TONIGHT_MS);
}
