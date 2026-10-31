// Put it online: a world on this phone becomes a world on the account, the one Atlas opens.
// The order is the safety: make the world with its own keys (once, remembered for a retry), upload the
// pictures the phone holds, send every element in one atomic /bulk under a remembered Idempotency-Key,
// send the description and the now, read the world back, and only when every element and every own key
// came back as sent remove the phone-only copy.
import { OwApiError, OwV2Client } from '@onlyworlds/sdk';
import * as db from './db';
import { accountToken } from './account';
import { API_BASE, LANTERN_CLIENT_NAME, openWorld, forgetSession } from './world';
import { setPin } from './pin';
import { uuid7 } from './uuid7';
import { moveDraft } from './draft';
import { isKnownOf } from './knownof';
import { withHiddenForCreate } from './hidden';
import { SERVED_TRIMMED } from './schema';

export const BULK_MAX = 1000;
// `x_served_trimmed` is keel's word on a body it served in part: kept in a world file, never sent up
// (keel refuses it with a 422; folder spec §4.4 rule 6).
const SERVER_OWNED = ['type', 'change_seq', 'created_at', 'updated_at', 'created_by', SERVED_TRIMMED];

/** A data: address as its picture, read in place: the host's connect-src refuses a fetch of one. */
export function dataUrlBlob(url: string): Blob {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) throw new Error('not a data address');
  const meta = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const type = meta.split(';')[0] || 'text/plain';
  if (!/;base64$/i.test(meta)) return new Blob([decodeURIComponent(body)], { type });
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** The World's own keys a world on this phone holds (another tool's settings, the strand's `x_strand`,
 * the names profile's `x_names`), as keel takes them on its world create: a null is no key there. */
export function worldOwnKeys(rec: db.WorldRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(rec.extensions ?? {}) };
  if (rec.names !== undefined) out.x_names = rec.names;
  // keel's served-trimmed word is never sent up (it refuses it); a null is no key.
  for (const [k, v] of Object.entries(out)) if (v === null || v === undefined || k === SERVED_TRIMMED) delete out[k];
  return out;
}

/** A JSON value with its object keys in order: keel stores a key's value as JSON and may hand its keys back reordered. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** The own keys keel does not serve back as sent: what a read of the world says did not land. */
export function keysNotLanded(sent: Record<string, unknown>, served: Record<string, unknown> | undefined): string[] {
  return Object.keys(sent).filter((k) => !served || !(k in served) || canonical(served[k]) !== canonical(sent[k]));
}

/** The maker's line keel takes on a create (`producer`: an object, its `tool` a string when present). */
function producerFor(rec: db.WorldRecord): Record<string, unknown> | undefined {
  const p = rec.producer;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined;
  if ('tool' in p && typeof p.tool !== 'string') return undefined;
  return p;
}

/** Put it online's own words: shown as they are, never read as a PIN refusal (a key's name can hold "pin"). */
export class OnlineSaid extends Error {}

const KEEL_INT_MIN = -2147483648;
const KEEL_INT_MAX = 2147483647;
/** keel's cap on a World's extension store, as its JSON in UTF-8 (elements/serialize.py EXTENSIONS_MAX_BYTES). */
export const WORLD_KEYS_MAX_BYTES = 64 * 1024;
const TIME_UNIT_MAX = 128;

/** A string keel cannot store: a NUL (Postgres refuses it) or half of a surrogate pair (keel's _check_unicode). */
function unstorable(v: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (typeof v === 'string') return /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v);
  if (Array.isArray(v)) return v.some((x) => unstorable(x, depth + 1));
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => unstorable(k, depth + 1) || unstorable(x, depth + 1));
  return false;
}

/**
 * What keel would refuse in the world's own settings, said before anything is made: a world made and then
 * refused its settings on every retry would sit half online for good, and the phone cannot change them.
 */
export function notSendable(rec: db.WorldRecord, ownKeys: Record<string, unknown>): string | null {
  const after = 'Open it in Atlas to change it. Nothing was sent.';
  if (rec.description !== undefined && unstorable(rec.description)) return `This world's description holds a character OnlyWorlds cannot keep. ${after}`;
  if (rec.timeUnit && rec.timeUnit.trim().length > TIME_UNIT_MAX) return `This world's time unit is longer than OnlyWorlds keeps (${TIME_UNIT_MAX} characters). ${after}`;
  if (rec.timeNow !== undefined && !(Number.isInteger(rec.timeNow) && rec.timeNow >= KEEL_INT_MIN && rec.timeNow <= KEEL_INT_MAX)) {
    return `This world's now (${rec.timeNow}) is not a whole number OnlyWorlds keeps. ${after}`;
  }
  const bad = Object.keys(ownKeys).find((k) => unstorable(k) || unstorable(ownKeys[k]));
  if (bad) return `This world's setting ${bad} holds a character OnlyWorlds cannot keep. ${after}`;
  const bytes = new TextEncoder().encode(JSON.stringify(ownKeys)).length;
  if (bytes > WORLD_KEYS_MAX_BYTES) return `This world's own settings are more than OnlyWorlds keeps for a world (${bytes} bytes, at most ${WORLD_KEYS_MAX_BYTES}). ${after}`;
  return null;
}

export class PinNeeded extends Error {
  constructor() {
    super('Choose a four-digit PIN for your account first.');
  }
}

export async function putOnline(localId: string, pin: string, onStep: (text: string) => void = () => {}): Promise<string> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first.');
  let rec = await db.getWorldRecord(localId);
  if (!rec || rec.kind !== 'local') throw new Error('This world is not a world on this phone.');
  // A stub (keel's known of) is never sent (the folder spec §4.4 rule 3), and the whole elements
  // beside it link to it, so a world holding one (a player's view, saved as a file) does not go
  // online at all: nothing is made, nothing sent, the phone copy stays (the stub gate, G1).
  const elements = await db.allElements(localId);
  const stubs = elements.filter((el) => isKnownOf(el)).length;
  if (stubs) {
    throw new Error(`This world is a player's view of a world online (${stubs} known of in it), so it cannot go online itself.`);
  }
  if (elements.length > BULK_MAX) {
    throw new Error(`This world has ${elements.length} elements; Lantern sends up to ${BULK_MAX} at once. Save a copy and open it in Atlas.`);
  }

  // 1. The world on the account, made once: a retry reuses it. Its own keys go with the create, so
  //    they land with the world in one write (keel d98ba65), and the maker's line as a courtesy:
  //    a line keel refuses goes once more without it, never a reason the world stays here.
  const ownKeys = worldOwnKeys(rec);
  const refused = notSendable(rec, ownKeys);
  if (refused) throw new OnlineSaid(refused);
  let pending = rec.pendingOnline;
  if (!pending) {
    onStep('Making the world on your account');
    const acct = new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
    let producer = producerFor(rec);
    const create = async (withPin?: string): Promise<{ id: string; key: string }> => {
      const body = () => ({ name: rec!.name, ...ownKeys, ...(producer ? { producer } : {}), ...(withPin ? { pin: withPin } : {}) });
      try {
        return await acct.request('POST', '/account/worlds', { body: body() });
      } catch (e) {
        if (!(e instanceof OwApiError && e.status === 422 && e.param === 'producer' && producer)) throw e;
        producer = undefined;
        return acct.request('POST', '/account/worlds', { body: body() });
      }
    };
    let made: { id: string; key: string };
    try {
      made = await create();
    } catch (e) {
      if (e instanceof OwApiError && e.status === 422 && e.param === 'extensions') {
        throw new OnlineSaid(`OnlyWorlds would not take this world's own settings (${e.message}). Nothing was sent.`);
      }
      // An account without a PIN needs one with its first world; one that has a PIN refuses a new one.
      if (!(e instanceof OwApiError && e.status === 422 && e.param === 'pin')) throw e;
      if (!/^[1-9]\d{3}$/.test(pin)) throw new PinNeeded();
      made = await create(pin);
    }
    pending = { serverId: made.id, key: made.key, bulkKey: uuid7() };
    rec = (await db.updateWorldRecord(localId, { pendingOnline: pending })) ?? rec;
  }
  const client = new OwV2Client({ apiKey: pending.key, apiPin: pin, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });

  // 2. Pictures the phone holds (data URLs) go to the edge first; the new address is kept on the
  //    phone before the bulk, so a retry sends the same body under the same key.
  const held = elements.filter((el) => typeof el.image_url === 'string' && el.image_url.startsWith('data:'));
  for (const [i, el] of held.entries()) {
    onStep(`Sending pictures · ${i + 1} of ${held.length}`);
    const blob = dataUrlBlob(el.image_url as string);
    const up = await client.uploadImage(blob);
    el.image_url = up.url;
    await db.applyElements(localId, [el]);
  }

  // 3. Every element in one atomic /bulk: links are checked against the batch, nothing half-lands.
  onStep(`Sending ${elements.length} elements`);
  if (elements.length) {
    // A hidden element goes up hidden (folder spec §4.8): the mark as the boolean keel
    // takes, and no key at all on any other, so a file's `false` or `null` is never sent.
    const items = elements.map((el) => ({
      type: el.type,
      element: withHiddenForCreate(Object.fromEntries(Object.entries(el).filter(([k]) => !SERVER_OWNED.includes(k)))),
    }));
    const res = await client.bulk(items, { atomic: true, idempotencyKey: pending.bulkKey });
    if (res.errors) {
      const bad = res.items.find((x) => x.status >= 400);
      if (bad?.error?.code === 'id_conflict') {
        throw new Error('Some of these elements already live in another world online (a world file of an online world?). Nothing was sent.');
      }
      // The world is the account's own, so its key can hide; said plainly if keel ever refuses it.
      if (bad?.error?.code === 'hidden_not_allowed') {
        throw new Error('OnlyWorlds would not take a hidden element from this key. Nothing was sent.');
      }
      throw new Error(`Nothing was sent: ${bad?.error?.message ?? 'the server refused an element'}.`);
    }
  }
  // The description and the world's now, which the create does not take. A refusal is said and the
  // phone copy kept: a retry reuses the world, replays the bulk under its key and sends these again.
  const settings: Record<string, unknown> = {};
  if (rec.description) settings.description = rec.description;
  // notSendable has read each one against keel's rules before the world was made.
  if (rec.timeNow !== undefined) settings.time_range_current = rec.timeNow;
  if (rec.timeUnit) settings.time_basic_unit = rec.timeUnit;
  // A PIN refusal keeps its kind, so the sheet says the PIN; any other refusal is said in its own words.
  const settingsRefused = (e: unknown) =>
    e instanceof OwApiError && e.status === 401
      ? e
      : new OnlineSaid(`The world is online, but OnlyWorlds would not take its settings (${e instanceof Error ? e.message : String(e)}). Your phone copy is kept; try again.`);
  if (Object.keys(settings).length) {
    try {
      await client.request('PATCH', '/world', { body: settings });
    } catch (e) {
      throw settingsRefused(e);
    }
  }

  // 4. Read it back as an ordinary online world: every element, and every own key as it was sent.
  onStep('Checking what arrived');
  const online: db.WorldRecord = {
    id: pending.serverId,
    name: rec.name,
    description: rec.description,
    ...(rec.producer !== undefined ? { producer: rec.producer } : {}),
    kind: 'online',
    apiKey: pending.key,
    keyKind: 'write',
    role: 'owner',
    addedAt: new Date().toISOString(),
  };
  await db.putWorldRecord(online);
  setPin(online, pin);
  forgetSession(online.id);
  const s = await openWorld(online.id);
  await s.pull();
  const arrived = s.elements().length;
  if (s.status !== 'idle' || arrived !== elements.length) {
    throw new Error(`The world is online, but only ${arrived} of ${elements.length} elements read back. Your phone copy is kept; try again.`);
  }
  // A key the read does not serve as sent (a retry over a world made before its keys went with the
  // create, or a create that dropped them) goes once by PATCH, and the world is read again.
  let missing = keysNotLanded(ownKeys, s.rec.extensions);
  if (missing.length) {
    try {
      await client.request('PATCH', '/world', { body: Object.fromEntries(missing.map((k) => [k, ownKeys[k]])) });
    } catch (e) {
      throw settingsRefused(e);
    }
    await s.pull();
    missing = keysNotLanded(ownKeys, s.rec.extensions);
    if (missing.length) {
      throw new OnlineSaid(`The world is online, but its own settings did not read back (${missing.join(', ')}). Your phone copy is kept; try again.`);
    }
  }

  // 5. Only now: the phone-only copy goes. Its records and media files move across first: keel holds none, so
  // they are not the capture's to drop (folder spec §4.5 rule 6a).
  await db.putRecords(online.id, await db.getRecords(localId));
  await db.putMedia(online.id, await db.getMedia(localId));
  forgetSession(localId);
  await db.removeWorld(localId);
  moveDraft(localId, online.id);
  return online.id;
}

