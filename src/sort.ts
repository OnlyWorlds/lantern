// The morning after's call: keel's sorting route (Skeld, h37 #3591, POST /account/sort), on the
// same account check, model and allowance as Ask. The notes and the world's slice go in; rows in
// Simmer's shape come back (src/sortplan.ts). The key and the meter are keel's. The call is the
// SDK's `sort()` (4.18, Kael h37 #3664); its rows are checked again on arrival (`sanitizeRows`).
import { OwApiError, OwNetworkError, OwV2Client } from '@onlyworlds/sdk';
import { accountToken } from './account';
import { API_BASE } from './world';
import type { SliceItem, SortRow } from './sortplan';

/** A note as the route takes it (h37 #3594): its words, or its words and its picture on keel's media host. */
export type SortNote = string | { text: string; image_url: string };

export interface Sorted {
  rows: SortRow[];
  not_proposed: { source_line: string; reason: string }[];
  remaining?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class SortRefused extends Error {
  constructor(
    message: string,
    /** keel's status, when it answered (422: a param it would not take; 502: the model gave no usable answer, nothing counted). */
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function sortNotes(worldId: string, notes: SortNote[], slice: SliceItem[]): Promise<Sorted> {
  const token = await accountToken();
  if (!token) throw new SortRefused('Sign in to sort with OnlyWorlds.');
  try {
    const r = await new OwV2Client({ apiKey: token, baseUrl: API_BASE }).sort({ worldId, notes, slice });
    return {
      rows: Array.isArray(r?.rows) ? (r.rows as SortRow[]) : [],
      not_proposed: Array.isArray(r?.not_proposed) ? r.not_proposed : [],
      remaining: r?.remaining,
      usage: r?.usage,
    };
  } catch (e) {
    if (e instanceof OwNetworkError) throw new SortRefused('No connection. Your notes wait here; sort them when you have signal.');
    if (!(e instanceof OwApiError)) throw new SortRefused('Nothing came back. Try again.');
    if (e.isQuotaExceeded) throw new SortRefused("Today's AI answers are used up. Your notes wait here until tomorrow.");
    if (e.isAskUnavailable) throw new SortRefused('Sorting is paused for now. Your notes wait here.');
    if (e.isAskFailed) throw new SortRefused('Nothing came back. Try again; nothing was counted.', 502);
    if (e.status === 404 || e.status === 403) throw new SortRefused('Your account is not in this world any more.');
    if (e.status === 401) throw new SortRefused('Sign in again to sort.');
    if (e.status === 422) throw new SortRefused(`The notes were not taken: ${e.message}`, 422);
    throw new SortRefused('Nothing came back. Try again.');
  }
}
