export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/session';
import { uploadParadePhoto } from '@/lib/cloudinary';
import { isValidDate, todayIST } from '@/lib/time';

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request) {
  const { payload, error } = await authenticate(request, { perm: 'canMarkAttendance' });
  if (error) return error;
  try {
    const formData = await request.formData();
    const files = formData.getAll('file').filter(f => typeof f !== 'string');
    const dateIn = formData.get('date');
    const date = isValidDate(dateIn) ? dateIn : todayIST();
    const geoLat = formData.get('geo_lat') ? parseFloat(formData.get('geo_lat')) : null;
    const geoLng = formData.get('geo_lng') ? parseFloat(formData.get('geo_lng')) : null;
    if (!files.length) return NextResponse.json({ error: 'No files provided.' }, { status: 400 });
    if (files.length > 6) return NextResponse.json({ error: 'Upload at most 6 photos at a time.' }, { status: 400 });
    if (date === todayIST() && (!geoLat || !geoLng)) return NextResponse.json({ error: 'GPS location required. Please enable location access.' }, { status: 400 });

    const urls = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'A photo is larger than 12 MB.' }, { status: 400 });
      if (file.type && !file.type.startsWith('image/')) return NextResponse.json({ error: 'Only image files are allowed.' }, { status: 400 });
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await uploadParadePhoto({ buffer, mimeType: file.type || 'image/jpeg', date, markedBy: payload.name, geoLat, geoLng });
      urls.push(result.url);
    }
    return NextResponse.json({ urls, url: urls[0] });
  } catch (err) {
    console.error('Upload error:', err);
    const code = err.http_code || err.status || 403;
    const msg = `Photo storage rejected the upload (code ${code}). Tell the administrator.`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

