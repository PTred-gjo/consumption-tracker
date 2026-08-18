/**
 * Receipt photo handling.
 *
 * Photos are persisted as data URLs in localStorage, which allows roughly 5 MB
 * for the entire app. A single unmodified phone photo is 3–8 MB, so every image
 * is downscaled and re-encoded as JPEG before it is stored.
 */

export const MAX_PHOTO_DIMENSION = 1280;
export const PHOTO_QUALITY = 0.7;
/** Refuse anything that would still dominate the storage budget after encoding. */
export const MAX_STORED_PHOTO_BYTES = 600 * 1024;

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded.'));
    img.src = dataUrl;
  });
}

/** Data URLs are base64: 4 characters carry 3 bytes. */
export function dataUrlBytes(dataUrl) {
  const commaIdx = String(dataUrl || '').indexOf(',');
  if (commaIdx === -1) return 0;
  const base64 = dataUrl.slice(commaIdx + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Downscale to fit MAX_PHOTO_DIMENSION and re-encode as JPEG.
 * Quality is stepped down until the result fits the storage budget.
 *
 * @returns {Promise<string>} a JPEG data URL
 */
export async function compressImage(file, {
  maxDimension = MAX_PHOTO_DIMENSION,
  quality = PHOTO_QUALITY,
  maxBytes = MAX_STORED_PHOTO_BYTES,
} = {}) {
  if (!file) throw new Error('No file selected.');
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('That file is not an image.');
  }

  const original = await readAsDataURL(file);
  const img = await loadImage(original);

  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');
  // JPEG has no alpha channel; without a white ground, transparent source
  // pixels encode as black.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let currentQuality = quality;
  let out = canvas.toDataURL('image/jpeg', currentQuality);
  while (dataUrlBytes(out) > maxBytes && currentQuality > 0.3) {
    currentQuality -= 0.15;
    out = canvas.toDataURL('image/jpeg', currentQuality);
  }

  if (dataUrlBytes(out) > maxBytes) {
    throw new Error('That photo is too large to store even after compression.');
  }
  return out;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
