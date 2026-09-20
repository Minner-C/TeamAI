import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const SIZE = 256;
const outDir = path.resolve(import.meta.dirname, "../build");
fs.mkdirSync(outDir, { recursive: true });

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const SS = 2;
const radius = 56;
const c0 = [79, 70, 229];
const c1 = [124, 58, 237];

function sample(px, py) {
  const inRect =
    (px >= radius && px < SIZE - radius && py >= 0 && py < SIZE) ||
    (py >= radius && py < SIZE - radius && px >= 0 && px < SIZE) ||
    (px - radius) ** 2 + (py - radius) ** 2 <= radius ** 2 ||
    (px - (SIZE - radius)) ** 2 + (py - radius) ** 2 <= radius ** 2 ||
    (px - radius) ** 2 + (py - (SIZE - radius)) ** 2 <= radius ** 2 ||
    (px - (SIZE - radius)) ** 2 + (py - (SIZE - radius)) ** 2 <= radius ** 2;
  if (!inRect) return [0, 0, 0, 0];
  const t = (px + py) / (2 * SIZE);
  const bg = c0.map((v, i) => Math.round(v + (c1[i] - v) * t));
  const inT =
    (py >= 64 && py < 100 && px >= 58 && px < 198) ||
    (px >= 112 && px < 144 && py >= 64 && py < 200);
  if (inT) return [255, 255, 255, 255];
  return [...bg, 255];
}

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
let o = 0;
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0;
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb, pa] = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        r += pr; g += pg; b += pb; a += pa;
      }
    const n = SS * SS;
    raw[o++] = r / n; raw[o++] = g / n; raw[o++] = b / n; raw[o++] = a / n;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(outDir, "icon.png"), png);

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
fs.writeFileSync(path.join(outDir, "icon.ico"), Buffer.concat([header, entry, png]));

console.log("icons written to", outDir, "png bytes:", png.length);
