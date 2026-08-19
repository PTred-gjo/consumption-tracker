/**
 * Generates the 1024x500 feature graphic Google Play requires on every listing.
 *
 * Reuses the PNG encoder from generate-icons.mjs rather than pulling in an
 * image library, so the asset stays reproducible from a single `npm run`.
 *
 * Run: npm run store:graphic
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'store');

const WIDTH = 1024;
const HEIGHT = 500;

const ACCENT = [0x3b, 0x82, 0xf6];
const ACCENT_DARK = [0x14, 0x2a, 0x6b];
const WHITE = [0xf5, 0xf5, 0xf3];
const LEVEL = [0x14, 0x2a, 0x6b];

/* ── PNG encoding (same approach as generate-icons.mjs) ─────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Drawing ────────────────────────────────────────────────────────────── */

const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || a <= 0) return;
  const i = (y * WIDTH + x) * 4;
  const al = Math.min(1, a);
  pixels[i] = Math.round(pixels[i] * (1 - al) + r * al);
  pixels[i + 1] = Math.round(pixels[i + 1] * (1 - al) + g * al);
  pixels[i + 2] = Math.round(pixels[i + 2] * (1 - al) + b * al);
  pixels[i + 3] = 255;
};

const lerp = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const coverage = (d) => Math.min(1, Math.max(0, 0.5 - d));

function triangleSDF(px, py, ax, ay, bx, by, cx, cy) {
  const edge = (x0, y0, x1, y1) => {
    const ex = x1 - x0, ey = y1 - y0;
    const vx = px - x0, vy = py - y0;
    const t = Math.min(1, Math.max(0, (vx * ex + vy * ey) / (ex * ex + ey * ey)));
    return { dx: vx - ex * t, dy: vy - ey * t, sx: ex, sy: ey, vx, vy };
  };
  const e0 = edge(ax, ay, bx, by), e1 = edge(bx, by, cx, cy), e2 = edge(cx, cy, ax, ay);
  const d = Math.min(
    e0.dx * e0.dx + e0.dy * e0.dy,
    e1.dx * e1.dx + e1.dy * e1.dy,
    e2.dx * e2.dx + e2.dy * e2.dy
  );
  const orient = Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  const side = (e) => Math.sign(e.sx * e.vy - e.sy * e.vx);
  const inside = side(e0) === orient && side(e1) === orient && side(e2) === orient;
  return (inside ? -1 : 1) * Math.sqrt(d);
}

// Background: diagonal gradient, matching the launcher icon.
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const t = (x / WIDTH) * 0.65 + (y / HEIGHT) * 0.35;
    set(x, y, lerp(ACCENT, ACCENT_DARK, t));
  }
}

// A faint chart line across the lower half, echoing the app's consumption trend.
const points = [0.08, 0.34, 0.22, 0.46, 0.3, 0.18, 0.26, 0.1];
for (let x = 0; x < WIDTH; x++) {
  const t = (x / WIDTH) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(t));
  const f = t - i;
  // Smoothstep between control points so the line reads as a curve.
  const s = f * f * (3 - 2 * f);
  const v = points[i] + (points[i + 1] - points[i]) * s;
  const lineY = HEIGHT - v * HEIGHT - 40;
  for (let y = Math.floor(lineY); y < HEIGHT; y++) {
    const dist = Math.abs(y - lineY);
    if (dist < 3) set(x, y, WHITE, 0.5 * (1 - dist / 3));
    else set(x, y, WHITE, 0.05);
  }
}

// Droplet mark on the left.
const dropCx = 190;
const dropCy = 250;
const dropR = 78;
const apexDist = dropR * 2.35;
const apexY = dropCy - apexDist;
const alpha = Math.acos(dropR / apexDist);
const tdx = dropR * Math.sin(alpha);
const tdy = -dropR * Math.cos(alpha);

for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const px = x + 0.5, py = y + 0.5;
    const bodyD = Math.hypot(px - dropCx, py - dropCy) - dropR;
    const tipD = triangleSDF(px, py, dropCx, apexY, dropCx + tdx, dropCy + tdy, dropCx - tdx, dropCy + tdy);
    const cov = coverage(Math.min(bodyD, tipD));
    if (cov > 0) set(x, y, WHITE, cov);
    const levelY = dropCy + dropR * 0.22;
    if (py > levelY) {
      const c = Math.min(coverage(Math.min(bodyD, tipD)), coverage(levelY - py + 1));
      if (c > 0) set(x, y, LEVEL, c);
    }
  }
}

/* ── Text ───────────────────────────────────────────────────────────────── */

/**
 * Compact 5x7 uppercase bitmap font. Play rejects graphics with unreadable
 * text, so the glyphs are drawn at a large scale with generous spacing.
 */
const GLYPHS = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01111','10000','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  I: ['11111','00100','00100','00100','00100','00100','11111'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','10101','10011','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '.': ['00000','00000','00000','00000','00000','00000','00100'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'],
};

function drawText(text, startX, startY, scale, color, alphaVal = 1) {
  let x = startX;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch];
    if (!glyph) { x += 6 * scale; continue; }
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            set(x + gx * scale + dx, startY + gy * scale + dy, color, alphaVal);
          }
        }
      }
    }
    x += 6 * scale;
  }
  return x;
}

drawText('FUELPILOT', 330, 175, 9, WHITE);
drawText('REAL COST PER KILOMETRE', 332, 265, 4, WHITE, 0.92);
drawText('OFFLINE. NO ACCOUNT.', 332, 315, 4, WHITE, 0.72);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'feature-graphic-1024x500.png'), encodePNG(WIDTH, HEIGHT, pixels));
console.log('wrote docs/store/feature-graphic-1024x500.png (1024x500)');
