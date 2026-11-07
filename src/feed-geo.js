// Small geometry helpers for feeds and zones. Pure functions, no I/O.
// Coordinates are [lng, lat]. A bbox is [west, south, east, north].
import { HttpError } from './http.js';

export const TILE_DEG = 0.25;
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function parseBbox(raw, { required = true } = {}) {
  if (raw === null || raw === undefined || raw === '') {
    if (required) throw new HttpError(400, 'Provide bbox as west,south,east,north.');
    return null;
  }
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const box = parts.map((p) => (typeof p === 'string' && p.trim() === '' ? NaN : Number(p)));
  const [w, s, e, n] = box;
  if (box.length !== 4 || !box.every(Number.isFinite)) throw new HttpError(400, 'bbox must be four numbers: west,south,east,north.');
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) throw new HttpError(400, 'bbox is outside the valid range or reversed.');
  return box;
}

export const bboxIntersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export const bboxCenter = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

function eachPosition(coords, fn) {
  if (typeof coords?.[0] === 'number') return fn(coords);
  for (const c of coords || []) eachPosition(c, fn);
}

export function geometryBbox(geometry) {
  if (!geometry?.coordinates) return null;
  let box = null;
  eachPosition(geometry.coordinates, ([x, y]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!box) box = [x, y, x, y];
    else {
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
    }
  });
  return box;
}

export function countPositions(geometry) {
  let n = 0;
  eachPosition(geometry?.coordinates, () => { n += 1; });
  return n;
}

// 0.25 degree tiles covering a bbox, nearest to the bbox center first.
export function tilesFor(bbox) {
  const [w, s, e, n] = bbox;
  const x0 = Math.floor(w / TILE_DEG), x1 = Math.floor((e - 1e-9) / TILE_DEG);
  const y0 = Math.floor(s / TILE_DEG), y1 = Math.floor((n - 1e-9) / TILE_DEG);
  const [cx, cy] = bboxCenter(bbox);
  const tiles = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const box = [x * TILE_DEG, y * TILE_DEG, (x + 1) * TILE_DEG, (y + 1) * TILE_DEG];
      const [tx, ty] = bboxCenter(box);
      tiles.push({ key: `t:${x}:${y}`, bbox: box, d: (tx - cx) ** 2 + (ty - cy) ** 2 });
    }
  }
  return tiles.sort((a, b) => a.d - b.d);
}

export function geohashEncode(lng, lat, precision = 5) {
  let lo = [-180, -90], hi = [180, 90], bit = 0, ch = 0, even = true, out = '';
  while (out.length < precision) {
    const axis = even ? 0 : 1;
    const v = even ? lng : lat;
    const mid = (lo[axis] + hi[axis]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; lo[axis] = mid; } else { ch <<= 1; hi[axis] = mid; }
    even = !even;
    if (++bit === 5) { out += BASE32[ch]; bit = 0; ch = 0; }
  }
  return out;
}

export function geohashBounds(hash) {
  let lo = [-180, -90], hi = [180, 90], even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    if (v < 0) return null;
    for (let b = 4; b >= 0; b--) {
      const axis = even ? 0 : 1;
      const mid = (lo[axis] + hi[axis]) / 2;
      if ((v >> b) & 1) lo[axis] = mid; else hi[axis] = mid;
      even = !even;
    }
  }
  return [lo[0], lo[1], hi[0], hi[1]];
}

export const geohashCenter = (hash) => bboxCenter(geohashBounds(hash));

// Geohash cells overlapping a bbox, nearest to its center first, capped.
export function cellsFor(bbox, precision = 5, cap = 25) {
  const [w, s, e, n] = bbox;
  const first = geohashBounds(geohashEncode(w, s, precision));
  const dx = first[2] - first[0], dy = first[3] - first[1];
  const [cx, cy] = bboxCenter(bbox);
  const seen = new Map();
  for (let x = first[0] + dx / 2; x < e + dx / 2; x += dx) {
    for (let y = first[1] + dy / 2; y < n + dy / 2; y += dy) {
      const hash = geohashEncode(Math.min(x, 179.999999), Math.min(y, 89.999999), precision);
      if (!seen.has(hash)) { const [hx, hy] = geohashCenter(hash); seen.set(hash, (hx - cx) ** 2 + (hy - cy) ** 2); }
    }
  }
  return [...seen].sort((a, b) => a[1] - b[1]).slice(0, cap).map(([h]) => h);
}
