// The phone's store: IndexedDB, one app database (the world list and settings) and one
// database per world (its elements as the API returned them, and the outbox).
import type { OwElement, OwKeyKind } from '@onlyworlds/sdk';

export type WorldKind = 'online' | 'local' | 'demo';

export interface WorldRecord {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  /** The world's now and its unit (keel's time_range_current, time_basic_unit): src/time.ts. */
  timeNow?: number;
  timeUnit?: string;
  /** The world's own words for the types (keel's `x_names`, the names profile), verbatim: src/schema.ts typeName. */
  names?: unknown;
  /** Who made this world's folder (folder spec §4.2): Lantern's own line for a world born here, a
   * file's own line kept verbatim for one opened from it, null when that file had none (written
   * once, by the maker: Lantern never claims a world it only saved). Absent on a record from before. */
  producer?: Record<string, unknown> | null;
  kind: WorldKind;
  /** The world key (ow_w_, ow_r_ or a legacy 10-digit key). Absent for a world on this phone only. */
  apiKey?: string;
  keyKind?: OwKeyKind;
  /** From the account list: owner, or collaborator with a member role. */
  role?: 'owner' | 'collaborator';
  memberRole?: 'co_builder' | 'contributor' | 'guest';
  /** A player's own Character, from keel's /me (Skeld #3457); null once asked and there is none. */
  characterId?: string | null;
  /** Joined with a player link, no account (Keel #353): a read key only, so nothing is ever shared from it. */
  playerSeat?: boolean;
  /** The game master's choice of which Collective is the party (Give it to the party), kept per world. */
  partyId?: string;
  count?: number;
  /** The /changes cursor: opaque, stored verbatim. */
  cursor?: string;
  /** The feed's head when the last walk finished: the quiet poll's "anything new?" compares with it. */
  appliedHead?: number | string;
  /** keel's view epoch (a guest's; null for everyone else) the last walk ran under (SDK changesAll's return);
   * unknown on a copy from before S397, which costs its next poll one walk. */
  appliedEpoch?: number | null;
  lastSync?: string;
  /** Put it online, under way: the account world already made, and the bulk's key, so a retry repeats nothing. */
  pendingOnline?: { serverId: string; key: string; bulkKey: string };
  /** A world on this phone only: when a world file was last saved from it. */
  lastCopy?: string;
  addedAt: string;
}

export type OutboxState = 'waiting' | 'sending' | 'needs-you' | 'gone' | 'refused';

export interface OutboxRow {
  seq?: number;
  op: 'patch' | 'create' | 'delete';
  type: string;
  id: string;
  /** A delete: what the element was called, for Waiting to send (it is no longer on the screen). */
  name?: string;
  /**
   * A create: false until its first send starts. A create never tried has never reached keel, so a
   * delete can drop it with nothing sent; a row from before this flag (undefined) counts as tried.
   */
  tried?: boolean;
  /** The element as it was when the edit started (patch only): the base the conflict rule compares. */
  base?: OwElement;
  /** The edit follows an unsettled row for the same element: its base is taken when it is sent. */
  lateBase?: boolean;
  /** The fields this edit sets. */
  values: Record<string, unknown>;
  idempotencyKey?: string;
  /** A queued photo, already converted and shrunk; uploaded before the write, then set as image_url. */
  photo?: Blob;
  state: OutboxState;
  /** needs-you: the server's copy when it refused (412). */
  current?: OwElement;
  error?: string;
  createdAt: string;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
  });
}

/**
 * `gone`: this connection closed because a newer build asked for a newer shape (another tab, or
 * the page after a reload). The caller forgets it, so the next use opens the new shape; without
 * this an old tab left open would block the upgrade (the security pass, F7).
 */
function open(name: string, version: number, upgrade: (db: IDBDatabase) => void, gone?: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = () => upgrade(r.result);
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        gone?.();
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error(`database ${name} is blocked by another tab`));
  });
}

// ---------- the app database ----------

let appDb: Promise<IDBDatabase> | null = null;
function app(): Promise<IDBDatabase> {
  appDb ??= open(
    'lantern',
    1,
    (db) => {
      db.createObjectStore('worlds', { keyPath: 'id' });
      db.createObjectStore('kv');
    },
    () => (appDb = null),
  ).catch((e) => {
    appDb = null; // a blocked or failed open is tried again next time, not cached
    throw e;
  });
  return appDb;
}

export async function listWorlds(): Promise<WorldRecord[]> {
  const db = await app();
  return req(db.transaction('worlds').objectStore('worlds').getAll() as IDBRequest<WorldRecord[]>);
}

export async function getWorldRecord(id: string): Promise<WorldRecord | undefined> {
  const db = await app();
  return req(db.transaction('worlds').objectStore('worlds').get(id) as IDBRequest<WorldRecord | undefined>);
}

export async function putWorldRecord(w: WorldRecord): Promise<void> {
  const db = await app();
  const t = db.transaction('worlds', 'readwrite');
  t.objectStore('worlds').put(w);
  await done(t);
}

export async function updateWorldRecord(id: string, patch: Partial<WorldRecord>): Promise<WorldRecord | undefined> {
  const db = await app();
  const t = db.transaction('worlds', 'readwrite');
  const s = t.objectStore('worlds');
  const cur = (await req(s.get(id))) as WorldRecord | undefined;
  if (cur) s.put({ ...cur, ...patch });
  await done(t);
  return cur ? { ...cur, ...patch } : undefined;
}

/**
 * A world file's `records/` entries, kept byte-exact for the next copy (folder spec §4.5 rule 6:
 * a tool that rewrites a folder copies records through untouched). Lantern never reads them.
 */
export interface RecordFile {
  path: string;
  data: Uint8Array;
}
const recordsKey = (id: string) => `records-${id}`;

export async function getRecords(worldId: string): Promise<RecordFile[]> {
  return (await kvGet<RecordFile[]>(recordsKey(worldId))) ?? [];
}

export async function putRecords(worldId: string, files: RecordFile[]): Promise<void> {
  await kvSet(recordsKey(worldId), files.length ? files : undefined);
}

export async function removeWorld(id: string): Promise<void> {
  const db = await app();
  const t = db.transaction(['worlds', 'kv'], 'readwrite');
  t.objectStore('worlds').delete(id);
  t.objectStore('kv').delete(recordsKey(id));
  await done(t);
  worldDbs.get(id)?.then((d) => d.close());
  worldDbs.delete(id);
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(worldDbName(id));
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await app();
  return req(db.transaction('kv').objectStore('kv').get(key) as IDBRequest<T | undefined>);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await app();
  const t = db.transaction('kv', 'readwrite');
  if (value === undefined) t.objectStore('kv').delete(key);
  else t.objectStore('kv').put(value, key);
  await done(t);
}

// ---------- one database per world ----------

const worldDbs = new Map<string, Promise<IDBDatabase>>();
const worldDbName = (id: string) => `lantern-world-${id}`;

function world(id: string): Promise<IDBDatabase> {
  let p = worldDbs.get(id);
  if (!p) {
    p = open(
      worldDbName(id),
      1,
      (db) => {
        db.createObjectStore('elements', { keyPath: 'id' });
        db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      },
      () => worldDbs.delete(id),
    ).catch((e) => {
      worldDbs.delete(id);
      throw e;
    });
    worldDbs.set(id, p);
  }
  return p;
}

export async function allElements(worldId: string): Promise<OwElement[]> {
  const db = await world(worldId);
  return req(db.transaction('elements').objectStore('elements').getAll() as IDBRequest<OwElement[]>);
}

/** Apply upserts and deletes in one transaction. */
export async function applyElements(worldId: string, puts: OwElement[], deletes: string[] = []): Promise<void> {
  if (!puts.length && !deletes.length) return;
  const db = await world(worldId);
  const t = db.transaction('elements', 'readwrite');
  const s = t.objectStore('elements');
  for (const el of puts) s.put(el);
  for (const id of deletes) s.delete(id);
  await done(t);
}

export async function clearElements(worldId: string): Promise<void> {
  const db = await world(worldId);
  const t = db.transaction('elements', 'readwrite');
  t.objectStore('elements').clear();
  await done(t);
}

export async function outboxRows(worldId: string): Promise<OutboxRow[]> {
  const db = await world(worldId);
  return req(db.transaction('outbox').objectStore('outbox').getAll() as IDBRequest<OutboxRow[]>);
}

export async function putOutboxRow(worldId: string, row: OutboxRow): Promise<number> {
  const db = await world(worldId);
  const t = db.transaction('outbox', 'readwrite');
  const key = await req(t.objectStore('outbox').put(row));
  await done(t);
  return key as number;
}

export async function deleteOutboxRow(worldId: string, seq: number): Promise<void> {
  const db = await world(worldId);
  const t = db.transaction('outbox', 'readwrite');
  t.objectStore('outbox').delete(seq);
  await done(t);
}

/** A row leaves the outbox and the server's answer lands in the store, together. */
export async function settleOutboxRow(worldId: string, seq: number, el: OwElement | null): Promise<void> {
  const db = await world(worldId);
  const t = db.transaction(['outbox', 'elements'], 'readwrite');
  t.objectStore('outbox').delete(seq);
  if (el) t.objectStore('elements').put(el);
  await done(t);
}

/** Ask the browser to keep this site's storage, and read back what it decided. */
export async function persistStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persisted) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    await navigator.storage.persist?.();
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}
