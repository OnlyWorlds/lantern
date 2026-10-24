// Ask, in a sentence: keel's proxy (Keel #159, POST /account/ask) answers a question from the
// elements the phone's own lookup found, sent as text, and from nothing else ("The world doesn't
// say." otherwise). The key and the meter are keel's: the page never holds a model key. Each
// account has a daily allowance; an answer costs one, a refusal costs none.
// The wire and the context are the SDK's (4.13: ask, buildAskContext, typed refusals).
import { buildAskContext, OwApiError, OwNetworkError, OwV2Client, type OwAskContext, type OwElement, type OwLookupHit, type OwWorldIndex } from '@onlyworlds/sdk';
import { accountToken } from './account';
import { roomShown } from './room';
import { API_BASE, LANTERN_CLIENT_NAME } from './world';

export interface Answer {
  answer: string;
  remaining?: number;
  /** The model found nothing in what it was given. */
  none: boolean;
}

export class AskRefused extends Error {}

/**
 * What Ask hands keel's AI (the SDK's buildAskContext, keel's limits). Since SDK 4.72 it leaves the
 * parlor's room out unless asked (Kael h56 #11977): Ask follows this phone's room switch, so a room the
 * person chose to show is asked about like the rest. Hidden and proposed never reach it (`handOnHold`).
 */
export function askContext(worldId: string, handed: OwLookupHit<OwElement>[], index: OwWorldIndex<OwElement>): OwAskContext {
  return buildAskContext(handed, index, { includeRoom: roomShown(worldId) });
}

export async function askInASentence(worldId: string, question: string, context: string[]): Promise<Answer> {
  const token = await accountToken();
  if (!token) throw new AskRefused('Sign in to have it answered in a sentence.');
  try {
    const r = await new OwV2Client({ apiKey: token, baseUrl: API_BASE, client: LANTERN_CLIENT_NAME }).ask({
      worldId,
      question: [...question].slice(0, 500).join(''),
      context,
    });
    const a = r.answer.trim();
    return { answer: a, remaining: r.remaining, none: /^the world doesn.t say\.?$/i.test(a) };
  } catch (e) {
    if (e instanceof OwNetworkError) throw new AskRefused('No connection. The list above is from this phone and needs none.');
    if (!(e instanceof OwApiError)) throw new AskRefused('No answer came back. Try again.');
    if (e.isQuotaExceeded) throw new AskRefused("Today's questions in a sentence are used up. More tomorrow; the list above still works.");
    if (e.isAskUnavailable) throw new AskRefused('Answers in a sentence are paused for now. The list above is the world itself.');
    if (e.isAskFailed) throw new AskRefused('No answer came back. Try again.');
    if (e.status === 404 || e.status === 403) throw new AskRefused('Your account is not in this world any more, so it cannot be asked in a sentence.');
    if (e.status === 401) throw new AskRefused('Sign in again to have it answered in a sentence.');
    throw new AskRefused('No answer came back. Try again.');
  }
}
