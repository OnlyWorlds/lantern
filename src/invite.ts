/**
 * The onlyworlds.com pages Lantern sends people to (S407, the journey floor h37 #4597): making an
 * account, and a world's Access pane, where only the website makes an invite link today (keel
 * `portal/urls.py`: invites are portal views; the v2 API has no route for them).
 */
import { API_BASE } from './world';
import type { WorldRecord } from './db';

const SITE = new URL(API_BASE).origin;

export const SIGNUP_URL = `${SITE}/accounts/signup/`;

/** A world's page on onlyworlds.com, opened at Access (the page reads the hash). */
export function accessUrl(worldId: string): string {
  return `${SITE}/account/worlds/${encodeURIComponent(worldId)}#access`;
}

/** Invite someone: an online world the account list says you own (the Access pane is the owner's). */
export function canInvite(rec: Pick<WorldRecord, 'kind' | 'role'>): boolean {
  return rec.kind === 'online' && rec.role === 'owner';
}
