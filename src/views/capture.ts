// Catch it: a line, a ramble from the keyboard's microphone, or a photographed page. It lands as
// a Narrative with supertype Unsorted, the photo as its picture: material not yet turned into
// elements (Skeld's convention, #3409).
import { h } from '../dom';
import { icon } from '../icons';
import { preparePhoto } from '@onlyworlds/sdk';
import { errorText, go, toast, topbar } from '../ui';
import type { WorldSession } from '../world';
import type { View } from './world';

export const UNSORTED = 'Unsorted';

function titleFrom(text: string, hasPhoto: boolean): string {
  const first = text.trim().split(/\n/)[0]?.trim() ?? '';
  if (first) {
    const cps = [...first];
    return cps.length > 60 ? cps.slice(0, 57).join('').trimEnd() + '…' : first;
  }
  const when = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return hasPhoto ? `A page, ${when}` : `A note, ${when}`;
}

export function captureView(s: WorldSession): View {
  let photo: Blob | null = null;
  let photoUrl: string | null = null;
  const text = h('textarea', {
    class: 'textarea',
    'aria-label': 'What to keep',
    placeholder: 'An idea, a name, what just happened at the table…',
    style: 'min-height:200px',
  });
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', 'aria-hidden': 'true' });
  const preview = h('div', { class: 'stack' });
  const photoBtn = h('button', { class: 'btn', type: 'button' }, icon('camera', 20), 'Add a photo');
  photoBtn.addEventListener('click', () => file.click());
  const err = h('p', { class: 'error', role: 'alert' });

  const showPhoto = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = photo ? URL.createObjectURL(photo) : null;
    if (!photo || !photoUrl) {
      preview.replaceChildren();
      photoBtn.lastChild!.textContent = 'Add a photo';
      return;
    }
    const remove = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Remove the photo');
    remove.addEventListener('click', () => {
      photo = null;
      showPhoto();
    });
    preview.replaceChildren(h('img', { class: 'photo-preview', src: photoUrl, alt: 'The photo to keep' }), remove);
    photoBtn.lastChild!.textContent = 'Take another';
  };

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    err.textContent = '';
    photoBtn.disabled = true;
    try {
      photo = (await preparePhoto(f)).blob;
      showPhoto();
    } catch (e) {
      err.textContent = errorText(e);
    } finally {
      photoBtn.disabled = false;
    }
  });

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Keep it in Unsorted');
  const form = h('form', { class: 'stack' }, text, h('div', { class: 'row-gap' }, photoBtn), preview, err, saveBtn, file);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    if (!body && !photo) {
      err.textContent = 'Write something or add a photo first.';
      return;
    }
    saveBtn.disabled = true;
    try {
      const values: Record<string, unknown> = { name: titleFrom(body, !!photo), supertype: UNSORTED };
      if (body) values.description = body;
      const id = await s.create('narrative', values, photo ?? undefined);
      toast(s.isLocal || navigator.onLine ? 'Kept in Unsorted.' : 'Kept on this phone. It sends when you have signal.');
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      go(`#/w/${s.id}/e/${id}`, true);
    } catch (ex) {
      err.textContent = errorText(ex);
      saveBtn.disabled = false;
    }
  });

  return {
    el: h(
      'main',
      { class: 'screen', 'data-screen': 'capture' },
      topbar('Catch it', `#/w/${s.id}`),
      h('p', { class: 'muted small', style: 'margin:0' }, "To speak it, use your keyboard's microphone."),
      form,
    ),
  };
}
