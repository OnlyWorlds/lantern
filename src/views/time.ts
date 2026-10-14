// Before now: a world's Events in the order they happened, the world's now between what has
// happened and what has not (src/time.ts holds the rules). Read only: dates change on an Event's page.
import { worldCalendars, type WorldCalendar } from '@onlyworlds/sdk';
import { chosenCalendar } from '../calendarpick';
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
    toast(`Now is ${dateText(n, s.rec.timeUnit, s.calendar())}.`);
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

function calendarSheet(s: WorldSession, cals: WorldCalendar[]): void {
  sheet((close) => {
    const current = chosenCalendar(s.id);
    const choice = (id: string | null, title: string, hint: string) => {
      const b = h('button', { class: 'choice', type: 'button', 'aria-pressed': (current ?? null) === id && current !== undefined ? 'true' : null }, h('b', null, title), h('span', null, hint));
      b.addEventListener('click', () => {
        s.pickCalendar(id);
        close();
      });
      return b;
    };
    const now = s.rec.timeNow;
    return [
      h('h2', null, 'Dates in which calendar?'),
      h('p', { class: 'dim', style: 'margin:0' }, 'Lantern keeps your choice for this world on this phone. Atlas keeps its own.'),
      h(
        'div',
        { class: 'stack' },
        ...cals.map((c) => choice(c.id, c.name, now === undefined ? 'A calendar from Atlas' : `Now is ${dateText(now, s.rec.timeUnit, c.config)}`)),
        choice(null, 'Numbers', now === undefined ? 'The numbers the dates are kept as' : `Now is ${dateText(now, s.rec.timeUnit)}`),
      ),
    ];
  }, 'Dates in which calendar?');
}

export function beforeNowView(s: WorldSession): View {
  const body = h('div', { class: 'stack' });
  const refresh = () => {
    const now = s.rec.timeNow;
    const unit = s.rec.timeUnit;
    const cal = s.calendar();
    const t = timeline(s.elements(), now);
    const row = (e: Parameters<typeof elRow>[1]) => elRow(s.id, e, [spanText(e, unit, cal),ongoing(e, now) ? 'still going' : ''].filter(Boolean).join(' · '));
    const parts: (HTMLElement | string)[] = [];
    if (!t.before.length && !t.after.length && !t.undated.length) {
      parts.push(h('p', { class: 'dim', style: 'margin:0' }, 'No Events in this world yet. An Event with a start date shows here in its place.'));
    } else {
      parts.push(
        h(
          'p',
          { class: 'dim', style: 'margin:0', 'data-now': now === undefined ? '' : String(now) },
          now === undefined ? 'This world has no now set, so every dated Event is listed. Set it in Atlas.' : `Now is ${dateText(now, unit, cal)}.`,
        ),
      );
      if (t.before.length) parts.push(h('div', { class: 'results', 'data-part': 'before' }, ...t.before.map(row)));
      if (now !== undefined) {
        parts.push(h('div', { class: 'now-line', role: 'separator', 'aria-label': `Now, ${dateText(now, unit, cal)}` }, h('span', null, `Now · ${dateText(now, unit, cal)}`)));
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
    // Several calendars: which one the dates are in is this phone's choice (Kael h37 #4287).
    const cals = worldCalendars(s.elements());
    if (cals.length > 1) {
      const chosen = cals.find((c) => c.id === chosenCalendar(s.id));
      const change = h('button', { class: 'btn btn-quiet', type: 'button', 'data-action': 'pick-calendar' }, chosen ? 'Change' : 'Choose one');
      change.addEventListener('click', () => calendarSheet(s, cals));
      parts.splice(1, 0, h('div', { class: 'give-row', 'data-part': 'calendar' }, h('span', { class: 'dim', style: 'flex:1;min-width:0' }, chosen ? ['Dates in ', h('b', null, chosen.name)] : `This world has ${cals.length} calendars. Dates show as numbers.`), change));
    }
    body.replaceChildren(...parts);
  };
  refresh();
  return {
    el: h('main', { class: 'screen has-tabbar', 'data-screen': 'time' }, topbar('Before now', `#/w/${s.id}`), body, tabbar(s, null)),
    refresh,
  };
}
