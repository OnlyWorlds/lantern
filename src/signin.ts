// Sign in with OnlyWorlds (Atlas 1.87.0's twin). The
// SDK's two calls: `signInWithOnlyWorlds` sends the phone to onlyworlds.com with a PKCE challenge,
// `completeSignIn` trades the code on `/signin/callback`. Lantern keeps no resume of its own: where
// the person goes after is what the store holds (an invitation waiting, else Your worlds).
import { OwV2Client, OwSignInError, detectKeyKind } from '@onlyworlds/sdk';
import * as db from './db';
import { API_BASE, LANTERN_CLIENT_NAME } from './world';
import { fetchAccountWorlds, keepAccount, revokeIfNotKept, type AccountWho } from './account';
import { afterSignInHash } from './opendoor';

/** keel's registry (`GET /api/v2/auth/clients`) lists `lantern` with exactly this address, production only. */
export const SIGN_IN_CLIENT_ID = 'lantern';
export const SIGN_IN_REDIRECT_URI = 'https://lantern.onlyworlds.com/signin/callback';
export const SIGN_IN_CALLBACK_PATH = '/signin/callback';
const SIGN_IN_ORIGIN = new URL(SIGN_IN_REDIRECT_URI).origin;
/** The SDK's record key (its RECORD_PREFIX and the client id): read to know whether this phone started one. */
export const SIGN_IN_RECORD_KEY = `ow_signin:${SIGN_IN_CLIENT_ID}`;

/** How long the exchange may take before the person is told: the SDK reads an abort as offline. */
export const SIGN_IN_EXCHANGE_LIMIT_MS = 20_000;

/**
 * Offered only on the registered origin (L1): from the preview host or a local build the round trip
 * would come back to production Lantern, another origin with other storage.
 */
export function canSignInWithOnlyWorlds(origin: string = globalThis.location?.origin ?? ''): boolean {
  return origin === SIGN_IN_ORIGIN;
}

export function isSignInCallback(pathname: string = globalThis.location?.pathname ?? ''): boolean {
  return pathname.replace(/\/$/, '') === SIGN_IN_CALLBACK_PATH;
}

type RecordStore = { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void };

/**
 * The record lives in localStorage, not the tab (L5): an installed phone app can come back from
 * onlyworlds.com in another browsing context of the same browser (a mail link's tab, a hand-off to
 * the browser), where a tab's own storage is empty. The trade (the sign-in gate's G5): every Lantern
 * window on this browser shares it, the last tap wins, and it stays until a completion, a sign-in by
 * any door or a sign-out clears it.
 */
function recordStore(): RecordStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v), remove: (k) => ls.removeItem(k) };
  } catch {
    return null;
  }
}

export const NEEDS_SIGNAL_LINE = 'Signing in needs signal.';

/** Send the phone to onlyworlds.com. Throws (in Lantern's words) when it cannot leave. */
export async function beginOnlyWorldsSignIn(navigate?: (url: string) => void): Promise<void> {
  if (globalThis.navigator?.onLine === false) throw new Error(NEEDS_SIGNAL_LINE);
  const storage = recordStore();
  if (!storage) throw new Error('This browser keeps no storage for Lantern, so the sign-in could not come back here. Use your email or username and password.');
  await new OwV2Client({ baseUrl: API_BASE, client: LANTERN_CLIENT_NAME }).signInWithOnlyWorlds({
    clientId: SIGN_IN_CLIENT_ID,
    redirectUri: SIGN_IN_REDIRECT_URI,
    storage,
    ...(navigate ? { navigate } : {}),
  });
}

export type SignInOutcome =
  | { ok: true; token: string; tokenId: string | null; account: AccountWho }
  | { ok: false; cancelled: boolean; error: unknown };

function fetchWithin(limitMs: number): typeof fetch {
  return (input, init) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), limitMs);
    return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
  };
}

/** Where the callback page goes while the exchange runs: the router shows "Signing in…" there. */
export const SIGNING_IN_HASH = '#/signing-in';

/** This browser kept no storage for Lantern, so no record could be read (the sign-in gate's G8). */
class NoStorage extends Error {}

/**
 * On `/signin/callback`, at module load, before any other request to onlyworlds.com (L3): the SDK
 * takes `code` and `state` out of the address before its first await, and this sets the address to
 * `/#/signing-in` before returning, so the router reads that and never the share target's query.
 */
export function startSignInCallback(href: string = location.href, fetchImpl?: typeof fetch): Promise<SignInOutcome> {
  const cancelled = new URL(href).searchParams.get('error') === 'access_denied';
  const storage = recordStore();
  const client = new OwV2Client({ baseUrl: API_BASE, client: LANTERN_CLIENT_NAME, fetch: fetchImpl ?? fetchWithin(SIGN_IN_EXCHANGE_LIMIT_MS) });
  const pending = storage
    ? client.completeSignIn({ clientId: SIGN_IN_CLIENT_ID, url: href, storage })
    : Promise.reject(new NoStorage('no storage'));
  try {
    history.replaceState(null, '', `/${SIGNING_IN_HASH}`);
  } catch {
    /* the address stays; the router still runs */
  }
  return pending.then(
    (r): SignInOutcome => ({ ok: true, token: r.token, tokenId: r.tokenId ?? null, account: { id: r.account.id, username: r.account.username } }),
    (error: unknown): SignInOutcome => ({ ok: false, cancelled, error }),
  );
}

/** What to tell the person when the round trip did not sign them in. Never keel's text (L6). */
export function signInCallbackLine(outcome: { cancelled: boolean; error: unknown }): string {
  if (outcome.cancelled) return 'Sign in with OnlyWorlds was cancelled. Nothing changed.';
  const err = outcome.error;
  if (err instanceof NoStorage) return 'This browser keeps no storage for Lantern, so the sign-in could not finish here. Use your email or username and password.';
  if (err instanceof OwSignInError) {
    switch (err.reason) {
      case 'state_mismatch':
        return 'That sign-in was not started here, so Lantern did not finish it. Tap Sign in with OnlyWorlds again.';
      case 'invalid_grant':
        return 'OnlyWorlds did not take that sign-in: it may have waited too long. Tap Sign in with OnlyWorlds again.';
      case 'rate_limited':
        return 'Too many sign-ins in a short time. Wait a moment and try again.';
      case 'offline':
        return 'OnlyWorlds could not be reached, so the sign-in did not finish. With signal, tap Sign in with OnlyWorlds again.';
      default:
        break;
    }
  }
  return 'Signing in with OnlyWorlds did not work. Try again in a moment.';
}

export const NOT_KEPT_LINE = 'This phone did not keep the sign-in. Try again, or use your email or username and password.';

/** What the sign-in screen says once, after a round trip that came back refused. */
let notice: string | null = null;
export function takeSignInNotice(): string | null {
  const n = notice;
  notice = null;
  return n;
}
export function setSignInNotice(line: string): void {
  notice = line;
}

/** Said once on the screen the return lands on: who this phone is now signed in as (the sign-in gate's G1). */
let welcome: string | null = null;
export function takeSignedInLine(): string | null {
  const w = welcome;
  welcome = null;
  return w;
}

/**
 * After the exchange: the hash to land on. The token is kept before anything else is asked (L4); a
 * return that is no sign-in to a phone already signed in is silent (L7, the sign-in gate's G5: a
 * signed-in phone shows no button, so it started nothing it still wants); a refusal goes to the
 * sign-in screen with its sentence (L6).
 */
export async function applySignInOutcome(outcome: SignInOutcome): Promise<string> {
  if (outcome.ok) {
    if (detectKeyKind(outcome.token) !== 'account') {
      notice = NOT_KEPT_LINE;
      return '#/signin';
    }
    try {
      await keepAccount(outcome.token, outcome.account, outcome.tokenId);
    } catch (e) {
      // Only a failure to keep is "not kept" (the sign-in code gate's C12); a token nobody kept is revoked.
      console.warn('[sign-in] not kept:', e);
      void revokeIfNotKept(outcome.token, outcome.tokenId).catch(() => undefined);
      notice = NOT_KEPT_LINE;
      return '#/signin';
    }
    welcome = outcome.account.username ? `Signed in as ${outcome.account.username}.` : 'Signed in.';
    // The list of worlds is asked after the token is safe; a failure here leaves the token, and
    // Your worlds asks again.
    await fetchAccountWorlds(outcome.token).catch(() => undefined);
    return afterSignInHash();
  }
  const signedIn = Boolean(await db.kvGet<string>('accountToken'));
  if (signedIn && !outcome.cancelled && outcome.error instanceof OwSignInError && outcome.error.reason === 'state_mismatch') {
    return '#/worlds';
  }
  if (!outcome.cancelled) console.warn('[sign-in] the return did not sign in:', outcome.error);
  notice = signInCallbackLine(outcome);
  return '#/signin';
}
