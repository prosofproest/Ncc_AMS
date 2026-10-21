'use client';
// Phone photos are 4-12 MB; the server accepts ~4 MB per request. Resize to 1600px / JPEG 78% (usually 300-700 KB).
export async function compressImage(file, maxSide = 1600, quality = 0.78) {
  try {
    if (!file.type.startsWith('image/')) return file;
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bmp) return file;
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file.size > 4_000_000 && blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
    return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
