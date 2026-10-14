// Which calendar a world's dates are in, on this phone (Kael h37 #4287: with several, the phone
// shows a choice). Atlas's meaning: never chosen (undefined) uses the world's only calendar; a
// calendar's id uses that one; 'none' (Atlas's null) is the numbers. Per phone and per world, like
// Atlas's own choice, which it keeps in its registry and never in the world.
const key = (worldId: string) => `lantern-calendar-${worldId}`;

export function chosenCalendar(worldId: string): string | null | undefined {
  try {
    const v = localStorage.getItem(key(worldId));
    return v === null ? undefined : v === 'none' ? null : v;
  } catch {
    return undefined;
  }
}

export function chooseCalendar(worldId: string, id: string | null): void {
  try {
    localStorage.setItem(key(worldId), id ?? 'none');
  } catch {
    /* storage refused: the choice is asked again next time */
  }
}
