// Camera or gallery: two doors to one photo. An input with `capture` opens the camera at once; one
// without opens the phone's own picker (the gallery, the files). The Captain's walk, 2026-10-12:
// the catch screen offered only the camera.
import { h } from '../dom';
import { icon } from '../icons';
import { preparePhoto } from '@onlyworlds/sdk';
import { errorText } from '../ui';

export interface PhotoPicker {
  /** The two buttons and their hidden inputs, in one row. */
  row: HTMLElement;
}

/** `onPhoto` gets the photo already shrunk for upload (SDK preparePhoto); `onError` a sentence. */
export function photoPicker(onPhoto: (photo: Blob) => void, onError: (text: string) => void): PhotoPicker {
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', 'aria-hidden': 'true', 'data-photo': 'camera' });
  const gallery = h('input', { type: 'file', accept: 'image/*', style: 'display:none', 'aria-hidden': 'true', 'data-photo': 'gallery' });
  const camBtn = h('button', { class: 'btn', type: 'button' }, icon('camera', 20), h('span', null, 'Camera'));
  const galBtn = h('button', { class: 'btn', type: 'button' }, icon('image', 20), h('span', null, 'Gallery'));
  camBtn.addEventListener('click', () => camera.click());
  galBtn.addEventListener('click', () => gallery.click());
  for (const input of [camera, gallery]) {
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      camBtn.disabled = galBtn.disabled = true;
      try {
        onPhoto((await preparePhoto(f)).blob);
      } catch (e) {
        onError(errorText(e));
      } finally {
        camBtn.disabled = galBtn.disabled = false;
      }
    });
  }
  return { row: h('div', { class: 'row-gap' }, camBtn, galBtn, camera, gallery) };
}
