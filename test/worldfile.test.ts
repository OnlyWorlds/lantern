// World files: a phone-only world saved and opened again comes back whole, with Atlas's names.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readWorldFile, writeWorldFile } from '@onlyworlds/sdk';
import { openWorldFile, slugify, toWorldFile } from '../src/worldfile';
import * as db from '../src/db';


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
    const dir = 'C:/Users/Titus/Desktop/TESTOWFOLDER/onlyworlds-atlas/moppetopia-sample-55a9b4d5';
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
    const onDisk = files.filter((f) => /^elements\/[a-z]+\/[^/]+\.json$/.test(f.path)).length;
    expect(els.length).toBe(onDisk);
    expect(els.find((e) => e.name === 'Admiral Fluffington')?.type).toBe('character');
  });
});
