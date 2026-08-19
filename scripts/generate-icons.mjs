/**
 * Generates the PWA icon set referenced by manifest.json.
 *
 * These files were missing from the repository, which made the manifest invalid
 * and the app non-installable. Written as a script so the icons can be
 * regenerated (and reviewed as a diff) rather than pasted in as binaries.
 *
 * Run: npm run icons
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const ACCENT = [0x3b, 0x82, 0xf6];
const ACCENT_DARK = [0x1d, 0x4e, 0xd8];
const BACKDROP = [0x0a, 0x0a, 0x0a];
/** Deep navy for the fuel level, so it separates from the accent backdrop. */
const LEVEL = [0x14, 0x2a, 0x6b];
const WHITE = [0xf5, 0xf5, 0xf3];

/* ── PNG encoding ───────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param pixels RGBA buffer, width*height*4 bytes. */
function encodePNG(width, height, pixels) {
  const stride = width * 4;
  // Each scanline is prefixed with its filter type; 0 = none.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Drawing ────────────────────────────────────────────────────────────── */

function createCanvas(size) {
  const pixels = Buffer.alloc(size * size * 4);

  const set = (x, y, [r, g, b], alpha = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
    const i = (y * size + x) * 4;
    const a = Math.min(1, alpha);
    // Source-over against whatever is already there.
    pixels[i] = Math.round(pixels[i] * (1 - a) + r * a);
    pixels[i + 1] = Math.round(pixels[i + 1] * (1 - a) + g * a);
    pixels[i + 2] = Math.round(pixels[i + 2] * (1 - a) + b * a);
    pixels[i + 3] = Math.round(pixels[i + 3] * (1 - a) + 255 * a);
  };

  return { pixels, set };
}

/** Signed distance to a rounded rectangle; negative inside. */
function roundedRectSDF(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Coverage of a shape at a pixel, from its signed distance. Gives clean edges. */
function coverage(distance) {
  return Math.min(1, Math.max(0, 0.5 - distance));
}

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Signed distance to the triangle abc; negative inside. */
function triangleSDF(px, py, ax, ay, bx, by, cx2, cy2) {
  const edge = (x0, y0, x1, y1) => {
    const ex = x1 - x0;
    const ey = y1 - y0;
    const vx = px - x0;
    const vy = py - y0;
    const t = Math.min(1, Math.max(0, (vx * ex + vy * ey) / (ex * ex + ey * ey)));
    return { dx: vx - ex * t, dy: vy - ey * t, sx: ex, sy: ey, vx, vy };
  };

  const e0 = edge(ax, ay, bx, by);
  const e1 = edge(bx, by, cx2, cy2);
  const e2 = edge(cx2, cy2, ax, ay);

  const d = Math.min(
    e0.dx * e0.dx + e0.dy * e0.dy,
    e1.dx * e1.dx + e1.dy * e1.dy,
    e2.dx * e2.dx + e2.dy * e2.dy
  );

  // Winding sign: inside when the point is on the same side of all three edges.
  const orientation = Math.sign((bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax));
  const side = (e) => Math.sign(e.sx * e.vy - e.sy * e.vx);
  const inside = side(e0) === orientation && side(e1) === orientation && side(e2) === orientation;

  return (inside ? -1 : 1) * Math.sqrt(d);
}

/**
 * Draws a fuel droplet over a rounded-square backdrop.
 *
 * The droplet is the union of a circle and the triangle spanning its two
 * tangent points from the tip, which is what gives a teardrop its smooth
 * shoulder instead of a spike glued onto a ball.
 *
 * @param padding fraction of the size kept clear on each side. Maskable icons
 *   need a generous margin because launchers crop to arbitrary shapes.
 */
function drawIcon(size, { padding = 0, background = true } = {}) {
  const { pixels, set } = createCanvas(size);
  const inset = size * padding;
  const inner = size - inset * 2;
  const cx = size / 2;
  const cy = size / 2;

  const dropR = inner * 0.21;
  const dropCy = cy + inner * 0.085;
  // Tip height above the body centre. Larger looks more elongated.
  const apexDist = dropR * 2.35;
  const apexY = dropCy - apexDist;

  // Where the tangent lines from the apex meet the circle.
  const alpha = Math.acos(dropR / apexDist);
  const tangentDx = dropR * Math.sin(alpha);
  const tangentDy = -dropR * Math.cos(alpha);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      if (background) {
        const d = roundedRectSDF(px, py, cx, cy, inner / 2, inner / 2, inner * 0.22);
        const cov = coverage(d);
        if (cov > 0) {
          // Diagonal gradient across the tile.
          const t = (px - inset + (py - inset)) / (inner * 2);
          set(x, y, lerp(ACCENT, ACCENT_DARK, Math.min(1, Math.max(0, t))), cov);
        }
      }

      const bodyD = Math.hypot(px - cx, py - dropCy) - dropR;
      const tipD = triangleSDF(
        px, py,
        cx, apexY,
        cx + tangentDx, dropCy + tangentDy,
        cx - tangentDx, dropCy + tangentDy
      );

      const dropCov = coverage(Math.min(bodyD, tipD));
      if (dropCov > 0) {
        set(x, y, background ? WHITE : ACCENT, dropCov);
      }

      // Fuel level inside the droplet: the lower part stays accent-coloured.
      const levelY = dropCy + dropR * 0.22;
      if (py > levelY) {
        const insideDrop = coverage(Math.min(bodyD, tipD) + 0.12 * inner * 0.03);
        const edgeFade = coverage(levelY - py + 1);
        const cov = Math.min(insideDrop, edgeFade);
        if (cov > 0) set(x, y, background ? LEVEL : BACKDROP, cov);
      }
    }
  }

  return encodePNG(size, size, pixels);
}

/* ── Output ─────────────────────────────────────────────────────────────── */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, opts: { padding: 0 } },
  { file: 'icon-512.png', size: 512, opts: { padding: 0 } },
  // Android crops maskable icons to the launcher's shape, so the artwork sits
  // inside the ~80% safe zone.
  { file: 'icon-maskable-512.png', size: 512, opts: { padding: 0.1 } },
  { file: 'apple-touch-icon.png', size: 180, opts: { padding: 0 } },
  { file: 'favicon-32.png', size: 32, opts: { padding: 0 } },
];

for (const { file, size, opts } of targets) {
  writeFileSync(join(OUT_DIR, file), drawIcon(size, opts));
  console.log(`wrote public/${file} (${size}×${size})`);
}
