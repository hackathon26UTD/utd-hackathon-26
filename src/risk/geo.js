// Geohash and point-in-polygon helpers. Coordinates are [lng, lat]. No I/O.

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const validLngLat = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

export function geohashEncode(lng, lat, precision = 5) {
  if (!validLngLat([lng, lat])) throw new RangeError('Invalid coordinates');
  let lonR = [-180, 180], latR = [-90, 90], even = true, bit = 0, ch = 0, out = '';
  while (out.length < precision) {
    const r = even ? lonR : latR, v = even ? lng : lat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
  }
  return out;
}

/** Returns [west, south, east, north]. */
export function geohashBounds(hash) {
  let lonR = [-180, 180], latR = [-90, 90], even = true;
  for (const c of String(hash).toLowerCase()) {
    const idx = B32.indexOf(c);
    if (idx < 0) throw new RangeError('Invalid geohash');
    for (let b = 4; b >= 0; b--) {
      const r = even ? lonR : latR, mid = (r[0] + r[1]) / 2;
      if ((idx >> b) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return [lonR[0], latR[0], lonR[1], latR[1]];
}

export function geohashDecode(hash) {
  const bbox = geohashBounds(hash);
  return { lng: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2, bbox };
}

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygon = (pt, rings) => Array.isArray(rings) && rings.length > 0 && inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h));

/** True when the point lies inside a Polygon or MultiPolygon. Points and lines never contain anything. */
export function pointInGeometry(pt, geometry) {
  if (!validLngLat(pt) || !geometry || typeof geometry !== 'object') return false;
  try {
    if (geometry.type === 'Polygon') return inPolygon(pt, geometry.coordinates);
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((p) => inPolygon(pt, p));
    if (geometry.type === 'GeometryCollection') return (geometry.geometries || []).some((g) => pointInGeometry(pt, g));
  } catch { /* malformed geometry contains nothing */ }
  return false;
}

export const inBbox = (pt, bbox) => validLngLat(pt) && Array.isArray(bbox) && pt[0] >= bbox[0] && pt[0] <= bbox[2] && pt[1] >= bbox[1] && pt[1] <= bbox[3];

/** Device position: its home's location, else device.meta latitude/longitude. Null when unknown. */
export function deviceLngLat(device, homesById = {}) {
  const home = device?.homeId != null ? (homesById instanceof Map ? homesById.get(String(device.homeId)) : homesById[String(device.homeId)]) : null;
  const c = home?.location?.coordinates;
  if (validLngLat(c)) return [c[0], c[1]];
  const lat = Number(device?.meta?.latitude), lng = Number(device?.meta?.longitude);
  if (device?.meta?.latitude != null && device?.meta?.longitude != null && validLngLat([lng, lat])) return [lng, lat];
  return null;
}

/** Parse "w,s,e,n" into a validated bbox or null. */
export function parseBbox(text) {
  if (!text) return null;
  const b = String(text).split(',').map(Number);
  if (b.length !== 4 || b.some((n) => !Number.isFinite(n)) || b[0] >= b[2] || b[1] >= b[3] || Math.abs(b[0]) > 180 || Math.abs(b[2]) > 180 || Math.abs(b[1]) > 90 || Math.abs(b[3]) > 90) return null;
  return b;
}
