import { describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';
import { LABELS_AT_MOST, mapPicture, maxZoomFor, pinsToLabel, placeLabels, placesOf, zoneAt, zoneColor, zonePoints, zoneShape } from '../src/maps';

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

describe('a tap on a zone', () => {
  const square = (id: string, x: number, y: number, s: number) => ({ id, line: false, pts: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] as [number, number][] });
  it('inside an area finds it; outside and far from it, nothing', () => {
    expect(zoneAt([50, 50], [square('a', 0, 0, 100)])).toBe('a');
    expect(zoneAt([300, 300], [square('a', 0, 0, 100)])).toBeNull();
  });
  it('the smallest area holding the tap wins (a ward inside a province)', () => {
    expect(zoneAt([50, 50], [square('province', 0, 0, 400), square('ward', 40, 40, 20)])).toBe('ward');
    expect(zoneAt([200, 200], [square('province', 0, 0, 400), square('ward', 40, 40, 20)])).toBe('province');
  });
  it('a line (a road, a river) within a finger, and not further', () => {
    const road = { id: 'road', line: true, pts: [[0, 100], [400, 100]] as [number, number][] };
    expect(zoneAt([200, 110], [road])).toBe('road');
    expect(zoneAt([200, 130], [road])).toBeNull();
    // A road through a province: on the road, the road.
    expect(zoneAt([200, 105], [square('province', 0, 0, 400), road])).toBe('road');
  });
  it("an area's edge counts from just outside, within a finger", () => {
    expect(zoneAt([108, 50], [square('a', 0, 0, 100)])).toBe('a');
    expect(zoneAt([120, 50], [square('a', 0, 0, 100)])).toBeNull();
  });
});

describe('names beside pins', () => {
  it('names only the named, and none when too many are in view to read', () => {
    const name = (p: string) => (p.startsWith('n') ? p : null);
    expect(pinsToLabel(['n1', 'x', 'n2'], name).map((l) => l.name)).toEqual(['n1', 'n2']);
    const many = Array.from({ length: LABELS_AT_MOST + 1 }, (_, i) => `n${i}`);
    expect(pinsToLabel(many, name)).toEqual([]);
    expect(pinsToLabel([...many.slice(1), 'x', 'y'], name)).toHaveLength(LABELS_AT_MOST);
  });

  const spot = (name: string, x: number, y: number) => ({ pin: name, name, x, y });
  const W = (name: string) => [...name].length * 7;

  it('measures each name with the width it is given: a wide script needs the room it really takes', () => {
    // 5 characters at 7 px fit before the next pin; the same 5 at 13 px (CJK) do not, on either side.
    const near = (w: (n: string) => number) => placeLabels([spot('東京大聖堂', 100, 100), spot('B', 160, 100), spot('C', 40, 100)], 400, w);
    expect(near(W).map((o) => o.name)).toContain('東京大聖堂');
    expect(near((n) => [...n].length * 13).map((o) => o.name)).not.toContain('東京大聖堂');
  });

  it("the shown pin's ring keeps its name and others' further off", () => {
    const [shown] = placeLabels([{ ...spot('Puddleton', 100, 100), reach: 15 }], 400, W);
    expect(shown.gap).toBe(17);
    // A name ending 15 px from the shown pin's centre would sit on its ring (not on a plain dot): it goes the other way.
    const other = placeLabels([{ ...spot('X', 100, 100), reach: 15 }, spot('Drip', 50, 104)], 400, W).find((o) => o.name === 'Drip');
    expect(other?.side).toBe('left');
  });

  it('to the right of the dot, apart from each other', () => {
    const out = placeLabels([spot('Drip Plaza', 100, 100), spot('Naval Academy', 100, 300)], 400, W);
    expect(out.map((o) => [o.name, o.side])).toEqual([
      ['Drip Plaza', 'right'],
      ['Naval Academy', 'right'],
    ]);
  });

  it('a dot where the name would go sends it left; boxed in on both sides, the later name is left out', () => {
    const dodge = placeLabels([spot('Puddleton', 200, 100), spot('X', 230, 100)], 400, W);
    expect(dodge[0]).toMatchObject({ name: 'Puddleton', side: 'left' });
    const boxed = placeLabels([spot('Puddleton', 200, 100), spot('A', 170, 100), spot('B', 230, 100)], 400, W);
    expect(boxed.map((o) => o.name)).not.toContain('Puddleton');
  });

  it('on a crowded screen, no name covers another name or another pin', () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const spots = Array.from({ length: 30 }, (_, i) => spot(`Place ${'x'.repeat(i % 9)}${i}`, Math.round(rnd() * 390), Math.round(rnd() * 400)));
    const out = placeLabels(spots, 390, W);
    expect(out.length).toBeGreaterThan(5);
    // The model's own boxes: this checks the placement keeps its promise; the rendered text is the walk's (walk/map.mjs).
    const box = (o: (typeof out)[number]) => {
      const w = W(o.name);
      return o.side === 'right' ? [o.x + o.gap, o.y - 8, o.x + o.gap + w, o.y + 8] : [o.x - o.gap - w, o.y - 8, o.x - o.gap, o.y + 8];
    };
    const hit = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    for (const a of out) {
      const ba = box(a);
      expect(ba[0] >= 0 && ba[2] <= 390).toBe(true);
      for (const b of out) if (a !== b) expect(hit(ba, box(b))).toBe(false);
      for (const s of spots) if (s.pin !== a.pin) expect(hit(ba, [s.x - 7, s.y - 7, s.x + 7, s.y + 7])).toBe(false);
    }
  });

  it('near the right edge the name goes left; with room on neither side, none', () => {
    expect(placeLabels([spot('Museum of Moistened History', 380, 50)], 400, W)[0].side).toBe('left');
    expect(placeLabels([spot('Museum of Moistened History', 100, 50)], 200, W)).toEqual([]);
  });
});
