// The words typed on the catch screen and not yet kept stay on this phone, per world: a share
// arriving into the open app, a call, or the app closed in the background does not lose them.
// Text only, not the photo. A share that reached a world's catch screen is part of that draft
// from then on: walked away from there, it comes back as "your note from before" in that world
// (and only there), which is what keeps a share safe from an app closed in the background.
const draftKey = (worldId: string) => `lantern-draft-${worldId}`;

export function readDraft(worldId: string): string {
  try {
    return localStorage.getItem(draftKey(worldId)) ?? '';
  } catch {
    return '';
  }
}

export function writeDraft(worldId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(draftKey(worldId), text);
    else localStorage.removeItem(draftKey(worldId));
  } catch {
    /* storage refused or full: the draft lives as long as the screen */
  }
}

/** A world that changes id (put online) takes its draft along. */
export function moveDraft(from: string, to: string): void {
  const d = readDraft(from);
  writeDraft(from, '');
  if (d && !readDraft(to)) writeDraft(to, d);
}
