import { OwApiError } from '@onlyworlds/sdk';
import * as db from './db';

/**
 * One wait for a world's sends. keel answers 429 with how long to wait (Retry-After): too many wrong
 * PINs lock the account's keys for up to 15 minutes, a busy key for up to a minute. While the wait
 * runs nothing that carries the PIN goes out for that world: the outbox, the poll, a new save, Put it
 * online, moving now, the PIN sheet. The time it ends is kept in the app database, so a reload or a
 * second window keeps it too.
 */

/** keel's longest wait: the PIN lock (core/throttle.py LOCK_SECONDS). */
export const MAX_WAIT_S = 900;
/** A 429 that says no Retry-After waits a minute. */
const DEFAULT_WAIT_S = 60;

/** A daily or per-use allowance, said where it was met (a picture's day, an AI use): never the world's wait. */
const NOT_THE_WORLDS = new Set(['quota_exceeded', 'use_ceiling', 'use_in_flight']);

export interface SendWait {
  /** When sends may start again (ms since the epoch). */
  until: number;
  /** keel's code for the wait (`rate_limited`: wrong PINs), when it named one. */
  code?: string;
}

const kvKey = (worldId: string) => `sendWait:${worldId}`;

/** Whether keel's answer asks the whole world's sends to wait. */
export function holdsSends(e: unknown): boolean {
  return e instanceof OwApiError && e.status === 429 && !NOT_THE_WORLDS.has(e.code ?? '');
}

/** The seconds keel asked for, inside 1 and `MAX_WAIT_S`. */
export function waitSeconds(retryAfter: number | null | undefined): number {
  const s = typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? retryAfter : DEFAULT_WAIT_S;
  return Math.min(Math.max(Math.ceil(s), 1), MAX_WAIT_S);
}

/** The world's wait while it runs; null when there is none or it has ended (and then it is let go). */
export async function readWait(worldId: string, now = Date.now()): Promise<SendWait | null> {
  const w = await db.kvGet<SendWait>(kvKey(worldId));
  if (!w || typeof w.until !== 'number') return null;
  if (w.until <= now) {
    await db.kvSet(kvKey(worldId), undefined);
    return null;
  }
  return w;
}

/** Start the world's wait from keel's 429, keeping a longer one already running. */
export async function holdSends(worldId: string, e: { code?: string | null; retryAfter?: number | null }, now = Date.now()): Promise<SendWait> {
  const until = now + waitSeconds(e.retryAfter) * 1000;
  const held = await readWait(worldId, now);
  if (held && held.until >= until) return held;
  const w: SendWait = { until, ...(e.code ? { code: e.code } : {}) };
  await db.kvSet(kvKey(worldId), w);
  return w;
}

/**
 * A fetch for a client whose answers it does not read one by one (Put it online's steps): any 429 that
 * is the world's starts the world's wait before the answer goes on to the caller.
 */
export function fetchThatHolds(worldId: string): typeof fetch {
  return async (input, init) => {
    const res = await globalThis.fetch(input, init);
    if (res.status === 429) {
      let code: string | undefined;
      try {
        code = ((await res.clone().json()) as { error?: { code?: string } } | null)?.error?.code;
      } catch {
        /* not keel's envelope: the world's wait all the same */
      }
      const header = res.headers.get('Retry-After');
      const retryAfter = header !== null && header.trim() !== '' && Number.isFinite(Number(header)) ? Number(header) : null;
      if (!NOT_THE_WORLDS.has(code ?? '')) await holdSends(worldId, { code, retryAfter });
    }
    return res;
  };
}

/** The time it ends, as the phone's clock says it: "14:32". */
export function waitClock(w: SendWait): string {
  return new Date(w.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** After a save while the wait runs: the change is kept, and when it goes. */
export function goesAtText(w: SendWait): string {
  return `It waits on this phone and goes by itself at ${waitClock(w)}.`;
}

/** Why the world waits, in a sentence. */
export function waitWhy(w: SendWait): string {
  return w.code === 'rate_limited'
    ? 'OnlyWorlds is holding off after too many wrong PINs.'
    : 'OnlyWorlds asked this phone to wait before sending more.';
}

/** The outbox's line: why, and when the changes go. */
export function waitText(w: SendWait): string {
  return `${waitWhy(w)} Your changes wait on this phone and go by themselves at ${waitClock(w)}.`;
}

/** For a send the person asked for (Put it online, moving now, a PIN): why, and when to try again. */
export function tryAfterText(w: SendWait): string {
  return `${waitWhy(w)} Try again after ${waitClock(w)}.`;
}
