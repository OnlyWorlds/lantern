// World files: one .zip holding a world folder (world.json, elements/<type>/*.json, and maps,
// pins, zones and markers under spatial/<type>/), the way Atlas keeps a world on disk (SDK
// readWorldFile/writeWorldFile). A world on this phone only is saved as one, and any world file
// opens as a world on this phone.
import { readWorldFile, SPATIAL_TYPES, writeWorldFile, type OwElement, type OwWorldFileEntry } from '@onlyworlds/sdk';
import * as db from './db';
import { isType } from './schema';

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

export function toWorldFile(rec: db.WorldRecord, elements: OwElement[]): { bytes: Uint8Array; name: string } {
  const world: Record<string, unknown> = { id: rec.id, name: rec.name };
  if (rec.description) world.description = rec.description;
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
  const top = `${slugify(rec.name) || 'world'}-${rec.id.slice(0, 8)}`;
  return { bytes: writeWorldFile(files, top), name: `${top}.zip` };
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
      byId.set(body.id, { el: { ...body, type: m[2] } as OwElement, home });
    } catch {
      /* a file that is not JSON is skipped, as Atlas skips it */
    }
  }
  const elements = [...byId.values()].map((x) => x.el);
  const rec: db.WorldRecord = {
    id: read.worldId,
    name: read.name || 'Opened world',
    description: typeof read.world.description === 'string' ? read.world.description : undefined,
    kind: 'local',
    count: elements.length,
    addedAt: new Date().toISOString(),
  };
  await db.applyElements(rec.id, elements);
  await db.putWorldRecord(rec);
  return rec.id;
}
