// A world's reading aids (src/aids.ts, schema-dist profiles/charter.md): which elements are aids, the door's
// packet from the SDK, and the phone's switch that keeps them out of every lore view by default.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { OwElement } from '@onlyworlds/sdk';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { aidLine, aidsShown, aidsWords, isReadingAid, readAids, setAidsShown } = await import('../src/aids');
const { openWorldFile, toWorldFile } = await import('../src/worldfile');
const { openWorld } = await import('../src/world');

const W = '0f0f0f0f-0000-4000-8000-0000000c0001';
const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const el = (o: Record<string, unknown>) => o as unknown as OwElement;

const charter = el({ id: id(1), type: 'law', name: 'House rules', supertype: 'Charter', x_charter_of: W, description: 'Be kind.\n\nMore.', created_at: '2026-10-01T00:00:00Z' });
const older = el({ id: id(2), type: 'law', name: 'Old rules', supertype: 'Charter', x_charter_of: W, created_at: '2026-09-01T00:00:00Z' });
const guide = el({ id: id(3), type: 'construct', name: 'Start with the Heir', supertype: 'Guide', x_charter_of: W, constructs: [id(5), id(4)] });
const coast = el({ id: id(4), type: 'construct', name: 'The coast', supertype: 'Domain', x_charter_of: W, description: 'Where the ferries run.\nMore.', locations: [id(10)] });
const court = el({ id: id(5), type: 'construct', name: 'The court', supertype: 'Domain', x_charter_of: W, description: 'Who rules.' });
// Lore that looks like an aid: a kingdom's charter with no mark, a blank mark, a proposed one.
const kingdom = el({ id: id(6), type: 'law', name: "The kingdom's charter", supertype: 'Charter' });
const blank = el({ id: id(7), type: 'law', name: 'Blank mark', supertype: 'Charter', x_charter_of: '  ' });
const proposed = el({ id: id(8), type: 'construct', name: 'A proposed domain', supertype: 'Domain', x_charter_of: W, x_review_proposed: { by: 'seat' } });
const ada = el({ id: id(9), type: 'character', name: 'Ada', description: 'A ferrywoman.' });
const harbour = el({ id: id(10), type: 'location', name: 'The harbour' });
const all = [charter, older, guide, coast, court, kingdom, blank, proposed, ada, harbour];

describe('a reading aid', () => {
  it('is the pair and the mark, not proposed', () => {
    for (const e of [charter, older, guide, coast, court]) expect(isReadingAid(e)).toBe(true);
    for (const e of [kingdom, blank, proposed, ada]) expect(isReadingAid(e)).toBe(false);
    expect(isReadingAid(el({ type: 'location', name: 'x', supertype: 'Domain', x_charter_of: W }))).toBe(false);
  });

  it("the door's packet is the SDK's: the newest Charter, the Guide, the Domains in the Guide's order", () => {
    const a = readAids(all);
    expect(a.packet.charter?.id).toBe(charter.id);
    expect(a.packet.guide?.id).toBe(guide.id);
    expect(a.packet.domains.map((d) => d.name)).toEqual(['The court', 'The coast']);
    expect(a.packet.domains[1].sentence).toBe('Where the ferries run.');
    expect([a.charters, a.guides, a.domains, a.count]).toEqual([2, 1, 2, 5]);
  });

  it('a world with none reads nothing', () => {
    const a = readAids([ada, harbour, kingdom, proposed]);
    expect(a.count).toBe(0);
    expect(a.packet).toEqual({ charter: null, guide: null, domains: [] });
  });

  it('is named by kind, and the line on its page says whether it leads', () => {
    expect(aidsWords({ charters: 1, guides: 1, domains: 3 })).toBe('the charter, the guide and 3 domains');
    expect(aidsWords({ charters: 1, guides: 0, domains: 0 })).toBe('the charter');
    expect(aidsWords({ charters: 0, guides: 1, domains: 1 })).toBe('the guide and 1 domain');
    const p = readAids(all).packet;
    const name = (x: string) => all.find((e) => e.id === x)?.name ?? '';
    expect(aidLine(charter, p, false, name)).toBe("This world's charter, first on its home. It stays out of the lists and search.");
    expect(aidLine(older, p, true, name)).toBe('Also marked as a charter: House rules is the one that leads.');
    expect(aidLine(coast, p, true, name)).toBe("One of this world's domains, on its home.");
    expect(aidLine(kingdom, p, false, name)).toBeNull();
  });

  it('is hidden unless this phone chose to show it, per world', () => {
    expect(aidsShown('w1')).toBe(false);
    expect(setAidsShown('w1', true)).toBe(true);
    expect(aidsShown('w1')).toBe(true);
    expect(aidsShown('w2')).toBe(false);
    setAidsShown('w1', false);
    expect(aidsShown('w1')).toBe(false);
  });
});

describe("a world's lore views", () => {
  it('leave the aids out by default, every view at once, and the switch brings them back', async () => {
    const { bytes } = toWorldFile({ id: W, name: 'Aids', kind: 'local', addedAt: '' }, all);
    const wid = await openWorldFile(bytes);
    const s = await openWorld(wid);
    const names = (els: OwElement[]) => els.map((e) => e.name).sort();

    expect(names(s.ofType('law'))).toEqual(['Blank mark', "The kingdom's charter"]);
    expect(names(s.ofType('construct'))).toEqual(['A proposed domain']);
    expect(s.counts().get('law')).toBe(2);
    expect(s.counts().get('construct') ?? 0).toBe(0); // the proposed one is counted apart
    expect(s.lookupIndex().byId.has(charter.id)).toBe(false);
    // An aid's own page and picker read the whole world: the Guide links to the Domains, a Domain to its hub.
    expect(s.backlinks(coast.id)).toEqual([]);
    expect(s.backlinks(coast.id, true)).toEqual([guide.id]);
    expect(s.backlinks(harbour.id)).toEqual([]);
    expect(s.backlinks(harbour.id, true)).toEqual([coast.id]);
    expect(names(s.ofType('construct', true))).toEqual(['A proposed domain', 'Start with the Heir', 'The coast', 'The court']);
    // The door reads the whole world whatever the switch.
    expect(s.aids().count).toBe(5);

    expect(s.showAids(true)).toBe(true);
    expect(names(s.ofType('law'))).toEqual(['Blank mark', 'House rules', 'Old rules', "The kingdom's charter"]);
    expect(s.counts().get('construct')).toBe(3);
    expect(s.lookupIndex().byId.has(charter.id)).toBe(true);
    expect(s.backlinks(harbour.id)).toEqual([coast.id]);

    s.showAids(false);
    expect(s.counts().get('law')).toBe(2);
    expect(s.backlinks(harbour.id)).toEqual([]);

    // The door follows an edit: the cache is let go with every rebuild.
    await s.edit(court.id, { x_charter_of: null });
    expect(s.aids().count).toBe(4);
    expect(s.aids().packet.domains.map((d) => d.name)).toEqual(['The coast']);
    expect(names(s.ofType('construct'))).toEqual(['A proposed domain', 'The court']);
  });

  it("an aid's own page brings the aids in, never the room: each switch is its own", async () => {
    const line = el({ id: id(20), type: 'narrative', name: 'A line', supertype: 'Message', x_room_of: W, laws: [charter.id] });
    const spec = el({ id: id(21), type: 'construct', name: 'A spec', supertype: 'Spec', x_room_of: W });
    const { bytes } = toWorldFile({ id: 'w0000000-0000-4000-8000-0000000000a2', name: 'Aids and room', kind: 'local', addedAt: '' }, [...all, line, spec]);
    const wid = await openWorldFile(bytes);
    const s = await openWorld(wid);
    const names = (els: OwElement[]) => els.map((e) => e.name).sort();
    const { setRoomShown } = await import('../src/room');
    // Room hidden, aids hidden: the Charter's page reads the aids in, the room out.
    expect(s.backlinks(charter.id, true)).toEqual([]);
    expect(names(s.ofType('construct', true))).toEqual(['A proposed domain', 'Start with the Heir', 'The coast', 'The court']);
    expect(s.backlinks(charter.id)).toEqual([]);
    // Room shown: the line is in, on the Charter's page and in the lists.
    setRoomShown(wid, true);
    expect(s.backlinks(charter.id, true)).toEqual([line.id]);
    expect(s.backlinks(charter.id)).toEqual([line.id]);
    expect(names(s.ofType('construct'))).toEqual(['A proposed domain', 'A spec']);
    expect(names(s.ofType('construct', true))).toEqual(['A proposed domain', 'A spec', 'Start with the Heir', 'The coast', 'The court']);
    // Both shown: every view holds both.
    s.showAids(true);
    expect(names(s.ofType('construct'))).toEqual(['A proposed domain', 'A spec', 'Start with the Heir', 'The coast', 'The court']);
    setRoomShown(wid, false);
    expect(names(s.ofType('construct'))).toEqual(['A proposed domain', 'Start with the Heir', 'The coast', 'The court']);
    s.showAids(false);
  });

  it('counts only what the reading draws, and a name that is not a string reads as Unnamed', async () => {
    const odd = el({ id: 42, type: 'construct', name: 'Odd id', supertype: 'Domain', x_charter_of: W });
    expect(readAids([coast, odd]).count).toBe(1);
    const { elName } = await import('../src/ui');
    expect(elName(el({ id: 'x', type: 'law', name: 42 }))).toBe('Unnamed');
    expect(elName(el({ id: 'x', type: 'law', name: { a: 1 } }))).toBe('Unnamed');
    expect(elName(el({ id: 'x', type: 'law', name: '  Rules ' }))).toBe('Rules');
  });
});

describe("the world's strand at the door", () => {
  const story = el({ id: id(51), type: 'narrative', name: 'The Long Thaw', events: [id(52)], protagonist: id(54) });
  const ice = el({ id: id(52), type: 'event', name: 'The Ice Breaks', locations: [id(53)] });
  const ford = el({ id: id(53), type: 'location', name: 'Kessel Ford' });
  const wren = el({ id: id(54), type: 'character', name: 'Wren', location: id(53) });

  it("reads the SDK's five slots from the World's mark, and none without one", async () => {
    const mark = { narrative: id(51), event: id(52), location: id(53) };
    const { bytes } = toWorldFile({ id: 'w0000000-0000-4000-8000-0000000000a3', name: 'Strand', kind: 'local', addedAt: '', extensions: { x_strand: mark } }, [story, ice, ford, wren, ada]);
    const s = await openWorld(await openWorldFile(bytes));
    const st = s.strand();
    expect([st?.narrative?.name, st?.event?.name, st?.location?.name, st?.character?.name, st?.now?.name, st?.same]).toEqual(['The Long Thaw', 'The Ice Breaks', 'Kessel Ford', 'Wren', 'Kessel Ford', true]);
    // The strand's elements are ordinary lore: no list leaves them out.
    expect(s.ofType('narrative').map((e) => e.name)).toEqual(['The Long Thaw']);
    // An edit moves the reading: the hero goes, and so does where the hero is now.
    await s.edit(story.id, { protagonist: null });
    expect([s.strand()?.character, s.strand()?.now]).toEqual([null, null]);

    // The mark alone moves (a world GET): the reading follows it.
    await s.edit(story.id, { protagonist: wren.id });
    s.rec = { ...s.rec, extensions: { x_strand: { narrative: id(51), event: null, location: null } } };
    expect([s.strand()?.event, s.strand()?.location, s.strand()?.character?.name, s.strand()?.same]).toEqual([null, null, 'Wren', null]);

    const { bytes: none } = toWorldFile({ id: 'w0000000-0000-4000-8000-0000000000a4', name: 'No strand', kind: 'local', addedAt: '' }, [story, ice]);
    expect((await openWorld(await openWorldFile(none))).strand()).toBeNull();
    const { bytes: gone } = toWorldFile({ id: 'w0000000-0000-4000-8000-0000000000a5', name: 'Gone story', kind: 'local', addedAt: '', extensions: { x_strand: { narrative: id(99) } } }, [ice]);
    expect((await openWorld(await openWorldFile(gone))).strand()).toBeNull();
  });
});
