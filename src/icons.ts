// Our own icons (constant SVG, the one innerHTML in the app). currentColor throughout.
const PATHS: Record<string, string> = {
  // A world, for the World tab: the tab lands on the world's own screen (Seethe h37 #3743).
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.4 3.9 5.4 3.9 9s-1.3 6.6-3.9 9c-2.6-2.4-3.9-5.4-3.9-9s1.3-6.6 3.9-9z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera:
    '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 9v6M9 12h6"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3-1-6z"/><path d="M12 13v7"/>',
  // Seethe's two marks (h37 #3716, the Captain's yes #3717): a card handed out, a tray of notes to sort.
  reveal: '<rect x="3" y="5" width="10" height="13" rx="1.5"/><path d="M7 9.5h2.5M7 13h3.5"/><path d="M15 11h6M18 8l3 3-3 3"/>',
  unsorted: '<path d="M4 13l2.5-8h11L20 13"/><path d="M4 13v5h16v-5"/><path d="M4 13h4l1.5 2.5h5L16 13h4"/>',
  install: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 22, stroke = 1.8): SVGSVGElement {
  const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wrap.setAttribute('width', String(size));
  wrap.setAttribute('height', String(size));
  wrap.setAttribute('viewBox', '0 0 24 24');
  wrap.setAttribute('fill', 'none');
  wrap.setAttribute('stroke', 'currentColor');
  wrap.setAttribute('stroke-width', String(stroke));
  wrap.setAttribute('stroke-linecap', 'round');
  wrap.setAttribute('stroke-linejoin', 'round');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = PATHS[name] ?? '';
  return wrap;
}
