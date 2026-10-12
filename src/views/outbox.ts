// Waiting to send: every change still on this phone, and the ones that need you. A conflict is
// asked only when the same field moved on both sides; everything else was settled silently.
import type { OwElement } from '@onlyworlds/sdk';
import { h, plural } from '../dom';
import { fieldInfo, fieldLabel, isEmptyValue } from '../schema';
import { elName, topbar } from '../ui';
import { movedFields, type WorldSession } from '../world';
import type { OutboxRow } from '../db';
import { pinSheet, type View } from './world';

function show(s: WorldSession, type: string, field: string, v: unknown): string {
  if (isEmptyValue(v)) return '(empty)';
  const info = fieldInfo(type, field);
  if (info?.type === 'single_link') return elName(s.get(String(v)));
  if (info?.type === 'multi_link' && Array.isArray(v)) return v.map((id) => elName(s.get(String(id)))).join(', ');
  return String(v);
}

// The choices made on a conflict, kept outside its card: a redraw (a change arriving from the
// poll) rebuilds the cards and must not put a choice back (the S396 gate).
const choices = new Map<string, Set<string>>();

function conflictCard(s: WorldSession, row: OutboxRow): HTMLElement {
  const current = row.current as OwElement;
  const moved = movedFields(row, current);
  const key = `${row.id}:${row.seq}:${String(current.change_seq ?? '')}`;
  const mine = choices.get(key) ?? new Set(moved);
  choices.set(key, mine);
  const card = h('div', { class: 'conflict', 'data-conflict': row.id });
  const render = () => {
    const pairs = moved.map((f) => {
      const yours = h(
        'button',
        { class: `side${mine.has(f) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(mine.has(f)) },
        h('span', { class: 'who' }, 'Yours, from this phone'),
        h('span', { class: 'val' }, show(s, row.type, f, row.values[f])),
      );
      const theirs = h(
        'button',
        { class: `side${mine.has(f) ? '' : ' on'}`, type: 'button', 'aria-pressed': String(!mine.has(f)) },
        h('span', { class: 'who' }, 'Changed elsewhere'),
        h('span', { class: 'val' }, show(s, row.type, f, current[f])),
      );
      yours.addEventListener('click', () => {
        mine.add(f);
        render();
      });
      theirs.addEventListener('click', () => {
        mine.delete(f);
        render();
      });
      return h('div', { class: 'stack' }, h('b', null, fieldLabel(f)), yours, theirs);
    });
    const quiet = Object.keys(row.values).filter((f) => !moved.includes(f));
    const send = h('button', { class: 'btn btn-primary', type: 'button' }, 'Use these');
    send.addEventListener('click', () => void s.resolve(row, [...mine]));
    card.replaceChildren(
      // Named as it was before either change, so the title is neither side's new name.
      h('b', null, elName(row.base ?? current)),
      h('p', { class: 'dim small', style: 'margin:0' }, 'Someone changed this while your edit waited. Choose which to keep.'),
      ...pairs,
      quiet.length ? h('p', { class: 'muted small', style: 'margin:0' }, `Also sending: ${quiet.map(fieldLabel).join(', ')}`) : '',
      send,
    );
  };
  render();
  return card;
}

function goneCard(s: WorldSession, row: OutboxRow): HTMLElement {
  const keep = h('button', { class: 'btn btn-primary', type: 'button' }, 'Keep it as a new element');
  keep.addEventListener('click', () => void s.keepAsNew(row));
  const drop = h('button', { class: 'btn', type: 'button' }, 'Drop my edit');
  drop.addEventListener('click', () => void s.drop(row));
  return h(
    'div',
    { class: 'conflict' },
    h('b', null, elName(s.get(row.id))),
    h('p', { class: 'dim small', style: 'margin:0' }, 'This was deleted elsewhere while your edit waited.'),
    keep,
    drop,
  );
}

function refusedCard(s: WorldSession, row: OutboxRow): HTMLElement {
  const retry = h('button', { class: 'btn', type: 'button' }, 'Try again');
  retry.addEventListener('click', () => void s.retryRefused(row));
  const drop = h('button', { class: 'btn', type: 'button' }, 'Let it go');
  drop.addEventListener('click', () => void s.drop(row));
  return h(
    'div',
    { class: 'conflict' },
    // A refused row is not laid over the view, so a refused create has only its own values.
    h('b', null, s.get(row.id) ? elName(s.get(row.id)) : String(row.values.name ?? 'A change')),
    h('p', { class: 'dim small', style: 'margin:0' }, `Not sent: ${row.error ?? 'the server refused it'}`),
    h('div', { class: 'row-gap' }, retry, drop),
  );
}

export function outboxView(s: WorldSession): View {
  const main = h('main', { class: 'screen', 'data-screen': 'outbox' });
  const refresh = () => {
    const rows = [...s.outbox].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const needs = rows.filter((r) => r.state === 'needs-you');
    const gone = rows.filter((r) => r.state === 'gone');
    const refused = rows.filter((r) => r.state === 'refused');
    const waiting = rows.filter((r) => r.state === 'waiting' || r.state === 'sending');
    const pinBtn = s.needPin && waiting.length ? h('button', { class: 'btn btn-primary', type: 'button' }, 'Enter your PIN to send') : null;
    pinBtn?.addEventListener('click', () => pinSheet(s));
    main.replaceChildren(
      topbar('Waiting to send', `#/w/${s.id}`),
      ...needs.map((r) => conflictCard(s, r)),
      ...gone.map((r) => goneCard(s, r)),
      ...refused.map((r) => refusedCard(s, r)),
      waiting.length
        ? h(
            'div',
            { class: 'stack' },
            h('p', { class: 'section-label' }, plural(waiting.length, 'change')),
            ...waiting.map((r) =>
              h(
                'a',
                { class: 'el-row', href: `#/w/${s.id}/e/${r.id}` },
                h(
                  'span',
                  { class: 'label' },
                  h('b', null, elName(s.get(r.id))),
                  ' ',
                  h(
                    'span',
                    { class: 'muted' },
                    `· ${r.op === 'create' ? 'new' : Object.keys(r.values).map(fieldLabel).join(', ')}${r.photo ? ' · a photo' : ''}${r.state === 'sending' ? ' · sending' : ''}`,
                  ),
                ),
              ),
            ),
          )
        : '',
      pinBtn ?? "",
      !rows.length ? h('p', { class: 'empty' }, 'Everything is sent.') : '',
    );
  };
  refresh();
  return { el: main, refresh };
}
