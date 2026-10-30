/**
 * The OnlyWorlds mark beside a name (the SDK's Waymark, #755): a slot of its own beside the name,
 * never inside a press target (the home's name goes to Your worlds, the element's opens its rename
 * sheet). Whether it shows and what it is given is `waymarkFor`'s; this file mounts and disposes it,
 * and says when an open fan-out has settled, so the view's refresh held while it was open (or its
 * "Link copied" toast showed) runs once, after the tap that closed it has landed.
 */

import { mountWaymark } from '@onlyworlds/sdk/waymark';
import { LANTERN_CLIENT_NAME } from '../world';
import type { WaymarkPlan } from '../waymark-for';

export interface WaymarkSlot {
  readonly el: HTMLElement;
  dispose(): void;
}

/** The event a slot sends up the page once its fan-out has settled: a held refresh may run. */
export const WAYMARK_SETTLED = 'lantern-waymark-settled';

const OPEN = '.ow-waymark__mark[aria-expanded="true"], .ow-waymark__toast:not([hidden])';

/** A fan-out is open, or its toast shows, somewhere under `root`: a refresh there waits for it. */
export function waymarkOpenIn(root: ParentNode): boolean {
  return !!root.querySelector(OPEN);
}

/** The slot's name (`world` or `element`) when focus is on its mark or in its fan-out, else null. */
export function waymarkFocusIn(root: ParentNode): string | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !root.contains(a)) return null;
  return a.closest<HTMLElement>('.lantern-waymark')?.getAttribute('data-mark') ?? null;
}

/** Focus the named slot's mark under `root`, when it drew one, leaving the page where the person scrolled it. */
export function focusWaymark(root: ParentNode, which: string): void {
  root.querySelector<HTMLElement>(`.lantern-waymark[data-mark="${which}"] .ow-waymark__mark`)?.focus({ preventScroll: true });
}

const coarse = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Once per world and element per session: a mount the component refused is said in the console, not on the page. */
const refusedSaid = new Set<string>();

/** A slot for the world's mark (`which` `world`) or an element's; empty when `plan` is null. */
export function waymarkSlot(plan: WaymarkPlan | null, which: 'world' | 'element'): WaymarkSlot {
  const slot = document.createElement('span');
  slot.className = 'lantern-waymark';
  slot.setAttribute('data-mark', which);
  let unmount: (() => void) | null = null;
  let gone = false;

  if (plan) {
    try {
      unmount = mountWaymark(slot, {
        world: plan.world,
        element: plan.element,
        reader: plan.reader,
        tool: LANTERN_CLIENT_NAME,
        signedIn: null,
        phone: coarse(),
        ground: 'dark',
        entry: 'mark',
      });
    } catch (err) {
      const k = `${plan.world.id}/${plan.element?.id ?? ''}`;
      if (!refusedSaid.has(k)) {
        refusedSaid.add(k);
        console.warn('[lantern:waymark] no mark beside this name', err);
      }
    }
  }

  const tell = (): void => {
    if (!gone) slot.dispatchEvent(new CustomEvent(WAYMARK_SETTLED, { bubbles: true }));
  };

  // A tap that closes the fan-out from outside it: its click must land before the page rebuilds
  // under it. (A tap on a row inside has already landed when it closes: its click clears the press.)
  let pressing = false;
  let pointerIsDown = false;
  const onDown = (): void => { pressing = true; pointerIsDown = true; };
  const onUp = (): void => { pointerIsDown = false; };
  const onClick = (): void => { pressing = false; };
  // A touch that becomes a scroll ends in pointercancel, with no pointerup and no click.
  const onCancel = (): void => { pressing = false; pointerIsDown = false; };
  let waiting: (() => void) | null = null;
  let scheduled = false;

  const run = (): void => {
    scheduled = false;
    waiting = null;
    tell();
  };

  const settle = (): void => {
    if (gone || waiting || scheduled || waymarkOpenIn(slot)) return;
    if (!pressing) { scheduled = true; setTimeout(run, 0); return; }
    pressing = false;
    let done = false;
    let guard = 0;
    const once = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener('click', once, true);
      window.removeEventListener('pointercancel', once, true);
      clearTimeout(guard);
      scheduled = true;
      waiting = null;
      setTimeout(run, 0);
    };
    window.addEventListener('click', once, true);
    window.addEventListener('pointercancel', once, true);
    // A press that never becomes a click (a drag off, a lost pointer): run once the pointer is up
    // and a moment has passed, however long the press is held.
    const check = (): void => { if (pointerIsDown) guard = window.setTimeout(check, 250); else once(); };
    guard = window.setTimeout(check, 1000);
    waiting = once;
  };

  // The fan-out's state is the mark's aria-expanded and the toast's hidden: watch both.
  const watch = new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target as HTMLElement;
      if (t.classList.contains('ow-waymark__mark') && r.attributeName === 'aria-expanded') {
        if (t.getAttribute('aria-expanded') === 'true') {
          pressing = false;
          window.addEventListener('pointerdown', onDown, true);
          window.addEventListener('pointerup', onUp, true);
          window.addEventListener('click', onClick, true);
          window.addEventListener('pointercancel', onCancel, true);
        } else settle();
      } else if (t.classList.contains('ow-waymark__toast') && r.attributeName === 'hidden' && t.hidden) {
        settle();
      }
    }
  });
  watch.observe(slot, { subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'hidden'] });

  return {
    el: slot,
    dispose(): void {
      if (gone) return;
      gone = true;
      watch.disconnect();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('pointercancel', onCancel, true);
      waiting?.();
      unmount?.();
      unmount = null;
    },
  };
}
