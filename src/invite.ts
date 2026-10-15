/**
 * The onlyworlds.com pages Lantern sends people to (S407, the journey floor h37 #4597): making an
 * account, and a world's Access pane. Since keel C1 (48c10d4, Skeld h29 #5147) the owner also makes
 * an invite link here, through the SDK (4.24, `createWorldLink`): the link is shown once and never
 * kept; seeing and taking back links stays on the website's Access pane.
 */
import { OwApiError, OwNetworkError, OwV2Client } from '@onlyworlds/sdk';
import { API_BASE } from './world';
import { accountToken } from './account';
import type { WorldRecord } from './db';

const SITE = new URL(API_BASE).origin;

export const SIGNUP_URL = `${SITE}/accounts/signup/`;

/** A world's page on onlyworlds.com, opened at Access (the page reads the hash). */
export function accessUrl(worldId: string): string {
  return `${SITE}/account/worlds/${encodeURIComponent(worldId)}#access`;
}

/** Invite someone: an online world the account list says you own (keel makes links for the owner only). */
export function canInvite(rec: Pick<WorldRecord, 'kind' | 'role'>): boolean {
  return rec.kind === 'online' && rec.role === 'owner';
}

export type InviteRole = 'contributor' | 'guest';

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

/** A new invite link for a person, made by the signed-in owner. Nothing about it is kept. */
export async function makeInvite(worldId: string, role: InviteRole, inviterName: string): Promise<MadeInvite> {
  const token = await accountToken();
  if (!token) throw new Error('Sign in first: only the world\'s owner makes an invite link.');
  const name = inviterName.trim();
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* a name not remembered is asked again next time */
  }
  const client = new OwV2Client({ apiKey: token, baseUrl: API_BASE });
  try {
    const made = await client.createWorldLink(worldId, {
      reader: 'person',
      role,
      days: INVITE_DAYS,
      ...(name ? { inviterName: name } : {}),
    });
    return { link: made.link, line: made.line };
  } catch (e) {
    if (e instanceof OwNetworkError) throw new Error('No connection. Making an invite link needs signal.');
    if (e instanceof OwApiError && e.isNotFound) throw new Error('Only the world\'s owner can make an invite link for it.');
    throw new Error('The link was not made. Try again in a moment.');
  }
}
