// A map, read only: the Map's picture with its pins and zones over it, entered from "Show on map".
// Quillon's measured rules (2026-10-12): Leaflet CRS.Simple,
// one image overlay, pins and zones on the SVG renderer, clusters above a thousand pins, the zoom
// stopped where the picture runs out. Leaflet loads only when a map opens.
import type * as Leaflet from 'leaflet';
import type { OwElement } from '@onlyworlds/sdk';
import { h } from '../dom';
import { icon } from '../icons';
import { CLUSTER_ABOVE, mapPicture, maxZoomFor, pinsToLabel, placeLabels, zoneAt, zoneColor, zonePoints, zoneShape, type Place } from '../maps';
import { typeColor, typeName } from '../schema';
import { elName, typeChip } from '../ui';
import { markWords } from '../hidden';
import type { WorldSession } from '../world';
import { notFound, type View } from './world';

type L = typeof Leaflet;
/** What a drawing found to look at: the shown pin or marker, or the shown zone's bounds. */
type Drawn = { focus: OwElement | undefined; focusZone: Leaflet.LatLngBounds | null };

/** A theme colour for drawing (Leaflet paints SVG attributes, not CSS). */
function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
let leaflet: Promise<L> | null = null;

async function loadLeaflet(): Promise<L> {
  leaflet ??= (async () => {
    const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
    // The module object itself (not a namespace copy): the cluster plugin adds to it.
    return ((mod as unknown as { default?: L }).default ?? mod) as L;
  })();
  // A failed load is not kept: the next map tries again (a chunk can fail before the worker is in).
  leaflet.catch(() => (leaflet = null));
  return leaflet;
}

class PictureError extends Error {}

async function loadCluster(L: L): Promise<void> {
  // leaflet.markercluster is a plugin of the global L.
  (window as unknown as { L: L }).L = L;
  await Promise.all([
    import('leaflet.markercluster'),
    import('leaflet.markercluster/dist/MarkerCluster.css'),
    import('leaflet.markercluster/dist/MarkerCluster.Default.css'),
  ]);
}

/** A pin's name: its own, else the name of what it places. */
function pinName(s: WorldSession, pin: OwElement): string {
  if (pin.name?.trim()) return pin.name.trim();
  const placed = typeof pin.element_id === 'string' ? s.get(pin.element_id) : undefined;
  return placed ? elName(placed) : 'Unnamed pin';
}

/** A pin name's line box, in px (`.map-label` sets the same line-height). */
const LABEL_LINE = 16;
let measurer: CanvasRenderingContext2D | null = null;

/** A name's width as the label draws it: measured in its own font, so capitals and CJK are not guessed. */
function labelWidth(name: string): number {
  if (!measurer) {
    measurer = document.createElement('canvas').getContext('2d');
    const root = getComputedStyle(document.documentElement);
    const px = parseFloat(root.fontSize) * 0.72;
    if (measurer) measurer.font = `700 ${px}px ${root.getPropertyValue('--lan-font-body') || 'sans-serif'}`;
  }
  // A little over, for the halo and a font still loading.
  return Math.ceil((measurer?.measureText(name).width ?? [...name].length * 13) * 1.04) + 2;
}

/** The name drawn beside a pin: its own, or what it places; none for an unnamed pin. Read as it is now. */
function pinLabel(s: WorldSession, drawn: OwElement): string | null {
  const pin = s.get(drawn.id) ?? drawn;
  if (pin.name?.trim()) return pin.name.trim();
  const placed = typeof pin.element_id === 'string' ? s.get(pin.element_id) : undefined;
  return placed?.name?.trim() || null;
}

function pinType(s: WorldSession, pin: OwElement): string {
  const placed = typeof pin.element_id === 'string' ? s.get(pin.element_id) : undefined;
  return placed?.type ?? (typeof pin.element_type === 'string' ? pin.element_type : 'pin');
}

function pictureSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new PictureError('picture'));
    img.src = src;
  });
}

export function mapView(s: WorldSession, place: Place): View {
  const mapEl = s.get(place.map);
  const src = mapPicture(mapEl);
  if (!mapEl || !src) return { el: notFound('This map has no picture online, so Lantern cannot show it.', `#/w/${s.id}`) };

  const box = h('div', { class: 'map-box', role: 'region', 'aria-label': `The map ${elName(mapEl)}` });
  const card = h('div', { class: 'map-card', hidden: true });
  const note = h('p', { class: 'map-note', role: 'status' }, 'Opening the map…');
  const back = h('a', { class: 'btn btn-round map-back', href: `#/w/${s.id}/e/${mapEl.id}`, 'aria-label': 'Back' }, icon('back', 24));
  back.addEventListener('click', (e) => {
    if (history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });
  const title = h('a', { class: 'map-title', href: `#/w/${s.id}/e/${mapEl.id}` }, elName(mapEl));
  const el = h('main', { class: 'map-screen', 'data-screen': 'map' }, box, h('div', { class: 'map-top' }, back, title), note, card);

  let map: Leaflet.Map | null = null;
  let layers: Leaflet.LayerGroup | null = null;
  let drawnKey = '';
  let destroyed = false;
  let pins: OwElement[] = [];
  let L: L | null = null;
  let labels: Leaflet.LayerGroup | null = null;
  /** The zones as drawn, for a tap to find (in map units, [lat, lng]). */
  let zones: { id: string; ll: [number, number][]; line: boolean }[] = [];

  /** Names beside the pins in view, when few enough are there to read; redrawn as the map moves. */
  const drawLabels = () => {
    labels?.remove();
    labels = null;
    // Clustered, most dots are hidden in bubbles: a name would float beside nothing.
    if (!map || !L || pins.length > CLUSTER_ABOVE) return;
    const view = map.getBounds().pad(0.1);
    const inView = pins.filter((p) => view.contains([p.y as number, p.x as number]));
    const named = pinsToLabel(inView, (p) => pinLabel(s, p));
    if (!named.length) return;
    // The shown pin's name first, so it is never the one left out; its ring reaches further.
    const at = (p: OwElement) => map!.latLngToContainerPoint([p.y as number, p.x as number]);
    const spots = named
      .sort((a, b) => Number(b.pin.id === place.pin) - Number(a.pin.id === place.pin))
      .map(({ pin, name }) => ({ pin, name, x: at(pin).x, y: at(pin).y, reach: pin.id === place.pin ? 15 : 7 }));
    const g = L.layerGroup();
    for (const { pin, name, side, gap } of placeLabels(spots, map.getSize().x, labelWidth, LABEL_LINE)) {
      // The name as text, never as markup: a pin's name is the world's words.
      const span = h('span', { class: 'map-label', style: side === 'right' ? `left:${gap}px` : `right:${gap}px` }, name);
      const icon = L.divIcon({ className: 'map-label-anchor', html: span, iconSize: [0, 0] });
      g.addLayer(L.marker([pin.y as number, pin.x as number], { icon, interactive: false, keyboard: false }));
    }
    g.addTo(map);
    labels = g;
  };

  let lit: Leaflet.Layer | null = null;
  const zoneCard = (zoneId: string) => {
    const zone = s.get(zoneId);
    // The tapped zone's outline drawn bold (no fill: it sits above the pins): among nested zones, the one the card names.
    lit?.remove();
    const d = zones.find((z) => z.id === zoneId);
    if (d && map && L) {
      const o = { color: zoneColor(zone), weight: 4, opacity: 1, interactive: false };
      lit = (d.line ? L.polyline(d.ll, o) : L.polygon(d.ll, { ...o, fill: false })).addTo(map);
    }
    card.replaceChildren(
      typeChip('zone'),
      h('span', { class: 'label' }, h('b', null, elName(zone)), ' ', h('span', { class: 'muted' }, `· ${['zone', ...markWords(zone)].join(' · ')}`)),
      zone ? h('a', { class: 'btn btn-pill', href: `#/w/${s.id}/e/${zone.id}` }, 'Open') : '',
    );
    card.hidden = false;
  };

  const showCard = (drawn: OwElement | null) => {
    lit?.remove();
    lit = null;
    // The pin as it is now: a pull may have renamed it since it was drawn.
    const pin = drawn ? s.get(drawn.id) ?? drawn : null;
    if (!pin) {
      card.hidden = true;
      card.replaceChildren();
      return;
    }
    const placed = typeof pin.element_id === 'string' ? s.get(pin.element_id) : undefined;
    const target = placed ?? pin;
    const t = pinType(s, pin);
    card.replaceChildren(
      typeChip(t),
      // What the pin places says its words, and a hidden pin its own (the hidden-elements gate's F3).
      h('span', { class: 'label' }, h('b', null, pinName(s, pin)), ' ', h('span', { class: 'muted' }, `· ${[typeName(t), ...new Set([...markWords(target), ...markWords(pin)])].join(' · ')}`)),
      h('a', { class: 'btn btn-pill', href: `#/w/${s.id}/e/${target.id}` }, 'Open'),
    );
    card.hidden = false;
  };

  /** What is on this map now, and a key of everything the drawing reads: a change in it redraws. */
  const onThisMap = () => {
    const els = s.elements();
    const p = els.filter((e) => e.type === 'pin' && e.map === mapEl.id && typeof e.x === 'number' && typeof e.y === 'number');
    const m = els.filter((e) => e.type === 'marker' && e.map === mapEl.id);
    const zoneIds = [...new Set(m.map((k) => k.zone).filter((z): z is string => typeof z === 'string' && !!z))];
    const key = [
      ...p.map((e) => {
        const placed = typeof e.element_id === 'string' ? s.get(e.element_id) : undefined;
        // The names too: a rename redraws the names beside the pins.
        return `${e.id},${e.x},${e.y},${e.element_id ?? ''},${e.element_type ?? ''},${placed?.type ?? ''},${e.name ?? ''},${placed?.name ?? ''}`;
      }),
      ...m.map((e) => `${e.id},${e.x},${e.y},${e.zone ?? ''},${e.order ?? ''},${e.created_at ?? ''}`),
      ...zoneIds.map((z) => {
        const e = s.get(z);
        return `${z},${e?.atlas_shape ?? ''},${e?.atlas_color ?? ''},${e?.supertype ?? ''}`;
      }),
    ].join('|');
    return { pins: p, markers: m, key };
  };

  // One drawing at a time: a refresh during a draw waits for it, then draws what is newest.
  let drawing: Promise<Drawn | undefined> | null = null;
  let again = false;
  const draw = async (): Promise<Drawn | undefined> => {
    if (drawing) {
      again = true;
      return drawing;
    }
    drawing = (async () => {
      let out: Drawn | undefined;
      do {
        again = false;
        out = (await drawOnce()) ?? out;
      } while (again && !destroyed);
      // Cleared here, in the same step as the last check: a refresh after it starts a new drawing.
      drawing = null;
      return out;
    })();
    return drawing;
  };

  const drawOnce = async (): Promise<Drawn | undefined> => {
    if (!map || !L) return;
    const now = onThisMap();
    if (now.key === drawnKey) return;
    const clustered = now.pins.length > CLUSTER_ABOVE;
    if (clustered) {
      await loadCluster(L);
      if (destroyed || !map) return;
    }
    drawnKey = now.key;
    pins = now.pins;
    layers?.remove();
    const g = L.layerGroup();
    const renderer = L.svg({ padding: 0.3 });
    const accent = token('--lan-accent', '#f0b44c');
    const ground = token('--lan-bg', '#101218');
    const ink = token('--lan-ink', '#efe9dd');

    // Zones, from their markers in order; markers outside a zone are small points.
    const byZone = new Map<string, OwElement[]>();
    for (const mk of now.markers) {
      const z = typeof mk.zone === 'string' && mk.zone ? mk.zone : '';
      if (!z) {
        if (typeof mk.x === 'number' && typeof mk.y === 'number')
          g.addLayer(L.circleMarker([mk.y, mk.x], { renderer, radius: 2.5, weight: 0, fillColor: ink, fillOpacity: 0.7, interactive: false }));
        continue;
      }
      const list = byZone.get(z);
      if (list) list.push(mk);
      else byZone.set(z, [mk]);
    }
    let focusZone: Leaflet.LatLngBounds | null = null;
    zones = [];
    for (const [zid, mks] of byZone) {
      const zone = s.get(zid);
      const ll = zonePoints(mks).map(([x, y]) => [y, x] as [number, number]);
      if (ll.length < 2) continue;
      const on = place.zone === zid;
      const line = zoneShape(zone) === 'line' || ll.length < 3;
      zones.push({ id: zid, ll, line });
      const o = { renderer, color: zoneColor(zone), weight: on ? 3 : 1.5, opacity: 0.9, interactive: false };
      const shape = line ? L.polyline(ll, o) : L.polygon(ll, { ...o, fillOpacity: on ? 0.3 : 0.15 });
      g.addLayer(shape);
      if (on) focusZone = shape.getBounds();
    }

    // Pins: circles on the SVG renderer; clustered DOM icons past a thousand.
    const focusId = place.pin ?? null;
    if (clustered) {
      const icon = L.divIcon({ className: 'map-pin-dom', iconSize: [14, 14] });
      // Not chunked: chunks run on a timer that outlives a removed map and throws (the gate ran it).
      const cg = L.markerClusterGroup({ chunkedLoading: false, showCoverageOnHover: false, maxClusterRadius: 40 });
      cg.addLayers(
        pins
          .filter((p) => p.id !== focusId)
          .map((p) => L!.marker([p.y as number, p.x as number], { icon, keyboard: false }).on('click', () => showCard(p))),
      );
      g.addLayer(cg);
    } else {
      for (const p of pins) {
        if (p.id === focusId) continue;
        g.addLayer(
          L.circleMarker([p.y as number, p.x as number], {
            renderer,
            radius: 5,
            // A light ring reads on dark ground and light parchment alike.
            color: ink,
            weight: 2,
            fillColor: typeColor(pinType(s, p)),
            fillOpacity: 1,
            interactive: false,
          }),
        );
      }
    }
    const focus = focusId ? pins.find((p) => p.id === focusId) : place.marker ? s.get(place.marker) : undefined;
    if (focus && typeof focus.x === 'number' && typeof focus.y === 'number') {
      // The one being shown: larger, ringed, drawn last so it sits on top.
      g.addLayer(L.circleMarker([focus.y, focus.x], { renderer, radius: 14, weight: 2, color: accent, fillOpacity: 0, interactive: false }));
      g.addLayer(L.circleMarker([focus.y, focus.x], { renderer, radius: 7, weight: 2, color: ground, fillColor: accent, fillOpacity: 1, interactive: false }));
    }
    g.addTo(map);
    layers = g;
    drawLabels();
    return { focus, focusZone };
  };

  const start = async () => {
    try {
      const [lib, size] = await Promise.all([loadLeaflet(), pictureSize(src)]);
      if (destroyed) return;
      L = lib;
      // The map's own size only when it has both (Atlas's rule): one alone mixes units and stretches the picture.
      const own = typeof mapEl.width === 'number' && mapEl.width > 0 && typeof mapEl.height === 'number' && mapEl.height > 0;
      const W = own ? (mapEl.width as number) : size.w;
      const H = own ? (mapEl.height as number) : size.h;
      const bounds = L.latLngBounds([0, 0], [H, W]);
      const fitZoom = () => {
        const vw = box.clientWidth || innerWidth;
        const vh = box.clientHeight || innerHeight;
        return Math.floor(Math.log2(Math.min(vw / W, vh / H)) * 4) / 4;
      };
      const minZoom = fitZoom();
      const maxZoom = maxZoomFor(size.w, W, devicePixelRatio || 1, minZoom);
      map = L.map(box, {
        crs: L.CRS.Simple,
        minZoom,
        maxZoom,
        zoomSnap: 0.25,
        attributionControl: false,
        zoomControl: false,
        maxBounds: bounds.pad(0.15),
        maxBoundsViscosity: 0.8,
      });
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.imageOverlay(src, bounds).addTo(map).once('error', () => {
        note.textContent = 'The map picture did not load. It needs a connection the first time.';
        note.hidden = false;
      });
      map.fitBounds(bounds);
      // Before the first draw and its setView: a jump of more than four zoom steps is not
      // animated, and fires moveend at once.
      map.on('moveend', drawLabels);
      const shown = await draw();
      if (destroyed || !map) return;
      if (shown?.focus && typeof shown.focus.x === 'number' && typeof shown.focus.y === 'number') {
        map.setView([shown.focus.y, shown.focus.x], Math.max(minZoom, Math.min(0, maxZoom)));
      } else if (shown?.focusZone) map.fitBounds(shown.focusZone.pad(0.2), { maxZoom });
      note.hidden = true;

      // A turned phone can fit the whole map again.
      map.on('resize', () => map?.setMinZoom(Math.min(fitZoom(), map.getMaxZoom())));

      // A tap finds the nearest pin within a finger's reach: the dots stay small, the target does not.
      // Clustered, the pins answer their own taps; the map's tap only reaches the shown pin, or closes the card.
      map.on('click', (e: Leaflet.LeafletMouseEvent) => {
        if (!map) return;
        const at = e.containerPoint;
        const shownPin = focus();
        const candidates = pins.length > CLUSTER_ABOVE ? (shownPin ? [shownPin] : []) : pins;
        let best: OwElement | null = null;
        let bestD = 26 * 26;
        for (const p of candidates) {
          if (typeof p.x !== 'number' || typeof p.y !== 'number') continue;
          const q = map.latLngToContainerPoint([p.y as number, p.x as number]);
          const d = (q.x - at.x) ** 2 + (q.y - at.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        // No pin under the finger: a zone, if the tap is on one (the smallest that holds it).
        if (!best) {
          const px = (ll: [number, number]): [number, number] => {
            const q = map!.latLngToContainerPoint(ll);
            return [q.x, q.y];
          };
          const z = zoneAt([at.x, at.y], zones.map((d) => ({ id: d.id, line: d.line, pts: d.ll.map(px) })));
          if (z) return zoneCard(z);
        }
        showCard(best);
      });
      if (focus()) showCard(focus());
    } catch (e) {
      if (destroyed) return;
      note.textContent =
        e instanceof PictureError
          ? 'The map picture did not load. It needs a connection the first time.'
          : 'The map did not open. Go back and try again.';
      note.hidden = false;
      if (!(e instanceof PictureError)) console.error(e);
    }
  };
  const focus = () => {
    const p = place.pin ? s.get(place.pin) : undefined;
    return p && typeof p.x === 'number' && typeof p.y === 'number' ? p : null;
  };

  requestAnimationFrame(() => void start());
  return {
    el,
    refresh: () => void draw(),
    destroy: () => {
      destroyed = true;
      map?.remove();
      map = null;
    },
  };
}
