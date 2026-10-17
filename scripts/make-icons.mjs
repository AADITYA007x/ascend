// Draws the app icons (a calm mountain with a rising sun) as PNGs.
// Uses only Node built-ins. Run with: npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const COLORS = {
  sky: [247, 242, 234],
  sun: [233, 161, 91],
  far: [127, 176, 166],
  near: [47, 111, 106],
  snow: [255, 250, 242],
};

// Shapes in unit coordinates (0..1), painted in order.
const SHAPES = [
  { color: COLORS.sun, circle: [0.72, 0.32, 0.075] },
  { color: COLORS.far, tri: [[0.06, 0.78], [0.33, 0.47], [0.6, 0.78]] },
  { color: COLORS.near, tri: [[0.18, 0.78], [0.54, 0.27], [0.92, 0.78]] },
  { color: COLORS.snow, tri: [[0.54, 0.27], [0.4565, 0.388], [0.6233, 0.388]] },
];

function inTri(x, y, [a, b, c]) {
  const s = (p, q) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function colorAt(u, v) {
  let col = COLORS.sky;
  for (const sh of SHAPES) {
    if (sh.circle) {
      const [cx, cy, r] = sh.circle;
      if ((u - cx) ** 2 + (v - cy) ** 2 <= r * r) col = sh.color;
    } else if (inTri(u, v, sh.tri)) col = sh.color;
  }
  return col;
}

// Rounded-square mask for the normal icon; full bleed for maskable.
function insideRoundRect(u, v, radius) {
  const cx = Math.min(Math.max(u, radius), 1 - radius);
  const cy = Math.min(Math.max(v, radius), 1 - radius);
  return (u - cx) ** 2 + (v - cy) ** 2 <= radius * radius;
}

function render(size, { maskable }) {
  const SS = 4; // supersampling for smooth edges
  const px = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.8 : 1; // keep art inside the maskable safe zone
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (!maskable && !insideRoundRect(u, v, 0.22)) continue;
          const c = colorAt((u - 0.5) / scale + 0.5, (v - 0.5) / scale + 0.5);
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const cover = a / 255;
      px[i] = cover ? Math.round(r / cover) : 0;
      px[i + 1] = cover ? Math.round(g / cover) : 0;
      px[i + 2] = cover ? Math.round(b / cover) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return encodePNG(size, size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="rgb(${COLORS.sky})"/>
  <circle cx="72" cy="32" r="7.5" fill="rgb(${COLORS.sun})"/>
  <polygon points="6,78 33,47 60,78" fill="rgb(${COLORS.far})"/>
  <polygon points="18,78 54,27 92,78" fill="rgb(${COLORS.near})"/>
  <polygon points="54,27 45.65,38.8 62.33,38.8" fill="rgb(${COLORS.snow})"/>
</svg>
`;

writeFileSync(join(outDir, 'icon-192.png'), render(192, { maskable: false }));
writeFileSync(join(outDir, 'icon-512.png'), render(512, { maskable: false }));
writeFileSync(join(outDir, 'icon-maskable-512.png'), render(512, { maskable: true }));
// iPhone and iPad round the corners themselves, so the home-screen icon is full bleed.
writeFileSync(join(outDir, 'icon-180.png'), render(180, { maskable: true }));
writeFileSync(join(outDir, 'favicon.svg'), svg);
console.log('Icons written to', outDir);
