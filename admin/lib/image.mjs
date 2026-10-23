// Reads the real type and size of an uploaded picture from its bytes. The browser's
// Content-Type and the file name are never trusted. Only PNG, JPEG and WebP are accepted.

const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

function png(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v) || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { type: 'png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const m = b[o + 1];
    if (m === 0xff) { o++; continue; }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { o += 2; continue; }
    const len = u16be(b, o + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { type: 'jpeg', ext: 'jpg', height: u16be(b, o + 5), width: u16be(b, o + 7) };
    }
    o += 2 + len;
  }
  return null;
}

function webp(b) {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const kind = b.toString('latin1', 12, 16);
  if (kind === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { type: 'webp', ext: 'webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { type: 'webp', ext: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') return { type: 'webp', ext: 'webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

/** @returns {{type, ext, width, height} | null} null when it is not a PNG, JPEG or WebP picture. */
export function inspectImage(buf) {
  const info = png(buf) || jpeg(buf) || webp(buf);
  if (!info || !(info.width > 0 && info.height > 0)) return null;
  return info;
}
