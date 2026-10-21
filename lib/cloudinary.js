import { v2 as cloudinary } from 'cloudinary';
import { cleanEnv } from './keys.mjs';
import { logEvent } from './events.js';

cloudinary.config({
  cloud_name: cleanEnv(process.env.CLOUDINARY_CLOUD_NAME),
  api_key: cleanEnv(process.env.CLOUDINARY_API_KEY),
  api_secret: cleanEnv(process.env.CLOUDINARY_API_SECRET),
});

export const ALLOWED_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export function escapeContextValue(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|');
}

/**
 * Upload a parade photo to Cloudinary.
 * - Stored under folder: ncc-airwing/attendance/<year-month>
 * - Context: date=<date>|marked_by=<name> (escaped)
 * - Returns: { url, publicId, width, height }
 */
export async function uploadParadePhoto({ buffer, mimeType, date, markedBy }) {
  if (!mimeType || !ALLOWED_PHOTO_MIMES.includes(mimeType.toLowerCase())) {
    throw new Error(`Unsupported image type: ${mimeType}. Allowed types: ${ALLOWED_PHOTO_MIMES.join(', ')}`);
  }

  const folder = `ncc-airwing/attendance/${date.slice(0, 7)}`;
  const publicId = `parade_${date}_${Date.now()}`;
  const context = `date=${escapeContextValue(date)}|marked_by=${escapeContextValue(markedBy)}`;

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        context,
        tags: ['ncc-airwing', 'attendance', `date-${date}`],
      },
      async (error, result) => {
        if (error) {
          const httpCode = error.http_code || error.status || 403;
          const body = error.error?.message || (typeof error.error === 'string' ? error.error : '') || error.message || '';
          const message = `Cloudinary upload failed (code ${httpCode})${body ? `: ${body}` : ''}`;
          const err = new Error(message);
          err.http_code = httpCode;
          err.body = body;
          await logEvent({ type: 'photo:upload', ok: false, message }).catch(() => {});
          return reject(err);
        }
        await logEvent({ type: 'photo:upload', ok: true, message: `uploaded photo ${result.public_id}` }).catch(() => {});
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
        });
      }
    );
    uploadStream.end(buffer);
  });
}

export async function pingPhotos() {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const t0 = Date.now();
  try {
    const res = await cloudinary.uploader.upload(png, {
      folder: 'ncc-airwing/healthcheck',
      tags: ['ams-healthcheck'],
    });
    if (res?.public_id) {
      await cloudinary.uploader.destroy(res.public_id).catch(() => {});
    }
    const ms = Date.now() - t0;
    return { ok: true, ms, message: `upload test OK (${ms} ms)` };
  } catch (err) {
    const code = err.http_code || err.status || 403;
    const body = err.error?.message || (typeof err.error === 'string' ? err.error : '') || err.message || '';
    const message = `Cloudinary upload failed (code ${code})${body ? `: ${body}` : ''}`;
    return { ok: false, ms: Date.now() - t0, message };
  }
}

export { cloudinary };

