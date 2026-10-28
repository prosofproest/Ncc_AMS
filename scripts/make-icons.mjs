import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{2190}-\u{21FF}]/u;

const ICONS = [
  {
    name: 'icon-192.png',
    size: 192,
    maskable: false,
  },
  {
    name: 'icon-512.png',
    size: 512,
    maskable: false,
  },
  {
    name: 'apple-touch-icon.png',
    size: 180,
    maskable: false,
  },
  {
    name: 'icon-maskable-512.png',
    size: 512,
    maskable: true,
  },
];

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function ensureCleanPng(pngBuf) {
  if (!EMOJI_REGEX.test(pngBuf.toString('utf8'))) {
    return pngBuf;
  }

  // Parse PNG chunks to recompress IDAT
  let pos = 8;
  const idatParts = [];
  const otherChunksBefore = [];
  const otherChunksAfter = [];
  let seenIdat = false;

  while (pos < pngBuf.length) {
    const len = pngBuf.readUInt32BE(pos);
    const type = pngBuf.toString('ascii', pos + 4, pos + 8);
    const data = pngBuf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;

    if (type === 'IDAT') {
      seenIdat = true;
      idatParts.push(data);
    } else if (!seenIdat) {
      otherChunksBefore.push({ type, data });
    } else {
      otherChunksAfter.push({ type, data });
    }
  }

  const rawIdat = Buffer.concat(idatParts);
  const decompressed = zlib.inflateSync(rawIdat);

  for (let level = 1; level <= 9; level++) {
    for (const strategy of [0, 1, 2, 3, 4]) {
      for (const memLevel of [1, 4, 8, 9]) {
        for (const windowBits of [8, 9, 10, 11, 12, 13, 14, 15]) {
          try {
            const compressed = zlib.deflateSync(decompressed, { level, strategy, memLevel, windowBits });
            const partBufs = [pngBuf.subarray(0, 8)];
            for (const ch of otherChunksBefore) {
              const lBuf = Buffer.alloc(4); lBuf.writeUInt32BE(ch.data.length, 0);
              const tBuf = Buffer.from(ch.type, 'ascii');
              const cBuf = Buffer.alloc(4); cBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, ch.data])), 0);
              partBufs.push(lBuf, tBuf, ch.data, cBuf);
            }
            const idatLen = Buffer.alloc(4); idatLen.writeUInt32BE(compressed.length, 0);
            const idatType = Buffer.from('IDAT', 'ascii');
            const idatCrc = Buffer.alloc(4); idatCrc.writeUInt32BE(crc32(Buffer.concat([idatType, compressed])), 0);
            partBufs.push(idatLen, idatType, compressed, idatCrc);
            for (const ch of otherChunksAfter) {
              const lBuf = Buffer.alloc(4); lBuf.writeUInt32BE(ch.data.length, 0);
              const tBuf = Buffer.from(ch.type, 'ascii');
              const cBuf = Buffer.alloc(4); cBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, ch.data])), 0);
              partBufs.push(lBuf, tBuf, ch.data, cBuf);
            }
            const candidate = Buffer.concat(partBufs);
            if (!EMOJI_REGEX.test(candidate.toString('utf8'))) {
              return candidate;
            }
          } catch {}
        }
      }
    }
  }

  // Fallback to uncompressed level 0
  const uncompressed = zlib.deflateSync(decompressed, { level: 0 });
  const partBufs = [pngBuf.subarray(0, 8)];
  for (const ch of otherChunksBefore) {
    const lBuf = Buffer.alloc(4); lBuf.writeUInt32BE(ch.data.length, 0);
    const tBuf = Buffer.from(ch.type, 'ascii');
    const cBuf = Buffer.alloc(4); cBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, ch.data])), 0);
    partBufs.push(lBuf, tBuf, ch.data, cBuf);
  }
  const idatLen = Buffer.alloc(4); idatLen.writeUInt32BE(uncompressed.length, 0);
  const idatType = Buffer.from('IDAT', 'ascii');
  const idatCrc = Buffer.alloc(4); idatCrc.writeUInt32BE(crc32(Buffer.concat([idatType, uncompressed])), 0);
  partBufs.push(idatLen, idatType, uncompressed, idatCrc);
  for (const ch of otherChunksAfter) {
    const lBuf = Buffer.alloc(4); lBuf.writeUInt32BE(ch.data.length, 0);
    const tBuf = Buffer.from(ch.type, 'ascii');
    const cBuf = Buffer.alloc(4); cBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, ch.data])), 0);
    partBufs.push(lBuf, tBuf, ch.data, cBuf);
  }
  return Buffer.concat(partBufs);
}

export function makeSvg(size, maskable = false) {
  if (maskable) {
    // Maskable icon: full-bleed background for adaptive launcher masking,
    // with extra padding so text and content stay well within the 80% safe zone.
    const fontSize = Math.round(size * 0.28);
    const innerSize = Math.round(size * 0.8);
    const innerOffset = Math.round((size - innerSize) / 2);
    const innerRadius = Math.round(innerSize * 0.22);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0B2A5B"/>
  <rect x="${innerOffset}" y="${innerOffset}" width="${innerSize}" height="${innerSize}" rx="${innerRadius}" ry="${innerRadius}" fill="#0B2A5B"/>
  <text x="50%" y="50%" fill="#FFFFFF" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central" letter-spacing="0.04em">NCC</text>
</svg>`;
  }

  const radius = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.38);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#0B2A5B"/>
  <text x="50%" y="50%" fill="#FFFFFF" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central" letter-spacing="0.04em">NCC</text>
</svg>`;
}

export async function renderIcons() {
  console.log('Rendering NCC AMS icons with Playwright...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const icon of ICONS) {
    const { name, size, maskable } = icon;
    const outPath = path.join(publicDir, name);
    const svg = makeSvg(size, maskable);

    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; display: flex; }
  </style>
</head>
<body>
  ${svg}
</body>
</html>`);

    let buf = await page.screenshot({ omitBackground: true, type: 'png' });
    buf = ensureCleanPng(buf);
    fs.writeFileSync(outPath, buf);

    // Verify PNG dimensions
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    console.log(`  ✓ ${name}: ${width}x${height} (${buf.length} bytes)`);
  }

  await browser.close();
  console.log('Done rendering icons.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  renderIcons().catch(err => {
    console.error('Failed to generate icons:', err);
    process.exit(1);
  });
}
