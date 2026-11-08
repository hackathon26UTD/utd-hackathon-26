// Pure JavaScript QR Code encoder. Byte mode, error correction level M, versions 1 to 10.
// No dependencies, no I/O. Output is a boolean matrix plus helpers to draw it as SVG.
// Tables follow ISO/IEC 18004 (level M). Tests use an independent OpenCV decoder when available.

// Per version (index = version): [ecCodewordsPerBlock, [[blockCount, dataCodewordsPerBlock], ...]]
const EC_M = [
  null,
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const MAX_VERSION = 10;
export const EC_LEVEL_M_BITS = 0b00;

export const dataCapacity = (version) => EC_M[version][1].reduce((n, [c, d]) => n + c * d, 0);
/** Largest byte-mode payload at level M for a version. */
export const byteCapacity = (version) => Math.floor((dataCapacity(version) * 8 - 4 - (version >= 10 ? 16 : 8)) / 8);

// GF(256), primitive polynomial 0x11D.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
export const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial of the given degree (coefficients high to low, leading 1 included). */
export function rsGenerator(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** Reed-Solomon remainder of data bytes divided by the generator polynomial. */
export function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift();
    rem.push(0);
    if (factor !== 0) for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

const utf8 = (s) => [...new TextEncoder().encode(s)];

/** Smallest version (1 to 10) that fits the bytes, or null. */
export function pickVersion(byteLength) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const countBits = v >= 10 ? 16 : 8;
    if (4 + countBits + 8 * byteLength <= dataCapacity(v) * 8) return v;
  }
  return null;
}

function buildCodewords(bytes, version) {
  const capBits = dataCapacity(version) * 8;
  const bits = [];
  const put = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataCapacity(version); pad ^= 0xec ^ 0x11) data.push(pad);

  const [ecLen, groups] = EC_M[version];
  const blocks = [];
  let at = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) { const d = data.slice(at, at + size); at += size; blocks.push({ data: d, ec: rsRemainder(d, ecLen) }); }
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

const bchDigits = (v) => 32 - Math.clz32(v);
/** 15-bit format string for level M and a mask, already XORed with 0x5412. */
export function formatBits(mask, ecBits = EC_LEVEL_M_BITS) {
  const data = (ecBits << 3) | mask;
  let rem = data << 10;
  while (bchDigits(rem) >= 11) rem ^= 0x537 << (bchDigits(rem) - 11);
  return ((data << 10) | rem) ^ 0x5412;
}
/** 18-bit version string for versions 7 and up. */
export function versionBits(version) {
  let rem = version << 12;
  while (bchDigits(rem) >= 13) rem ^= 0x1f25 << (bchDigits(rem) - 13);
  return (version << 12) | rem;
}

const maskFn = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Lay out function patterns. Returns { size, mod, fn } where fn marks reserved cells. */
function baseMatrix(version) {
  const size = 17 + 4 * version;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, v) => { mod[r][c] = v; fn[r][c] = true; };
  const finder = (r0, c0) => {
    // Separator ring (light), clipped to the matrix.
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r >= 0 && c >= 0 && r < size && c < size) set(r, c, false);
    }
    // 7x7 finder: outer ring dark, next ring light, centre 3x3 dark.
    for (let dr = 0; dr < 7; dr++) for (let dc = 0; dc < 7; dc++) {
      const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      set(r0 + dr, c0 + dc, ring === 3 || ring <= 1);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const pos = ALIGN[version];
  for (const r of pos) for (const c of pos) {
    if ((r === 6 && c === 6) || (r === 6 && c === pos[pos.length - 1]) || (r === pos[pos.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // Reserve format areas (written later) and the dark module.
  for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true; }
  for (let i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
  set(size - 8, 8, true);
  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vb >>> i) & 1) === 1;
      const a = Math.floor(i / 3), b = (i % 3) + size - 11;
      set(a, b, bit); set(b, a, bit);
    }
  }
  return { size, mod, fn };
}

function placeData(m, codewords) {
  const { size, mod, fn } = m;
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  let k = 0;
  let up = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let n = 0; n < size; n++) {
      const r = up ? size - 1 - n : n;
      for (let dc = 0; dc < 2; dc++) {
        const c = right - dc;
        if (fn[r][c]) continue;
        mod[r][c] = k < bits.length ? bits[k] === 1 : false; // remainder bits stay light
        k++;
      }
    }
    up = !up;
  }
}

function writeFormat(mod, size, mask) {
  const f = formatBits(mask);
  const bit = (i) => ((f >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) mod[i][8] = bit(i);
  mod[7][8] = bit(6); mod[8][8] = bit(7); mod[8][7] = bit(8);
  for (let i = 9; i < 15; i++) mod[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) mod[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) mod[size - 15 + i][8] = bit(i);
  mod[size - 8][8] = true;
}

function penalty(mod, size) {
  let p = 0;
  const run = (line) => {
    let s = 0, count = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) count++;
      else { if (count >= 5) s += 3 + (count - 5); count = 1; }
    }
    return s;
  };
  for (let i = 0; i < size; i++) {
    p += run(mod[i]);
    p += run(mod.map((row) => row[i]));
  }
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = mod[r][c];
    if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) p += 3;
  }
  const pat = [true, false, true, true, true, false, true, false, false, false, false];
  const rev = [...pat].reverse();
  const match = (get, i, j, arr) => arr.every((v, k) => get(i, j + k) === v);
  for (let r = 0; r < size; r++) for (let c = 0; c <= size - 11; c++) {
    if (match((i, j) => mod[i][j], r, c, pat)) p += 40;
    if (match((i, j) => mod[i][j], r, c, rev)) p += 40;
    if (match((i, j) => mod[j][i], r, c, pat)) p += 40;
    if (match((i, j) => mod[j][i], r, c, rev)) p += 40;
  }
  let dark = 0;
  for (const row of mod) for (const v of row) if (v) dark++;
  const pct = (dark * 100) / (size * size);
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

/**
 * Encode text (UTF-8, byte mode, level M). Returns { version, size, mask, modules } where modules[r][c]
 * is true for dark. Throws RangeError when the text does not fit version 10.
 */
export function encodeQr(text) {
  const bytes = utf8(String(text));
  const version = pickVersion(bytes.length);
  if (!version) throw new RangeError(`QR payload of ${bytes.length} bytes is too long (max ${byteCapacity(MAX_VERSION)} at level M)`);
  const codewords = buildCodewords(bytes, version);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = baseMatrix(version);
    placeData(m, codewords);
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (!m.fn[r][c] && maskFn[mask](r, c)) m.mod[r][c] = !m.mod[r][c];
    writeFormat(m.mod, m.size, mask);
    const score = penalty(m.mod, m.size);
    if (!best || score < best.score) best = { score, mask, mod: m.mod, size: m.size };
  }
  return { version, size: best.size, mask: best.mask, modules: best.mod };
}

/** SVG path data (one rect per horizontal dark run) in module units, origin at the quiet-zone corner. */
export function qrPath(modules, quiet = 4) {
  const size = modules.length;
  let d = '';
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!modules[r][c]) { c++; continue; }
      let end = c;
      while (end < size && modules[r][end]) end++;
      d += `M${c + quiet} ${r + quiet}h${end - c}v1h-${end - c}z`;
      c = end;
    }
  }
  return d;
}

/** Standalone SVG string. Text is a pure function of the matrix, so nothing needs escaping. */
export function qrSvg(text, { quiet = 4, label = 'QR code', className = '' } = {}) {
  if (!Number.isInteger(quiet) || quiet < 4 || quiet > 32) throw new RangeError('QR quiet zone must be 4 to 32 modules.');
  const { modules } = encodeQr(text);
  const full = modules.length + quiet * 2;
  const cls = className ? ` class="${className.replace(/[^a-z0-9_-]/gi, '')}"` : '';
  const safeLabel = String(label).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<svg${cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" role="img" aria-label="${safeLabel}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path d="${qrPath(modules, quiet)}" fill="#000"/></svg>`;
}
