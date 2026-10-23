// Put it online: a world on this phone becomes a world on the account, the one Atlas opens.
// The order is the safety: make the world (once, remembered for a retry), upload the pictures the
// phone holds, send every element in one atomic /bulk under a remembered Idempotency-Key, read the
// world back, and only when the count matches remove the phone-only copy.
import { OwApiError, OwV2Client } from '@onlyworlds/sdk';
import * as db from './db';
import { accountToken } from './account';
import { API_BASE, LANTERN_CLIENT_NAME, openWorld, forgetSession } from './world';
import { setPin } from './pin';
import { uuid7 } from './uuid7';
import { moveDraft } from './draft';
import { isKnownOf } from './knownof';

export const BULK_MAX = 1000;
const SERVER_OWNED = ['type', 'change_seq', 'created_at', 'updated_at', 'created_by'];

/** A data: address as its picture, read in place: the host's connect-src refuses a fetch of one (S409). */
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
  // online at all: nothing is made, nothing sent, the phone copy stays (the S444 gate, G1).
  const elements = await db.allElements(localId);
  const stubs = elements.filter((el) => isKnownOf(el)).length;
  if (stubs) {
    throw new Error(`This world is a player's view of a world online (${stubs} known of in it), so it cannot go online itself.`);
  }
  if (elements.length > BULK_MAX) {
    throw new Error(`This world has ${elements.length} elements; Lantern sends up to ${BULK_MAX} at once. Save a copy and open it in Atlas.`);
  }

  // 1. The world on the account, made once: a retry reuses it.
  let pending = rec.pendingOnline;
  if (!pending) {
    onStep('Making the world on your account');
    const acct = new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
    let made: { id: string; key: string };
    try {
      made = await acct.request('POST', '/account/worlds', { body: { name: rec.name } });
    } catch (e) {
      // An account without a PIN needs one with its first world; one that has a PIN refuses a new one.
      if (!(e instanceof OwApiError && e.status === 422 && e.param === 'pin')) throw e;
      if (!/^[1-9]\d{3}$/.test(pin)) throw new PinNeeded();
      made = await acct.request('POST', '/account/worlds', { body: { name: rec.name, pin } });
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
    const items = elements.map((el) => ({
      type: el.type,
      element: Object.fromEntries(Object.entries(el).filter(([k]) => !SERVER_OWNED.includes(k))) as Record<string, unknown>,
    }));
    const res = await client.bulk(items, { atomic: true, idempotencyKey: pending.bulkKey });
    if (res.errors) {
      const bad = res.items.find((x) => x.status >= 400);
      if (bad?.error?.code === 'id_conflict') {
        throw new Error('Some of these elements already live in another world online (a world file of an online world?). Nothing was sent.');
      }
      throw new Error(`Nothing was sent: ${bad?.error?.message ?? 'the server refused an element'}.`);
    }
  }
  if (rec.description) await client.patchWorld({ description: rec.description }).catch(() => undefined);

  // 4. Read it back as an ordinary online world.
  onStep('Checking what arrived');
  const online: db.WorldRecord = {
    id: pending.serverId,
    name: rec.name,
    description: rec.description,
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

  // 5. Only now: the phone-only copy goes. Its records and media files move across first: keel holds none, so
  // they are not the capture's to drop (folder spec §4.5 rule 6a).
  await db.putRecords(online.id, await db.getRecords(localId));
  await db.putMedia(online.id, await db.getMedia(localId));
  forgetSession(localId);
  await db.removeWorld(localId);
  moveDraft(localId, online.id);
  return online.id;
}

