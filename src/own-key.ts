// The account's own AI key (keel's own-key box, on the account page under the rating): once the day's
// rating is spent, Ask and the sort run on the person's own Anthropic or OpenAI key, billed by its
// provider. keel's answer says which paid (`paid_by`); a key its provider refuses answers 422
// `own_key_refused`, spends nothing and is never retried, here or by the SDK. The page that holds the
// key is the only way to fix it, so the refusal links there.
import type { OwPaidBy } from '@onlyworlds/sdk';
import { h } from './dom';

/** The account page's own-key box. */
export const OWN_KEY_PAGE = 'https://www.onlyworlds.com/account/settings#own-ai-key';

/** keel's refusal, in Lantern's words: what happened and that nothing was spent. */
export const OWN_KEY_REFUSED = 'Your own AI key was refused by its provider. Nothing was counted.';

/** The line after an answer: who paid. On the own key there is no count to give. */
export function paidLine(paidBy: OwPaidBy | undefined, remaining: number | undefined, unit = '', done = 'Answered'): string {
  if (paidBy === 'own_key') return ` ${done} on your own AI key.`;
  return typeof remaining === 'number' ? ` ${remaining}${unit ? ` ${unit}` : ''} left today.` : '';
}

/** The refusal with its one way onward: the key's own page. No Try again: the same key is refused again. */
export function ownKeyRefusedLine(attrs: Record<string, string> = {}): HTMLElement {
  return h(
    'p',
    { class: 'error', role: 'alert', 'data-own-key': 'refused', ...attrs },
    `${OWN_KEY_REFUSED} `,
    h('a', { href: OWN_KEY_PAGE, target: '_blank', rel: 'noopener' }, 'Check it on your account page'),
    '.',
  );
}
