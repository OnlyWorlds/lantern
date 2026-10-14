// Make it an element, by hand: an Unsorted note becomes an element of a type you pick, the way a
// typed catch does (the first line its name, the rest its description), and the note is filed as
// Sorted, as a sort files it. No AI, no account: it works in a world on this phone only too
// (Quillon's walk, h37 #4275: in a local world the notes had no way out of Unsorted).
import type { OwElement } from '@onlyworlds/sdk';
import { h } from '../dom';
import { icon, typeIcon } from '../icons';
import { MAP_TYPES } from '../maps';
import { valuesFromNote } from '../note';
import { SORTED } from '../sortplan';
import { TYPES, typeColor, typeLabel } from '../schema';
import { errorText, go, sheet } from '../ui';
import type { WorldSession } from '../world';
import { FIRST_KINDS } from './capture';

export function makeFromNoteSheet(s: WorldSession, note: OwElement): void {
  sheet((close) => {
    let kind = FIRST_KINDS[0];
    let showAll = false;
    const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'What is it?' });
    const ok = h('button', { class: 'btn btn-primary', type: 'submit' });
    const err = h('p', { class: 'error', role: 'alert' });
    const render = () => {
      const rest = TYPES.filter((t) => !MAP_TYPES.has(t) && !FIRST_KINDS.includes(t));
      const offered = [...FIRST_KINDS, ...(showAll || rest.includes(kind as never) ? rest : [])];
      const chip = (k: string) => {
        const b = h(
          'button',
          { class: 'kind-chip', type: 'button', role: 'radio', 'aria-checked': String(k === kind), style: `--type:${typeColor(k)}`, 'data-kind': k },
          typeIcon(k, 16),
          typeLabel(k),
        );
        b.addEventListener('click', () => {
          kind = k;
          render();
        });
        return b;
      };
      const more = offered.length < FIRST_KINDS.length + rest.length ? h('button', { class: 'kind-chip more', type: 'button' }, 'More') : null;
      more?.addEventListener('click', () => {
        showAll = true;
        render();
      });
      chips.replaceChildren(...offered.map(chip), more ?? '');
      ok.textContent = `Make the ${typeLabel(kind).toLowerCase()}`;
    };
    render();
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);
    const form = h(
      'form',
      { class: 'stack' },
      h('p', { class: 'muted small', style: 'margin:0' }, "The note's first line is its name, the rest its description. The note moves out of Unsorted."),
      chips,
      err,
      h('div', { class: 'row-gap' }, cancel, ok),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      ok.disabled = true;
      try {
        const id = await s.create(kind, valuesFromNote(note));
        // Filed, not deleted, as a sort files it: the note keeps the words it came from.
        if (s.get(note.id)) await s.edit(note.id, { supertype: SORTED }, s.serverCopy(note.id));
        close();
        go(`#/w/${s.id}/e/${id}?fill`);
      } catch (ex) {
        err.textContent = errorText(ex);
        ok.disabled = false;
      }
    });
    return [h('h2', null, icon('unsorted', 18, 2), ' Make it an element'), form];
  }, 'Make it an element');
}
