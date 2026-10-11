// A photo from the camera, made ready for the edge: turned upright, shrunk, and converted to a
// type the edge takes (webp, png, jpeg, avif; never HEIC; at most 15 MB). Safari cannot encode
// webp from a canvas, so a jpeg is the fallback, read back from the blob's own type.
const MAX_EDGE = 2000;
const MAX_BYTES = 15 * 1024 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function preparePhoto(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const hgt = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This phone could not prepare the photo.');
  ctx.drawImage(bmp, 0, 0, w, hgt);
  bmp.close?.();
  let out = await toBlob(canvas, 'image/webp', 0.82);
  if (!out || out.type !== 'image/webp') out = await toBlob(canvas, 'image/jpeg', 0.85);
  if (!out) throw new Error('This phone could not prepare the photo.');
  if (out.size > MAX_BYTES) throw new Error('That photo is too large even after shrinking.');
  return out;
}
