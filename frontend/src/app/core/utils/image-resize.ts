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

/**
 * Downscale a Blob (PNG/JPEG/anything `createImageBitmap` accepts) to a JPEG
 * within `maxDim` pixels on the longest side. Used for map snapshots — a
 * full-resolution Retina canvas easily lands at 5+ MB PNG, which (a) blows
 * Vercel's multipart body cap on the Hobby tier and (b) bloats the
 * surveillance repo unnecessarily. JPEG @ 0.85 reduces a typical map
 * snapshot to ~300–700 KB with no perceptible loss for cartographic use.
 */
export async function resizeSnapshot(
  blob: Blob,
  opts: { maxDim?: number; quality?: number; maxBytes?: number } = {},
): Promise<Blob> {
  const maxDim = opts.maxDim ?? 2000;
  const quality = opts.quality ?? 0.85;
  const maxBytes = opts.maxBytes ?? 1_500_000;

  // Cheap path: already small enough, don't pay the bitmap decode.
  if (blob.size <= maxBytes && blob.type === 'image/jpeg') return blob;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }

  const { width, height } = scale(bitmap.width, bitmap.height, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return blob;
  }
  // White background so JPEG (no alpha) doesn't render transparent areas as black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  return out ?? blob;
}
