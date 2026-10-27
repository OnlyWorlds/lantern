/**
 * The onlyworlds.com pages Lantern sends people to: making an
 * account, and a world's Access pane. Since keel 48c10d4 (Skeld, 2026-10-15) the owner also makes
 * an invite link here, through the SDK (4.24, `createWorldLink`): the link is shown once and never
 * kept; seeing and taking back links stays on the website's Access pane.
 */
import { OwApiError, OwNetworkError, OwV2Client } from '@onlyworlds/sdk';
import { API_BASE, LANTERN_CLIENT_NAME } from './world';
import { accountToken } from './account';
import type { WorldRecord } from './db';

const SITE = new URL(API_BASE).origin;

export const SIGNUP_URL = `${SITE}/accounts/signup/`;

/** A world's page on onlyworlds.com, opened at Access: its own path, kept through the site's sign-in. */
export function accessUrl(worldId: string): string {
  return `${SITE}/account/worlds/${encodeURIComponent(worldId)}/access`;
}

/** Invite someone: an online world the account list says you own (keel makes links for the owner only). */
export function canInvite(rec: Pick<WorldRecord, 'kind' | 'role'>): boolean {
  return rec.kind === 'online' && rec.role === 'owner';
}

/**
 * Who a link is for (Titus's call, 2026-10-19): `player` is keel's
 * no-account player link (#353), a friend reading as one Character; `guest` is a person's link with
 * role guest, the same reading signed in to an account of their own; `contributor` a person's link.
 */
export type InviteFor = 'contributor' | 'player' | 'guest';

/** A player link's Character: one of the world's, by its id, or a new one named for the player. */
export const NEW_CHARACTER = 'new';

export const INVITE_CAP = 'This world has as many open invites as it can hold, links not yet used included. Take some back on its page on onlyworlds.com, under Access, then make a new one.';

export const CHARACTER_GONE ='That Character is not on OnlyWorlds yet, or no longer. Let the world sync, or pick another, then make the link.';

/**
 * The Characters a player link can name: keel holds only what has reached it, so a Character still
 * waiting to send (an outbox create) is left out rather than refused. Sorted by name.
 */
export function playableCharacters(
  elements: Array<{ id: string; type?: string; name?: unknown }>,
  waiting: Array<{ op: string; id: string }>,
): Array<{ id: string; name: string }> {
  const unsent = new Set(waiting.filter((r) => r.op === 'create').map((r) => r.id));
  return elements
    .filter((el) => el.type === 'character' && !unsent.has(el.id))
    .map((el) => ({ id: el.id, name: typeof el.name === 'string' && el.name.trim() ? el.name.trim() : 'Unnamed' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How long a link works, said where it is made (keel's default; the SDK takes 1, 7 or 30). */
export const INVITE_DAYS = 7;

export interface MadeInvite {
  /** The link alone (the /join page with the code after `#`). */
  link: string;
  /** keel's one line to send: who invites, to which world, and the link. */
  line: string;
}

const NAME_KEY = 'lantern.inviterName';

/** The name the owner signed the last link with, on this phone. */
export function lastInviterName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * A new invite link, made by the signed-in owner. Nothing about it is kept. `character` is for a
 * player link only: a Character's id, or `NEW_CHARACTER`.
 */
export async function makeInvite(
  worldId: string,
  inviteFor: InviteFor,
  inviterName: string,
  character: string = NEW_CHARACTER,
): Promise<MadeInvite> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first: only the world\'s owner makes an invite link.');
  const name = inviterName.trim();
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* a name not remembered is asked again next time */
  }
  const client = new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME });
  try {
    const made = await client.createWorldLink(
      worldId,
      inviteFor === 'player'
        ? { reader: 'player', character, days: INVITE_DAYS, ...(name ? { inviterName: name } : {}) }
        : { reader: 'person', role: inviteFor, days: INVITE_DAYS, ...(name ? { inviterName: name } : {}) },
    );
    return { link: made.link, line: made.line };
  } catch (e) {
    if (e instanceof OwNetworkError) throw new Error('No connection. Making an invite link needs signal.');
    if (e instanceof OwApiError && e.isNotFound) throw new Error('Only the world\'s owner can make an invite link for it.');
    // keel refuses a Character it does not hold in this world (agents.py `_clean_link_character`).
    if (e instanceof OwApiError && e.status === 422 && e.param === 'character') throw new Error(CHARACTER_GONE);
    // keel's cap on a world's open invites (player links count too) is a 422 naming no field; a
    // retry never helps (Atlas's INVITE_CAP_LINE).
    if (e instanceof OwApiError && e.status === 422 && !e.param) throw new Error(INVITE_CAP);
    throw new Error('The link was not made. Try again in a moment.');
  }
}
