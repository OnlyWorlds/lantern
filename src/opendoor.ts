// The open door: a link `#/open/<world id>[/element/<id>]` (Open in Lantern on onlyworlds.com, Atlas's
// own door spelled the same) opens that world on this phone, and the element when it names one.
// The ids are no credential: the signed-in account is. A world already on the phone opens at once;
// one from the account opens only after the person says Open, since that makes a key on keel.
import { OwAddressError, parseOwLink } from '@onlyworlds/sdk';
import * as db from './db';
import type { AccountWorld } from './account';

/** keel's world ids and element ids are UUIDs. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A link waits this long for a sign-in; a later sign-in (days on) lands on Your worlds, not on it. */
export const OPEN_WAIT_MS = 60 * 60 * 1000;

/** How long the door waits for the account's list of worlds before saying it could not read it. */
export const ACCOUNT_LIST_MS = 15_000;

/** What a link asked for. `world` is '' when the link's id did not look like one (a cut-short paste). */
export interface OpenWant {
  world: string;
  element?: string;
  /** When the link was followed (ms), so a link left waiting lapses. */
  at?: number;
}

/**
 * Reads `/open/<world>[/element/<id>]` from the router's path parts (`['open', world, 'element', id]`).
 * Null when the parts carry no world (a bare `#/open`, which reads what waits instead).
 */
export function openWantOf(parts: string[]): OpenWant | null {
  if (parts[0] !== 'open' || parts.length < 2) return null;
  const world = decoded(parts[1]);
  if (!UUID_RE.test(world)) return { world: '' };
  const element = parts[2] === 'element' && parts[3] ? decoded(parts[3]) : '';
  return UUID_RE.test(element) ? { world, element } : { world };
}

// An OnlyWorlds address (the address profile): the site's link to a world or an element, or the
// ow:// text form. Found in pasted or shared text by its prefix, in any case, so a link in capitals
// is refused for its case rather than missed; the SDK reads it whole.
const ADDRESS_RE = /(?:https:\/\/www\.onlyworlds\.com\/w\/|ow:\/\/)\S*/i;

export const ADDRESS_SLUG_LINE =
  'This link names the world by its page name, which Lantern does not read. On OnlyWorlds, use Copy link: that link names the world by its id.';
export const ADDRESS_NO_WORLD_LINE = 'This address names an element but not its world. Copy the link from OnlyWorlds, which names both.';
export const ADDRESS_BROKEN_LINE = 'Lantern cannot read this link: part of it is missing or changed. Copy it again from OnlyWorlds.';

/** The address in a piece of text, the first one; punctuation a sentence puts after a link is not part of it. */
export function addressIn(text: string): string | null {
  const found = text.match(ADDRESS_RE)?.[0];
  return found ? found.replace(/[.,;:!?)\]}>'"]+$/, '') : null;
}

/**
 * What a pasted OnlyWorlds address asks the open door for: its world, and its element when it names
 * one (a lens or a moment is read and set aside: Lantern shows the element). A refusal is in words.
 * Null when the text holds no address at all.
 */
export function openWantOfAddress(text: string): { want: OpenWant } | { refused: string } | null {
  const address = addressIn(text);
  if (!address) return null;
  let r;
  try {
    r = parseOwLink(address);
  } catch (e) {
    if (e instanceof OwAddressError) return { refused: ADDRESS_BROKEN_LINE };
    throw e;
  }
  // The SDK reads any world that is not an id as a page name; one that starts like an id is a paste cut short.
  if (r.worldIsSlug) return { refused: /^[0-9a-f]{8}-/i.test(r.world ?? '') ? ADDRESS_BROKEN_LINE : ADDRESS_SLUG_LINE };
  if (!r.world) return { refused: ADDRESS_NO_WORLD_LINE };
  // The door's own rule for ids, as for a #/open link (keel's ids are UUIDs).
  if (!UUID_RE.test(r.world) || (r.id && !UUID_RE.test(r.id))) return { refused: ADDRESS_BROKEN_LINE };
  return { want: r.id ? { world: r.world, element: r.id } : { world: r.world } };
}

function decoded(part: string): string {
  try {
    return decodeURIComponent(part).trim().toLowerCase();
  } catch {
    return '';
  }
}

/** The link the door reads, kept in the app database (a sign-in's round trip unloads the page). */
export async function setPendingOpen(want: OpenWant | undefined, now = Date.now()): Promise<void> {
  await db.kvSet('pendingOpen', want ? { ...want, at: want.at ?? now } : undefined);
}

/** The waiting link, unless it has lapsed. */
export async function pendingOpen(now = Date.now()): Promise<OpenWant | undefined> {
  const want = await db.kvGet<OpenWant>('pendingOpen');
  if (!want) return undefined;
  return typeof want.at === 'number' && now - want.at >= 0 && now - want.at < OPEN_WAIT_MS ? want : undefined;
}

/** Drops the waiting link only if it is still the one this screen read: a newer link stays. */
export async function clearPendingOpen(read: OpenWant | undefined): Promise<void> {
  const now = await db.kvGet<OpenWant>('pendingOpen');
  if (!now || !read || (now.world === read.world && now.element === read.element && now.at === read.at)) {
    await db.kvSet('pendingOpen', undefined);
  }
}

/**
 * The link is about to wait through a sign-in: it is the newest link the person followed, so an
 * invite that waited before it gives way (a sign-in lands on one of them, never on a stale one).
 */
export async function holdThroughSignIn(): Promise<void> {
  await db.kvSet('pendingJoin', undefined);
}

/** Where a sign-in lands: the invite or the world link that waited for it, else Your worlds. */
export async function afterSignInHash(): Promise<string> {
  const [join, open] = await Promise.all([
    db.kvGet<string>('pendingJoin').catch(() => undefined),
    pendingOpen().catch(() => undefined),
  ]);
  return join ? '#/join' : open ? '#/open' : '#/worlds';
}

/** The world's page in Lantern. */
export function homeHash(want: OpenWant): string {
  return `#/w/${want.world}`;
}

/** The world's page in Lantern, at the element when the link named one. */
export function hashFor(want: OpenWant): string {
  return want.element ? `#/w/${want.world}/e/${want.element}` : homeHash(want);
}

export type OpenStep =
  | { kind: 'none' }
  | { kind: 'malformed' }
  | { kind: 'here'; hash: string }
  | { kind: 'signin' }
  | { kind: 'offline' }
  | { kind: 'unread'; error: unknown; signIn: boolean }
  | { kind: 'not-yours'; who: string | undefined }
  | { kind: 'ask'; world: AccountWorld };

export interface OpenDeps {
  onPhone(id: string): Promise<boolean>;
  token(): Promise<string | undefined>;
  online(): boolean;
  /** The account's worlds, read fresh. */
  accountWorlds(): Promise<AccountWorld[]>;
  accountName(): Promise<string | undefined>;
  /** The list's time limit (ms). */
  listMs?: number;
}

/** What the door does for a link, decided before anything is made. */
export async function decideOpen(want: OpenWant | undefined, deps: OpenDeps): Promise<OpenStep> {
  if (!want) return { kind: 'none' };
  if (!want.world) return { kind: 'malformed' };
  if (await deps.onPhone(want.world)) return { kind: 'here', hash: hashFor(want) };
  if (!(await deps.token())) return { kind: 'signin' };
  if (!deps.online()) return { kind: 'offline' };
  let worlds: AccountWorld[];
  try {
    worlds = await withLimit(deps.accountWorlds(), deps.listMs ?? ACCOUNT_LIST_MS);
  } catch (error) {
    // keel no longer takes this phone's sign-in: trying again repeats the refusal, signing in does not.
    return { kind: 'unread', error, signIn: (error as { status?: number }).status === 401 };
  }
  const row = worlds.find((w) => w.id === want.world);
  return row ? { kind: 'ask', world: row } : { kind: 'not-yours', who: await deps.accountName() };
}

function withLimit<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('OnlyWorlds did not answer in time. Try again in a moment.')), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}
