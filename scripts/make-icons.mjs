// Generates the extension icons (PNG) with no dependencies: a dark rounded
// tile with a 2×2 grid of swatches, matching the logo in the UI.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Signed distance to a rounded rect centred at (cx, cy).
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const cov = (d, aa) => Math.min(1, Math.max(0, 0.5 - d / aa));

const TILE = [21, 21, 28];
const SW = [[143, 120, 255, 'sq'], [255, 107, 157, 'ci'], [62, 211, 163, 'ci'], [255, 197, 77, 'sq']];

function icon(size) {
  const aa = 1;
  const s = size;
  return png(size, (x, y) => {
    const tile = cov(sdRoundRect(x, y, s / 2, s / 2, s / 2, s / 2, s * 0.24), aa);
    if (tile <= 0) return [0, 0, 0, 0];
    let col = [...TILE];
    const pad = s * 0.2, gap = s * 0.09;
    const cell = (s - pad * 2 - gap) / 2;
    SW.forEach(([r, g, b, shape], i) => {
      const cx = pad + cell / 2 + (i % 2) * (cell + gap);
      const cy = pad + cell / 2 + Math.floor(i / 2) * (cell + gap);
      const d = shape === 'ci' ? Math.hypot(x - cx, y - cy) - cell / 2 : sdRoundRect(x, y, cx, cy, cell / 2, cell / 2, cell * 0.25);
      const c = cov(d, aa);
      col = col.map((v, k) => v * (1 - c) + [r, g, b][k] * c);
    });
    return [...col.map(Math.round), Math.round(tile * 255)];
  });
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`public/icons/icon-${size}.png`, icon(size));
console.log('icons written to public/icons');
