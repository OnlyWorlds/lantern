/**
 * A press in flight: a redraw that would replace what a finger is on waits until the press has
 * become its click (or ended without one), then runs once.
 *
 * A screen rebuilt between pointerdown and click loses the tap: the pressed node is gone, so no
 * click lands, and Chromium drops it even when the same node is put back in place; on a touch
 * screen whose rows moved, the lift lands on whatever moved under it. Late answers (the account's
 * worlds, an element's trail, a pull, the poll) redraw at any moment, so every redraw driven by
 * data rather than by the person waits here. (The same module runs in the OnlyWorlds dashboard,
 * parlor and Little Lens, and in Tactical Tangle.)
 */

let pressing = false;
let fallback = 0;
let cap = 0;
const waiters = new Set<() => void>();
let installed = false;

/** The longest a redraw waits on one press, timed from the pointerdown: a lost pointerup must not hold the screen still. */
const MAX_HOLD_MS = 5000;

function runWaiters(): void {
  if (pressing) return; // a new press began before the turn came: its own release runs them
  const ws = [...waiters];
  waiters.clear();
  // One waiter that throws never keeps the others from running.
  for (const w of ws) {
    try { w(); } catch (err) { setTimeout(() => { throw err; }, 0); }
  }
}

function release(): void {
  if (!pressing) return;
  pressing = false;
  clearTimeout(fallback);
  clearTimeout(cap);
  runWaiters();
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
  // The click has landed: a redraw its own handlers ask for runs at once, as it always did; the
  // redraws held during the press run on the next turn, after the handlers and the click's default
  // (a link removed before its default runs no longer navigates).
  // Only a person's click: a script's `a.click()` (a download's link landing) during another press
  // must not end that press's hold.
  window.addEventListener('click', (e) => {
    if (!pressing || !e.isTrusted) return;
    pressing = false;
    clearTimeout(fallback);
    clearTimeout(cap);
    setTimeout(runWaiters, 0);
  }, true);
  // A touch that becomes a scroll ends in pointercancel, with no pointerup and no click; a press that
  // becomes a drag (a link dragged with a mouse) can end with neither, so a drag frees it too.
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('dragstart', release, true);
  // Space on a button clicks on its keyup: a redraw between the two would leave no click at all.
  // (Enter clicks on its keydown, before anything can redraw.)
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== ' ' || e.repeat) return;
      const t = e.target;
      if (!(t instanceof Element) || !t.closest('button, [role="button"], input[type="checkbox"], input[type="radio"]')) return;
      pressing = true;
      clearTimeout(fallback);
      capHold();
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.key !== ' ' || !pressing) return;
      clearTimeout(fallback);
      fallback = window.setTimeout(release, 300);
    },
    true,
  );
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
