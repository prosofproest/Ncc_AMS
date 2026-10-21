import crypto from 'crypto';
import { cleanEnv } from '../lib/keys.mjs';
import { uploadParadePhoto, cloudinary } from '../lib/cloudinary.js';

const cloudName = cleanEnv(process.env.CLOUDINARY_CLOUD_NAME);
const apiKey = cleanEnv(process.env.CLOUDINARY_API_KEY);
const apiSecret = cleanEnv(process.env.CLOUDINARY_API_SECRET);

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
});

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URI = 'data:image/png;base64,' + TINY_PNG_BASE64;
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, 'base64');

async function run() {
  console.log('Cloudinary Config Check:');
  console.log('  cloud_name:', cloudName ? `${cloudName.slice(0, 3)}***` : 'MISSING');
  console.log('  api_key:   ', apiKey ? `${apiKey.slice(0, 4)}***` : 'MISSING');
  console.log('  api_secret:', apiSecret ? '*** (set)' : 'MISSING');

  // =========================================================================
  // TEST A: Minimal signed upload with plain fetch (no SDK)
  // =========================================================================
  console.log('\n======================================================');
  console.log('TEST A: Minimal signed upload with plain fetch');
  console.log('======================================================');
  const tsA = Math.floor(Date.now() / 1000);
  const toSignA = `tags=ams-healthcheck&timestamp=${tsA}${apiSecret}`;
  const sigA = crypto.createHash('sha1').update(toSignA).digest('hex');

  const fdA = new FormData();
  fdA.append('file', TINY_PNG_DATA_URI);
  fdA.append('api_key', apiKey);
  fdA.append('timestamp', String(tsA));
  fdA.append('tags', 'ams-healthcheck');
  fdA.append('signature', sigA);

  const resA = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: fdA,
  });

  const statusA = resA.status;
  const rawBodyA = await resA.text();
  console.log('HTTP Status A:', statusA);
  console.log('RAW Response Body A:\n' + rawBodyA);

  if (resA.ok) {
    try {
      const dataA = JSON.parse(rawBodyA);
      if (dataA.public_id) {
        await cloudinary.uploader.destroy(dataA.public_id);
        console.log(`Cleaned up Test A image (${dataA.public_id})`);
      }
    } catch (e) {
      console.warn('Could not clean up Test A image:', e.message);
    }
  }

  // =========================================================================
  // TEST B: uploadParadePhoto() from lib/cloudinary.js
  // =========================================================================
  console.log('\n======================================================');
  console.log('TEST B: uploadParadePhoto() from lib/cloudinary.js');
  console.log('======================================================');
  const today = new Date().toISOString().slice(0, 10);
  let sdkError = null;

  try {
    const resB = await uploadParadePhoto({
      buffer: TINY_PNG_BUFFER,
      mimeType: 'image/png',
      date: today,
      markedBy: 'Healthcheck',
      geoLat: 12.9,
      geoLng: 74.8,
    });
    console.log('HTTP Status B: 200 (Success)');
    console.log('Result B:', JSON.stringify(resB));
    if (resB.publicId) {
      await cloudinary.uploader.destroy(resB.publicId);
      console.log(`Cleaned up Test B image (${resB.publicId})`);
    }
  } catch (err) {
    sdkError = err;
    console.log('SDK Threw Error:');
    console.log('  name:     ', err.name);
    console.log('  message:  ', err.message);
    console.log('  http_code:', err.http_code);
    if (err.error) console.log('  error obj:', JSON.stringify(err.error));

    // Expose raw body by repeating the exact options with fetch
    console.log('\nRepeating Test B options with plain fetch to expose raw response body:');
    const folder = `ncc-airwing/attendance/${today.slice(0, 7)}`;
    const publicId = `parade_${today}_${Date.now()}`;
    const contextParts = [
      `date=${today}`,
      `marked_by=Healthcheck`,
      `geo_lat=12.9`,
      `geo_lng=74.8`,
      `location=https://maps.google.com/?q=12.9,74.8`,
    ];
    const contextStr = contextParts.join('|');
    const tagsStr = ['ncc-airwing', 'attendance', `date-${today}`, 'ams-healthcheck'].join(',');
    const tsB = Math.floor(Date.now() / 1000);

    // Options as passed by lib/cloudinary.js
    const paramsToSign = {
      context: contextStr,
      folder,
      image_metadata: 'true',
      public_id: publicId,
      tags: tagsStr,
      timestamp: String(tsB),
      transformation: 'f_auto,q_auto',
    };

    // Sort alphabetically for signature
    const sortedKeys = Object.keys(paramsToSign).sort();
    const signString = sortedKeys.map(k => `${k}=${paramsToSign[k]}`).join('&') + apiSecret;
    const sigB = crypto.createHash('sha1').update(signString).digest('hex');

    const fdB = new FormData();
    fdB.append('file', TINY_PNG_DATA_URI);
    fdB.append('api_key', apiKey);
    fdB.append('signature', sigB);
    for (const [k, v] of Object.entries(paramsToSign)) {
      fdB.append(k, v);
    }

    const fetchResB = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: fdB,
    });

    const statusFetchB = fetchResB.status;
    const rawBodyFetchB = await fetchResB.text();
    console.log('HTTP Status B (Raw fetch):', statusFetchB);
    console.log('RAW Response Body B:\n' + rawBodyFetchB);

    if (fetchResB.ok) {
      try {
        const dataB = JSON.parse(rawBodyFetchB);
        if (dataB.public_id) {
          await cloudinary.uploader.destroy(dataB.public_id);
          console.log(`Cleaned up Test B fetch image (${dataB.public_id})`);
        }
      } catch {}
    }
  }

  console.log('\n======================================================');
  console.log('TEST SUMMARY COMPLETED');
  console.log('======================================================');
}

run().catch((err) => {
  console.error('Fatal error running test-cloudinary:', err);
  process.exit(1);
});
