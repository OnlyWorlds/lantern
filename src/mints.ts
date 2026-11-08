// A key mint whose answer was lost, found and taken back.
//
// keel shows a minted key's secret once and never replays a mint, so a lost answer used to leave a
// live key on the person's account that nobody held. Every mint now carries an Idempotency-Key, kept
// on the phone before the send; keel keeps only its hash on the key's row, and
// GET /account/worlds/{id}/keys/made?key= names that row (its id and `revoked`, never its secret;
// a revoked key's row still answers). A mint that got no answer asks it at once and takes the key
// back by the id keel named; one the phone could not ask about then is asked again when the phone
// comes back online or into view, and one a reload cut off by the sweep at the next start. Nothing is
// ever taken back by a name or a list.

import { OwV2Client, type OwMintedKey, type OwWorldKeyRow } from '@onlyworlds/sdk';
import * as db from './db';
import { API_BASE, LANTERN_CLIENT_NAME } from './world';
import { uuid7 } from './uuid7';

/** One mint sent and not yet settled: the world, the key it went under, the account's id, the last six
 * characters of the sign-in it went under (keel's lookup answers per account, so "none made" counts only
 * under that sign-in), when. */
export interface MintAsk {
  worldId: string;
  key: string;
  account: string;
  tail?: string;
  at: string;
}

/** One kv row per ask (`db.kvList`): two tabs minting at once never lose each other's ask. */
const ASK = 'pendingMint:';
/** A sweep leaves another tab's younger ask alone: that tab may hold its answer and be storing it now. */
export const SWEEP_AFTER_MS = 2 * 60_000;
/** A mint's answer waits at most this long, by the clock, so no answer is used after another tab's sweep:
 * the abort's timer stops while a page is frozen, so an answer that lands later is also read as lost. */
export const MINT_LIMIT_MS = 60_000;
/** Any ask is dropped after this long: for an account no longer signed in here, or a keel that can't say. */
export const FORGET_AFTER_MS = 7 * 24 * 60 * 60_000;
const LIMIT_MS = 8000;
/** keel made no key by it: the SDK's lookup reads keel's 404 (none found) and 405 (a keel before the
 * lookup) as null; a 501 says the same and still arrives as an error. */
const NONE_MADE = new Set([404, 405, 501]);

/** This tab's own asks whose lookup failed: asked again at once when the phone is back, never left to the age rule. */
const ownUnsettled = new Set<string>();

function client(token: string): OwV2Client {
  return new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
}

export async function pendingMints(): Promise<MintAsk[]> {
  return db.kvList<MintAsk>(ASK);
}

async function dropAsk(key: string): Promise<void> {
  ownUnsettled.delete(key);
  try {
    await db.kvSet(ASK + key, undefined);
  } catch {
    // Left for the sweep, which finds the key held or gone.
  }
}

function bounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), LIMIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  return typeof s === 'number' && s > 0 ? s : undefined;
}

/**
 * Mint a world key under a kept Idempotency-Key. A refusal (4xx) made nothing and drops the ask; any
 * other failure (no answer within a minute included) may have come after keel minted, so the key that
 * call made is asked for and taken back before the error goes on. The ask is dropped once the answer
 * is in: the caller stores the key in the same turn, and no sweep reads an ask that young.
 */
export async function mintKey<T extends { key: string; id?: string } = OwMintedKey>(
  token: string, worldId: string, body: { scope?: 'read' | 'write'; name?: string; keep?: boolean },
): Promise<T> {
  const ask: MintAsk = { worldId, key: uuid7(), account: (await db.kvGet<string>('accountId')) ?? '', tail: token.slice(-6), at: new Date().toISOString() };
  await db.kvSet(ASK + ask.key, ask);
  let minted: T;
  try {
    minted = (await client(token).mintWorldKey(worldId, {
      ...body, idempotencyKey: ask.key, signal: AbortSignal.timeout(MINT_LIMIT_MS),
    })) as unknown as T;
  } catch (e) {
    const s = statusOf(e);
    if (s !== undefined && s >= 400 && s < 500) await dropAsk(ask.key);
    // Taken back now, settled. "None made" right after a failure may be a mint keel is still
    // writing (a timeout ends the wait, not keel's work): the ask is kept for one more look.
    else if ((await settle(token, ask)) === 'gone') await dropAsk(ask.key);
    else ownUnsettled.add(ask.key);
    throw e;
  }
  if (Date.now() - Date.parse(ask.at) >= MINT_LIMIT_MS) {
    // A frozen page's answer, landing after a sweep may already have taken this key back: lost too.
    if ((await settle(token, ask)) === 'gone') await dropAsk(ask.key);
    else ownUnsettled.add(ask.key);
    throw new Error('OnlyWorlds took too long to make a key for this phone. Try again.');
  }
  await dropAsk(ask.key);
  return minted;
}

/**
 * Ask keel which key this ask's mint made and take it back by that id: 'gone' when the key it made is
 * taken back (now, or already) or held by this phone, 'none' when keel made none by it, 'unknown' when
 * keel could not be asked (offline, a timeout, a dead sign-in).
 */
async function settle(token: string, ask: MintAsk, held?: Set<string>): Promise<'gone' | 'none' | 'unknown'> {
  const c = client(token);
  let row: OwWorldKeyRow | null;
  try {
    // null: keel made no key by it (its 404), or a keel from before the lookup (405).
    row = await bounded(c.madeWorldKey(ask.worldId, ask.key));
  } catch (e) {
    const s = statusOf(e);
    return s !== undefined && NONE_MADE.has(s) ? 'none' : 'unknown';
  }
  if (row === null) return 'none';
  if (!row?.id) return 'unknown';
  if (row.revoked === true) return 'gone'; // keel keeps a revoked key's row: already taken back
  if (held?.has(row.id)) return 'gone'; // the phone holds this key: its answer landed after all
  try {
    await bounded(c.request('DELETE', `/account/worlds/${ask.worldId}/keys/${encodeURIComponent(row.id)}`));
    return 'gone';
  } catch (e) {
    const s = statusOf(e);
    return s === 404 || s === 410 ? 'gone' : 'unknown';
  }
}

/** Every key id a world record on this phone holds, its own key's and a put's pending one. */
async function heldKeyIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const rec of await db.listWorlds()) {
    if (rec.keyMint?.id) ids.add(rec.keyMint.id);
    const put = rec.pendingOnline;
    if (put && 'keyMint' in put && put.keyMint?.id) ids.add(put.keyMint.id);
  }
  return ids;
}

let sweeping: Promise<void> | null = null;

/**
 * Settle every ask for the account signed in now that is this tab's own or older than two minutes;
 * any ask past a week is dropped. At start, and again when the phone comes back online or into view.
 * Quiet: a failure leaves the ask for the next time. One sweep at a time per tab.
 */
export function sweepLostMints(now?: number): Promise<void> {
  sweeping ??= sweep(now ?? Date.now()).finally(() => { sweeping = null; });
  return sweeping;
}

async function sweep(now: number): Promise<void> {
  const asks = await pendingMints();
  if (!asks.length) return;
  const token = await db.kvGet<string>('accountToken');
  const account = (await db.kvGet<string>('accountId')) ?? '';
  const held = await heldKeyIds();
  for (const ask of asks) {
    const age = now - Date.parse(ask.at);
    if (Number.isNaN(age) || age >= FORGET_AFTER_MS) {
      if (token && ask.account === account) await settle(token, ask, held);
      await dropAsk(ask.key);
      continue;
    }
    if (age < SWEEP_AFTER_MS && !ownUnsettled.has(ask.key)) continue;
    if (!token || ask.account !== account) continue;
    const said = await settle(token, ask, held);
    // "None made" ends an ask only once keel has had two minutes to finish a mint it was still writing,
    // and only under the sign-in it was sent with (another sign-in's lookup sees none of its keys).
    if (said === 'gone' || (said === 'none' && age >= SWEEP_AFTER_MS && ask.tail === token.slice(-6))) await dropAsk(ask.key);
  }
}

/** The sweep's later times: back online, or back into view (a phone's tab wakes far more than it starts). */
export function watchLostMints(): void {
  const again = () => void sweepLostMints().catch(() => undefined);
  window.addEventListener('online', again);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') again();
  });
}
