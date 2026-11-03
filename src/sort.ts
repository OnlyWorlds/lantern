// The morning after's call: keel's sorting route (Skeld, 2026-10-12, POST /account/sort), on the
// same account check, model and allowance as Ask. The notes and the world's slice go in; rows in
// Simmer's shape come back (src/sortplan.ts). The key and the meter are keel's. The call is the
// SDK's `sort()` (4.18, Kael, 2026-10-12); its rows are checked again on arrival (`sanitizeRows`).
import { OwApiError, OwNetworkError, OwV2Client, type OwPaidBy } from '@onlyworlds/sdk';
import { accountToken } from './account';
import { OWN_KEY_REFUSED } from './own-key';
import { API_BASE, LANTERN_CLIENT_NAME } from './world';
import type { SliceItem, SortRow } from './sortplan';

/** A note as the route takes it: its words, or its words and its picture on keel's media host. */
export type SortNote = string | { text: string; image_url: string };

export interface Sorted {
  rows: SortRow[];
  not_proposed: { source_line: string; reason: string }[];
  remaining?: number;
  /** Who paid: the day's rating, or the account's own AI key. */
  paidBy?: OwPaidBy;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class SortRefused extends Error {
  constructor(
    message: string,
    /** keel's status, when it answered (422: a param it would not take; 502: the model gave no usable answer, nothing counted). */
    readonly status?: number,
    /** The account's own AI key was refused by its provider (keel's 422 `own_key_refused`). It carries no
     * status, so the photo fallback never sends again; said with the key's page, never retried. */
    readonly ownKey = false,
  ) {
    super(message);
  }
}

export async function sortNotes(worldId: string, notes: SortNote[], slice: SliceItem[]): Promise<Sorted> {
  const token = await accountToken();
  if (!token) throw new SortRefused('Sign in to sort with OnlyWorlds.');
  try {
    const r = await new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME }).sort({ worldId, notes, slice });
    return {
      rows: Array.isArray(r?.rows) ? (r.rows as SortRow[]) : [],
      not_proposed: Array.isArray(r?.not_proposed) ? r.not_proposed : [],
      remaining: r?.remaining,
      paidBy: r?.paid_by,
      usage: r?.usage,
    };
  } catch (e) {
    if (e instanceof OwNetworkError) throw new SortRefused('No connection. Your notes wait here; sort them when you have signal.');
    if (!(e instanceof OwApiError)) throw new SortRefused('Nothing came back. Try again.');
    if (e.isOwnKeyRefused) throw new SortRefused(OWN_KEY_REFUSED, undefined, true);
    if (e.isQuotaExceeded) throw new SortRefused("Today's AI answers are used up. Your notes wait here until tomorrow.");
    if (e.isAskUnavailable) throw new SortRefused('Sorting is paused for now. Your notes wait here.');
    if (e.isAskFailed) throw new SortRefused('Nothing came back. Try again; nothing was counted.', 502);
    if (e.status === 404 || e.status === 403) throw new SortRefused('Your account is not in this world any more.');
    if (e.status === 401) throw new SortRefused('Sign in again to sort.');
    if (e.status === 422) throw new SortRefused(`The notes were not taken: ${e.message}`, 422);
    throw new SortRefused('Nothing came back. Try again.');
  }
}
