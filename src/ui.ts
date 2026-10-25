// Pieces every screen shares: a type chip, an element row, a sheet, a toast.
import type { OwElement } from '@onlyworlds/sdk';
import { h } from './dom';
import { icon } from './icons';
import { supertypeWord, typeAbbr, typeColor, typeName } from './schema';
import { isKnownOf } from './knownof';
import { proposedWord } from './review';
import { hiddenWord, markWords } from './hidden';

/** replace: the screen we leave (a form just submitted) drops out of Back's history. */
export function go(hash: string, replace = false): void {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else if (replace) location.replace(hash);
  else location.hash = hash;
}

export function typeChip(type: string): HTMLElement {
  return h('span', { class: 'type-chip', style: `--type:${typeColor(type)}`, 'aria-hidden': 'true' }, typeAbbr(type));
}

export function elName(el: OwElement | undefined): string {
  return el?.name?.trim() || 'Unnamed';
}

export function elRow(worldId: string, el: OwElement, extra?: string): HTMLElement {
  // A caught note reads as one in every list, as on its own page (Quillon, h37 #4275).
  const note = el.type === 'narrative' && el.supertype === 'Unsorted';
  // keel's stub says so before the tap: a player knows of it, not its details.
  // A proposed element says so too (src/review.ts, Keel #565's reader rule), and a hidden one
  // (src/hidden.ts, folder spec §4.8).
  const hint = [...(note ? ['unsorted note'] : [typeName(el.type, { supertype: el.supertype }), supertypeWord(el.type, el.supertype) ? '' : el.supertype]), isKnownOf(el) ? 'known of' : '', proposedWord(el), hiddenWord(el), extra].filter(Boolean).join(' · ');
  return h(
    'a',
    { class: 'el-row', href: `#/w/${worldId}/e/${el.id}` },
    typeChip(el.type),
    h('span', { class: 'label' }, h('b', null, elName(el)), ' ', h('span', { class: 'muted' }, `· ${hint}`)),
  );
}

/** A link chip's tail for a proposed or hidden element ('· hidden'), in the chip's own ink; null for any other. */
export function chipMark(el: unknown): HTMLElement | null {
  const w = markWords(el);
  return w.length ? h('span', { class: 'chip-mark', 'data-role': 'chip-mark' }, `· ${w.join(' · ')}`) : null;
}

export function topbar(title: string | Node, backHref?: string, ...actions: Node[]): HTMLElement {
  return h(
    'div',
    { class: 'topbar' },
    backHref
      ? h('a', { class: 'btn btn-round', href: backHref, 'aria-label': 'Back', style: 'border:0;background:transparent' }, icon('back', 24))
      : null,
    typeof title === 'string' ? h('h1', { style: 'flex-grow:1;min-width:0' }, title) : title,
    actions.length ? h('div', { class: 'actions' }, ...actions) : null,
  );
}

/**
 * The world's places, on every screen inside it: its home (find, the types), Catch (a world you can
 * write) and Ask. World is the way home from anywhere: mobile apps keep a tab bar, not breadcrumbs
 * (the Captain's walk, 2026-10-12). `on` is null on a screen that is none of the three (an element).
 */
export function tabbar(s: { id: string; canWrite: boolean; takesNotes?: boolean }, on: 'world' | 'catch' | 'ask' | null): HTMLElement {
  const tab = (id: 'world' | 'catch' | 'ask', label: string, href: string, ic: string) =>
    h(
      'a',
      {
        href,
        class: [id === 'catch' ? 'catch' : '', on === id ? 'on' : ''].filter(Boolean).join(' ') || null,
        // Lit where you are; "current page" only while the tab still points here (World on the home points up).
        'aria-current': on === id && !(id === 'world' && href === '#/worlds') ? 'page' : null,
        'data-tab': id,
      },
      id === 'catch' ? h('span', { class: 'catch-dot' }, icon(ic, 26, 2.2)) : icon(ic, 22),
      label,
    );
  return h(
    'nav',
    { class: 'tabbar', 'aria-label': 'World' },
    // On the world's own home, World goes up a level to Your worlds, and says so (the Captain, #3675).
    on === 'world' ? tab('world', 'Worlds', '#/worlds', 'world') : tab('world', 'World', `#/w/${s.id}`, 'world'),
    // A player's key only reads: their Catch is a note kept on this phone (src/notes.ts).
    s.canWrite ? tab('catch', 'Catch', `#/w/${s.id}/capture`, 'unsorted') : s.takesNotes ? tab('catch', 'Note', `#/w/${s.id}/notes`, 'edit') : null,
    tab('ask', 'Ask', `#/w/${s.id}/ask`, 'spark'),
  );
}

let toastTimer: number | undefined;
/** A line said for a moment; `ms` longer for one that asks the person to do something. */
export function toast(text: string, ms = 2600): void {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), ms);
}

/**
 * A bottom sheet. Returns a close function; closes on the backdrop and on navigation. One at a
 * time: a second tap on what opened it opens nothing (stacked sheets wrote twice, the S396 gate).
 */
/**
 * `hold(true)` keeps a backdrop tap from closing the sheet while its work is in flight (Invite while
 * keel makes the link: closed then, the link it made was shown to no one; S414's left gap, S477).
 */
export function sheet(build: (close: () => void, hold: (on: boolean) => void) => Node[], label: string): () => void {
  if (document.querySelector('.backdrop')) return () => undefined;
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const back = h('div', { class: 'backdrop' }, panel);
  // The keyboard covered Save (the Captain's phone, h43 #4293). Chrome on Android shrinks the page for
  // it (`interactive-widget` in index.html); Safari shrinks only the visible part, so the backdrop
  // follows that part, and the sheet's bottom, Save with it, sits above the keyboard.
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    back.style.top = `${vv.offsetTop}px`;
    back.style.height = `${vv.height}px`;
    back.style.bottom = 'auto';
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  const close = () => {
    back.remove();
    window.removeEventListener('hashchange', close);
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
  };
  let held = false;
  back.addEventListener('click', (e) => {
    if (e.target === back && !held) close();
  });
  window.addEventListener('hashchange', close);
  for (const n of build(close, (on) => (held = on))) panel.appendChild(n);
  document.body.appendChild(back);
  fit();
  const first = panel.querySelector<HTMLElement>('input, textarea');
  first?.focus();
  return close;
}

/**
 * A screen's main button kept in sight while its text box is typed in (the Captain's smoke, h37
 * #4359: on Catch the keyboard hid it). While the box has focus the button sits at the bottom of what
 * is visible: above the keyboard where Chrome shrinks the page, and where Safari shrinks only the
 * visible part, as far up as that part ends. It goes back into the page 350 ms after the box lets go,
 * as the tab bar returns: the tap that takes the focus away is aimed at the button where it was.
 */
export function pinWhileTyping(btn: HTMLElement, field: HTMLElement): void {
  const vv = window.visualViewport;
  let unpin: ReturnType<typeof setTimeout> | undefined;
  const place = () => {
    const below = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    btn.style.setProperty('--below', `${Math.round(below)}px`);
  };
  field.addEventListener('focus', () => {
    clearTimeout(unpin);
    place();
    btn.classList.add('pinned');
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
  });
  field.addEventListener('blur', () => {
    unpin = setTimeout(() => {
      btn.classList.remove('pinned');
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    }, 350);
  });
}

export function errorText(e: unknown): string {
  if (e instanceof Error) {
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(e.message)) return 'No connection. Try again when you have signal.';
    return e.message;
  }
  return String(e);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
