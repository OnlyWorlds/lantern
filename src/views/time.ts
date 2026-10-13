// Before now: a world's Events in the order they happened, the world's now between what has
// happened and what has not (src/time.ts holds the rules). Read only: dates change on an Event's page.
import { h, plural } from '../dom';
import { dateText, ongoing, spanText, timeline } from '../time';
import { elRow, errorText, sheet, tabbar, toast, topbar } from '../ui';
import type { WorldSession } from '../world';
import { pinSheet, type View } from './world';

/** Move the world's now, asking for the PIN first when none is held. Resolves true once moved. */
export async function moveNow(s: WorldSession, n: number): Promise<boolean> {
  if (!s.isLocal && !s.pinKnown()) {
    pinSheet(s);
    toast('Enter your PIN, then try again.');
    return false;
  }
  try {
    await s.setNow(n);
    toast(`Now is ${dateText(n, s.rec.timeUnit)}.`);
    return true;
  } catch (e) {
    toast(errorText(e));
    return false;
  }
}

function changeNowSheet(s: WorldSession): void {
  sheet((close) => {
    const input = h('input', { class: 'input', type: 'number', inputmode: 'numeric', step: '1', 'aria-label': 'Now' });
    input.value = s.rec.timeNow === undefined ? '' : String(s.rec.timeNow);
    const err = h('p', { class: 'error', role: 'alert' });
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);
    const form = h(
      'form',
      { class: 'stack' },
      h('p', { class: 'dim', style: 'margin:0' }, s.rec.timeUnit ? `In ${s.rec.timeUnit.toLowerCase()}s, as a whole number.` : 'A whole number.'),
      input,
      err,
      h('div', { class: 'row-gap' }, cancel, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Move now')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Number(input.value.trim());
      if (!input.value.trim() || !Number.isInteger(n)) {
        err.textContent = 'A whole number, please.';
        return;
      }
      void moveNow(s, n).then((ok) => ok && close());
    });
    return [h('h2', null, 'Move now'), form];
  }, 'Move now');
}

export function beforeNowView(s: WorldSession): View {
  const body = h('div', { class: 'stack' });
  const refresh = () => {
    const now = s.rec.timeNow;
    const unit = s.rec.timeUnit;
    const t = timeline(s.elements(), now);
    const row = (e: Parameters<typeof elRow>[1]) => elRow(s.id, e, [spanText(e, unit), ongoing(e, now) ? 'still going' : ''].filter(Boolean).join(' · '));
    const parts: (HTMLElement | string)[] = [];
    if (!t.before.length && !t.after.length && !t.undated.length) {
      parts.push(h('p', { class: 'dim', style: 'margin:0' }, 'No Events in this world yet. An Event with a start date shows here in its place.'));
    } else {
      parts.push(
        h(
          'p',
          { class: 'dim', style: 'margin:0', 'data-now': now === undefined ? '' : String(now) },
          now === undefined ? 'This world has no now set, so every dated Event is listed. Set it in Atlas.' : `Now is ${dateText(now, unit)}.`,
        ),
      );
      if (t.before.length) parts.push(h('div', { class: 'results', 'data-part': 'before' }, ...t.before.map(row)));
      if (now !== undefined) {
        parts.push(h('div', { class: 'now-line', role: 'separator', 'aria-label': `Now, ${dateText(now, unit)}` }, h('span', null, `Now · ${dateText(now, unit)}`)));
        if (t.after.length) {
          parts.push(h('p', { class: 'section-label' }, 'After now'), h('div', { class: 'results after', 'data-part': 'after' }, ...t.after.map(row)));
        }
      }
      if (t.undated.length) {
        parts.push(
          h('p', { class: 'section-label' }, `No date · ${plural(t.undated.length, 'Event')}`),
          h('div', { class: 'results', 'data-part': 'undated' }, ...t.undated.map((e) => elRow(s.id, e))),
        );
      }
    }
    if (s.canMoveNow) {
      const b = h('button', { class: 'btn btn-quiet', type: 'button', 'data-action': 'change-now', style: 'align-self:flex-start' }, now === undefined ? 'Set now' : 'Move now');
      b.addEventListener('click', () => changeNowSheet(s));
      parts.splice(1, 0, b);
    }
    body.replaceChildren(...parts);
  };
  refresh();
  return {
    el: h('main', { class: 'screen has-tabbar', 'data-screen': 'time' }, topbar('Before now', `#/w/${s.id}`), body, tabbar(s, null)),
    refresh,
  };
}
