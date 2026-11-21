import { OwApiError } from '@onlyworlds/sdk';
import { WaitSaid, waitClock, type SendWait } from './sendwait';

/**
 * What the sheets say after a save, a delete, a PIN or a file tap, as plain functions of what happened:
 * the views show these words and decide nothing themselves.
 */

/** Said after an edit that took the place of a change OnlyWorlds refused (`edit()` returns true). */
export const REPLACED_REFUSAL = 'It takes the place of the change OnlyWorlds did not take.';

/** Where a change stands when it is saved: a world on this phone only, signal, keel's wait, a PIN kept. */
export interface SendSituation {
  local: boolean;
  online: boolean;
  wait: SendWait | null;
  pinKnown: boolean;
}

/** While keel's wait runs: when it goes, or when to enter the PIN if none is kept (it waits for both). */
function duringWait(w: SendWait, pinKnown: boolean, it: string): string {
  return pinKnown ? `${it} waits on this phone and goes by itself at ${waitClock(w)}.` : `${it} waits on this phone; enter your PIN after ${waitClock(w)}.`;
}

/**
 * After a save. `head` is the sheet's own first words ("Saved.", "Picture saved."); null for a world on
 * this phone only when the sheet says nothing then (an edit's save).
 */
export function savedText(head: string, st: SendSituation, replaced: boolean, quietWhenLocal = false): string | null {
  let said: string;
  if (st.local) {
    if (quietWhenLocal) return null;
    said = head;
  } else if (st.wait) said = `${head} ${duringWait(st.wait, st.pinKnown, 'It')}`;
  else if (st.online) said = `${head} Sending…`;
  else said = head === 'Saved.' ? 'Saved on this phone. It sends when you have signal.' : `${head} It sends when you have signal.`;
  return replaced ? `${said} ${REPLACED_REFUSAL}` : said;
}

/** After the delete sheet's Delete: said only when it was done here or is on its way (`queued`). */
export function deletedText(name: string, queued: boolean, st: SendSituation): string | null {
  if (!queued) return null;
  if (st.local) return `Deleted ${name}.`;
  if (st.wait) return `Deleted ${name} on this phone. ${duringWait(st.wait, st.pinKnown, 'It')}`;
  if (st.online) return `Deleted ${name}.`;
  return `Deleted ${name} on this phone. It sends when you have signal.`;
}

/** The world's PIN sheet, when the PIN was not taken: keel's wait in its own words, else the PIN refused. */
export function pinSheetError(ex: unknown, message: string): string {
  if (ex instanceof WaitSaid) return ex.message;
  return /PIN|credential|401/i.test(message) ? 'That PIN does not open this world.' : message;
}

/** A file link that could not be had: keel's wait, a file gone, or a try again. */
export function fileLinkError(ex: unknown): string {
  if (ex instanceof WaitSaid) return ex.message;
  return ex instanceof OwApiError && ex.status === 404 ? 'This file is no longer on OnlyWorlds.' : 'The file could not be fetched. Try again in a moment.';
}
