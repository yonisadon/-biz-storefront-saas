import path from 'node:path';
import sharp from 'sharp';
import { HttpError } from './errors';

// Keep memory predictable on small Railway instances
sharp.cache(false);
sharp.concurrency(2);

const FORMATS = new Set(['jpeg', 'png', 'webp']);
// failOn:error tolerates harmless warnings; the pixel cap blocks decompression bombs
const OPTS = { failOn: 'error' as const, limitInputPixels: 100_000_000 };

/**
 * The type is detected from the file CONTENT (never the client's MIME header or
 * extension), so SVG/GIF/HEIC/PDF renamed to .jpg are rejected.
 * sharp strips all metadata (EXIF/GPS) by default; .rotate() applies EXIF orientation first.
 */
export async function processImage(input: Buffer) {
  try {
    const meta = await sharp(input, OPTS).metadata();
    if (!meta.format || !FORMATS.has(meta.format)) throw new HttpError(415, 'unsupported_type');
    if ((meta.pages ?? 1) > 1) throw new HttpError(415, 'animated_not_supported');

    const base = sharp(input, OPTS).rotate().flatten({ background: '#ffffff' });
    const [main, og] = await Promise.all([
      base.clone()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true, progressive: true })
        .toBuffer({ resolveWithObject: true }),
      base.clone()
        .resize(1200, 630, { fit: 'cover', position: sharp.strategy.attention })
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer(),
    ]);
    return { main: main.data, og, width: main.info.width, height: main.info.height };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, 'invalid_image'); // corrupt file, or over the pixel cap
  }
}

export function sanitizeFilename(name: string | undefined): string | null {
  if (!name) return null;
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return base || null;
}