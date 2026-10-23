// World files: one .zip holding a world folder (world.json, elements/<type>/*.json, and maps,
// pins, zones and markers under spatial/<type>/), the way Atlas keeps a world on disk (SDK
// readWorldFile/writeWorldFile). A world on this phone only is saved as one, and any world file
// opens as a world on this phone.
import { readWorldFile, SPATIAL_TYPES, writeWorldFile, type OwElement, type OwWorldFileEntry } from '@onlyworlds/sdk';
import * as db from './db';
import { isType } from './schema';
import { clockFrom } from './time';
import { BUILD_ID } from './app-state';
import { fromWire } from './knownof';

const SPATIAL = new Set<string>(SPATIAL_TYPES);
/** Where a type's files live in a world folder. */
export function folderOf(type: string): string {
  return SPATIAL.has(type) ? 'spatial' : 'elements';
}

/**
 * Atlas wrote pin and marker links suffixed (`map_id`, `zone_id`) before the format settled on
 * the schema's names (Atlas `disk-link-names.ts`): read either, keep the schema's in Lantern.
 */
const SUFFIXED: Record<string, string[]> = { pin: ['map'], marker: ['map', 'zone'] };
function schemaLinks(type: string, body: Record<string, unknown>): void {
  for (const f of SUFFIXED[type] ?? []) {
    const disk = `${f}_id`;
    // Atlas reads the suffixed name when a file has both: so does Lantern, or one file means two maps.
    if (disk in body) {
      body[f] = body[disk];
      delete body[disk];
    }
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Atlas's filename rule (tools/atlas/src/store/fs-utils.ts): `<slug>--<last 8 of the id>.json`. */
export function slugify(name: string): string {
  const s = (name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length <= 40 ? s : s.slice(0, 40).replace(/-+$/g, '');
}

function fileName(id: string, name: string | undefined, used: Set<string>): string {
  const slug = slugify(name ?? '');
  if (!slug) return `${id}.json`;
  const short = `${slug}--${id.slice(-8)}.json`;
  return used.has(short.toLowerCase()) ? `${slug}--${id}.json` : short;
}

/** The producer line of a world born on this phone (folder spec §4.2: `bare`, a world born empty in a tool). */
export function lanternProducer(): Record<string, unknown> {
  return { tool: 'lantern', version: BUILD_ID, input: 'bare' };
}

/** A world.json's producer line, an object kept verbatim, or null when it has none. */
function producerLineOf(world: unknown): Record<string, unknown> | null {
  const p = world && typeof world === 'object' ? (world as Record<string, unknown>).producer : undefined;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
}

const RECORDS_MANIFEST = 'records/RECORDS.json';

/** What Save a copy asks before it hands a file over (folder spec §4.5 rule 11, OW-8). */
export type CopyQuestion = { kind: 'private'; producers: string[] } | { kind: 'unreadable' };

/** The producer a `records/<producer>/…` path belongs to, or null. */
function producerOf(path: string): string | null {
  const segs = path.split('/');
  return segs.length > 2 && segs[0] === 'records' ? segs[1] : null;
}

/**
 * A copy of a world on this phone, the parts it keeps unread carried through (`kept`: its records/
 * and media/, as they came). The SDK decides which records are
 * private and leaves them out unless asked; which went is read back from the file itself, so
 * Lantern holds no copy of the rule (Atlas's way, 1.82.0). No bytes when the records list will not
 * read: nothing is left out by guess, so the person asks for every record or makes no copy.
 */
export function worldCopy(
  rec: db.WorldRecord,
  elements: OwElement[],
  kept: db.RecordFile[],
  includePrivateRecords = false,
): { bytes: Uint8Array | null; name: string; question?: CopyQuestion } {
  try {
    const made = toWorldFile(rec, elements, kept, includePrivateRecords);
    if (includePrivateRecords) return made;
    const had = new Set(kept.map((f) => producerOf(f.path)).filter((p): p is string => p !== null));
    if (!had.size) return made;
    const inFile = new Set(readWorldFile(made.bytes).files.map((f) => producerOf(f.path)));
    const producers = [...had].filter((p) => !inFile.has(p)).sort();
    return producers.length ? { ...made, question: { kind: 'private', producers } } : made;
  } catch (e) {
    // Lantern's options are always well formed, so the writer's TypeError is the records list.
    if (e instanceof TypeError && !includePrivateRecords && kept.some((f) => f.path === RECORDS_MANIFEST)) {
      return { bytes: null, name: '', question: { kind: 'unreadable' } };
    }
    throw e;
  }
}

export function toWorldFile(
  rec: db.WorldRecord,
  elements: OwElement[],
  kept: db.RecordFile[] = [],
  includePrivateRecords = false,
): { bytes: Uint8Array; name: string } {
  const world: Record<string, unknown> = { id: rec.id, name: rec.name };
  if (rec.description) world.description = rec.description;
  // The folder spec's names for the clock (Atlas reads both spellings of now).
  if (rec.timeNow !== undefined) world.time_current = rec.timeNow;
  if (rec.timeUnit) world.time_basic_unit = rec.timeUnit;
  if (rec.names !== undefined) world.x_names = rec.names;
  if (rec.producer) world.producer = rec.producer;
  const files: OwWorldFileEntry[] = [{ path: 'world.json', data: enc.encode(JSON.stringify(world, null, 2) + '\n') }];
  const used = new Map<string, Set<string>>();
  for (const el of [...elements].sort((a, b) => a.id.localeCompare(b.id))) {
    const { type, ...body } = el;
    const dir = used.get(type) ?? new Set<string>();
    used.set(type, dir);
    const fn = fileName(el.id, el.name, dir);
    dir.add(fn.toLowerCase());
    files.push({ path: `${folderOf(type)}/${type}/${fn}`, data: enc.encode(JSON.stringify(body, null, 2) + '\n') });
  }
  // As they came, byte for byte (rule 6, OW-9); the writer leaves private records out unless asked.
  for (const f of kept) files.push({ path: f.path, data: f.data });
  const top = `${slugify(rec.name) || 'world'}-${rec.id.slice(0, 8)}`;
  return { bytes: writeWorldFile(files, top, { includePrivateRecords }), name: `${top}.zip` };
}

/** Hand the file to the phone: the share sheet where there is one (Save to Files), else a download. */
export async function saveFile(bytes: Uint8Array, name: string): Promise<'shared' | 'downloaded'> {
  const file = new File([bytes as BlobPart], name, { type: 'application/zip' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return 'shared';
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

/** Open a world file as a world on this phone. Returns its id; an id already here is refused. */
export async function openWorldFile(bytes: Uint8Array): Promise<string> {
  const read = readWorldFile(bytes);
  if (await db.getWorldRecord(read.worldId)) {
    throw new Error(`"${read.name || 'This world'}" is already on this phone.`);
  }
  // One element per id. A file in its type's own folder beats a copy in the other one.
  const byId = new Map<string, { el: OwElement; home: boolean }>();
  for (const f of read.files) {
    const m = f.path.match(/^(elements|spatial)\/([a-z]+)\/[^/]+\.json$/);
    // Either folder is read: an earlier Lantern saved pins under elements/.
    if (!m || !isType(m[2])) continue;
    try {
      const body = JSON.parse(dec.decode(f.data)) as Record<string, unknown>;
      if (typeof body.id !== 'string') continue;
      schemaLinks(m[2], body);
      // A world folder's files carry no type: the folder names it.
      const home = folderOf(m[2]) === m[1];
      if (byId.get(body.id)?.home && !home) continue;
      // A stub from a file is trimmed as one from keel is (another tool may keep more on it; the S444 gate, G4).
      byId.set(body.id, { el: fromWire({ ...body, type: m[2] } as OwElement), home });
    } catch {
      /* a file that is not JSON is skipped, as Atlas skips it */
    }
  }
  const elements = [...byId.values()].map((x) => x.el);
  const rec: db.WorldRecord = {
    id: read.worldId,
    name: read.name || 'Opened world',
    description: typeof read.world.description === 'string' ? read.world.description : undefined,
    timeNow: clockFrom(read.world as Record<string, unknown>).now,
    timeUnit: clockFrom(read.world as Record<string, unknown>).unit,
    names: (read.world as Record<string, unknown>).x_names,
    producer: producerLineOf(read.world),
    kind: 'local',
    count: elements.length,
    addedAt: new Date().toISOString(),
  };
  // A file's records and media are kept unread for its next copy (rule 6, OW-9); the reader hands
  // over every one.
  const part = (p: string) => read.files.filter((f) => f.path.startsWith(p)).map((f) => ({ path: f.path, data: f.data }));
  await db.applyElements(rec.id, elements);
  await db.putRecords(rec.id, part('records/'));
  await db.putMedia(rec.id, part('media/'));
  await db.putWorldRecord(rec);
  return rec.id;
}
