/**
 * Browser-side photo downscaling so we don't push 10 MB phone photos through
 * the Vercel function (4.5 MB hobby / 50 MB pro body cap) and so first-upload
 * over mobile data stays bearable.
 *
 * Uses createImageBitmap with imageOrientation: 'from-image' so EXIF rotation
 * is honored (otherwise portrait phone photos render sideways).
 */

const DEFAULT_MAX_DIM = 2000;
const DEFAULT_QUALITY = 0.85;

export interface ResizeOptions {
  maxDim?: number;
  quality?: number;
}

export async function resizeImage(file: File, opts: ResizeOptions = {}): Promise<File> {
  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  // Pass-through anything we can't handle as an image (e.g. HEIC on browsers
  // without native support). Better to upload as-is than crash the form.
  if (!file.type.startsWith('image/')) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }

  const { width: targetW, height: targetH } = scale(bitmap.width, bitmap.height, maxDim);

  // No-op if the source is already small enough.
  if (targetW === bitmap.width && targetH === bitmap.height && file.type === 'image/jpeg') {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) return file;

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
}

function scale(w: number, h: number, maxDim: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxDim) return { width: w, height: h };
  const factor = maxDim / longest;
  return { width: Math.round(w * factor), height: Math.round(h * factor) };
}
