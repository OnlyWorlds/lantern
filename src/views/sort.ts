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
import { buildSlice, fitNotes, notesPayload, noteText, planWrites, sanitizeRows, tooLong, type SortRow, type Target, type Ticked, type Write } from '../sortplan';
import { sortNotes, SortRefused, type Sorted } from '../sort';
import { runWrites, type WriteRun } from '../sortwrite';
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
  /** The ids sent in the slice: a row naming any other is refused here too. */
  sent: string[];
  result: Sorted;
  at: string;
  /** Once Write is tapped: the writes, fixed, and how many are done, so a retry resumes and never writes twice. */
  plan?: Write[];
  step?: number;
  /** The photos were not read (refused, or unreadable to the model): this sort used the notes' words. */
  wordsOnly?: boolean;
  /** The cards' ticks, edits and picks, by row index: a reload mid-review keeps them. */
  ticks?: Record<string, RowState>;
}

/** Rows checked on arrival and again on reopen: a row the screen cannot show is left out with its reason. */
function clean(result: Sorted): Sorted {
  const { rows, dropped } = sanitizeRows(result.rows);
  return { ...result, rows, not_proposed: [...dropped, ...(Array.isArray(result.not_proposed) ? result.not_proposed : [])] };
}

// A sort spends an answer: what came back is kept on this phone until written or let go.
const keepKey = (worldId: string) => `lantern-sort-${worldId}`;
function readKept(worldId: string): Kept | null {
  try {
    const raw = localStorage.getItem(keepKey(worldId));
    if (!raw) return null;
    const k = JSON.parse(raw) as Kept;
    const ticks = k.ticks && typeof k.ticks === 'object' ? k.ticks : {};
    return { ...k, sent: Array.isArray(k.sent) ? k.sent : [], result: clean(k.result), ticks };
  } catch {
    return null;
  }
}

/** A sort under way, per world: leaving and coming back waits for it instead of spending a second answer. */
const inFlight = new Map<string, Promise<void>>();
/** A write run under way, per world: one at a time, joined by a screen that comes back to it. */
const writingRun = new Map<string, Promise<void>>();
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

/** A note's words under its name: a catch's first line is its name, so the line under it does not say it twice. */
function afterName(n: OwElement): string {
  const t = noteText(n);
  const name = typeof n.name === 'string' ? n.name.trim() : '';
  return name && t.startsWith(name) ? t.slice(name.length).trim() : t;
}

const KIND_WORD: Record<SortRow['kind'], string> = { make: 'New', add_to: 'Add to', link: 'Link', ask: 'Which one?' };

export function sortView(s: WorldSession): View {
  const main = h('main', { class: 'screen has-tabbar', 'data-screen': 'sort' });
  let phase: 'choose' | 'asking' | 'review' = 'choose';
  let kept = readKept(s.id);
  if (kept) phase = 'review';
  // The last write run here stopped on an error: say so, and offer to stop.
  let failed = false;
  const running = writingRun.get(s.id);
  if (running) {
    // Back while a write run is under way: wait for it, then show what it left.
    void running.then(
      () => {
        kept = readKept(s.id);
        loadTicks();
        phase = kept ? 'review' : 'choose';
        if (main.isConnected) render();
      },
      () => {
        failed = true;
        if (main.isConnected) render();
      },
    );
  }
  const pending = inFlight.get(s.id);
  if (pending) {
    phase = 'asking';
    void pending.then(() => {
      kept = readKept(s.id);
      loadTicks();
      phase = kept ? 'review' : 'choose';
      render();
    });
  }
  let chosen = new Set(fitNotes(unsortedNotes(s)).map((n) => n.id));
  let refusal = '';
  let signedIn = false;
  let accountWorld = s.rec.kind === 'online' && !!s.rec.role;
  let known = false;
  // Per row (by index in the kept result): ticked, and a make's edits or an ask's pick. Kept with the
  // sort, so a reload or a lost tab comes back to the same ticks.
  const state = new Map<number, RowState>();
  const loadTicks = () => {
    state.clear();
    for (const [k, v] of Object.entries(kept?.ticks ?? {})) {
      const i = Number(k);
      if (Number.isInteger(i) && v && typeof v === 'object') state.set(i, { on: !!v.on, name: v.name, type: v.type, pick: v.pick });
    }
  };
  const saveTicks = () => {
    if (!kept || kept.plan) return;
    kept.ticks = Object.fromEntries([...state].filter(([, v]) => v.on || v.name !== undefined || v.type !== undefined || v.pick !== undefined));
    writeKept(s.id, kept);
  };
  loadTicks();
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
    if (!fit.length || inFlight.has(s.id)) return;
    phase = 'asking';
    refusal = '';
    render();
    const job = (async () => {
      try {
        const slice = buildSlice(fit, s.lookupIndex(), (id) => s.get(id));
        const payload = notesPayload(fit).notes;
        let result: Sorted;
        let wordsOnly = false;
        try {
          result = await sortNotes(s.id, payload, slice);
        } catch (e) {
          // keel refuses a picture it will not take (422), or the model could not read one (502):
          // nothing was counted either way, so the words go once alone, and the review says so.
          if (!(e instanceof SortRefused && (e.status === 422 || e.status === 502) && payload.some((n) => typeof n !== 'string'))) throw e;
          result = await sortNotes(s.id, payload.map((n) => (typeof n === 'string' ? n : n.text)), slice);
          wordsOnly = true;
        }
        kept = { notes: fit.map((n) => n.id), sent: slice.map((x) => x.id), result: clean(result), at: new Date().toISOString(), wordsOnly };
        writeKept(s.id, kept);
        state.clear();
        phase = 'review';
      } catch (e) {
        refusal = e instanceof SortRefused ? e.message : errorText(e);
        phase = 'choose';
      }
    })();
    inFlight.set(s.id, job);
    await job;
    inFlight.delete(s.id);
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
        h(
          'span',
          { class: 'label' },
          h('b', null, String(n.name ?? 'A note')),
          h('span', { class: 'muted small', style: 'display:block' }, tooLong(n) ? 'Too long for one sort (4,000 characters): split it on its page first.' : snippet(afterName(n))),
        ),
        typeof n.image_url === 'string' && n.image_url ? icon('image', 18) : '',
      );
      b.addEventListener('click', () => {
        if (on) chosen.delete(n.id);
        else chosen.add(n.id);
        render();
      });
      b.disabled = tooLong(n);
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
    // Once writing has begun, the plan is fixed: the cards are shown, not changed.
    const locked = !!kept?.plan;
    const body: (Node | string)[] = [];
    if (row.kind === 'make') {
      const name = h('input', { class: 'input', type: 'text', 'aria-label': 'Name', value: st.name ?? row.proposal.name });
      name.addEventListener('input', () => {
        st.name = name.value;
        saveTicks();
      });
      name.disabled = locked;
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
      type.addEventListener('change', () => {
        st.type = type.value;
        saveTicks();
      });
      type.disabled = locked;
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
          saveTicks();
          render();
        });
        b.disabled = locked;
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
        saveTicks();
        writeKept(s.id, kept);
        render();
      });
      neither.disabled = locked;
      body.push(picks, neither);
      if (!row.then && row.candidates.length) body.push(h('p', { class: 'muted small', style: 'margin:0' }, 'Picking one only answers the question.'));
    }
    const tickable = row.kind !== 'ask';
    const tickBtn = tickable
      ? (() => {
          const b = h('button', { class: `btn btn-pill${st.on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(st.on), 'data-tick': String(i) }, st.on ? icon('check', 16, 2.4) : '', st.on ? 'True' : 'Tick if true');
          b.addEventListener('click', () => {
            st.on = !st.on;
            saveTicks();
            render();
          });
          b.disabled = locked;
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

  // Write is one plan, fixed at the first tap and kept with the sort, done step by step: a second
  // tap while it runs does nothing, and a retry after a failure resumes where it stopped, so nothing
  // is made or appended twice (the S398 sort gate).
  const write = async () => {
    if (!kept || writingRun.has(s.id)) return;
    if (!s.canWrite) {
      toast('This world is read only here now, so nothing more can be written to it.');
      return;
    }
    if (!kept.plan) {
      const ticked: Ticked[] = [];
      kept.result.rows.forEach((row, i) => {
        const st = state.get(i);
        if (st?.on) ticked.push({ key: String(i), row, name: st.name, type: st.type, pick: st.pick });
      });
      let plan: ReturnType<typeof planWrites>;
      try {
        plan = planWrites(ticked, (id) => s.get(id), new Set(kept.sent), {
          // Each edit is judged against keel's copy as the plan was fixed, however late it is finished.
          base: (id) => s.serverCopy(id),
          waitsOnYou: (id) => [...s.pending(id).values()].some((r) => r.state === 'needs-you' || r.state === 'gone'),
        });
      } catch {
        toast('A ticked card could not be read. Untick it and write the rest.');
        return;
      }
      if (plan.skipped.length) {
        toast(plan.skipped[0].reason);
        return;
      }
      kept.plan = plan.writes;
      kept.step = 0;
      writeKept(s.id, kept);
    }
    const k = kept;
    const plan = k.plan!;
    let gone = 0;
    // One write run per world, wherever the screen is: leaving and coming back joins this run
    // instead of starting a second one over the same steps (the S399 merge gate).
    const run = (async () => {
      // The kept sort is the run's state: its step moves with each write and is saved after it.
      ({ gone } = await runWrites(s, k as Kept & WriteRun, () => writeKept(s.id, k)));
      writeKept(s.id, null);
    })();
    writingRun.set(s.id, run);
    failed = false;
    render();
    try {
      await run;
      kept = null;
      const done = plan.length - gone;
      toast(
        (done ? `${plural(done, 'change')} written. ` : '') +
          (gone ? `${plural(gone, 'element')} had been removed elsewhere, so nothing was added to it. ` : '') +
          'The notes are filed as Sorted.',
      );
      if (main.isConnected) go(`#/w/${s.id}/t/narrative?unsorted`, true);
    } catch (e) {
      failed = true;
      toast(`${errorText(e)} What was written stays written: tap again to finish, or stop here.`);
    } finally {
      writingRun.delete(s.id);
      if (main.isConnected) render();
    }
  };

  const reviewScreen = (): (Node | string)[] => {
    if (!kept) return [];
    const { rows, not_proposed, remaining } = kept.result;
    const count = [...state.values()].filter((x) => x.on).length;
    const started = !!kept.plan;
    const writing = writingRun.has(s.id);
    const writeBtn = h(
      'button',
      { class: 'btn btn-primary', type: 'button', 'data-action': 'write' },
      writing ? 'Writing…' : started ? 'Finish writing' : count ? `Write ${count}` : 'File the notes as sorted',
    );
    writeBtn.disabled = writing;
    writeBtn.addEventListener('click', () => void write());
    // Before writing: let the sort go. Once started and stopped (a failure, a reload, a target that
    // cannot be written), stopping keeps what was written and leaves the unfiled notes in Unsorted,
    // so a sort can never be stuck for good (the S399 merge gate).
    const letGo = h(
      'button',
      { class: 'btn btn-quiet', type: 'button', style: 'align-self:center', hidden: writing, 'data-action': 'let-go' },
      started ? 'Stop here: what is written stays' : 'Keep the notes in Unsorted',
    );
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
      kept.wordsOnly ? h('p', { class: 'muted small', style: 'margin:0', 'data-words-only': '' }, 'The photos could not be read, so this sort used the words of your notes.') : '',
      started ? h('p', { class: 'muted small', style: 'margin:0', role: 'status' }, `Writing what you ticked: ${Math.min(kept.step ?? 0, (kept.plan?.length ?? 0) + kept.notes.length)} of ${(kept.plan?.length ?? 0) + kept.notes.length} done.`) : '',
      failed && !writing ? h('p', { class: 'error', role: 'alert', 'data-stopped': '' }, 'Writing stopped. Finish writing goes on from there; Stop here keeps what is written.') : '',
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
