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
