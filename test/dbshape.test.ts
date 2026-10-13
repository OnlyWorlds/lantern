// The day Lantern's database changes shape (the security pass, F7): a connection this build holds
// steps aside when a newer build asks for a newer version, so the upgrade is never blocked by an
// old tab; this build forgets its connection (an old tab then meets the update banner).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as db from '../src/db';

const upgradeTo = (name: string, version: number) =>
  new Promise<string>((res) => {
    const r = indexedDB.open(name, version);
    r.onsuccess = () => {
      r.result.close();
      res('opened');
    };
    r.onblocked = () => res('blocked');
    r.onerror = () => res('error');
  });

describe('a newer shape', () => {
  it('is never blocked by the connection this build holds', async () => {
    await db.kvSet('probe', 1); // the app database is open and held
    await db.applyElements('w-shape', [{ id: 'e1', type: 'character', name: 'Ada' }]); // a world's too
    expect(await upgradeTo('lantern', 2)).toBe('opened');
    expect(await upgradeTo('lantern-world-w-shape', 2)).toBe('opened');
  });
});
