// Pieces every screen shares: a type chip, an element row, a sheet, a toast.
import type { OwElement } from '@onlyworlds/sdk';
import { h } from './dom';
import { icon } from './icons';
import { typeAbbr, typeColor, typeLabel } from './schema';

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
  const hint = [typeLabel(el.type).toLowerCase(), el.supertype, extra].filter(Boolean).join(' · ');
  return h(
    'a',
    { class: 'el-row', href: `#/w/${worldId}/e/${el.id}` },
    typeChip(el.type),
    h('span', { class: 'label' }, h('b', null, elName(el)), ' ', h('span', { class: 'muted' }, `· ${hint}`)),
  );
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

/** The world's two places: its home (find, the types) and Ask. */
export function tabbar(worldId: string, on: 'world' | 'ask'): HTMLElement {
  const tab = (id: 'world' | 'ask', label: string, href: string, ic: string) =>
    h('a', { href, class: on === id ? 'on' : null, 'aria-current': on === id ? 'page' : null }, icon(ic, 22), label);
  return h(
    'nav',
    { class: 'tabbar', 'aria-label': 'World' },
    tab('world', 'World', `#/w/${worldId}`, 'search'),
    tab('ask', 'Ask', `#/w/${worldId}/ask`, 'spark'),
  );
}

let toastTimer: number | undefined;
export function toast(text: string): void {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2600);
}

/** A bottom sheet. Returns a close function; closes on the backdrop and on navigation. */
export function sheet(build: (close: () => void) => Node[], label: string): () => void {
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const back = h('div', { class: 'backdrop' }, panel);
  const close = () => {
    back.remove();
    window.removeEventListener('hashchange', close);
  };
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  window.addEventListener('hashchange', close);
  for (const n of build(close)) panel.appendChild(n);
  document.body.appendChild(back);
  const first = panel.querySelector<HTMLElement>('input, textarea');
  first?.focus();
  return close;
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
