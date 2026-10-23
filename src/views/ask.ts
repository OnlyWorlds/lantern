// Ask: a question answered from the phone's own copy, offline and free (Kael's lookup, SDK
// lookupWorld). It finds what exists and shows why; it never invents. When nothing matches,
// "your world does not say" is the answer. For an account world, with signal, the same elements
// can be put into a sentence by keel's proxy (#159), on a tap: the sources stay on screen.
import { buildAskContext, lookupWorld, type OwElement, type OwLookupHit } from '@onlyworlds/sdk';
import { handOnHold, heldBackLine } from '../hidden';
import { h } from '../dom';
import { icon } from '../icons';
import { fieldLabel } from '../schema';
import { elRow, tabbar } from '../ui';
import { accountToken, cachedAccountWorlds } from '../account';
import { askInASentence } from '../ask';
import type { WorldSession } from '../world';
import type { View } from './world';

type Reason = ReturnType<typeof lookupWorld<OwElement>>[number]['reasons'][number];

function because(r: Reason): string {
  switch (r.kind) {
    case 'name':
    case 'alias':
      return `named "${r.text}"`;
    case 'word':
      return `its name has "${r.text}"`;
    case 'text':
      return `its text mentions "${r.text}"`;
    case 'link':
      return r.dir === 'out'
        ? `${r.from ?? 'something'} names it (${fieldLabel(r.field).toLowerCase()})`
        : `it names ${r.from ?? 'something'} (${fieldLabel(r.field).toLowerCase()})`;
  }
}

function snippet(el: OwElement): string {
  const d = typeof el.description === 'string' ? el.description.trim() : '';
  const cps = [...d];
  return cps.length > 140 ? cps.slice(0, 137).join('').trimEnd() + '…' : d;
}

const lastQuestion = new Map<string, string>();
const answered = new Map<string, HTMLElement>();

export function askView(s: WorldSession): View {
  const input = h('input', {
    type: 'search',
    placeholder: 'What was the blacksmith called?',
    'aria-label': 'Ask your world',
    autocomplete: 'off',
    enterkeyhint: 'search',
  });
  input.value = lastQuestion.get(s.id) ?? '';
  const out = h('div', { class: 'stack' });
  // A sentence needs an account world (keel checks the account owns or is in it) and a sign-in.
  let signedIn = false;
  // A world first opened with a key has no role on this phone; signed in later, the account's own
  // list says whether it is one of yours (the Captain's walk: Ask stayed a search after sign-in).
  let accountWorld = s.rec.kind === 'online' && !!s.rec.role;
  let known = false; // until the sign-in is read, no reason is given (it would flash "Sign in")
  void Promise.all([accountToken(), cachedAccountWorlds()]).then(([t, mine]) => {
    signedIn = !!t;
    if (s.rec.kind === 'online' && mine.some((w) => w.id === s.id)) accountWorld = true;
    known = true;
    run();
  });
  const aiReady = () => signedIn && accountWorld && navigator.onLine;
  // Why there is no sentence, said once under the question (the Captain's walk: Ask read as a
  // search bar, because a world opened with a key never shows the AI half).
  const whyNot = (): HTMLElement | '' => {
    if (!known || aiReady()) return '';
    if (s.rec.kind === 'demo')
      return h('p', { class: 'muted small', style: 'margin:0', 'data-why': 'demo' }, 'Answers in a sentence come with a world from your account.');
    if (s.rec.kind === 'local')
      return h('p', { class: 'muted small', style: 'margin:0', 'data-why': 'local' }, 'Answers in a sentence come once this world is online, in your account.');
    if (!accountWorld)
      return h('p', { class: 'muted small', style: 'margin:0', 'data-why': 'key' }, 'Answers in a sentence come with a world from your account, signed in. This one was opened with a key.');
    if (!signedIn)
      return h('p', { class: 'muted small', style: 'margin:0', 'data-why': 'signin' }, h('a', { href: '#/signin' }, 'Sign in'), ' to get answers in a sentence.');
    return h('p', { class: 'muted small', style: 'margin:0', 'data-why': 'offline' }, 'With signal, the answer comes in a sentence too.');
  };
  const sentence = (q: string, hits: OwLookupHit<OwElement>[], askNow: boolean): HTMLElement | '' => {
    if (!signedIn || !accountWorld) return '';
    // Ask hands the world to keel's AI, so a proposed element stays on the phone (src/review.ts, Keel
    // #565's reader rule), and so does a hidden one (src/hidden.ts, folder spec §4.8): shown in the
    // list with its word, never sent, and said how many.
    // A pin or marker placing one stays back with it (handOnHold, the S462 gate's F1).
    const why = hits.map((x) => handOnHold(x.element, (id) => s.get(id)));
    const hiddenOut = why.filter((w) => w === 'hidden').length;
    const proposedOut = why.filter((w) => w === 'proposed').length;
    const handed = hits.filter((_, i) => !why[i]);
    const held = heldBackLine(hiddenOut, proposedOut);
    const leftLine = held ? ` ${held}` : '';
    if (!handed.length) {
      const why = !proposedOut
        ? 'Only hidden elements match, and a hidden element is not sent to be put into words.'
        : !hiddenOut
          ? 'Only proposed elements match, and a proposed element is not sent to be put into words until a keeper accepts it.'
          : 'Only hidden and proposed elements match, and neither is sent to be put into words.';
      return h('p', { class: 'muted small', style: 'margin:0', 'data-why': hiddenOut ? 'hidden' : 'proposed' }, why);
    }
    // The elements on screen, in their order (the SDK's buildAskContext, keel's limits).
    const { context } = buildAskContext(handed, s.handOnIndex());
    // One box per world, question and the very text sent: a redraw while it asks, or after, shows
    // the same box (never a second spend); elements that changed make a new one.
    const key = `${s.id}|${q}|${context.join('|')}`;
    const kept = answered.get(key);
    if (kept) {
      // Enter on a question shown with its button: ask now (a box that asked already has no button).
      if (askNow) kept.querySelector<HTMLButtonElement>('button:not(:disabled)')?.click();
      return kept;
    }
    const box = h('div', { class: 'stack', 'data-sentence': '' });
    answered.set(key, box);
    const btn = h('button', { class: 'btn', type: 'button' }, icon('spark', 18), 'Answer it in a sentence');
    const n = context.length;
    const hint = h('p', { class: 'muted small', style: 'margin:0' }, `Sends ${n === handed.length ? 'these' : `the first`} ${n === 1 ? 'one' : n} to OnlyWorlds to be put into words. It answers from them only.${leftLine}`);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      hint.textContent = 'Asking…';
      try {
        const a = await askInASentence(s.id, q, context);
        const left = typeof a.remaining === 'number' ? ` ${a.remaining} left today.` : '';
        box.replaceChildren(
          h('p', { class: a.none ? 'empty' : 'answer', 'data-answer': a.none ? 'none' : 'sentence' }, a.none ? 'Your world does not say.' : a.answer),
          h('p', { class: 'muted small', style: 'margin:0' }, `From the elements below.${left}`),
        );
      } catch (e) {
        hint.textContent = e instanceof Error ? e.message : String(e);
        btn.disabled = false;
      }
    });
    box.append(btn, hint);
    if (askNow) btn.click();
    return box;
  };
  /** `askNow`: the question was sent (Enter), so a sentence is asked for at once; typing only looks up. */
  const run = (askNow = false) => {
    const q = input.value.trim();
    lastQuestion.set(s.id, q);
    input.setAttribute('enterkeyhint', aiReady() ? 'send' : 'search');
    if (!q) {
      out.replaceChildren(
        h(
          'p',
          { class: 'muted', style: 'margin:0' },
          aiReady()
            ? 'Ask about anything in this world. Send it for an answer in a sentence, made only from what is written here.'
            : 'Ask about anything in this world. The answer comes from what is written here, on this phone, with or without signal.',
        ),
        whyNot(),
      );
      return;
    }
    const hits = lookupWorld(s.lookupIndex(), q, { limit: 8 });
    if (!hits.length) {
      // Said whole: the sentence is made only from what the phone finds, so nothing found means no AI.
      out.replaceChildren(
        h('p', { class: 'empty', 'data-answer': 'none' }, 'Your world does not say.'),
        h(
          'p',
          { class: 'muted small', style: 'margin:0' },
          aiReady()
            ? 'Nothing here is named or written with those words, so there was nothing to answer from. Try a name from your world.'
            : 'Nothing here is named or written with those words. Try a name from your world.',
        ),
        whyNot(),
      );
      return;
    }
    out.replaceChildren(
      navigator.onLine ? sentence(q, hits, askNow) : '',
      whyNot(),
      h('p', { class: 'section-label' }, 'What your world says'),
      h(
        'div',
        { class: 'results' },
        ...hits.map((hit) => {
          const row = elRow(s.id, hit.element);
          const label = row.querySelector('.label')!;
          const why = [...new Set(hit.reasons.map(because))].slice(0, 2).join(' · ');
          label.appendChild(h('span', { class: 'muted small', style: 'display:block' }, why));
          const snip = snippet(hit.element);
          if (snip) label.appendChild(h('span', { class: 'dim small', style: 'display:block;margin-top:2px' }, snip));
          return row;
        }),
      ),
    );
  };
  const form = h('form', { class: 'search', role: 'search' }, icon('spark', 20), input);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(t);
    input.blur();
    run(aiReady());
  });
  let t: number | undefined;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = window.setTimeout(() => run(), 250);
  });
  run();
  return {
    el: h(
      'main',
      { class: 'screen has-tabbar', 'data-screen': 'ask' },
      h('div', { class: 'topbar' }, h('h1', null, 'Ask')),
      form,
      out,
      tabbar(s, 'ask'),
    ),
    // A sync that lands mid-question changes the index: answer again.
    refresh: () => input.value.trim() && run(),
  };
}

