// Ask, in a sentence: keel's proxy (Keel #159, POST /account/ask) answers a question from the
// elements the phone's own lookup found, sent as text, and from nothing else ("The world doesn't
// say." otherwise). The key and the meter are keel's: the page never holds a model key. Each
// account has a daily allowance; an answer costs one, a refusal costs none.
import type { OwElement } from '@onlyworlds/sdk';
import { accountToken } from './account';
import { fieldInfo, fieldLabel, isEmptyValue, typeFields, typeLabel } from './schema';
import { API_BASE } from './world';

const PER_ELEMENT = 2000;
const ALL = 12000;
const MAX_ELEMENTS = 8;

/** An element as the text the proxy reads: its name and type, then its filled fields, links by name. */
export function elementText(el: OwElement, nameOf: (id: string) => string | undefined): string {
  const lines = [`${el.name?.trim() || 'Unnamed'} (${typeLabel(el.type).toLowerCase()})`];
  const kind = [el.supertype, el.subtype].filter((v) => typeof v === 'string' && v.trim()).join(', ');
  if (kind) lines.push(`kind: ${kind}`);
  if (typeof el.description === 'string' && el.description.trim()) lines.push(`description: ${el.description.trim()}`);
  for (const { field } of typeFields(el.type)) {
    const v = el[field];
    if (isEmptyValue(v)) continue;
    const info = fieldInfo(el.type, field);
    let text: string;
    if (info?.type === 'single_link' && typeof v === 'string') text = nameOf(v) ?? '';
    else if (info?.type === 'multi_link' && Array.isArray(v)) text = v.map((id) => nameOf(String(id))).filter(Boolean).join(', ');
    else text = String(v);
    if (text.trim()) lines.push(`${fieldLabel(field).toLowerCase()}: ${text.trim()}`);
  }
  const all = lines.join('\n');
  return [...all].length > PER_ELEMENT ? [...all].slice(0, PER_ELEMENT - 1).join('') + '…' : all;
}

/** Up to eight elements, within the proxy's whole-context limit, in the lookup's order. */
export function contextFor(els: OwElement[], nameOf: (id: string) => string | undefined): string[] {
  const out: string[] = [];
  let total = 0;
  for (const el of els.slice(0, MAX_ELEMENTS)) {
    const t = elementText(el, nameOf);
    if (total + t.length > ALL) break;
    out.push(t);
    total += t.length;
  }
  return out;
}

export interface Answer {
  answer: string;
  remaining?: number;
  /** The model found nothing in what it was given. */
  none: boolean;
}

export class AskRefused extends Error {}

export async function askInASentence(worldId: string, question: string, context: string[]): Promise<Answer> {
  const token = await accountToken();
  if (!token) throw new AskRefused('Sign in to have it answered in a sentence.');
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/account/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ world_id: worldId, question: [...question].slice(0, 500).join(''), context }),
    });
  } catch {
    throw new AskRefused('No connection. The list above is from this phone and needs none.');
  }
  const body = (await res.json().catch(() => null)) as
    | { answer?: string; remaining?: number; error?: { code?: string; message?: string } }
    | null;
  if (res.ok && typeof body?.answer === 'string') {
    const a = body.answer.trim();
    return { answer: a, remaining: body.remaining, none: /^the world doesn.t say\.?$/i.test(a) };
  }
  const code = body?.error?.code;
  if (res.status === 429) throw new AskRefused("Today's questions in a sentence are used up. More tomorrow; the list above still works.");
  if (res.status === 404 || res.status === 403) throw new AskRefused('Your account is not in this world any more, so it cannot be asked in a sentence.');
  if (res.status === 503 || code === 'ask_unavailable') throw new AskRefused('Answers in a sentence are paused for now. The list above is the world itself.');
  if (res.status === 502 || code === 'ask_failed') throw new AskRefused('No answer came back. Try again.');
  if (res.status === 401) throw new AskRefused('Sign in again to have it answered in a sentence.');
  throw new AskRefused(body?.error?.message ?? 'No answer came back. Try again.');
}
