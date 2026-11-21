import { OwApiError } from '@onlyworlds/sdk';
import * as db from './db';
import { ACCOUNT_PIN_HOLDER, pinHolder, type PinOwner } from './pin';

/**
 * keel's wait (429, Retry-After), read first by these sends, none of which goes out before it ends: the
 * outbox (so the poll, a new save, Send now and Try again), moving now, the world's PIN sheet and the
 * share sheet's PIN, Put it online, a key put in with a PIN, the /me that proves a PIN when a world is
 * opened with a key, and every read of a ten-digit key (they carry the PIN too: the poll, the roster, the
 * public page, files, doors, a file link and who I am). The time it ends is kept in the app database, so
 * a reload or a second window keeps it.
 *
 * Two places, as keel counts: too many wrong PINs lock the PIN's holder (an account and every world
 * that sends its PIN, keel's core/throttle.py; in Lantern the account's one PIN, or a world opened with
 * another's key and its own PIN), up to 901 s; any other 429 (a busy key) is the world's.
 *
 * The limit: a world opened with a key is the key's own PIN holder here, since Lantern cannot tell
 * whose PIN was typed. Opening one of the account's own worlds that way during the account's wait sends
 * that PIN once (a ten-digit key on its first read, a write key on its /me); keel refuses it with 429
 * and counts nothing (the lock is checked before the PIN).
 */

/** Said in place of a send during keel's wait: its words are the screen's. */
export class WaitSaid extends Error {}

/** keel's longest wait: the PIN lock, 900 s, and the one second its answer can add (core/throttle.py check). */
export const MAX_WAIT_S = 901;
/** A 429 that says no Retry-After waits a minute. */
const DEFAULT_WAIT_S = 60;

/** A daily or per-use allowance, said where it was met (a picture's day, an AI use): never a wait for sends. */
const NOT_THE_WORLDS = new Set(['quota_exceeded', 'use_ceiling', 'use_in_flight']);

export interface SendWait {
  /** When sends may start again (ms since the epoch). */
  until: number;
  /** keel's code for the wait (`rate_limited`: wrong PINs), when it named one. */
  code?: string;
}

/** Where a world's waits are kept: its own (a busy key), and its PIN holder's (the wrong-PIN lock). */
export interface WaitScope {
  world: string;
  pin: string;
}

/** A world's two places, from its record: the PIN's holder as Lantern keeps the PIN (src/pin.ts). */
export function waitScope(w: PinOwner): WaitScope {
  return { world: `world:${w.id}`, pin: pinHolder(w) };
}

const kvKey = (slot: string) => `sendWait:${slot}`;

/** Whether keel's answer asks sends to wait. */
export function holdsSends(e: unknown): boolean {
  return e instanceof OwApiError && e.status === 429 && !NOT_THE_WORLDS.has(e.code ?? '');
}

/** The seconds keel asked for, inside 1 and `MAX_WAIT_S`. */
export function waitSeconds(retryAfter: number | null | undefined): number {
  const s = typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? retryAfter : DEFAULT_WAIT_S;
  return Math.min(Math.max(Math.ceil(s), 1), MAX_WAIT_S);
}

/** One place's wait while it runs. Ended, unreadable or further off than keel ever asks (a clock set
 * back, a bad value): let go, and read as none. */
async function readSlot(slot: string, now: number): Promise<SendWait | null> {
  const w = await db.kvGet<SendWait>(kvKey(slot));
  if (!w) return null;
  const left = typeof w.until === 'number' ? w.until - now : NaN;
  if (Number.isFinite(left) && left > 0 && left <= MAX_WAIT_S * 1000) return w;
  await db.kvSet(kvKey(slot), undefined);
  return null;
}

/** The wait that holds this world's sends while it runs (the later of its two); null when none does. */
export async function readWait(scope: WaitScope, now = Date.now()): Promise<SendWait | null> {
  const [a, b] = await Promise.all([readSlot(scope.world, now), readSlot(scope.pin, now)]);
  if (!a || !b) return a ?? b;
  return a.until >= b.until ? a : b;
}

/** Start a wait from keel's 429 in the place keel counts it, keeping a longer one already running there. */
export async function holdSends(scope: WaitScope, e: { code?: string | null; retryAfter?: number | null }, now = Date.now()): Promise<SendWait> {
  const slot = e.code === 'rate_limited' ? scope.pin : scope.world;
  const until = now + waitSeconds(e.retryAfter) * 1000;
  const held = await readSlot(slot, now);
  const w: SendWait = held && held.until >= until ? held : { until, ...(e.code ? { code: e.code } : {}) };
  if (w !== held) await db.kvSet(kvKey(slot), w);
  // What holds the world now: this wait, or a later one in its other place.
  return (await readWait(scope, now)) ?? w;
}

/**
 * A fetch for a client whose answers it does not read one by one (Put it online's steps): any 429 that
 * holds sends starts the wait before the answer goes on to the caller.
 */
export function fetchThatHolds(scope: WaitScope): typeof fetch {
  return async (input, init) => {
    const res = await globalThis.fetch(input, init);
    if (res.status === 429) {
      let code: string | undefined;
      try {
        code = ((await res.clone().json()) as { error?: { code?: string } } | null)?.error?.code;
      } catch {
        /* not keel's envelope: a wait all the same */
      }
      const header = res.headers.get('Retry-After');
      const retryAfter = header !== null && header.trim() !== '' && Number.isFinite(Number(header)) ? Number(header) : null;
      if (!NOT_THE_WORLDS.has(code ?? '')) await holdSends(scope, { code, retryAfter });
    }
    return res;
  };
}

/** The minute it has ended by, as the phone's clock says it ("4:53 PM"): rounded up, never early. */
export function waitClock(w: SendWait): string {
  return new Date(Math.ceil(w.until / 60_000) * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** After a save while the wait runs: the change is kept, and when it goes. */
export function goesAtText(w: SendWait): string {
  return `It waits on this phone and goes by itself at ${waitClock(w)}.`;
}

/** Why sends wait, in a sentence. */
export function waitWhy(w: SendWait): string {
  return w.code === 'rate_limited'
    ? 'OnlyWorlds is holding off after too many wrong PINs.'
    : 'OnlyWorlds asked this phone to wait before sending more.';
}

/** The outbox's line: why, and when the changes go. */
export function waitText(w: SendWait): string {
  return `${waitWhy(w)} Your changes wait on this phone and go by themselves at ${waitClock(w)}.`;
}

/** For a send the person asked for (Put it online, moving now, a PIN, a key): why, and when to try again. */
export function tryAfterText(w: SendWait): string {
  return `${waitWhy(w)} Try again after ${waitClock(w)}.`;
}

/** The wait while no PIN is kept: the PIN is asked for only once it ends. */
export function pinAfterText(w: SendWait): string {
  return `${waitWhy(w)} Enter your PIN after ${waitClock(w)}; your changes wait on this phone.`;
}

/** Let the account's wrong-PIN wait go: a sign-out, or another account signing in (its lock is not theirs). */
export async function forgetAccountWait(): Promise<void> {
  await db.kvSet(kvKey(ACCOUNT_PIN_HOLDER), undefined);
}

/** A change behind one OnlyWorlds did not take, for the same element: it goes once that one is gone. */
export const HELD_TEXT = 'A change behind one OnlyWorlds did not take, above, goes once that one is tried again or let go.';

/** What the outbox and the home need to know to say when the waiting changes go. */
export interface WaitingState {
  /** Changes waiting (or being sent). */
  waiting: number;
  /** Of them, the ones held behind a change OnlyWorlds did not take for the same element. */
  held: number;
  /** keel's wait while it runs. */
  wait: SendWait | null;
  /** A PIN is kept for this world. */
  pinKnown: boolean;
  /** The PIN is being asked for (a send found none). */
  askPin: boolean;
}

/** Waiting to send's line under its changes; empty when none wait. */
export function waitingLine(st: WaitingState): string {
  if (!st.waiting) return '';
  if (st.held === st.waiting) return HELD_TEXT;
  const head = st.wait
    ? st.pinKnown
      ? waitText(st.wait)
      : pinAfterText(st.wait)
    : st.askPin
      ? 'They send as soon as the PIN is in.'
      : 'They send by themselves whenever the phone has signal.';
  return st.held ? `${head} ${HELD_TEXT}` : head;
}

/** The home's banner during keel's wait, or null when the wait says nothing there (none runs, nothing goes). */
export function homeWaitLine(st: WaitingState): string | null {
  if (!st.wait || st.waiting - st.held <= 0) return null;
  return st.pinKnown ? waitText(st.wait) : pinAfterText(st.wait);
}
