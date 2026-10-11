import { describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';
import { mapPicture, maxZoomFor, placesOf, zoneColor, zonePoints, zoneShape } from '../src/maps';

const el = (o: Partial<OwElement> & { id: string; type: string }): OwElement => o as OwElement;

function world(els: OwElement[]) {
  const by = new Map(els.map((e) => [e.id, e]));
  return {
    get: (id: string) => by.get(id),
    backlinks: (id: string) =>
      els.filter((e) => Object.entries(e).some(([k, v]) => k !== 'id' && (v === id || (Array.isArray(v) && v.includes(id))))).map((e) => e.id),
  };
}

const withPicture = el({ id: 'm1', type: 'map', name: 'Sea', image_url: 'https://media.onlyworlds.com/a.webp' });
const noPicture = el({ id: 'm2', type: 'map', name: 'Draft', image_url: '' });
const local = el({ id: 'm3', type: 'map', name: 'Photo', image_url: 'data:image/webp;base64,AAAA' });

describe('which maps an element is on', () => {
  it('a map needs a picture online: none, or one held on the phone, shows no map', () => {
    expect(mapPicture(withPicture)).toBe('https://media.onlyworlds.com/a.webp');
    expect(mapPicture(noPicture)).toBe('');
    expect(mapPicture(local)).toBe('');
    expect(mapPicture(el({ id: 'x', type: 'map', image_url: 'http://plain.example/a.webp' }))).toBe('');
  });

  it('an element placed by pins: one place per map, only maps with a picture', () => {
    const town = el({ id: 't', type: 'location', name: 'Port' });
    const w = world([
      withPicture,
      noPicture,
      town,
      el({ id: 'p1', type: 'pin', map: 'm1', element_id: 't', x: 1, y: 2 }),
      el({ id: 'p2', type: 'pin', map: 'm1', element_id: 't', x: 3, y: 4 }),
      el({ id: 'p3', type: 'pin', map: 'm2', element_id: 't', x: 5, y: 6 }),
    ]);
    expect(placesOf(w, town)).toEqual([{ map: 'm1', pin: 'p1' }]);
  });

  it('a pin that only shares a map with the element is not a place of it', () => {
    // The map itself is linked from every pin on it: that makes it "Open the map", not one per pin.
    const w = world([withPicture, el({ id: 'p1', type: 'pin', map: 'm1', element_id: 'other', x: 1, y: 2 })]);
    expect(placesOf(w, withPicture)).toEqual([{ map: 'm1' }]);
  });

  it('a pin, a marker, and a zone drawn by markers', () => {
    const pin = el({ id: 'p1', type: 'pin', map: 'm1', x: 1, y: 2 });
    const zone = el({ id: 'z', type: 'zone', name: 'Reef' });
    const mk = el({ id: 'k1', type: 'marker', map: 'm1', zone: 'z', x: 1, y: 1, order: 0 });
    const mk2 = el({ id: 'k2', type: 'marker', map: 'm1', zone: 'z', x: 5, y: 1, order: 1 });
    const w = world([withPicture, pin, zone, mk, mk2]);
    expect(placesOf(w, pin)).toEqual([{ map: 'm1', pin: 'p1' }]);
    expect(placesOf(w, mk)).toEqual([{ map: 'm1', marker: 'k1' }]);
    expect(placesOf(w, zone)).toEqual([{ map: 'm1', zone: 'z' }]);
  });

  it('no button that opens an empty view: a pin without a place, a zone with one point (the gate, C4)', () => {
    const town = el({ id: 't', type: 'location', name: 'Port' });
    const zone = el({ id: 'z', type: 'zone', name: 'Reef' });
    const w = world([
      withPicture,
      town,
      zone,
      el({ id: 'p1', type: 'pin', map: 'm1', element_id: 't' }),
      el({ id: 'k1', type: 'marker', map: 'm1', zone: 'z', x: 1, y: 1, order: 0 }),
      el({ id: 'k2', type: 'marker', map: 'm1', zone: 'z', order: 1 }),
    ]);
    expect(placesOf(w, town)).toEqual([]);
    expect(placesOf(w, w.get('p1')!)).toEqual([]);
    expect(placesOf(w, zone)).toEqual([]);
  });

  it('a map not on this phone shows nothing', () => {
    const pin = el({ id: 'p1', type: 'pin', map: 'gone', x: 1, y: 2 });
    expect(placesOf(world([pin]), pin)).toEqual([]);
  });
});

describe('zones', () => {
  it('shape: atlas_shape first, then a "line" supertype in any casing, else a polygon', () => {
    expect(zoneShape(el({ id: 'a', type: 'zone', atlas_shape: 'line', supertype: 'polygon' }))).toBe('line');
    expect(zoneShape(el({ id: 'b', type: 'zone', supertype: 'Line' }))).toBe('line');
    expect(zoneShape(el({ id: 'c', type: 'zone', supertype: 'Territory' }))).toBe('polygon');
    expect(zoneShape(undefined)).toBe('polygon');
  });

  it('colour: a hex atlas_color, else the default; anything else is refused', () => {
    expect(zoneColor(el({ id: 'a', type: 'zone', atlas_color: '#3b82f6' }))).toBe('#3b82f6');
    expect(zoneColor(el({ id: 'b', type: 'zone', atlas_color: 'red; stroke:url(x)' }))).toBe('#22d3ee');
    // Five or seven digits is no colour at all: the outline would vanish (the gate, P7).
    expect(zoneColor(el({ id: 'c', type: 'zone', atlas_color: '#12345' }))).toBe('#22d3ee');
    expect(zoneColor(el({ id: 'd', type: 'zone', atlas_color: '#3b82f680' }))).toBe('#3b82f680');
    expect(zoneColor(undefined)).toBe('#22d3ee');
  });

  it('points run in order; markers without one follow, oldest first; a marker without x or y is skipped', () => {
    const m = (id: string, order: number | null, x: number, created: string) =>
      el({ id, type: 'marker', order: order as number, x, y: 0, created_at: created });
    const pts = zonePoints([
      m('d', null, 40, '2026-01-02'),
      m('b', 1, 20, '2026-01-01'),
      m('c', null, 30, '2026-01-01'),
      m('a', 0, 10, '2026-01-03'),
      el({ id: 'e', type: 'marker', order: 2, x: 99 }),
    ]);
    expect(pts.map(([x]) => x)).toEqual([10, 20, 30, 40]);
  });
});

describe('the zoom ceiling', () => {
  it('Quillon\'s case: a 3840 picture of a 1920 map on a 3x phone stops at 0', () => {
    expect(maxZoomFor(3840, 1920, 3, -2.25)).toBe(0);
  });

  it('a picture as wide as its map still gets one step past the whole view', () => {
    // Moppetopia: 784 wide on 784, a 3x phone fits it at about -1.
    expect(maxZoomFor(784, 784, 3, -1)).toBe(0);
  });

  it('a sharper picture on a plainer screen goes further', () => {
    expect(maxZoomFor(3840, 1920, 1, -2.25)).toBeCloseTo(1.5);
  });
});
