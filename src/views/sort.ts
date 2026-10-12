// The morning after: Unsorted notes read beside what the world already has, the AI proposing what
// they make, link and add, and the person ticking what is true. Nothing is written before the tick;
// what is ticked goes to the outbox like any edit, and the sorted notes are filed as Sorted (kept:
// every row points at its note). Design: Forge/Notes/2026-10-12-lantern-morning-after.md.
import type { OwElement } from '@onlyworlds/sdk';
import { h, plural } from '../dom';
import { icon } from '../icons';
import { accountToken, cachedAccountWorlds } from '../account';
import { MAP_TYPES } from '../maps';
import { fieldLabel, TYPES, typeColor, typeLabel } from '../schema';
import { buildSlice, fitNotes, notesPayload, noteText, planWrites, SORTED, type SortRow, type Target, type Ticked } from '../sortplan';
import { sortNotes, SortRefused, type Sorted } from '../sort';
import { errorText, go, tabbar, toast, topbar, typeChip } from '../ui';
import type { WorldSession } from '../world';
import type { View } from './world';

/** A card's state: ticked, a make's edits, an ask's pick. */
interface RowState {
  on: boolean;
  name?: string;
  type?: string;
  pick?: string;
}

interface Kept {
  notes: string[];
  result: Sorted;
  at: string;
}

// A sort spends an answer: what came back is kept on this phone until written or let go.
const keepKey = (worldId: string) => `lantern-sort-${worldId}`;
function readKept(worldId: string): Kept | null {
  try {
    const raw = localStorage.getItem(keepKey(worldId));
    return raw ? (JSON.parse(raw) as Kept) : null;
  } catch {
    return null;
  }
}
function writeKept(worldId: string, k: Kept | null): void {
  try {
    if (k) localStorage.setItem(keepKey(worldId), JSON.stringify(k));
    else localStorage.removeItem(keepKey(worldId));
  } catch {
    /* a reload then loses this sort; the notes stay in Unsorted */
  }
}

function unsortedNotes(s: WorldSession): OwElement[] {
  const stamp = (e: OwElement) => String(e.created_at ?? e.updated_at ?? '');
  return s
    .elements()
    .filter((e) => e.type === 'narrative' && e.supertype === 'Unsorted')
    .sort((a, b) => stamp(b).localeCompare(stamp(a)));
}

function snippet(t: string, n = 90): string {
  const cps = [...t.replace(/\s+/g, ' ').trim()];
  return cps.length > n ? cps.slice(0, n - 1).join('').trimEnd() + '…' : cps.join('');
}

const KIND_WORD: Record<SortRow['kind'], string> = { make: 'New', add_to: 'Add to', link: 'Link', ask: 'Which one?' };

export function sortView(s: WorldSession): View {
  const main = h('main', { class: 'screen has-tabbar', 'data-screen': 'sort' });
  let phase: 'choose' | 'asking' | 'review' = 'choose';
  let kept = readKept(s.id);
  if (kept) phase = 'review';
  let chosen = new Set(fitNotes(unsortedNotes(s)).map((n) => n.id));
  let refusal = '';
  let signedIn = false;
  let accountWorld = s.rec.kind === 'online' && !!s.rec.role;
  let known = false;
  // Per row (by index in the kept result): ticked, and a make's edits or an ask's pick.
  const state = new Map<number, RowState>();
  let showLeftOut = false;

  void Promise.all([accountToken(), cachedAccountWorlds()]).then(([t, mine]) => {
    signedIn = !!t;
    if (s.rec.kind === 'online' && mine.some((w) => w.id === s.id)) accountWorld = true;
    known = true;
    render();
  });

  const whyNot = (): string => {
    if (!s.canWrite) return 'This world is read only here, so its notes cannot be sorted into it.';
    if (s.rec.kind === 'local') return 'Sorting comes once this world is online, in your account.';
    if (!accountWorld) return 'Sorting comes with a world from your account, signed in. This one was opened with a key.';
    if (!signedIn) return 'Sign in to sort your notes.';
    if (!navigator.onLine) return 'Sorting needs signal. Your notes wait here.';
    return '';
  };

  const run = async () => {
    const notes = unsortedNotes(s).filter((n) => chosen.has(n.id));
    const fit = fitNotes(notes);
    if (!fit.length) return;
    phase = 'asking';
    refusal = '';
    render();
    try {
      const slice = buildSlice(fit, s.lookupIndex(), (id) => s.get(id));
      const result = await sortNotes(s.id, notesPayload(fit).notes, slice);
      kept = { notes: fit.map((n) => n.id), result, at: new Date().toISOString() };
      writeKept(s.id, kept);
      state.clear();
      phase = 'review';
    } catch (e) {
      refusal = e instanceof SortRefused ? e.message : errorText(e);
      phase = 'choose';
    }
    render();
  };

  const chooseScreen = (): (Node | string)[] => {
    const notes = unsortedNotes(s);
    if (!notes.length) return [h('p', { class: 'empty' }, 'Nothing waits in Unsorted.')];
    const reason = known ? whyNot() : '';
    const rows = notes.map((n) => {
      const on = chosen.has(n.id);
      const b = h(
        'button',
        { class: 'note-pick', type: 'button', role: 'checkbox', 'aria-checked': String(on), 'data-note': n.id },
        h('span', { class: 'tick' }, on ? icon('check', 18, 2.4) : ''),
        h('span', { class: 'label' }, h('b', null, String(n.name ?? 'A note')), h('span', { class: 'muted small', style: 'display:block' }, snippet(noteText(n)))),
        typeof n.image_url === 'string' && n.image_url ? icon('image', 18) : '',
      );
      b.addEventListener('click', () => {
        if (on) chosen.delete(n.id);
        else chosen.add(n.id);
        render();
      });
      return b;
    });
    const fit = fitNotes(notes.filter((n) => chosen.has(n.id)));
    const over = chosen.size - fit.length;
    const sortBtn = h('button', { class: 'btn btn-primary', type: 'button', 'data-action': 'sort' }, fit.length ? `Sort ${plural(fit.length, 'note')}` : 'Choose a note');
    sortBtn.disabled = !fit.length || !!reason || !known;
    sortBtn.addEventListener('click', () => void run());
    return [
      h('p', { class: 'dim', style: 'margin:0' }, 'The AI reads your notes beside what your world already has and proposes what they add. You tick what is true; nothing is written before that.'),
      h('div', { class: 'stack', style: 'gap:6px' }, ...rows),
      over > 0 ? h('p', { class: 'muted small', style: 'margin:0' }, `${plural(over, 'note')} wait for the next sort: one sort reads up to 8 notes, 16,000 characters in all.`) : '',
      (() => {
        const held = notesPayload(fit).held;
        return held
          ? h('p', { class: 'muted small', style: 'margin:0' }, `${plural(held, 'photo')} go as words only: a photo is read once it is online, four a sort.`)
          : '';
      })(),
      reason ? h('p', { class: 'muted small', style: 'margin:0', 'data-why': '' }, reason) : h('p', { class: 'muted small', style: 'margin:0' }, 'One sort uses one of today\'s AI answers.'),
      refusal ? h('p', { class: 'error', role: 'alert' }, refusal) : '',
      sortBtn,
    ];
  };

  const targetLine = (t: Target | undefined) =>
    t ? h('span', null, h('b', null, s.get(t.id)?.name ? String(s.get(t.id)!.name) : t.name), t.anchor ? h('span', { class: 'muted small' }, ` · ${t.anchor}`) : '') : '';

  const card = (row: SortRow, i: number): HTMLElement => {
    const st = state.get(i) ?? { on: false };
    state.set(i, st);
    const body: (Node | string)[] = [];
    if (row.kind === 'make') {
      const name = h('input', { class: 'input', type: 'text', 'aria-label': 'Name', value: st.name ?? row.proposal.name });
      name.addEventListener('input', () => (st.name = name.value));
      const type = h('select', { class: 'input', 'aria-label': 'What it is' });
      const want = (st.type ?? row.proposal.type ?? '').toLowerCase();
      for (const t of TYPES.filter((x) => !MAP_TYPES.has(x))) {
        const o = h('option', { value: t }, typeLabel(t));
        if (t === want) o.selected = true;
        type.appendChild(o);
      }
      if (!TYPES.includes(want as never)) {
        const o = h('option', { value: '', selected: true }, 'Choose what it is');
        type.prepend(o);
      }
      type.addEventListener('change', () => (st.type = type.value));
      body.push(h('div', { class: 'row-gap' }, name, type));
      if (row.proposal.description) body.push(h('p', { class: 'dim small', style: 'margin:0' }, row.proposal.description));
    } else if (row.kind === 'add_to') {
      body.push(h('p', { style: 'margin:0' }, targetLine(row.target)));
      body.push(h('p', { class: 'dim', style: 'margin:0' }, row.value));
    } else if (row.kind === 'link') {
      body.push(
        h('p', { style: 'margin:0' }, targetLine(row.target), h('span', { class: 'muted small' }, ' to '), h('b', null, s.get(row.value_id)?.name ? String(s.get(row.value_id)!.name) : row.value_name ?? '')),
      );
    } else {
      body.push(h('p', { style: 'margin:0' }, row.question));
      const picks = h('div', { class: 'stack', style: 'gap:6px' });
      for (const c of row.candidates) {
        const b = h('button', { class: 'note-pick', type: 'button', role: 'radio', 'aria-checked': String(st.pick === c.id) }, h('span', { class: 'tick' }, st.pick === c.id ? icon('check', 18, 2.4) : ''), h('span', { class: 'label' }, targetLine(c)));
        b.addEventListener('click', () => {
          st.pick = st.pick === c.id ? undefined : c.id;
          st.on = !!st.pick;
          render();
        });
        picks.appendChild(b);
      }
      // Neither: an empty card to make it new, written fresh (Simmer h37 #3598: never a model's guess behind a tap).
      const neither = h('button', { class: 'btn btn-quiet', type: 'button', 'data-neither': String(i) }, row.candidates.length ? 'Neither: it is something new' : 'It is something new');
      neither.addEventListener('click', () => {
        if (!kept) return;
        st.pick = undefined;
        st.on = false;
        kept.result.rows.splice(i + 1, 0, { kind: 'make', source_line: row.source_line, proposal: { type: '', name: '' } });
        // Rows after this one move down by one: their ticks move with them.
        const moved = new Map<number, RowState>();
        for (const [k, v] of state) moved.set(k > i ? k + 1 : k, v);
        state.clear();
        for (const [k, v] of moved) state.set(k, v);
        writeKept(s.id, kept);
        render();
      });
      body.push(picks, neither);
      if (!row.then && row.candidates.length) body.push(h('p', { class: 'muted small', style: 'margin:0' }, 'Picking one only answers the question.'));
    }
    const tickable = row.kind !== 'ask';
    const tickBtn = tickable
      ? (() => {
          const b = h('button', { class: `btn btn-pill${st.on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(st.on), 'data-tick': String(i) }, st.on ? icon('check', 16, 2.4) : '', st.on ? 'True' : 'Tick if true');
          b.addEventListener('click', () => {
            st.on = !st.on;
            render();
          });
          return b;
        })()
      : '';
    const head = h(
      'div',
      { class: 'sort-head' },
      row.kind === 'make' ? typeChip((st.type ?? row.proposal.type ?? '').toLowerCase() || 'narrative') : '',
      h('span', { class: 'section-label' }, row.kind === 'add_to' || row.kind === 'link' ? `${KIND_WORD[row.kind]} · ${fieldLabel(row.field)}` : KIND_WORD[row.kind]),
      h('span', { class: 'spacer' }),
      tickBtn,
    );
    return h(
      'div',
      { class: `sort-card${st.on ? ' on' : ''}`, 'data-kind': row.kind, style: row.kind === 'make' ? `--type:${typeColor((st.type ?? row.proposal.type ?? '').toLowerCase())}` : null },
      head,
      ...body,
      h('p', { class: 'source-line' }, `From your note: "${snippet(row.source_line, 140)}"`),
    );
  };

  const write = async () => {
    if (!kept) return;
    const ticked: Ticked[] = [];
    kept.result.rows.forEach((row, i) => {
      const st = state.get(i);
      if (st?.on) ticked.push({ key: String(i), row, name: st.name, type: st.type, pick: st.pick });
    });
    const plan = planWrites(ticked, (id) => s.get(id));
    if (plan.skipped.length) {
      toast(plan.skipped[0].reason);
      return;
    }
    try {
      for (const w of plan.writes) {
        if (w.op === 'create') await s.create(w.type, w.values);
        else await s.edit(w.id, w.values, s.serverCopy(w.id));
      }
      // The notes are filed, not deleted: every written row points at its note.
      for (const id of kept.notes) if (s.get(id)) await s.edit(id, { supertype: SORTED }, s.serverCopy(id));
      writeKept(s.id, null);
      kept = null;
      toast(plan.writes.length ? `${plural(plan.writes.length, 'change')} written. The notes are filed as Sorted.` : 'The notes are filed as Sorted.');
      go(`#/w/${s.id}/t/narrative?unsorted`, true);
    } catch (e) {
      toast(errorText(e));
    }
  };

  const reviewScreen = (): (Node | string)[] => {
    if (!kept) return [];
    const { rows, not_proposed, remaining } = kept.result;
    const count = [...state.values()].filter((x) => x.on).length;
    const writeBtn = h('button', { class: 'btn btn-primary', type: 'button', 'data-action': 'write' }, count ? `Write ${count}` : 'File the notes as sorted');
    writeBtn.addEventListener('click', () => void write());
    const letGo = h('button', { class: 'btn btn-quiet', type: 'button', style: 'align-self:center' }, 'Keep the notes in Unsorted');
    letGo.addEventListener('click', () => {
      writeKept(s.id, null);
      kept = null;
      phase = 'choose';
      render();
    });
    const leftOut = not_proposed.length
      ? (() => {
          const b = h('button', { class: 'btn btn-quiet', type: 'button' }, showLeftOut ? 'Hide what was left out' : `Left out · ${not_proposed.length}`);
          b.addEventListener('click', () => {
            showLeftOut = !showLeftOut;
            render();
          });
          return h(
            'div',
            { class: 'stack', style: 'gap:6px' },
            b,
            ...(showLeftOut ? not_proposed.map((n) => h('p', { class: 'muted small', style: 'margin:0' }, `"${snippet(n.source_line, 100)}": ${n.reason}`)) : []),
          );
        })()
      : '';
    return [
      h(
        'p',
        { class: 'dim', style: 'margin:0' },
        rows.length ? `${plural(rows.length, 'proposal')} from ${plural(kept.notes.length, 'note')}. Tick what is true.` : 'Nothing to propose from these notes.',
        typeof remaining === 'number' ? h('span', { class: 'muted small' }, ` ${remaining} AI answers left today.`) : '',
      ),
      ...rows.map(card),
      leftOut,
      writeBtn,
      letGo,
    ];
  };

  const render = () => {
    const body =
      phase === 'asking'
        ? [h('p', { class: 'empty', role: 'status' }, 'Reading your notes beside your world…')]
        : phase === 'review'
          ? reviewScreen()
          : chooseScreen();
    main.replaceChildren(topbar('Sort your notes', `#/w/${s.id}/t/narrative?unsorted`), ...body, tabbar(s, null));
  };
  render();
  // A sync that lands mid-review redraws with the ticks kept (they live in `state`, not the page).
  // Not while a name is being typed on a card: the redraw would take the field away under the finger.
  const typing = () => main.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement?.tagName ?? '');
  return { el: main, refresh: () => phase !== 'asking' && !typing() && render() };
}
