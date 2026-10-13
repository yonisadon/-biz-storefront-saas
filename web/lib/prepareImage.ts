export const MAX_BYTES = 10 * 1024 * 1024;
export const ACCEPT = 'image/jpeg,image/png,image/webp';
const OK = new Set(['image/jpeg', 'image/png', 'image/webp']);

function checkSize(f: Blob) {
  if (f.size > MAX_BYTES) throw new Error('size');
  return f;
}

/** Shrinks big phone photos before upload to save mobile data. The server re-validates everything. */
export async function prepareImage(file: File): Promise<Blob> {
  if (!OK.has(file.type)) throw new Error('type');
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= 3 * 1024 * 1024) { bmp.close(); return checkSize(file); }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // PNG transparency becomes white (the server flattens too)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
    if (blob && blob.size < file.size) return checkSize(blob);
  } catch { /* fall back to the original file */ }
  return checkSize(file);
}