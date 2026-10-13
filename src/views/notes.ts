// A player's own notes (src/notes.ts): written at the table, kept on this phone only, never sent.
import { h, plural } from '../dom';
import { addNote, notes, removeNote } from '../notes';
import { tabbar, toast, topbar } from '../ui';
import type { WorldSession } from '../world';
import type { View } from './world';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function notesView(s: WorldSession): View {
  const input = h('textarea', { class: 'textarea', 'aria-label': 'A note', placeholder: 'What you want to remember' });
  const list = h('div', { class: 'stack', 'data-part': 'notes' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Keep it');
  const form = h('form', { class: 'stack' }, input, save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    if (!addNote(s.id, input.value)) {
      toast('This phone would not keep the note.');
      return;
    }
    input.value = '';
    refresh();
  });
  const refresh = () => {
    const all = notes(s.id);
    list.replaceChildren(
      ...(all.length ? [h('p', { class: 'section-label' }, plural(all.length, 'note'))] : []),
      ...all.map((n) => {
        const rm = h('button', { class: 'btn btn-quiet', type: 'button', 'data-action': 'remove-note', style: 'align-self:flex-start' }, 'Remove');
        let armed = false;
        rm.addEventListener('click', () => {
          if (!armed) {
            armed = true;
            rm.textContent = 'Remove this note? Tap again';
            return;
          }
          removeNote(s.id, n.id);
          refresh();
        });
        return h('div', { class: 'note-card', 'data-note': n.id }, h('p', { class: 'prose', style: 'margin:0' }, n.text), h('span', { class: 'muted small' }, when(n.at)), rm);
      }),
    );
  };
  refresh();
  return {
    el: h(
      'main',
      { class: 'screen has-tabbar', 'data-screen': 'notes' },
      topbar('My notes', `#/w/${s.id}`),
      h('p', { class: 'dim', style: 'margin:0' }, 'Kept on this phone only. Nobody else sees them, and they stay here when you have no signal.'),
      form,
      list,
      tabbar(s, 'catch'),
    ),
  };
}
