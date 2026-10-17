// Getting a photo or PDF ready to send: photos are shrunk to a sensible size first.
import { IMPORT } from '../model/timetable-import.js';

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * A picked file → { mimeType, data (base64), previewUrl, sizeKb }.
 * Photos become a JPEG of at most maxImageSide px (turned the right way up); PDFs go as they are.
 * Throws an Error with a calm message when the file can't be used.
 */
export async function prepareFile(file) {
  if (file.type === 'application/pdf') {
    if (file.size > IMPORT.maxBytes) throw new Error('That PDF is over 4 MB. Try a photo or screenshot of the timetable page instead.');
    return { mimeType: 'application/pdf', data: await toBase64(file), previewUrl: null, sizeKb: Math.round(file.size / 1024) };
  }
  if (!file.type.startsWith('image/')) throw new Error('Pick a photo or a PDF of your timetable.');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Couldn’t open that image. Try a JPEG or PNG, or a screenshot.');
  }
  const scale = Math.min(1, IMPORT.maxImageSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent screenshots read better on white
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  let blob = await canvasBlob(canvas, IMPORT.jpegQuality);
  if (blob && blob.size > IMPORT.maxBytes) blob = await canvasBlob(canvas, 0.6);
  if (!blob || blob.size > IMPORT.maxBytes) throw new Error('That photo is too big to send. Try a screenshot instead.');
  return { mimeType: 'image/jpeg', data: await toBase64(blob), previewUrl: URL.createObjectURL(blob), sizeKb: Math.round(blob.size / 1024) };
}
