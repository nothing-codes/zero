/**
 * Generates monochrome PNG app icons without external dependencies.
 * Run: npm run icons
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "public");
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size / 512;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 122 * s;
  const half = 22 * s; // half of the 44px stroke
  const glow = 32 * s;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;

      // soft radial graphite background
      const dx = (x - size * 0.32) / size;
      const dy = (y - size * 0.18) / size;
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.03);
      const base = Math.round(mix(48, 8, Math.pow(t, 1.35)));

      // subtle diagonal sheen
      const sheen = Math.max(0, 1 - Math.abs(x / size - y / size + 0.12) * 2.4) * 8;

      let r = base + sheen;
      let g = base + sheen;
      let b = base + sheen + Math.round(sheen * 0.2);

      const dist = Math.abs(Math.hypot(x - cx, y - cy) - radius);
      const edge = Math.max(0, Math.min(1, half + 0.75 - dist));
      const halo = Math.max(0, 1 - Math.max(0, dist - half) / glow) * 0.1;

      if (edge > 0) {
        const angle = Math.atan2(y - cy, x - cx);
        const shade = 0.78 + 0.22 * Math.cos(angle + Math.PI * 0.72);
        r = mix(r, 255 * shade, edge);
        g = mix(g, 255 * shade, edge);
        b = mix(b, 255 * shade, edge);
      } else if (halo > 0) {
        r = mix(r, 255, halo);
        g = mix(g, 255, halo);
        b = mix(b, 255, halo);
      }

      pixels[index] = Math.min(255, Math.round(r));
      pixels[index + 1] = Math.min(255, Math.round(g));
      pixels[index + 2] = Math.min(255, Math.round(b));
      pixels[index + 3] = 255;
    }
  }

  return encodePng(size, pixels);
}

for (const [name, size] of [
  ["icon-96.png", 96],
  ["icon-180.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
]) {
  writeFileSync(resolve(outDir, name), drawIcon(size));
  console.log(`created public/${name} (${size}×${size})`);
}
