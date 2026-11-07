// Put it online: a world on this phone becomes a world on the account, the one Atlas opens.
// The order is the safety. The world and every element go in one write, keel's hand-over, all or
// nothing, so an element keel refuses leaves no world behind. That send carries an Idempotency-Key
// kept on the phone before it goes, so a retry after a lost answer gets the first world back. From
// that moment the phone copy holds still (read only here) until the put is finished or started over,
// so a retry sends the very same body. Then a key for this phone, the pictures the phone holds and
// one atomic /bulk that sets them, the description and the now, a read back, and only when every
// element, picture and own key came back as sent does the phone-only copy go.
import { OwApiError, OwV2Client } from '@onlyworlds/sdk';
import * as db from './db';
import { KEPT, accountName, accountToken, deviceName } from './account';
import { API_BASE, LANTERN_CLIENT_NAME, openWorld, forgetSession } from './world';
import { setPin } from './pin';
import { uuid7 } from './uuid7';
import { moveDraft } from './draft';
import { isKnownOf } from './knownof';
import { withHiddenForCreate } from './hidden';
import { SERVED_TRIMMED } from './schema';
import { mintOf } from './revoke';

export const BULK_MAX = 1000;
/** keel's media tickets for one world in a day (KEEL_MEDIA_TICKETS_PER_DAY) and the size of one picture. */
export const PICTURES_MAX = 200;
export const PICTURE_MAX_BYTES = 15_000_000;
/** keel reads at most 2.5 MB of a request body (a 413 past it); Lantern keeps a margin under it. */
export const BODY_MAX_BYTES = 2_400_000;
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

/** A put whose world may already be on the account, which this phone cannot find: Start over is offered. */
export class StartOverOffered extends OnlineSaid {}

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

/** A put under way since the hand-over: the phone copy holds still until it is finished or started over. */
export function isPutting(rec: db.WorldRecord | undefined): boolean {
  return !!rec && rec.kind === 'local' && !!rec.pendingOnline && (rec.pendingOnline as db.PendingOnlineV2).v === 2;
}

function isV2(p: db.WorldRecord['pendingOnline']): p is db.PendingOnlineV2 {
  return !!p && (p as db.PendingOnlineV2).v === 2;
}

const START_OVER =
  'Your last try may already have put this world online on your account. Look in Your worlds: if it is there, open it from there. Start over makes a new one.';

/** The sentence that refuses a put under an account it was not started under. */
async function otherAccount(p: db.PendingOnlineV2): Promise<OnlineSaid | null> {
  const me = await db.kvGet<string>('accountId');
  if (!p.account || !me || p.account === me) return null;
  return new OnlineSaid(`This world is being put online under ${p.accountName || 'another account'}. Sign in as it to finish.`);
}

/**
 * Let go of a put that cannot be finished from here: the phone copy is writable again and the next try
 * makes a new world. Refused under another sign-in than the put's own.
 */
export async function startOver(localId: string): Promise<void> {
  const rec = await db.getWorldRecord(localId);
  if (!rec || rec.kind !== 'local' || !rec.pendingOnline) return;
  if (isV2(rec.pendingOnline)) {
    const other = await otherAccount(rec.pendingOnline);
    if (other) throw other;
  }
  await db.updateWorldRecord(localId, { pendingOnline: undefined });
  forgetSession(localId);
}

/** No answer came, or keel failed after it may have written: the send counts as unanswered. */
function noAnswer(e: unknown): boolean {
  return !(e instanceof OwApiError) || e.status >= 500;
}

type Slot = { status?: number; error?: { code?: string; message?: string } };

function slotsOf(e: OwApiError): Slot[] {
  const d = e.detail as { items?: unknown } | null;
  return d && Array.isArray(d.items) ? (d.items as Slot[]) : [];
}

/** What the hand-over refused, in a sentence: the first refused slot that is not only a link to another refused one. */
function refusalLine(e: OwApiError, items: { element: Record<string, unknown> }[]): string {
  const slots = slotsOf(e);
  if (slots.some((s) => s.error?.code === 'id_conflict')) {
    return 'Some of these elements already live in another world online (a world file of an online world?). Nothing was made.';
  }
  const refused = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.error);
  const pick = refused.find(({ s }) => s.error?.code !== 'invalid_link') ?? refused[0];
  if (!pick) return `OnlyWorlds would not take this world (${e.message}). Nothing was made.`;
  const el = items[pick.i]?.element ?? {};
  const name = typeof el.name === 'string' && el.name.trim() ? el.name.trim() : 'an element';
  return `OnlyWorlds would not take ${name} (${pick.s.error?.message ?? pick.s.error?.code ?? 'refused'}). Nothing was made.`;
}

/** An element as it goes up: without the server's own keys, hidden as keel takes it. */
function bodyOf(el: Record<string, unknown>): Record<string, unknown> {
  return withHiddenForCreate(Object.fromEntries(Object.entries(el).filter(([k]) => !SERVER_OWNED.includes(k))));
}

const isHeld = (el: Record<string, unknown>) => typeof el.image_url === 'string' && el.image_url.startsWith('data:');

/** The pictures a world holds on the phone and the hand-over's body, checked against keel's caps before anything is made. */
function tooMuch(held: Record<string, unknown>[], body: unknown): string | null {
  const after = 'Save a copy and open it in Atlas. Nothing was made.';
  if (held.length > PICTURES_MAX) return `This world holds ${held.length} pictures; OnlyWorlds takes ${PICTURES_MAX} for a new world in a day. ${after}`;
  const big = held.find((el) => dataUrlBlob(el.image_url as string).size > PICTURE_MAX_BYTES);
  if (big) return `The picture of ${typeof big.name === 'string' && big.name ? big.name : 'an element'} is more than OnlyWorlds takes (15 MB). ${after}`;
  const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
  if (bytes > BODY_MAX_BYTES) return `This world is more than OnlyWorlds takes in one go (${(bytes / 1e6).toFixed(1)} MB of text, at most ${BODY_MAX_BYTES / 1e6}). ${after}`;
  return null;
}

export async function putOnline(localId: string, pin: string, onStep: (text: string) => void = () => {}): Promise<string> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first.');
  let rec = await db.getWorldRecord(localId);
  if (!rec || rec.kind !== 'local') throw new Error('This world is not a world on this phone.');
  const elements = await db.allElements(localId);
  // A put begun by an earlier Lantern (its world already made, its key known) finishes on its own path.
  if (rec.pendingOnline && !isV2(rec.pendingOnline)) return finishOld(rec, rec.pendingOnline, elements, pin, onStep);

  // A stub (keel's known of) is never sent (the folder spec §4.4 rule 3), and the whole elements
  // beside it link to it, so a world holding one (a player's view, saved as a file) does not go
  // online at all: nothing is made, nothing sent, the phone copy stays (the stub gate, G1).
  const stubs = elements.filter((el) => isKnownOf(el)).length;
  if (stubs) {
    throw new Error(`This world is a player's view of a world online (${stubs} known of in it), so it cannot go online itself.`);
  }
  if (elements.length > BULK_MAX) {
    throw new Error(`This world has ${elements.length} elements; Lantern sends up to ${BULK_MAX} at once. Save a copy and open it in Atlas.`);
  }
  const ownKeys = worldOwnKeys(rec);
  const refused = notSendable(rec, ownKeys);
  if (refused) throw new OnlineSaid(refused);
  const held = elements.filter((el) => isHeld(el as Record<string, unknown>)) as Record<string, unknown>[];
  // Every element goes in the hand-over without a picture the phone holds: a picture needs the world's key.
  const items = elements.map((el) => {
    const body = bodyOf(el as Record<string, unknown>);
    if (isHeld(body)) delete body.image_url;
    return { type: el.type, element: body };
  });

  let pending = rec.pendingOnline as db.PendingOnlineV2 | undefined;
  if (pending) {
    const other = await otherAccount(pending);
    if (other) throw other;
  }

  // 1. The world, made once. The hand-over makes it with every element, or nothing; a world with no
  //    elements goes by the create (the hand-over takes one or more). The PIN goes with it, checked
  //    before anything is written. Its own keys go with it, and the maker's line as a courtesy: a
  //    line keel refuses goes once more without it.
  if (!pending?.serverId) {
    let producer = producerFor(rec);
    let withPin: string | undefined = pin || undefined;
    const route = elements.length ? 'handover' : 'create';
    const bodyFor = () => {
      const world = { name: rec!.name, ...ownKeys, ...(producer ? { producer } : {}), ...(withPin ? { pin: withPin } : {}) };
      return route === 'handover' ? { world, items } : world;
    };
    if (!pending) {
      const said = tooMuch(held, bodyFor());
      if (said) throw new OnlineSaid(said);
      pending = {
        v: 2,
        account: (await db.kvGet<string>('accountId')) ?? '',
        accountName: await accountName(),
        route,
        sendKey: uuid7(),
        picturesKey: uuid7(),
      };
      rec = (await db.updateWorldRecord(localId, { pendingOnline: pending })) ?? rec;
      // The phone copy holds still from here: an open view reads the record again.
      forgetSession(localId);
    }
    const p: db.PendingOnlineV2 = pending;
    // Whether an earlier send of this put went out and never answered: then this one is its retry.
    const retry = !!p.unanswered;
    const settle = async (patch: Partial<db.PendingOnlineV2> | null) => {
      if (patch === null) {
        await db.updateWorldRecord(localId, { pendingOnline: undefined });
        forgetSession(localId);
        return;
      }
      Object.assign(p, patch);
      await db.updateWorldRecord(localId, { pendingOnline: { ...p } });
    };
    const acct = new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
    onStep(route === 'handover' ? `Sending the world and its ${elements.length} elements` : 'Making the world on your account');
    let made: { id: string; key?: string } | undefined;
    for (let attempt = 0; !made && attempt < 3; attempt++) {
      await settle({ unanswered: true });
      try {
        const res = await acct.request<{ id?: string; key?: string; world?: { id: string } }>(
          'POST',
          route === 'handover' ? '/account/worlds/handover' : '/account/worlds',
          { body: bodyFor(), idempotencyKey: p.sendKey, elementWrite: true },
        );
        made = route === 'handover' ? { id: res.world!.id } : { id: res.id!, key: res.key };
      } catch (e) {
        if (noAnswer(e)) {
          throw new OnlineSaid('No answer from OnlyWorlds. Your phone copy is kept and waits; try again when you have signal.');
        }
        const err = e as OwApiError;
        // An answer: this send wrote nothing.
        await settle({ unanswered: retry });
        if (err.status === 422 && err.param === 'producer' && producer) {
          producer = undefined;
          continue;
        }
        if (err.status === 422 && err.param === 'pin') {
          // A keel before the PIN check refuses a pinned account's PIN: the create goes without it.
          if (withPin && !retry) {
            withPin = undefined;
            continue;
          }
          await settle(retry ? {} : null);
          throw new PinNeeded();
        }
        if (err.status === 401 && err.param === 'pin') {
          if (retry) throw new OnlineSaid('That PIN does not match your account. Type the PIN you used on the last try.');
          await settle(null);
          throw new OnlineSaid('That PIN does not match your account. Nothing was made.');
        }
        if (err.status === 401) {
          if (retry) throw new OnlineSaid("OnlyWorlds no longer takes this phone's sign-in. Sign in again, then finish putting it online.");
          await settle(null);
          throw new OnlineSaid("OnlyWorlds no longer takes this phone's sign-in. Sign in again, then put it online. Nothing was made.");
        }
        if (err.status === 429) {
          const mins = Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60));
          const wait = `Too many wrong PINs: OnlyWorlds waits before taking another. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
          if (retry) throw new OnlineSaid(wait);
          await settle(null);
          throw new OnlineSaid(`${wait} Nothing was made.`);
        }
        // The same key with another body: the PIN typed differently from the send that never answered.
        if (err.status === 409 && err.code === 'idempotency_error') {
          throw new OnlineSaid('That PIN differs from your last try. Type the PIN you used on the last try.');
        }
        if (err.status === 409 && err.code === 'idempotency_in_flight') {
          await settle({ unanswered: true });
          throw new OnlineSaid('OnlyWorlds is still making this world. Try again in a minute.');
        }
        if (err.code === 'handover_refused') {
          // On a retry, every id held elsewhere may be this phone's own first world (a keel that does not
          // replay a lost answer): it cannot be found from here, so the phone says so and offers Start over.
          const slots = slotsOf(err);
          if (retry && slots.length && slots.every((s) => s.error?.code === 'id_conflict')) {
            await settle({ unanswered: true });
            throw new StartOverOffered(START_OVER);
          }
          if (retry) throw new StartOverOffered(`${refusalLine(err, items)} ${START_OVER}`);
          await settle(null);
          throw new OnlineSaid(refusalLine(err, items));
        }
        if (err.status === 413) {
          await settle(retry ? {} : null);
          throw new OnlineSaid('This world is more than OnlyWorlds takes in one go. Save a copy and open it in Atlas. Nothing was made.');
        }
        if (err.status === 422 && err.param === 'extensions') {
          if (!retry) await settle(null);
          throw new OnlineSaid(`OnlyWorlds would not take this world's own settings (${err.message}). Nothing was sent.`);
        }
        if (!retry) await settle(null);
        throw new OnlineSaid(`OnlyWorlds would not make this world (${err.message}).${retry ? '' : ' Nothing was made.'}`);
      }
    }
    if (!made) throw new OnlineSaid('OnlyWorlds would not make this world. Nothing was made.');
    await settle({ unanswered: false, serverId: made.id, ...(made.key ? { key: made.key } : {}) });
    pending = p;
  }

  // 2. A key for this phone: the hand-over makes none, and a replayed create carries none. Kept across a
  //    sign-out like every key Lantern mints, with its id, so removing the world later takes it back.
  const p = pending!;
  if (!p.key) {
    onStep('Making a key for this phone');
    const acct = new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
    try {
      const k = await acct.request<{ key: string; id?: string }>('POST', `/account/worlds/${p.serverId}/keys`, {
        body: { scope: 'write', name: `Lantern on ${deviceName()}`, ...KEPT },
      });
      p.key = k.key;
      p.keyMint = mintOf(k.key, k.id);
      await db.updateWorldRecord(localId, { pendingOnline: { ...p } });
    } catch (e) {
      if (e instanceof OwApiError && e.status === 401) {
        throw new OnlineSaid("The world is online, but OnlyWorlds no longer takes this phone's sign-in. Sign in again, then finish putting it online.");
      }
      throw new OnlineSaid(`The world is online, but this phone could not get its key (${e instanceof Error ? e.message : String(e)}). Your phone copy is kept; try again.`);
    }
  }
  const client = new OwV2Client({ apiKey: p.key, apiPin: pin, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });

  // 3. The pictures the phone holds go to the edge on the new key, each address kept as it comes, then
  //    one atomic /bulk sends the same elements whole with their pictures (an element with an id is
  //    replaced whole), under a kept key, so a retry sends nothing twice.
  if (held.length) {
    const pics = { ...(p.pictures ?? {}) };
    try {
      for (const [i, el] of held.entries()) {
        if (pics[el.id as string]) continue;
        onStep(`Sending pictures · ${i + 1} of ${held.length}`);
        const up = await client.uploadImage(dataUrlBlob(el.image_url as string));
        pics[el.id as string] = up.url;
        p.pictures = { ...pics };
        await db.updateWorldRecord(localId, { pendingOnline: { ...p } });
      }
      onStep('Setting the pictures');
      const withPictures = held.map((el) => ({ type: el.type as string, element: { ...bodyOf(el), image_url: pics[el.id as string] } }));
      const res = await client.bulk(withPictures, { atomic: true, idempotencyKey: p.picturesKey });
      if (res.errors) {
        const bad = res.items.find((x) => x.status >= 400);
        throw new Error(bad?.error?.message ?? 'refused');
      }
    } catch (e) {
      // A PIN refusal keeps its kind, so the sheet says the PIN.
      if (e instanceof OwApiError && e.status === 401) throw e;
      throw new OnlineSaid(`The world is online, but its pictures did not arrive (${e instanceof Error ? e.message : String(e)}). Your phone copy is kept; try again.`);
    }
  }

  await sendSettings(client, rec);
  return readBackAndFinish(rec, p.serverId!, p.key, p.keyMint, elements.length, ownKeys, client, pin, onStep, p.pictures ?? {});
}

/** The description and the world's now, which neither the create nor the hand-over takes. */
async function sendSettings(client: OwV2Client, rec: db.WorldRecord): Promise<void> {
  const settings: Record<string, unknown> = {};
  if (rec.description) settings.description = rec.description;
  // notSendable has read each one against keel's rules before the world was made.
  if (rec.timeNow !== undefined) settings.time_range_current = rec.timeNow;
  if (rec.timeUnit) settings.time_basic_unit = rec.timeUnit;
  if (Object.keys(settings).length) {
    try {
      await client.request('PATCH', '/world', { body: settings });
    } catch (e) {
      throw settingsRefused(e);
    }
  }
}

/** A PIN refusal keeps its kind, so the sheet says the PIN; any other refusal is said in its own words. */
function settingsRefused(e: unknown): Error {
  return e instanceof OwApiError && e.status === 401
    ? e
    : new OnlineSaid(`The world is online, but OnlyWorlds would not take its settings (${e instanceof Error ? e.message : String(e)}). Your phone copy is kept; try again.`);
}

/** Read the world back as an ordinary online world: every element, every picture and every own key as sent; then the phone copy goes. */
async function readBackAndFinish(
  rec: db.WorldRecord,
  serverId: string,
  key: string,
  keyMint: db.WorldRecord['keyMint'],
  sent: number,
  ownKeys: Record<string, unknown>,
  client: OwV2Client,
  pin: string,
  onStep: (text: string) => void,
  pictures: Record<string, string>,
): Promise<string> {
  const localId = rec.id;
  onStep('Checking what arrived');
  const online: db.WorldRecord = {
    id: serverId,
    name: rec.name,
    description: rec.description,
    ...(rec.producer !== undefined ? { producer: rec.producer } : {}),
    kind: 'online',
    apiKey: key,
    keyKind: 'write',
    ...(keyMint ? { keyMint } : {}),
    role: 'owner',
    addedAt: new Date().toISOString(),
  };
  await db.putWorldRecord(online);
  setPin(online, pin);
  forgetSession(online.id);
  const s = await openWorld(online.id);
  await s.pull();
  const arrived = s.elements();
  if (s.status !== 'idle' || arrived.length !== sent) {
    throw new Error(`The world is online, but only ${arrived.length} of ${sent} elements read back. Your phone copy is kept; try again.`);
  }
  const byId = new Map(arrived.map((el) => [el.id, el as Record<string, unknown>]));
  const missingPictures = Object.entries(pictures).filter(([id, url]) => byId.get(id)?.image_url !== url).length;
  if (missingPictures) {
    throw new OnlineSaid(`The world is online, but ${missingPictures} of its pictures did not read back. Your phone copy is kept; try again.`);
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

  // Only now: the phone-only copy goes. Its records and media files move across first: keel holds none, so
  // they are not the capture's to drop (folder spec §4.5 rule 6a).
  await db.putRecords(online.id, await db.getRecords(localId));
  await db.putMedia(online.id, await db.getMedia(localId));
  forgetSession(localId);
  await db.removeWorld(localId);
  moveDraft(localId, online.id);
  return online.id;
}

/**
 * A put an earlier Lantern began: its world was made by the create and its key is known, so the
 * elements go by one atomic /bulk under the kept key, as they did then. Elements an id held elsewhere
 * refuses leave that world empty, so Start over is offered with where the empty world is.
 */
async function finishOld(
  rec: db.WorldRecord,
  pending: db.PendingOnlineV1,
  elements: Awaited<ReturnType<typeof db.allElements>>,
  pin: string,
  onStep: (text: string) => void,
): Promise<string> {
  const localId = rec.id;
  const ownKeys = worldOwnKeys(rec);
  const client = new OwV2Client({ apiKey: pending.key, apiPin: pin, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
  const held = elements.filter((el) => isHeld(el as Record<string, unknown>));
  for (const [i, el] of held.entries()) {
    onStep(`Sending pictures · ${i + 1} of ${held.length}`);
    const up = await client.uploadImage(dataUrlBlob(el.image_url as string));
    el.image_url = up.url;
    await db.applyElements(localId, [el]);
  }
  onStep(`Sending ${elements.length} elements`);
  if (elements.length) {
    const items = elements.map((el) => ({ type: el.type, element: bodyOf(el as Record<string, unknown>) }));
    const res = await client.bulk(items, { atomic: true, idempotencyKey: pending.bulkKey });
    if (res.errors) {
      const bad = res.items.find((x) => x.status >= 400);
      const empty = 'An empty world of this name stays on your account from that try; delete it on onlyworlds.com if you like.';
      if (bad?.error?.code === 'id_conflict') {
        throw new StartOverOffered(`Some of these elements already live in another world online (a world file of an online world?). ${empty} Start over tries again from the start.`);
      }
      if (bad?.error?.code === 'hidden_not_allowed') {
        throw new OnlineSaid('OnlyWorlds would not take a hidden element from this key. Nothing was sent.');
      }
      throw new StartOverOffered(`Nothing was sent: ${bad?.error?.message ?? 'the server refused an element'}. ${empty} Start over tries again from the start.`);
    }
  }
  await sendSettings(client, rec);
  return readBackAndFinish(rec, pending.serverId, pending.key, undefined, elements.length, ownKeys, client, pin, onStep, {});
}
