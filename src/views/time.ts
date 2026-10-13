// Before now: a world's Events in the order they happened, the world's now between what has
// happened and what has not (src/time.ts holds the rules). Read only: dates change on an Event's page.
import { h, plural } from '../dom';
import { dateText, ongoing, spanText, timeline } from '../time';
import { elRow, tabbar, topbar } from '../ui';
import type { WorldSession } from '../world';
import type { View } from './world';

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
    body.replaceChildren(...parts);
  };
  refresh();
  return {
    el: h('main', { class: 'screen has-tabbar', 'data-screen': 'time' }, topbar('Before now', `#/w/${s.id}`), body, tabbar(s, null)),
    refresh,
  };
}
