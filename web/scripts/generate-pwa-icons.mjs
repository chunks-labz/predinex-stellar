/**
 * Generates the PWA icon set (no external deps) so installability audits have
 * the required 192px / 512px PNG icons plus a maskable variant.
 *
 * Design: brand-purple (#8b5cf6) disc on the app's near-black background
 * (#050505). The maskable variant shrinks the disc into the safe zone so
 * platform masking never clips it.
 *
 * Run: `node scripts/generate-pwa-icons.mjs`
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BG = [0x05, 0x05, 0x05];
const FG = [0x8b, 0x5c, 0xf6];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePNG(size, radiusRatio) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * radiusRatio;
  const rowLen = size * 4 + 1;
  const raw = Buffer.alloc(size * rowLen);

  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter type 0 (None)
    for (let x = 0; x < size; x++) {
      const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
      const [rr, gg, bb] = inside ? FG : BG;
      const o = y * rowLen + 1 + x * 4;
      raw[o] = rr;
      raw[o + 1] = gg;
      raw[o + 2] = bb;
      raw[o + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10..12 = compression / filter / interlace = 0

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputs = [
  { file: 'public/icons/icon-192.png', size: 192, radius: 0.42 },
  { file: 'public/icons/icon-512.png', size: 512, radius: 0.42 },
  { file: 'public/icons/maskable-512.png', size: 512, radius: 0.33 },
];

for (const { file, size, radius } of outputs) {
  const path = resolve(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, makePNG(size, radius));
  console.log(`wrote ${file} (${size}x${size})`);
}
