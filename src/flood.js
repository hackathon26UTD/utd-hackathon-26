// FEMA National Flood Hazard Layer (NFHL): flood zone lookups and map polygons.
// Source: https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28 (Flood Hazard Zones).
// Results are cached in MongoDB so lookups stay fast and the demo survives FEMA outages.
// Flood zones are regulatory map designations, not a prediction of current flooding.
import { badRequest, HttpError } from './http.js';
import { requireAdmin, requireRead } from './auth.js';

const NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const CACHE_DAYS = 30;
const MAX_BBOX_DEG = 0.15; // ~16 km; FEMA polygons are detailed, keep requests bounded
const FIELDS = 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE';

let fetchImpl = (...a) => globalThis.fetch(...a);
export function setFloodFetch(f) { fetchImpl = f; } // tests only

/**
 * Plain-language risk from FEMA attributes.
 * high: Special Flood Hazard Area (1% annual chance, zones A*, V*).
 * moderate: 0.2% annual chance or levee-protected (zone X shaded).
 * minimal: zone X unshaded. undetermined: zone D. none: no NFHL polygon (unmapped).
 */
export function classifyZone(attrs) {
  if (!attrs) return 'unmapped';
  const zone = String(attrs.FLD_ZONE || '').toUpperCase();
  const sub = String(attrs.ZONE_SUBTY || '').toUpperCase();
  if (attrs.SFHA_TF === 'T' || /^(A|V)/.test(zone)) return 'high';
  if (zone === 'D') return 'undetermined';
  if (zone === 'OPEN WATER') return 'open_water';
  if (/0\.2 PCT|LEVEE|FUTURE CONDITIONS/.test(sub)) return 'moderate';
  if (zone.startsWith('X')) return 'minimal';
  return 'undetermined';
}

function parseLatLon(url) {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!url.searchParams.has('lat') || !url.searchParams.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw badRequest('Valid lat and lon required');
  return { lat, lon };
}

async function femaGet(params, timeoutMs = 20000) {
  let res;
  try {
    res = await fetchImpl(`${NFHL}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'utd-hackathon-26 (Safe Home)' } });
  } catch {
    throw new HttpError(503, 'FEMA flood map service did not respond');
  }
  if (!res.ok) throw new HttpError(503, `FEMA flood map service returned HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data || data.error) throw new HttpError(503, 'FEMA flood map service returned an error');
  return data;
}

export async function lookupZone(lat, lon) {
  const data = await femaGet({
    geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: FIELDS, returnGeometry: 'false', f: 'json',
  });
  // A point can touch several polygons on a boundary; take the most severe.
  const order = ['high', 'moderate', 'undetermined', 'open_water', 'minimal'];
  const zones = (data.features || []).map((f) => ({ attrs: f.attributes, risk: classifyZone(f.attributes) }));
  zones.sort((a, b) => order.indexOf(a.risk) - order.indexOf(b.risk));
  const top = zones[0];
  return {
    risk: top ? top.risk : 'unmapped',
    zone: top?.attrs.FLD_ZONE ?? null,
    subtype: top?.attrs.ZONE_SUBTY ?? null,
    specialFloodHazardArea: top ? top.attrs.SFHA_TF === 'T' : false,
    baseFloodElevationFt: top && top.attrs.STATIC_BFE > -9999 ? top.attrs.STATIC_BFE : null,
    source: 'FEMA National Flood Hazard Layer',
    fetchedAt: new Date(),
  };
}

async function cachedZone(d, lat, lon) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const cache = d.collection('flood_zone_cache');
  const hit = await cache.findOne({ _id: key });
  if (hit) return { ...hit.result, cached: true };
  const result = await lookupZone(lat, lon);
  await cache.updateOne({ _id: key }, { $set: { result, expireAt: new Date(Date.now() + CACHE_DAYS * 86400e3) } }, { upsert: true });
  return { ...result, cached: false };
}

export async function setupFlood(db) {
  await Promise.all([
    db.collection('flood_zone_cache').createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('flood_polygon_cache').createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

export function registerFloodRoutes(route, withDb, { json, intParam }) {
  route('GET', '/flood/zone', async (ctx) => {
    requireRead(ctx.request, ctx.env);
    const { lat, lon } = parseLatLon(ctx.url);
    return withDb(ctx, async (d) => json({ lat, lon, ...(await cachedZone(d, lat, lon)) }));
  });

  // GeoJSON polygons for a map layer. Default: high-risk (SFHA) only; ?include=moderate adds 0.2%/levee areas.
  route('GET', '/flood/zones', async (ctx) => {
    requireRead(ctx.request, ctx.env);
    const parts = (ctx.url.searchParams.get('bbox') || '').split(',').map(Number);
    if (parts.length !== 4 || !parts.every(Number.isFinite)) throw badRequest('bbox=west,south,east,north required');
    const [w, s, e, n] = parts;
    if (w >= e || s >= n || Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) throw badRequest('bbox must be west,south,east,north in degrees');
    if (e - w > MAX_BBOX_DEG || n - s > MAX_BBOX_DEG) throw badRequest(`bbox too large (max ${MAX_BBOX_DEG} degrees per side); request tiles`);
    const includeModerate = ctx.url.searchParams.get('include') === 'moderate';
    const key = `${[w, s, e, n].map((v) => v.toFixed(4)).join(',')}|${includeModerate ? 'mod' : 'high'}`;
    return withDb(ctx, async (d) => {
      const cache = d.collection('flood_polygon_cache');
      const hit = await cache.findOne({ _id: key });
      if (hit) return json({ ...hit.geojson, cached: true, fetchedAt: hit.fetchedAt });
      const where = includeModerate ? "SFHA_TF='T' OR ZONE_SUBTY LIKE '%0.2 PCT%' OR ZONE_SUBTY LIKE '%LEVEE%'" : "SFHA_TF='T'";
      const data = await femaGet({
        geometry: `${w},${s},${e},${n}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
        where, outFields: FIELDS, outSR: '4326', geometryPrecision: '5', f: 'geojson',
      }, 45000);
      const features = (data.features || []).map((f) => ({ ...f, properties: { ...f.properties, risk: classifyZone(f.properties) } }));
      const geojson = { type: 'FeatureCollection', features, source: 'FEMA National Flood Hazard Layer', exceededTransferLimit: Boolean(data.exceededTransferLimit || data.properties?.exceededTransferLimit) };
      const fetchedAt = new Date();
      await cache.updateOne({ _id: key }, { $set: { geojson, fetchedAt, expireAt: new Date(Date.now() + CACHE_DAYS * 86400e3) } }, { upsert: true });
      return json({ ...geojson, cached: false, fetchedAt });
    });
  });

  // Admin: tag homes with their FEMA flood zone (adds `floodZone` to each home document only).
  route('POST', '/flood/homes/refresh', async (ctx) => {
    requireAdmin(ctx.request, ctx.env);
    const limit = intParam(ctx.url, 'limit', { def: 100, min: 1, max: 300 });
    const force = ctx.url.searchParams.get('force') === 'true';
    return withDb(ctx, async (d) => {
      const homes = d.collection('homes');
      const stale = new Date(Date.now() - CACHE_DAYS * 86400e3);
      const q = force ? {} : { $or: [{ floodZone: { $exists: false } }, { 'floodZone.fetchedAt': { $lt: stale } }] };
      const list = await homes.find(q, { projection: { location: 1 } }).limit(limit).toArray();
      let updated = 0, failed = 0;
      const counts = {};
      for (let i = 0; i < list.length; i += 4) {
        await Promise.all(list.slice(i, i + 4).map(async (h) => {
          const [lon, lat] = h.location?.coordinates || [];
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) { failed++; return; }
          try {
            const { cached, ...z } = await cachedZone(d, lat, lon);
            await homes.updateOne({ _id: h._id }, { $set: { floodZone: z } });
            counts[z.risk] = (counts[z.risk] || 0) + 1;
            updated++;
          } catch { failed++; }
        }));
      }
      return json({ checked: list.length, updated, failed, byRisk: counts });
    });
  });
}
