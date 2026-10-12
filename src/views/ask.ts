// Ask: a question answered from the phone's own copy, offline and free (Kael's lookup, SDK
// lookupWorld). It finds what exists and shows why; it never invents. When nothing matches,
// "your world does not say" is the answer. For an account world, with signal, the same elements
// can be put into a sentence by keel's proxy (#159), on a tap: the sources stay on screen.
import { lookupWorld, type OwElement } from '@onlyworlds/sdk';
import { h } from '../dom';
import { icon } from '../icons';
import { fieldLabel } from '../schema';
import { elName, elRow, tabbar } from '../ui';
import { accountToken } from '../account';
import { askInASentence, contextFor } from '../ask';
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
  const accountWorld = s.rec.kind === 'online' && !!s.rec.role;
  void accountToken().then((t) => {
    signedIn = !!t;
    if (signedIn && accountWorld && input.value.trim()) run();
  });
  const sentence = (q: string, els: OwElement[]): HTMLElement | '' => {
    if (!signedIn || !accountWorld) return '';
    // An answer already given stays with its question: a sync that redraws the list keeps it.
    const kept = answered.get(`${s.id}|${q}`);
    if (kept) return kept;
    const box = h('div', { class: 'stack', 'data-sentence': '' });
    const btn = h('button', { class: 'btn', type: 'button' }, icon('spark', 18), 'Answer it in a sentence');
    const hint = h('p', { class: 'muted small', style: 'margin:0' }, `Sends these ${els.length === 1 ? 'one' : els.length} to OnlyWorlds to be put into words. It answers from them only.`);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      hint.textContent = 'Asking…';
      try {
        const a = await askInASentence(s.id, q, contextFor(els, (id) => (s.get(id) ? elName(s.get(id)) : undefined)));
        const left = typeof a.remaining === 'number' ? ` ${a.remaining} left today.` : '';
        box.replaceChildren(
          h('p', { class: a.none ? 'empty' : 'answer', 'data-answer': a.none ? 'none' : 'sentence' }, a.none ? 'Your world does not say.' : a.answer),
          h('p', { class: 'muted small', style: 'margin:0' }, `From the elements below.${left}`),
        );
        answered.set(`${s.id}|${q}`, box);
      } catch (e) {
        hint.textContent = e instanceof Error ? e.message : String(e);
        btn.disabled = false;
      }
    });
    box.append(btn, hint);
    return box;
  };
  const run = () => {
    const q = input.value.trim();
    lastQuestion.set(s.id, q);
    if (!q) {
      out.replaceChildren(
        h(
          'p',
          { class: 'muted', style: 'margin:0' },
          'Ask about anything in this world. The answer comes from what is written here, on this phone, with or without signal.',
        ),
      );
      return;
    }
    const hits = lookupWorld(s.lookupIndex(), q, { limit: 8 });
    if (!hits.length) {
      out.replaceChildren(h('p', { class: 'empty', 'data-answer': 'none' }, 'Your world does not say.'));
      return;
    }
    out.replaceChildren(
      navigator.onLine ? sentence(q, hits.map((x) => x.element)) : '',
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
    input.blur();
    run();
  });
  let t: number | undefined;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = window.setTimeout(run, 250);
  });
  run();
  return {
    el: h(
      'main',
      { class: 'screen has-tabbar', 'data-screen': 'ask' },
      h('div', { class: 'topbar' }, h('h1', null, 'Ask')),
      form,
      out,
      tabbar(s.id, 'ask'),
    ),
    // A sync that lands mid-question changes the index: answer again.
    refresh: () => input.value.trim() && run(),
  };
}

