// World files: a phone-only world saved and opened again comes back whole, with Atlas's names.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readWorldFile, writeWorldFile } from '@onlyworlds/sdk';
import { lanternProducer, openWorldFile, slugify, toWorldFile, worldCopy } from '../src/worldfile';
import * as db from '../src/db';

// The standard's own pair for private records (schema-dist fixtures/owworld, OW-8, serial 49):
// the same world asked for and left out. Vendored; Atlas carries the same two files.
const ow8 = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures/owworld', name)));
const recordsOf = (bytes: Uint8Array) =>
  readWorldFile(bytes).files.filter((f) => f.path.startsWith('records/')).sort((a, b) => (a.path < b.path ? -1 : 1));

describe('records/ through a copy (folder spec §4.5 rules 6, 6a and 11)', () => {
  it("a file's records come back byte for byte; a private producer is left out and said, asked it travels", async () => {
    const asked = ow8('pass-OW-8-private-asked.owworld');
    const id = await openWorldFile(asked);
    const rec = (await db.getWorldRecord(id))!;
    const els = await db.allElements(id);
    const recs = await db.getRecords(id);
    expect(recs.map((f) => f.path)).toEqual(recordsOf(asked).map((f) => f.path));

    const def = worldCopy(rec, els, recs);
    expect(def.question).toEqual({ kind: 'private', producers: ['fold'] });
    const want = recordsOf(ow8('pass-OW-8-private-left-out.owworld'));
    const got = recordsOf(def.bytes!);
    expect(got.map((f) => f.path)).toEqual(want.map((f) => f.path));
    got.forEach((f, i) => expect(Buffer.from(f.data).equals(Buffer.from(want[i].data))).toBe(true));

    const all = worldCopy(rec, els, recs, true);
    expect(all.question).toBeUndefined();
    const every = recordsOf(all.bytes!);
    const src = recordsOf(asked);
    expect(every.map((f) => f.path)).toEqual(src.map((f) => f.path));
    every.forEach((f, i) => expect(Buffer.from(f.data).equals(Buffer.from(src[i].data))).toBe(true));
    await db.removeWorld(id);
    expect(await db.getRecords(id)).toEqual([]);
  });

  it('a records list that will not read leaves nothing out by guess: no copy until every record is asked for', async () => {
    const enc = new TextEncoder();
    const file = writeWorldFile(
      [
        { path: 'world.json', data: enc.encode(JSON.stringify({ id: 'w0000000-0000-4000-8000-0000000000c1', name: 'Bad list' })) },
        { path: 'records/RECORDS.json', data: enc.encode('{"producer":"fold"}') },
        { path: 'records/fold/spine.jsonl', data: enc.encode('{"a":1}\n') },
      ],
      'Bad list',
      { includePrivateRecords: true },
    );
    const id = await openWorldFile(file);
    const rec = (await db.getWorldRecord(id))!;
    const recs = await db.getRecords(id);
    const def = worldCopy(rec, [], recs);
    expect(def).toMatchObject({ bytes: null, question: { kind: 'unreadable' } });
    expect(recordsOf(worldCopy(rec, [], recs, true).bytes!).map((f) => f.path)).toEqual(['records/RECORDS.json', 'records/fold/spine.jsonl']);
    await db.removeWorld(id);
  });

  it('a world with no records asks nothing', () => {
    const made = worldCopy({ id: 'w0000000-0000-4000-8000-0000000000c2', name: 'Plain', kind: 'local', addedAt: '' }, [], []);
    expect(made.question).toBeUndefined();
    expect(recordsOf(made.bytes!)).toEqual([]);
  });
});


describe('world files', () => {
  it('names files as Atlas does', () => {
    expect(slugify('José’s Ferry-Debt!')).toBe('jose-s-ferry-debt');
    const { bytes } = toWorldFile({ id: '019f0000-0000-7000-8000-00000000abcd', name: 'Bus stop ideas', kind: 'local', addedAt: '' }, [
      { id: '019f0000-0000-7000-8000-0000ferry001', type: 'narrative', name: 'The ferryman’s debt', supertype: 'Unsorted' },
    ]);
    const read = readWorldFile(bytes);
    expect(read.files.map((f) => f.path)).toEqual(['elements/narrative/the-ferryman-s-debt--ferry001.json', 'world.json']);
    expect(read.name).toBe('Bus stop ideas');
  });

  it("the producer line: Lantern's for a world born here, a file's own kept, none claimed for a file that had none", async () => {
    const base = { kind: 'local' as const, addedAt: '' };
    const lineOf = (bytes: Uint8Array) =>
      JSON.parse(new TextDecoder().decode(readWorldFile(bytes).files.find((f) => f.path === 'world.json')!.data)).producer;
    const born = toWorldFile({ ...base, id: 'w0000000-0000-4000-8000-0000000000b1', name: 'Born', producer: lanternProducer() }, []);
    expect(lineOf(born.bytes)).toMatchObject({ tool: 'lantern', input: 'bare' });
    const atlas = { tool: 'atlas', version: '1.81.0', input: 'bare', extra: 1 };
    const fromAtlas = writeWorldFile([{ path: 'world.json', data: new TextEncoder().encode(JSON.stringify({ id: 'w0000000-0000-4000-8000-0000000000b2', name: 'From Atlas', producer: atlas })) }], 'From Atlas');
    const id = await openWorldFile(fromAtlas);
    const rec = (await db.getWorldRecord(id))!;
    expect(lineOf(toWorldFile(rec, []).bytes)).toEqual(atlas);
    const bare = writeWorldFile([{ path: 'world.json', data: new TextEncoder().encode(JSON.stringify({ id: 'w0000000-0000-4000-8000-0000000000b3', name: 'No line' })) }], 'No line');
    const id2 = await openWorldFile(bare);
    expect(lineOf(toWorldFile((await db.getWorldRecord(id2))!, []).bytes)).toBeUndefined();
    expect(lineOf(toWorldFile({ ...base, id: 'w0000000-0000-4000-8000-0000000000b4', name: 'Old record' }, []).bytes)).toBeUndefined();
  });

  it("a world's own words (x_names) leave in its file and come back verbatim", async () => {
    const names = { version: 1, types: { character: { one: 'Employee', many: 'Employees' } }, later: [1] };
    const { bytes } = toWorldFile({ id: 'w0000000-0000-4000-8000-0000000000aa', name: 'Work', kind: 'local', addedAt: '', names }, []);
    const world = JSON.parse(new TextDecoder().decode(readWorldFile(bytes).files.find((f) => f.path === 'world.json')!.data));
    expect(world.x_names).toEqual(names);
    const id = await openWorldFile(bytes);
    expect((await db.getWorldRecord(id))?.names).toEqual(names);
  });

  it('a saved world opens again whole, the type taken from the folder', async () => {
    const els = [
      { id: 'a1111111-0000-4000-8000-000000000001', type: 'character', name: 'Ada', friends: ['a1111111-0000-4000-8000-000000000002'] },
      { id: 'a1111111-0000-4000-8000-000000000002', type: 'character', name: 'Ada' }, // a same-named twin
      { id: 'a1111111-0000-4000-8000-000000000003', type: 'location', name: '' },
    ];
    const { bytes } = toWorldFile({ id: 'w0000000-0000-4000-8000-000000000001', name: 'Round trip', kind: 'local', addedAt: '' }, els);
    const read = readWorldFile(bytes);
    for (const f of read.files.filter((x) => x.path.startsWith('elements/'))) {
      expect(JSON.parse(new TextDecoder().decode(f.data)).type).toBeUndefined();
    }
    const id = await openWorldFile(bytes);
    const back = await db.allElements(id);
    expect(back.map((e) => [e.id, e.type, e.name]).sort()).toEqual(els.map((e) => [e.id, e.type, e.name]).sort());
    expect(back.find((e) => e.id.endsWith('01'))?.friends).toEqual(['a1111111-0000-4000-8000-000000000002']);
    await expect(openWorldFile(bytes)).rejects.toThrow(/already on this phone/);
  });

  it('opens a real Atlas world folder', async () => {
    const dir = join(homedir(), 'Desktop/TESTOWFOLDER/onlyworlds-atlas/moppetopia-sample-55a9b4d5');
    let files: { path: string; data: Uint8Array }[];
    try {
      const walk = (d: string, rel = ''): { path: string; data: Uint8Array }[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name), `${rel}${e.name}/`) : [{ path: `${rel}${e.name}`, data: new Uint8Array(readFileSync(join(d, e.name))) }],
        );
      files = walk(dir);
    } catch {
      return; // the Captain's folder is not on this machine
    }
    const zip = writeWorldFile(files, 'moppetopia-sample-55a9b4d5');
    await db.removeWorld('55a9b4d5-d203-4e80-b9f3-91fff436ff75');
    const id = await openWorldFile(zip);
    const els = await db.allElements(id);
    const onDisk = files.filter((f) => /^(elements|spatial)\/[a-z]+\/[^/]+\.json$/.test(f.path)).length;
    expect(els.length).toBe(onDisk);
    expect(els.find((e) => e.name === 'Admiral Fluffington')?.type).toBe('character');
  });

  it("opens an Atlas world's maps, pins, zones and markers (spatial/, Atlas's map_id spelling)", async () => {
    const dir = join(homedir(), 'Desktop/TESTOWFOLDER/onlyworlds-atlas/tuvsh-ul-019f6295');
    let files: { path: string; data: Uint8Array }[];
    try {
      const walk = (d: string, rel = ''): { path: string; data: Uint8Array }[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name), `${rel}${e.name}/`) : [{ path: `${rel}${e.name}`, data: new Uint8Array(readFileSync(join(d, e.name))) }],
        );
      files = walk(dir).filter((f) => !f.path.startsWith('media/'));
    } catch {
      return; // the Captain's folder is not on this machine
    }
    const count = (t: string) => files.filter((f) => f.path.startsWith(`spatial/${t}/`) && f.path.endsWith('.json')).length;
    expect(count('pin')).toBeGreaterThan(0); // the fixture fields the shape this test is about
    const zip = writeWorldFile(files, 'tuvsh-ul-019f6295');
    const read = readWorldFile(zip);
    await db.removeWorld(read.worldId);
    const id = await openWorldFile(zip);
    const els = await db.allElements(id);
    const of = (t: string) => els.filter((e) => e.type === t);
    for (const t of ['map', 'pin', 'zone', 'marker']) expect(of(t).length).toBe(count(t));
    const map = of('map')[0];
    expect(of('pin').every((p) => p.map === map.id && !('map_id' in p))).toBe(true);
    expect(of('marker').filter((m) => typeof m.zone === 'string').length).toBeGreaterThan(0);
    expect(of('marker').some((m) => 'zone_id' in m)).toBe(false);
  });

  it("a file with both map and map_id lands where Atlas puts it; one id in both folders is one element (the gate, C2 C3)", async () => {
    const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
    const wid = 'w0000000-0000-4000-8000-0000000000c2';
    const pin = 'b2222222-0000-4000-8000-000000000001';
    const zip = writeWorldFile(
      [
        { path: 'world.json', data: enc({ id: wid, name: 'Both names' }) },
        { path: 'spatial/pin/a.json', data: enc({ id: pin, name: 'Here', map_id: 'NEW', map: 'OLD', x: 1, y: 2 }) },
        { path: 'elements/pin/a.json', data: enc({ id: pin, name: 'Stale copy', map: 'OLD', x: 9, y: 9 }) },
      ],
      'both-names',
    );
    await db.removeWorld(wid);
    const id = await openWorldFile(zip);
    const els = await db.allElements(id);
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ name: 'Here', map: 'NEW' });
    expect('map_id' in els[0]).toBe(false);
    expect((await db.getWorldRecord(id))?.count).toBe(1);
  });

  it('a saved world keeps its pins under spatial/, with the schema\'s link names', () => {
    const { bytes } = toWorldFile({ id: 'w0000000-0000-4000-8000-000000000002', name: 'Pins', kind: 'local', addedAt: '' }, [
      { id: 'b1111111-0000-4000-8000-000000000001', type: 'map', name: 'Sea' },
      { id: 'b1111111-0000-4000-8000-000000000002', type: 'pin', name: 'Port', map: 'b1111111-0000-4000-8000-000000000001', x: 1, y: 2 },
      { id: 'b1111111-0000-4000-8000-000000000003', type: 'location', name: 'Port' },
    ]);
    const paths = readWorldFile(bytes).files.map((f) => f.path).sort();
    expect(paths).toEqual(['elements/location/port--00000003.json', 'spatial/map/sea--00000001.json', 'spatial/pin/port--00000002.json', 'world.json']);
  });
});
