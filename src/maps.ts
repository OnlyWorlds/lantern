// What a map needs, as plain rules (the view draws them): which maps an element can be shown on,
// a zone's shape and outline, and how far a picture may be zoomed. Quillon measured the rules on a
// phone (Armature/Notes/2026-10-12-lantern-maps-report.md); coordinates are the schema's: x and y
// from the map's bottom left, which is Leaflet CRS.Simple's lng and lat with no conversion.
import type { OwElement } from '@onlyworlds/sdk';

/** A map is shown only with a picture online: pins on a blank canvas are not a map. */
export function mapPicture(map: OwElement | undefined): string {
  const u = map?.image_url;
  return typeof u === 'string' && u.startsWith('https://') ? u : '';
}

/** Where on a map to look: a pin, a marker, a zone, or the whole map. */
export interface Place {
  map: string;
  pin?: string;
  marker?: string;
  zone?: string;
}

interface Lookup {
  get(id: string): OwElement | undefined;
  backlinks(id: string): string[];
}

/** Every map this element can be shown on, one place per map, only maps with a picture. */
export function placesOf(s: Lookup, el: OwElement): Place[] {
  const out: Place[] = [];
  const add = (p: Place) => {
    if (!mapPicture(s.get(p.map))) return;
    if (out.some((o) => o.map === p.map)) return;
    out.push(p);
  };
  const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
  // Only what the map can draw: a pin or marker with a place, a zone with two points on that map.
  const placed = (e: OwElement) => typeof e.x === 'number' && typeof e.y === 'number';
  if (el.type === 'map') add({ map: el.id });
  else if (el.type === 'pin' && str(el.map) && placed(el)) add({ map: str(el.map), pin: el.id });
  else if (el.type === 'marker' && str(el.map) && placed(el)) add({ map: str(el.map), marker: el.id });
  const linked = s.backlinks(el.id).map((id) => s.get(id));
  const zonePointsOn = new Map<string, number>();
  for (const o of linked) {
    if (!o) continue;
    // A pin that places this element; a marker that draws this zone.
    if (o.type === 'pin' && o.element_id === el.id && str(o.map) && placed(o)) add({ map: str(o.map), pin: o.id });
    else if (el.type === 'zone' && o.type === 'marker' && o.zone === el.id && str(o.map) && placed(o)) {
      const n = (zonePointsOn.get(str(o.map)) ?? 0) + 1;
      zonePointsOn.set(str(o.map), n);
      if (n === 2) add({ map: str(o.map), zone: el.id });
    }
  }
  return out;
}

/** Atlas's rule (DESIGN_ZONES `getZoneShape`): atlas_shape, then a "line" supertype in any casing; else a polygon. */
export function zoneShape(zone: OwElement | undefined): 'line' | 'polygon' {
  if (!zone) return 'polygon';
  if (zone.atlas_shape === 'line' || zone.atlas_shape === 'polygon') return zone.atlas_shape;
  return typeof zone.supertype === 'string' && zone.supertype.trim().toLowerCase() === 'line' ? 'line' : 'polygon';
}

export function zoneColor(zone: OwElement | undefined): string {
  const c = zone?.atlas_color;
  return typeof c === 'string' && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) ? c : '#22d3ee';
}

/** A zone's outline: its markers in `order` (the first point is 0); markers without one follow, oldest first. */
export function zonePoints(markers: OwElement[]): [number, number][] {
  const ord = (m: OwElement) => (typeof m.order === 'number' ? m.order : null);
  return [...markers]
    .filter((m) => typeof m.x === 'number' && typeof m.y === 'number')
    .sort((a, b) => {
      const oa = ord(a);
      const ob = ord(b);
      if (oa === null || ob === null) return oa === ob ? String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) : oa === null ? 1 : -1;
      return oa - ob;
    })
    .map((m) => [m.x as number, m.y as number]);
}

/**
 * How far in a picture may go: where one of its pixels meets 1.5 device pixels (Quillon's rule;
 * a 3840 picture of a 1920 map on a 3x phone stops at 0). A small picture still gets one step
 * past the whole-map view, soft rather than stuck.
 */
export function maxZoomFor(pictureWidth: number, mapWidth: number, dpr: number, fitZoom: number): number {
  const rule = Math.log2((1.5 * pictureWidth) / (mapWidth * Math.max(1, dpr)));
  return Math.max(Math.floor(rule * 4) / 4, fitZoom + 1);
}

/** Clustering pays from about a thousand pins on one map (plain wins at 839, clusters by 1,678). */
export const CLUSTER_ABOVE = 1000;

/** Names are drawn beside pins only while this few named pins are in view: more would be a wall of text. */
export const LABELS_AT_MOST = 30;

/** The pins whose names are drawn: the named ones in view, or none when there are too many to read. */
export function pinsToLabel<T>(inView: T[], nameOf: (p: T) => string | null): { pin: T; name: string }[] {
  const named: { pin: T; name: string }[] = [];
  for (const pin of inView) {
    const name = nameOf(pin);
    if (name) named.push({ pin, name });
  }
  return named.length <= LABELS_AT_MOST ? named : [];
}

export interface DrawnZone {
  id: string;
  /** Its outline on screen, in px. */
  pts: [number, number][];
  line: boolean;
}

function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function inside(p: [number, number], poly: [number, number][]): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) yes = !yes;
  }
  return yes;
}

function area(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

/**
 * The zone a tap is on: inside an area, or within a finger of a line or an area's edge. Where
 * several hold the tap, the smallest wins (a town's ward inside a province); a line counts as none.
 */
export function zoneAt(at: [number, number], zones: DrawnZone[], reach = 14): string | null {
  let best: { id: string; size: number } | null = null;
  for (const z of zones) {
    if (z.pts.length < 2) continue;
    const ring = z.line || z.pts.length < 3 ? z.pts : [...z.pts, z.pts[0]];
    let near = false;
    for (let i = 1; i < ring.length && !near; i++) near = distToSegment(at, ring[i - 1], ring[i]) <= reach;
    const isArea = !z.line && z.pts.length >= 3;
    if (!near && !(isArea && inside(at, z.pts))) continue;
    const size = isArea ? area(z.pts) : 0;
    if (!best || size < best.size) best = { id: z.id, size };
  }
  return best?.id ?? null;
}

export interface LabelSpot<T> {
  pin: T;
  name: string;
  /** The pin's place on screen, in px. */
  x: number;
  y: number;
  /** How far the pin's drawing reaches from its centre: 7 for a dot, 15 for the shown pin's ring. */
  reach?: number;
}

export type PlacedLabel<T> = LabelSpot<T> & { side: 'right' | 'left'; gap: number };

/**
 * Where names go without covering each other or another pin: to the right of the dot, or to its
 * left near the screen's right edge; a name that fits on neither side is left out (a tap names it).
 * First come, first placed: put the shown pin first. `widthOf` is the name's real width in px
 * (the screen measures it in the label's own font: an estimate per character missed capitals and
 * CJK, the S396 gate); `height` is the label's line box.
 */
export function placeLabels<T>(spots: LabelSpot<T>[], screenWidth: number, widthOf: (name: string) => number, height = 16): PlacedLabel<T>[] {
  type Box = [number, number, number, number];
  const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const taken: Box[] = [];
  const reach = (s: LabelSpot<T>) => s.reach ?? 7;
  const dots: Box[] = spots.map((s) => [s.x - reach(s), s.y - reach(s), s.x + reach(s), s.y + reach(s)]);
  const out: PlacedLabel<T>[] = [];
  spots.forEach((s, i) => {
    const w = widthOf(s.name);
    const gap = reach(s) + 2;
    const right: Box = [s.x + gap, s.y - height / 2, s.x + gap + w, s.y + height / 2];
    const left: Box = [s.x - gap - w, s.y - height / 2, s.x - gap, s.y + height / 2];
    const free = (b: Box) => b[0] >= 0 && b[2] <= screenWidth && !taken.some((t) => hit(t, b)) && !dots.some((d, j) => j !== i && hit(d, b));
    const side = free(right) ? 'right' : free(left) ? 'left' : null;
    if (!side) return;
    taken.push(side === 'right' ? right : left);
    out.push({ ...s, side, gap });
  });
  return out;
}
