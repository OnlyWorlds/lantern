// Catch it: a line, a ramble from the keyboard's microphone, or a photographed page. By default it
// lands as a Narrative with supertype Unsorted, the photo as its picture: material not yet turned
// into elements (Skeld's convention, #3409). "What is it?" makes it an element of a type at once
// instead: the first line its name, the rest its description (the Captain's walk, 2026-10-12).
import { h } from '../dom';
import { icon, typeIcon } from '../icons';
import { errorText, go, pinWhileTyping, tabbar, toast, topbar } from '../ui';
import type { WorldSession } from '../world';
import type { View } from './world';
import { consumeShared } from '../share';
import { readDraft, writeDraft } from '../draft';
import { MAP_TYPES } from '../maps';
import { TYPES, typeColor, typeLabel, typeName } from '../schema';
import { photoPicker } from './photo';
import { elementFromNote, titleFrom } from '../note';

export const UNSORTED = 'Unsorted';

/** The kinds offered first; the rest of the types (map furniture aside) behind "More". */
export const FIRST_KINDS = ['character', 'location', 'object', 'creature', 'event'];

export function captureView(s: WorldSession, fromShare = false): View {
  let photo: Blob | null = null;
  let photoUrl: string | null = null;
  let kind = UNSORTED;
  let showAllKinds = false;
  const text = h('textarea', {
    class: 'textarea',
    'aria-label': 'What to keep',
    placeholder: 'An idea, a name, what just happened at the table…',
    style: 'min-height:180px',
  });
  // A draft from before comes back first (src/draft.ts), and a note shared from another app lands under it.
  const shared = fromShare ? consumeShared() : null;
  const draft = readDraft(s.id);
  text.value = [draft.trimEnd(), shared ?? ''].filter(Boolean).join('\n\n');
  if (shared) writeDraft(s.id, text.value);
  text.addEventListener('input', () => {
    writeDraft(s.id, text.value);
    if (!text.value.trim()) kept.remove();
  });
  const clear = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Clear it');
  const kept = h(
    'div',
    { style: 'display:flex;gap:12px;align-items:center;justify-content:space-between' },
    h('span', { class: 'muted small' }, 'Your note from before is still here.'),
    clear,
  );
  clear.addEventListener('click', () => {
    text.value = '';
    writeDraft(s.id, '');
    kept.remove();
    text.focus();
  });
  const preview = h('div', { class: 'stack' });
  const err = h('p', { class: 'error', role: 'alert' });
  const keptLine = h('p', { class: 'muted small', role: 'status', 'data-part': 'kept', style: 'margin:0' });
  const picker = photoPicker(
    (p) => {
      err.textContent = '';
      photo = p;
      showPhoto();
    },
    (m) => {
      err.textContent = m;
    },
  );

  const showPhoto = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = photo ? URL.createObjectURL(photo) : null;
    if (!photo || !photoUrl) {
      preview.replaceChildren();
      return;
    }
    const remove = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Remove the photo');
    remove.addEventListener('click', () => {
      photo = null;
      showPhoto();
    });
    preview.replaceChildren(h('img', { class: 'photo-preview', src: photoUrl, alt: 'The photo to keep' }), remove);
  };

  // What is it? Unsorted first (the catch is fast by default), then the common kinds, then More.
  const kinds = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'What is it?' });
  const kindHint = h('p', { class: 'muted small', style: 'margin:0' });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit', 'data-action': 'catch-save' });
  pinWhileTyping(saveBtn, text);
  const renderKinds = () => {
    const rest = TYPES.filter((t) => !MAP_TYPES.has(t) && !FIRST_KINDS.includes(t));
    const offered = [UNSORTED, ...FIRST_KINDS, ...(showAllKinds || rest.includes(kind as never) ? rest : [])];
    const chip = (k: string) => {
      const on = k === kind;
      const b = h(
        'button',
        {
          class: 'kind-chip',
          type: 'button',
          role: 'radio',
          'aria-checked': String(on),
          style: k === UNSORTED ? null : `--type:${typeColor(k)}`,
          'data-kind': k,
        },
        // Each kind wears its mark (Seethe h37 #3743): a type's own glyph, Unsorted the Catch tab's tray.
        k === UNSORTED ? icon('unsorted', 16, 2) : typeIcon(k, 16),
        k === UNSORTED ? UNSORTED : typeLabel(k),
      );
      b.addEventListener('click', () => {
        kind = k;
        renderKinds();
      });
      return b;
    };
    const more =
      offered.length < rest.length + FIRST_KINDS.length + 1
        ? (() => {
            const b = h('button', { class: 'kind-chip more', type: 'button' }, 'More');
            b.addEventListener('click', () => {
              showAllKinds = true;
              renderKinds();
            });
            return b;
          })()
        : null;
    kinds.replaceChildren(...offered.map(chip), more ?? '');
    // The first line names it either way, so the hint says so before a type is picked (Quillon, h37 #4275).
    kindHint.textContent =
      kind === UNSORTED
        ? 'The first line names the note. Sort it into elements later.'
        : 'The first line is its name, the rest its description.';
    saveBtn.textContent = kind === UNSORTED ? 'Add to Unsorted' : `Make the ${typeName(kind)}`;
  };
  renderKinds();

  const form = h(
    'form',
    { class: 'stack' },
    text,
    draft.trim() ? kept : '',
    picker.row,
    preview,
    h('div', { class: 'stack', style: 'gap:8px' }, h('p', { class: 'section-label' }, 'What is it?'), kinds, kindHint),
    err,
    saveBtn,
    keptLine,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    if (kind === UNSORTED ? !body && !photo : !body) {
      err.textContent = kind === UNSORTED ? 'Write something or add a photo first.' : 'Write its name on the first line.';
      return;
    }
    saveBtn.disabled = true;
    try {
      let values: Record<string, unknown>;
      let type: string;
      if (kind === UNSORTED) {
        type = 'narrative';
        values = { name: titleFrom(body, !!photo), supertype: UNSORTED };
        if (body) values.description = body;
      } else {
        type = kind;
        values = elementFromNote(body);
      }
      const id = await s.create(type, values, photo ?? undefined);
      writeDraft(s.id, '');
      const where = kind === UNSORTED ? 'Added to Unsorted.' : `Made the ${typeName(kind)}.`;
      // A note's own line under the button says where it went, so its toast would only cover the
      // button; the offline sentence still matters for either.
      if (!s.isLocal && !navigator.onLine) toast('Kept on this phone. It sends when you have signal.');
      else if (kind !== UNSORTED) toast(where);
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      if (kind !== UNSORTED) {
        // A typed catch opens with its empty fields, to fill in (the Captain, h37 #3555).
        go(`#/w/${s.id}/e/${id}?fill`, true);
        return;
      }
      // A note stays on Catch, the box empty for the next one (Quillon, h37 #4275: three catches took
      // three round trips), and says where it went.
      text.value = '';
      photo = null;
      photoUrl = null;
      showPhoto();
      kept.remove();
      saveBtn.disabled = false;
      const open = h('a', { href: `#/w/${s.id}/e/${id}`, 'data-action': 'open-kept' }, 'Open it');
      // Sending waits on the PIN when the phone holds none (the flush's own gate): say so here, where
      // the note was made, not only on the home (S419's L12).
      if (!s.isLocal && !s.pinKnown()) {
        const enter = h('button', { class: 'btn btn-quiet', type: 'button', 'data-action': 'kept-pin' }, 'Enter your PIN');
        const sent = () => keptLine.replaceChildren(`Added to Unsorted: ${values.name as string}. `, open);
        enter.addEventListener('click', () => void import('./world').then((m) => m.pinSheet(s, sent)));
        keptLine.replaceChildren(`Added to Unsorted: ${values.name as string}. It sends once Lantern has your PIN. `, enter, ' ', open);
      } else keptLine.replaceChildren(`Added to Unsorted: ${values.name as string}. `, open);
      text.focus();
    } catch (ex) {
      err.textContent = errorText(ex);
      saveBtn.disabled = false;
    }
  });

  return {
    el: h(
      'main',
      { class: 'screen has-tabbar', 'data-screen': 'capture' },
      topbar('Catch it', `#/w/${s.id}`),
      h('p', { class: 'muted small', style: 'margin:0' }, "To speak it, use your keyboard's microphone."),
      form,
      tabbar(s, 'catch'),
    ),
  };
}
