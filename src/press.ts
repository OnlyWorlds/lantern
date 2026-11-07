/**
 * A press in flight: a redraw that would replace what a finger is on waits until the press has
 * become its click (or ended without one), then runs once.
 *
 * A screen rebuilt between pointerdown and click loses the tap: the pressed node is gone, so no
 * click lands, and Chromium drops it even when the same node is put back in place. Late answers
 * (the account's worlds, an element's trail, a pull, the poll) redraw at any moment, so every
 * redraw driven by data rather than by the person waits here.
 */

let pressing = false;
let fallback = 0;
let cap = 0;
const waiters = new Set<() => void>();
let installed = false;

/** The longest a redraw waits on one press, timed from the pointerdown: a lost pointerup must not hold the screen still. */
const MAX_HOLD_MS = 5000;

function release(): void {
  if (!pressing) return;
  pressing = false;
  clearTimeout(fallback);
  clearTimeout(cap);
  const ws = [...waiters];
  waiters.clear();
  for (const w of ws) w();
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener(
    'pointerdown',
    () => {
      pressing = true;
      clearTimeout(fallback);
      capHold();
    },
    true,
  );
  // A press that never becomes a click (dragged off, released outside): free once the finger is up
  // and a moment has passed.
  window.addEventListener(
    'pointerup',
    () => {
      clearTimeout(fallback);
      fallback = window.setTimeout(release, 300);
    },
    true,
  );
  // The click's own handlers and its default (a link's navigation) run first: free on the next turn.
  window.addEventListener('click', () => { if (pressing) setTimeout(release, 0); }, true);
  // A touch that becomes a scroll ends in pointercancel, with no pointerup and no click; a press that
  // becomes a drag (a link dragged with a mouse) can end with neither, so a drag frees it too.
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('dragstart', release, true);
}

/** True while a press is down or has not yet become its click. */
export function pressHeld(): boolean {
  install();
  return pressing;
}

function capHold(): void {
  clearTimeout(cap);
  cap = window.setTimeout(release, MAX_HOLD_MS);
}

/** Run `fn` now when no press is in flight, else once the press has landed. */
export function afterPress(fn: () => void): void {
  if (!pressHeld()) {
    fn();
    return;
  }
  waiters.add(fn);
}

/** Resolves now when no press is in flight, else once the press has landed. */
export function pressSettled(): Promise<void> {
  return new Promise((res) => afterPress(res));
}

/** Install the listeners at start, so the first press after load is seen. */
export function watchPresses(): void {
  install();
}
