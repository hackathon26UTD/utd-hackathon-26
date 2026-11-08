// GET /api/ops/place: what is happening at one point in the lower 48.
// Every section reports its own status. Missing data is unknown, a source that was not loaded is never "none",
// and nothing here says anything about occupancy, entry, damage, coverage or dispatch.
// The numbers in CONUS_API_BOX must match ui/command/geo.js (a test checks it).
import { HttpError, json } from './http.js';
import { withDb } from './db.js';
import { opsAuth } from './live-api.js';
import { loadScopeDevices } from './live.js';
import { loadRisk } from './risk/load.js';
import { inBbox, pointInGeometry } from './risk/geo.js';
import { ensureFeedIndexes, readLayer, loadActiveZones, LAYERS } from './feeds.js';
import { tilesFor } from './feed-geo.js';
import { classifyZone } from './flood.js';
import { parseAirnow, parseFirms, parseGauges, parseQuakes, rainLevel } from './feed-layers.js';

export const CONUS_API_BOX = { minLat: 24.3, maxLat: 49.6, minLon: -125.1, maxLon: -66.8 };
export const inConus = (lat, lon) => lat >= CONUS_API_BOX.minLat && lat <= CONUS_API_BOX.maxLat && lon >= CONUS_API_BOX.minLon && lon <= CONUS_API_BOX.maxLon;

export const ADVISORY = 'Advisory only. A person must review this.';
export const SECTION_IDS = ['weatherNow', 'forecast', 'alerts', 'floodZone', 'gauges', 'riverForecast', 'tides', 'quakes', 'fires', 'airQuality', 'shelters', 'declarations', 'devices', 'regionalRisk', 'zones'];
const TITLES = {
  weatherNow: 'Current weather', forecast: 'Forecast', alerts: 'Weather alerts', floodZone: 'Flood zone', gauges: 'River gauges', riverForecast: 'River forecast',
  tides: 'Coastal water level', quakes: 'Earthquakes', fires: 'Fire detections', airQuality: 'Air quality', shelters: 'Shelters', declarations: 'Disaster declarations',
  devices: 'Safe Home boxes', regionalRisk: 'Area summary', zones: 'Operator zones',
};
const SOURCES = {
  weatherNow: 'NWS', forecast: 'NWS, Open-Meteo', alerts: 'NWS', floodZone: 'FEMA NFHL', gauges: 'USGS', riverForecast: 'Open-Meteo GloFAS', tides: 'NOAA CO-OPS',
  quakes: 'USGS', fires: 'NASA FIRMS', airQuality: 'AirNow', shelters: 'FEMA NSS (cached)', declarations: 'OpenFEMA (cached)', devices: 'Safe Home', regionalRisk: 'Safe Home', zones: 'Operator zones',
};
const UA = 'HomeBeaconHackUTD/1.0 (https://github.com/hackathon26UTD)';
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
export const LIMITS = { perActorPerMin: 60, globalPerMin: 300, sectionMs: 4000, totalMs: 6000 };

// Coastal stations (id, name, lat, lon). Water level is only offered within 100 km of one.
export const TIDE_STATIONS = [
  ['8410140', 'Eastport ME', 44.9046, -66.9829], ['8443970', 'Boston MA', 42.3539, -71.0503], ['8518750', 'The Battery NY', 40.7006, -74.0142],
  ['8574680', 'Baltimore MD', 39.2667, -76.5783], ['8594900', 'Washington DC', 38.8733, -77.0217], ['8638610', 'Sewells Point VA', 36.9428, -76.3286],
  ['8658120', 'Wilmington NC', 34.2267, -77.9533], ['8665530', 'Charleston SC', 32.7808, -79.9236], ['8723214', 'Virginia Key FL', 25.7314, -80.1618],
  ['8726520', 'St. Petersburg FL', 27.7606, -82.6269], ['8729840', 'Pensacola FL', 30.4044, -87.2112], ['8761724', 'Grand Isle LA', 29.2633, -89.9567],
  ['8771450', 'Galveston TX', 29.31, -94.7933], ['9410170', 'San Diego CA', 32.7156, -117.1767], ['9414290', 'San Francisco CA', 37.8063, -122.4659],
  ['9439040', 'Astoria OR', 46.2073, -123.7683], ['9447130', 'Seattle WA', 47.6026, -122.3393],
].map(([id, name, lat, lon]) => ({ id, name, lat, lon }));

// ---------- small helpers ----------
export class UpstreamError extends Error {
  constructor(reason, status = 0) { super(reason); this.reason = reason; this.status = status; }
}
const iso = (d) => (d ? new Date(d).toISOString() : null);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, n = 1) => (v === null ? null : Math.round(v * 10 ** n) / 10 ** n);
/** Upstream text: control characters out, dashes plain, length capped. */
export const clean = (v, max = 160) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().slice(0, max) : null);
export function distanceM(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}
const km = (m) => round(m / 1000, 1);
const grid = (v, step) => (Math.round(v / step) * step).toFixed(2);
const boxAround = (lat, lon, dLat, dLon) => [lon - dLon, lat - dLat, lon + dLon, lat + dLat];

export function ageText(seconds) {
  if (seconds === null || seconds === undefined) return 'age unknown';
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min old`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h old`;
  return `${Math.round(seconds / 86400)} d old`;
}
function clock(value, tz, now) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const zone = tz || 'UTC';
  try {
    const day = (x) => new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' }).format(x);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d).replace(':00', '');
    return day(d) === day(now) ? time : `${new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(d)} ${time}`;
  } catch { return d.toISOString().slice(11, 16) + ' UTC'; }
}

// ---------- upstream access ----------
async function fetchText(ctx, url, { timeoutMs = 3500, allow404 = false } = {}) {
  let res;
  try {
    res = await ctx.fetcher(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json, application/json, text/csv' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new UpstreamError(e?.name === 'TimeoutError' ? 'The source took too long to answer.' : 'The source could not be reached.');
  }
  if (res.status === 404 && allow404) return null;
  if (!res.ok) throw new UpstreamError(`The source answered with an error (${res.status}).`, res.status);
  const body = await res.text();
  if (body.length > 4_000_000) throw new UpstreamError('The source sent more data than we accept.');
  return body;
}
async function fetchJson(ctx, url, opts) {
  const body = await fetchText(ctx, url, opts);
  if (body === null) return null;
  try { return JSON.parse(body); } catch { throw new UpstreamError('The source sent unreadable data.'); }
}

/** Cache-through. Fresh hit, else fetch and store, else the stale copy when the source fails. */
async function cached(ctx, key, ttlMs, load) {
  let doc = null;
  try { doc = await ctx.db.collection('place_cache').findOne({ _id: key }); } catch { /* a cache read failure is a miss */ }
  const nowMs = ctx.now.getTime();
  if (doc && new Date(doc.freshUntil).getTime() > nowMs) return { value: doc.value, fetchedAt: new Date(doc.fetchedAt), stale: false };
  try {
    await ctx.touchUpstream();
    const value = await load();
    try {
      await ctx.db.collection('place_cache').replaceOne({ _id: key }, {
        _id: key, value, fetchedAt: ctx.now, freshUntil: new Date(nowMs + ttlMs), expiresAt: new Date(nowMs + Math.min(Math.max(ttlMs * 10, DAY), 35 * DAY)),
      }, { upsert: true });
    } catch { /* storing is best effort */ }
    return { value, fetchedAt: ctx.now, stale: false };
  } catch (e) {
    if (doc) return { value: doc.value, fetchedAt: new Date(doc.fetchedAt), stale: true };
    throw e;
  }
}

const indexed = new Set();
async function ensurePlaceIndexes(db) {
  const name = db.databaseName || 'db';
  if (indexed.has(name)) return;
  try {
    await Promise.all([
      db.collection('place_cache').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('place_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    indexed.add(name);
  } catch { /* indexes are an optimization */ }
}
const bucketKey = (name, now) => `${name}:${Math.floor(now.getTime() / MIN)}`;
async function bump(db, name, now) {
  const r = await db.collection('place_limits').findOneAndUpdate({ _id: bucketKey(name, now) }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + 2 * MIN) } }, { upsert: true, returnDocument: 'after' });
  return (r?.value ?? r)?.count ?? 1;
}

// ---------- section helpers ----------
const section = (id, status, extra = {}) => ({ status, source: extra.source || SOURCES[id], ...extra, items: extra.items || [] });
function timed(id, fetchedAt, observedAt, now) {
  const base = observedAt || fetchedAt;
  const t = base ? new Date(base).getTime() : NaN;
  return {
    ...(fetchedAt ? { fetchedAt: iso(fetchedAt) } : {}), ...(observedAt ? { observedAt: iso(observedAt) } : {}),
    ageSeconds: Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 1000)) : null,
  };
}
const flagStale = (base, stale, reason) => (stale ? { ...base, status: base.status === 'ok' ? 'stale' : base.status, reason: base.reason || reason, stale: true } : base);

// ---------- upstream loaders ----------
async function loadCensus(ctx) {
  const key = `census:${ctx.lat.toFixed(3)},${ctx.lon.toFixed(3)}`;
  return cached(ctx, key, 30 * DAY, async () => {
    const q = new URLSearchParams({ x: String(ctx.lon), y: String(ctx.lat), benchmark: 'Public_AR_Current', vintage: 'Current_Current', layers: 'States,Counties,Incorporated Places', format: 'json' });
    const j = await fetchJson(ctx, `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${q}`, { timeoutMs: 2500 });
    const g = j?.result?.geographies;
    if (!g || typeof g !== 'object') throw new UpstreamError('The place lookup sent unreadable data.');
    const st = g.States?.[0], co = g.Counties?.[0], pl = g['Incorporated Places']?.[0];
    if (!st && !co) return { none: true };
    return {
      state: st ? { abbr: clean(st.STUSAB, 2), name: clean(st.NAME, 40), fips: clean(st.GEOID, 2) } : null,
      county: co ? { name: clean(co.NAME, 60), fips: clean(co.GEOID, 5) } : null,
      city: pl ? clean(pl.BASENAME, 60) : null,
    };
  });
}
const loadNwsPoint = (ctx) => cached(ctx, `nws-point:${ctx.lat.toFixed(4)},${ctx.lon.toFixed(4)}`, 7 * DAY, async () => {
  const j = await fetchJson(ctx, `https://api.weather.gov/points/${ctx.lat.toFixed(4)},${ctx.lon.toFixed(4)}`, { allow404: true });
  const p = j?.properties;
  if (!p) return { none: true };
  return { gridId: clean(p.gridId, 5), x: num(p.gridX), y: num(p.gridY), timeZone: clean(p.timeZone, 40), city: clean(p.relativeLocation?.properties?.city, 60), state: clean(p.relativeLocation?.properties?.state, 2) };
});
const gridPath = (pt) => `${pt.gridId}/${pt.x},${pt.y}`;
const loadOpenMeteo = (ctx) => {
  const lat = grid(ctx.lat, 0.05), lon = grid(ctx.lon, 0.05);
  return cached(ctx, `om:${lat},${lon}`, 15 * MIN, async () => {
    const j = await fetchJson(ctx, `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code&hourly=precipitation&forecast_hours=24&timezone=UTC`);
    if (!j || typeof j !== 'object' || j.error) throw new UpstreamError('The model forecast sent unreadable data.');
    const stamp = (t) => (typeof t === 'string' ? new Date(`${t}:00Z`).toISOString() : null);
    const precip = (j.hourly?.precipitation || []).filter(Number.isFinite);
    return {
      elevationM: num(j.elevation),
      current: j.current ? { time: stamp(j.current.time), temperature_2m: num(j.current.temperature_2m), relative_humidity_2m: num(j.current.relative_humidity_2m), precipitation: num(j.current.precipitation), wind_speed_10m: num(j.current.wind_speed_10m), wind_direction_10m: num(j.current.wind_direction_10m) } : null,
      rain: precip.length ? { totalMm: round(precip.reduce((a, b) => a + b, 0), 1), peakMmph: round(Math.max(...precip), 1), hours: precip.length } : null,
    };
  });
};

// ---------- sections ----------
async function weatherNow(ctx) {
  const id = 'weatherNow';
  let obs = null, stale = false, fetchedAt = null;
  try {
    const pt = (await ctx.nwsPoint()).value;
    if (!pt.none) {
      const stations = (await cached(ctx, `nws-stations:${gridPath(pt)}`, 7 * DAY, async () => {
        const j = await fetchJson(ctx, `https://api.weather.gov/gridpoints/${gridPath(pt)}/stations?limit=5`);
        return (j?.features || []).filter((f) => f?.properties?.stationIdentifier && Array.isArray(f.geometry?.coordinates))
          .map((f) => ({ id: clean(f.properties.stationIdentifier, 8), name: clean(f.properties.name, 80), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })).slice(0, 4);
      })).value;
      for (const st of stations.slice(0, 3)) {
        let got;
        try {
          got = await cached(ctx, `nws-obs:${st.id}`, 10 * MIN, async () => {
            const j = await fetchJson(ctx, `https://api.weather.gov/stations/${encodeURIComponent(st.id)}/observations/latest`);
            const p = j?.properties;
            if (!p) throw new UpstreamError('The observation was unreadable.');
            const v = (o) => num(o?.value);
            return { timestamp: p.timestamp || null, text: clean(p.textDescription, 60), temp: v(p.temperature), dew: v(p.dewpoint), wind: v(p.windSpeed), dir: v(p.windDirection), gust: v(p.windGust), rh: v(p.relativeHumidity), pa: v(p.barometricPressure), vis: v(p.visibility) };
          });
        } catch { continue; }
        if (got.value.temp !== null && got.value.timestamp) { obs = { st, ...got.value }; stale = got.stale; fetchedAt = got.fetchedAt; break; }
      }
    }
  } catch { /* fall back to the model below */ }
  if (obs) {
    const items = [
      obs.text && { label: 'Conditions', value: obs.text }, { label: 'Temperature', value: round(obs.temp), unit: 'C' }, obs.dew !== null && { label: 'Dew point', value: round(obs.dew), unit: 'C' },
      obs.rh !== null && { label: 'Humidity', value: Math.round(obs.rh), unit: '%' }, obs.wind !== null && { label: 'Wind', value: round(obs.wind), unit: 'km/h', ...(obs.dir !== null ? { direction: Math.round(obs.dir) } : {}) },
      obs.gust !== null && { label: 'Gust', value: round(obs.gust), unit: 'km/h' }, obs.pa !== null && { label: 'Pressure', value: round(obs.pa / 100), unit: 'hPa' }, obs.vis !== null && { label: 'Visibility', value: round(obs.vis / 1000), unit: 'km' },
    ].filter(Boolean);
    const t = timed(id, fetchedAt, obs.timestamp, ctx.now);
    const old = t.ageSeconds > 3 * 3600;
    const base = section(id, old ? 'stale' : 'ok', { source: `NWS ${obs.st.id}`, station: obs.st.name, stationDistanceKm: km(distanceM(ctx.lat, ctx.lon, obs.st.lat, obs.st.lon)), ...t, items, ...(old ? { reason: 'The latest station report is more than 3 hours old' } : {}) });
    return flagStale(base, stale && !old, 'The weather service did not answer; showing the last copy');
  }
  const om = await ctx.openMeteo();
  const c = om.value.current;
  if (!c || c.temperature_2m === null) throw new UpstreamError('No current weather is available.');
  const items = [{ label: 'Temperature', value: c.temperature_2m, unit: 'C' }, c.relative_humidity_2m !== null && { label: 'Humidity', value: c.relative_humidity_2m, unit: '%' },
    c.wind_speed_10m !== null && { label: 'Wind', value: c.wind_speed_10m, unit: 'km/h', ...(c.wind_direction_10m !== null ? { direction: Math.round(c.wind_direction_10m) } : {}) }].filter(Boolean);
  return flagStale(section(id, 'ok', { source: 'Open-Meteo model', note: 'Model estimate. No nearby station report was available.', ...timed(id, om.fetchedAt, c.time, ctx.now), items }), om.stale, 'The model service did not answer; showing the last copy');
}

async function forecast(ctx) {
  const id = 'forecast';
  const [nws, om] = await Promise.allSettled([
    (async () => {
      const pt = (await ctx.nwsPoint()).value;
      if (pt.none) throw new UpstreamError('No forecast office covers this point.');
      return cached(ctx, `nws-fc:${gridPath(pt)}`, 30 * MIN, async () => {
        const j = await fetchJson(ctx, `https://api.weather.gov/gridpoints/${gridPath(pt)}/forecast`);
        const periods = j?.properties?.periods;
        if (!Array.isArray(periods)) throw new UpstreamError('The forecast was unreadable.');
        return { updated: j.properties.updateTime || j.properties.generatedAt || null, periods: periods.slice(0, 4).map((p) => ({ name: clean(p.name, 30), temperature: num(p.temperature), unit: clean(p.temperatureUnit, 2), summary: clean(p.shortForecast, 80), precipChancePct: num(p.probabilityOfPrecipitation?.value), wind: clean(p.windSpeed, 30) })) };
      });
    })(),
    ctx.openMeteo(),
  ]);
  if (nws.status === 'rejected' && om.status === 'rejected') throw nws.reason;
  const items = [];
  let fetchedAt = null, observedAt = null, stale = false;
  if (nws.status === 'fulfilled') {
    for (const p of nws.value.value.periods) items.push({ label: p.name, value: p.temperature, unit: p.unit, summary: p.summary, ...(p.precipChancePct !== null ? { precipChancePct: p.precipChancePct } : {}) });
    fetchedAt = nws.value.fetchedAt; observedAt = nws.value.value.updated; stale = nws.value.stale;
  }
  let rain = null;
  if (om.status === 'fulfilled' && om.value.value.rain) {
    const r = om.value.value.rain; rain = { ...r, level: rainLevel(r.peakMmph, r.totalMm) };
    items.push({ label: 'Rain, next 24 hours (model)', value: r.totalMm, unit: 'mm', rainLevel: rain.level });
    fetchedAt ||= om.value.fetchedAt; stale ||= om.value.stale;
  }
  if (!items.length) return section(id, 'unknown', { reason: 'No forecast data was returned' });
  return flagStale(section(id, 'ok', { ...timed(id, fetchedAt, observedAt, ctx.now), items, ...(rain ? { rain } : {}) }), stale, 'A source did not answer; showing the last copy');
}

async function alerts(ctx) {
  const id = 'alerts';
  const r = await cached(ctx, `nws-alerts:${ctx.lat.toFixed(3)},${ctx.lon.toFixed(3)}`, 2 * MIN, async () => {
    const j = await fetchJson(ctx, `https://api.weather.gov/alerts/active?point=${ctx.lat.toFixed(4)},${ctx.lon.toFixed(4)}`);
    if (!Array.isArray(j?.features)) throw new UpstreamError('The alert feed sent unreadable data.');
    return j.features.slice(0, 30).map((f) => ({ geometry: f.geometry || null, event: clean(f.properties?.event, 80), severity: clean(f.properties?.severity, 20), urgency: clean(f.properties?.urgency, 20), area: clean(f.properties?.areaDesc, 160), sent: f.properties?.sent || null, ends: f.properties?.ends || f.properties?.expires || null }));
  });
  const rank = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
  const items = r.value
    // A feature that carries a polygon must contain the point; zone-based alerts carry none and are kept.
    .filter((a) => a.event && (!a.geometry || pointInGeometry([ctx.lon, ctx.lat], a.geometry)) && (!a.ends || new Date(a.ends) > ctx.now))
    .sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0)).slice(0, 10)
    .map(({ geometry, ...rest }) => rest);
  const t = timed(id, r.fetchedAt, null, ctx.now);
  const base = items.length ? section(id, 'ok', { ...t, items }) : section(id, 'none', { ...t, reason: 'No active NWS alerts at this point' });
  return flagStale(base, r.stale, 'The alert service did not answer; showing the last copy');
}

const ZONE_TEXT = { high: 'Special Flood Hazard Area (1% annual chance)', moderate: '0.2% annual chance or levee protected', minimal: 'Minimal flood hazard on the FEMA map', undetermined: 'Flood hazard not determined', open_water: 'Open water' };
async function floodZone(ctx) {
  const id = 'floodZone';
  const r = await cached(ctx, `nfhl:${ctx.lat.toFixed(4)},${ctx.lon.toFixed(4)}`, 30 * DAY, async () => {
    const q = new URLSearchParams({ geometry: `${ctx.lon},${ctx.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE', returnGeometry: 'false', f: 'json' });
    const j = await fetchJson(ctx, `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?${q}`, { timeoutMs: 3800 });
    if (!j || j.error || !Array.isArray(j.features)) throw new UpstreamError('The flood map service sent an error.');
    const order = ['high', 'moderate', 'undetermined', 'open_water', 'minimal'];
    const zones = j.features.map((f) => ({ a: f.attributes || {}, risk: classifyZone(f.attributes) })).sort((a, b) => order.indexOf(a.risk) - order.indexOf(b.risk));
    const top = zones[0];
    if (!top) return { risk: 'unmapped' };
    return { risk: top.risk, zone: clean(top.a.FLD_ZONE, 17), subtype: clean(top.a.ZONE_SUBTY, 76), sfha: top.a.SFHA_TF === 'T', bfeFt: num(top.a.STATIC_BFE) !== null && top.a.STATIC_BFE > -9999 ? top.a.STATIC_BFE : null };
  });
  const t = timed(id, r.fetchedAt, null, ctx.now);
  const note = 'FEMA map designation. It does not show current flooding.';
  if (r.value.risk === 'unmapped') return flagStale(section(id, 'unknown', { ...t, reason: 'Unmapped is not the same as low risk', note }), r.stale, '');
  const item = { risk: r.value.risk, zone: r.value.zone, description: ZONE_TEXT[r.value.risk] || 'Flood hazard not determined', specialFloodHazardArea: r.value.sfha, ...(r.value.bfeFt !== null ? { baseFloodElevationFt: r.value.bfeFt } : {}) };
  return flagStale(section(id, 'ok', { ...t, note, items: [item] }), r.stale, 'The flood map service did not answer; showing the last copy');
}

async function gauges(ctx) {
  const id = 'gauges';
  const clat = Number(grid(ctx.lat, 0.1)), clon = Number(grid(ctx.lon, 0.1));
  const r = await cached(ctx, `usgs:${clat},${clon}`, 10 * MIN, async () => {
    const b = boxAround(clat, clon, 0.5, 0.6).map((v) => v.toFixed(4)).join(',');
    const j = await fetchJson(ctx, `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${b}&parameterCd=00065&siteStatus=active`, { allow404: true, timeoutMs: 3800 });
    // USGS answers 404 when no site matches.
    return j ? parseGauges(j).features.map((f) => ({ site: f.properties.site, name: clean(f.properties.name, 100), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], stage: f.properties.stage, unit: clean(f.properties.unit, 6), observedAt: f.properties.observedAt })) : [];
  });
  const items = r.value.map((g) => ({ ...g, d: distanceM(ctx.lat, ctx.lon, g.lat, g.lon) })).filter((g) => g.d <= 40_000).sort((a, b) => a.d - b.d).slice(0, 5)
    .map((g) => ({ id: g.site, name: g.name, distanceKm: km(g.d), stage: g.stage, unit: g.unit, stageFt: g.unit === 'ft' ? g.stage : undefined, observedAt: iso(g.observedAt), ageSeconds: Math.max(0, Math.round((ctx.now - new Date(g.observedAt)) / 1000)), trend: 'unknown' }));
  const t = timed(id, r.fetchedAt, items.length ? items.map((g) => g.observedAt).sort().pop() : null, ctx.now);
  const note = 'Stage is measured against a station datum. It does not show water depth at a home.';
  if (!items.length) return flagStale(section(id, 'none', { ...t, reason: 'No USGS stage gauges within 40 km', note }), r.stale, '');
  const old = t.ageSeconds > 6 * 3600;
  return flagStale(section(id, old ? 'stale' : 'ok', { ...t, note, items, ...(old ? { reason: 'The newest gauge report is more than 6 hours old' } : {}) }), r.stale && !old, 'The gauge service did not answer; showing the last copy');
}

async function riverForecast(ctx) {
  const id = 'riverForecast';
  const lat = grid(ctx.lat, 0.05), lon = grid(ctx.lon, 0.05);
  const r = await cached(ctx, `glofas:${lat},${lon}`, HOUR, async () => {
    const j = await fetchJson(ctx, `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&forecast_days=7&timezone=UTC`);
    const d = j?.daily;
    if (!Array.isArray(d?.river_discharge) || !Array.isArray(d?.time)) throw new UpstreamError('The river forecast sent unreadable data.');
    return { unit: clean(j.daily_units?.river_discharge, 10) || 'm3/s', days: d.time.map((t, i) => ({ date: clean(t, 10), v: num(d.river_discharge[i]) })).filter((x) => x.v !== null) };
  });
  const t = timed(id, r.fetchedAt, null, ctx.now);
  const note = 'Modelled river flow, not an observed flood boundary.';
  if (!r.value.days.length) return flagStale(section(id, 'none', { ...t, reason: 'No modelled river flow at this location', note }), r.stale, '');
  const peak = r.value.days.reduce((a, b) => (b.v > a.v ? b : a));
  return flagStale(section(id, 'ok', { ...t, note, items: [{ label: 'Flow, first forecast day', value: r.value.days[0].v, unit: r.value.unit, date: r.value.days[0].date }, { label: 'Highest flow in 7 days', value: peak.v, unit: r.value.unit, date: peak.date }] }), r.stale, 'The river forecast did not answer; showing the last copy');
}

async function tides(ctx) {
  const id = 'tides';
  const near = TIDE_STATIONS.map((s) => ({ ...s, d: distanceM(ctx.lat, ctx.lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d)[0];
  if (!near || near.d > 100_000) return section(id, 'not_applicable', { reason: 'No coastal water level station within 100 km' });
  const r = await cached(ctx, `tide:${near.id}`, 10 * MIN, async () => {
    const j = await fetchJson(ctx, `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=${near.id}&product=water_level&datum=MSL&units=metric&time_zone=gmt&application=HomeBeacon&format=json`);
    const v = j?.data?.[0];
    if (!v || num(v.v) === null || typeof v.t !== 'string') throw new UpstreamError('The station sent no water level.');
    return { at: new Date(`${v.t.replace(' ', 'T')}:00Z`).toISOString(), level: num(v.v) };
  });
  const t = timed(id, r.fetchedAt, r.value.at, ctx.now);
  const base = section(id, t.ageSeconds > 3 * 3600 ? 'stale' : 'ok', { ...t, note: 'Station water level. It is not storm surge and not flood depth at a home.', items: [{ label: `${near.name} water level`, value: r.value.level, unit: 'm above MSL', station: near.id, distanceKm: km(near.d) }] });
  return flagStale(base, r.stale, 'The station did not answer; showing the last copy');
}

async function quakes(ctx) {
  const id = 'quakes';
  const r = await cached(ctx, 'quakes:day', 5 * MIN, async () => {
    const j = await fetchJson(ctx, 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
    if (!Array.isArray(j?.features)) throw new UpstreamError('The earthquake feed sent unreadable data.');
    return parseQuakes(j).features.map((f) => ({ mag: f.properties.mag, place: f.properties.place, time: f.properties.time, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
      .filter((q) => inBbox([q.lon, q.lat], [CONUS_API_BOX.minLon - 3, CONUS_API_BOX.minLat - 3, CONUS_API_BOX.maxLon + 3, CONUS_API_BOX.maxLat + 3])).slice(0, 400);
  });
  const items = r.value.map((q) => ({ ...q, d: distanceM(ctx.lat, ctx.lon, q.lat, q.lon) })).filter((q) => q.d <= 150_000).sort((a, b) => b.mag - a.mag).slice(0, 5)
    .map((q) => ({ magnitude: q.mag, place: q.place, at: q.time ? new Date(q.time).toISOString() : null, distanceKm: km(q.d) }));
  const t = timed(id, r.fetchedAt, null, ctx.now);
  const base = items.length ? section(id, 'ok', { ...t, items }) : section(id, 'none', { ...t, reason: 'No earthquakes within 150 km in the last 24 hours' });
  return flagStale(base, r.stale, 'The earthquake service did not answer; showing the last copy');
}

async function fires(ctx) {
  const id = 'fires';
  const key = ctx.env.FIRMS_MAP_KEY;
  if (!key) return section(id, 'needs_key', { reason: 'Needs FIRMS_MAP_KEY' });
  const clat = Number(grid(ctx.lat, 0.1)), clon = Number(grid(ctx.lon, 0.1));
  const r = await cached(ctx, `firms:${clat},${clon}`, 15 * MIN, async () => {
    const body = await fetchText(ctx, `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_NOAA20_NRT/${boxAround(clat, clon, 0.6, 0.7).map((v) => v.toFixed(3)).join(',')}/1`, { timeoutMs: 3800 });
    return parseFirms(body).features.map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], ...f.properties }));
  });
  const items = r.value.map((f) => ({ ...f, d: distanceM(ctx.lat, ctx.lon, f.lat, f.lon) })).filter((f) => f.d <= 50_000).sort((a, b) => a.d - b.d).slice(0, 5)
    .map((f) => ({ distanceKm: km(f.d), acquiredDate: f.acqDate, acquiredTime: f.acqTime, confidence: f.confidence, frpMw: f.frp }));
  const t = timed(id, r.fetchedAt, null, ctx.now);
  const note = 'Satellite heat detections are context. They are not fire perimeters.';
  const base = items.length ? section(id, 'ok', { ...t, note, items }) : section(id, 'none', { ...t, note, reason: 'No satellite fire detections within 50 km in the last day' });
  return flagStale(base, r.stale, 'The fire service did not answer; showing the last copy');
}

async function airQuality(ctx) {
  const id = 'airQuality';
  const key = ctx.env.AIRNOW_API_KEY;
  if (!key) return section(id, 'needs_key', { reason: 'Needs AIRNOW_API_KEY' });
  const clat = Number(grid(ctx.lat, 0.1)), clon = Number(grid(ctx.lon, 0.1));
  const r = await cached(ctx, `airnow:${clat},${clon}`, 30 * MIN, async () => {
    const j = await fetchJson(ctx, `https://www.airnowapi.org/aq/observation/current/ziplatLong?format=application/json&latitude=${clat}&longitude=${clon}&distance=25&api_key=${encodeURIComponent(key)}`);
    return parseAirnow(j).features.map((f) => f.properties);
  });
  const items = r.value.filter((o) => o.aqi !== null).map((o) => ({ area: o.area, parameter: o.parameter, aqi: o.aqi, category: o.category, observedOn: o.observedOn, hour: o.hour }));
  const t = timed(id, r.fetchedAt, null, ctx.now);
  const note = 'Reporting-area air quality. It is not an indoor reading.';
  const base = items.length ? section(id, 'ok', { ...t, note, items }) : section(id, 'none', { ...t, note, reason: 'No air quality report within 25 miles' });
  return flagStale(base, r.stale, 'The air quality service did not answer; showing the last copy');
}

/** Cache-only reads: a tile that was never loaded is not_cached, never "none". */
async function shelters(ctx) {
  const id = 'shelters';
  const bbox = boxAround(ctx.lat, ctx.lon, 0.3, 0.35);
  const { docs, collection } = await readLayer(ctx.db, ctx.env, 'shelters', bbox, { now: ctx.now });
  const expected = tilesFor(bbox).length;
  const t = timed(id, collection.hb.fetchedAt ? new Date(collection.hb.fetchedAt) : null, null, ctx.now);
  const found = collection.features.map((f) => ({ ...f.properties, lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] })).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => ({ ...s, d: distanceM(ctx.lat, ctx.lon, s.lat, s.lon) })).filter((s) => s.d <= 80_000).sort((a, b) => a.d - b.d).slice(0, 5);
  const items = found.map((s) => ({ name: s.name, city: s.city, state: s.state, status: s.status, capacity: s.capacity, distanceKm: km(s.d), pets: s.pets, accessible: s.accessible }));
  if (!docs.length) return section(id, 'not_cached', { reason: 'Shelter data for this area is not loaded yet' });
  if (!items.length) {
    return docs.length < expected ? section(id, 'not_cached', { ...t, reason: 'Shelter data for part of this area is not loaded yet', partial: true })
      : section(id, 'none', { ...t, reason: 'No open shelters within 80 km in the cached list' });
  }
  const base = section(id, collection.hb.stale ? 'stale' : 'ok', { ...t, items, ...(docs.length < expected ? { partial: true } : {}), ...(collection.hb.stale ? { reason: 'The cached shelter list is out of date' } : {}) });
  return base;
}

async function declarations(ctx) {
  const id = 'declarations';
  const scope = LAYERS.declarations.scopeKey(ctx.env);
  const geo = ctx.geo;
  if (geo?.state?.abbr && geo.state.abbr !== scope) return section(id, 'not_cached', { reason: `Declarations are loaded only for ${scope}` });
  const { docs, collection } = await readLayer(ctx.db, ctx.env, 'declarations', null, { now: ctx.now });
  if (!docs.length) return section(id, 'not_cached', { reason: 'Disaster declarations are not loaded yet' });
  const fips = geo?.county?.fips;
  const t = timed(id, collection.hb.fetchedAt ? new Date(collection.hb.fetchedAt) : null, null, ctx.now);
  if (!fips) return section(id, 'unknown', { ...t, reason: 'The county is not known' });
  const hit = collection.features.filter((f) => f.properties?.geoid === fips || f.properties?.statewide === true);
  const items = hit.flatMap((f) => (f.properties.declarations || []).map((d) => ({ title: clean(d.title, 100), incidentType: clean(d.incidentType, 40), declaredOn: d.declarationDate ? iso(d.declarationDate) : null, disasterNumber: d.disasterNumber, area: f.properties.statewide ? 'Statewide' : clean(f.properties.area, 80) }))).slice(0, 6);
  const note = 'Declaration areas are not storm or damage boundaries.';
  if (items.length) return section(id, collection.hb.stale ? 'stale' : 'ok', { ...t, note, items });
  return collection.hb.truncated ? section(id, 'unknown', { ...t, note, reason: 'The cached list was cut off, so this county may be missing' }) : section(id, 'none', { ...t, note, reason: 'No declaration in the last two years for this county in the cached list' });
}

async function zones(ctx) {
  const id = 'zones';
  const bbox = boxAround(ctx.lat, ctx.lon, 0.002, 0.002);
  const items = [];
  for (const exercise of ctx.modes) {
    const list = await loadActiveZones(ctx.db, { bbox, exercise, now: ctx.now });
    for (const z of list) if (pointInGeometry([ctx.lon, ctx.lat], z.geometry)) items.push({ id: z.id, type: z.properties.type, name: clean(z.properties.name, 80), endsAt: z.properties.endsAt, exercise });
  }
  const t = { fetchedAt: ctx.now.toISOString(), ageSeconds: 0 };
  return items.length ? section(id, 'ok', { ...t, items }) : section(id, 'none', { ...t, reason: 'Not inside an active operator zone' });
}

/** One read-only risk pass per data mode feeds both the boxes list and the area summary. */
async function nearbyBoxes(ctx) {
  const box = boxAround(ctx.lat, ctx.lon, 0.2, 0.25);
  const devices = [], regions = [];
  let total = 0;
  for (const exercise of ctx.modes) {
    const scope = await loadScopeDevices(ctx.db, { exercise, bbox: box, cap: 200 });
    if (!scope.devices.length) continue;
    const risk = await loadRisk(ctx.db, { deviceIds: scope.devices.map((d) => String(d._id)), exercise, now: ctx.now, env: ctx.env, readOnly: true });
    for (const a of risk.assessments) {
      if (!a.location) continue;
      const d = distanceM(ctx.lat, ctx.lon, a.location[1], a.location[0]);
      if (d > 10_000) continue;
      total++;
      const seen = a.lastSeen ? new Date(a.lastSeen).getTime() : null;
      devices.push({
        id: a.deviceId, label: clean(a.name, 60) || 'Safe Home box', distanceM: Math.round(d / 10) * 10, tier: a.status, priority: a.priority.tier,
        status: a.offline ? 'offline' : 'online', lastSeenAgeS: seen === null ? null : Math.max(0, Math.round((ctx.now.getTime() - seen) / 1000)),
        lastKnown: a.reasons.some((r) => r.evidence.some((e) => e.stale)), exercise,
      });
    }
    for (const r of risk.regions) {
      if (!inBbox([ctx.lon, ctx.lat], r.bbox)) continue;
      regions.push({ key: r.key, deviceCount: r.deviceCount, counts: r.counts, priority: r.priority, hotspot: r.hotspot, outage: r.outage, offlineShare: r.offlineShare, notes: r.correlations.map((c) => c.text), exercise });
    }
  }
  devices.sort((a, b) => a.distanceM - b.distanceM);
  const stamp = { fetchedAt: ctx.now.toISOString(), ageSeconds: 0 };
  return {
    devices: devices.length ? section('devices', 'ok', { ...stamp, total, items: devices.slice(0, 10) }) : section('devices', 'none', { ...stamp, reason: 'No Safe Home boxes within 10 km' }),
    regionalRisk: regions.length ? section('regionalRisk', 'ok', { ...stamp, items: regions }) : section('regionalRisk', 'none', { ...stamp, note: 'No regional summary (fewer than 3 boxes)' }),
  };
}

// ---------- plain-language summary ----------
const TIER_TEXT = { critical: 'critical', elevated: 'elevated', watch: 'watch', normal: 'normal', unknown: 'unknown' };
export function buildStandsOut(sections, { tz, now }) {
  const out = [];
  const add = (text, sectionId, severity = 'info') => out.push({ text, sectionId, severity });
  const age = (s) => ageText(s.ageSeconds);
  const a = sections.alerts;
  if (a?.status === 'ok' || a?.status === 'stale') {
    for (const x of a.items.slice(0, 3)) {
      const until = x.ends ? clock(x.ends, tz, now) : null;
      add(`${x.event} active${until ? ` until ${until}` : ''} (NWS, ${age(a)})`, 'alerts', ['Extreme', 'Severe'].includes(x.severity) ? 'warning' : x.severity === 'Moderate' ? 'watch' : 'info');
    }
  } else if (a?.status === 'none') add(`No active NWS alerts at this point (${age(a)})`, 'alerts');
  const f = sections.floodZone?.items?.[0];
  if (f && (f.risk === 'high' || f.risk === 'moderate')) add(`This spot is in a FEMA ${f.risk === 'high' ? 'high' : 'moderate'} risk flood zone, ${f.zone || 'zone unnamed'} (map designation, not current flooding)`, 'floodZone', f.risk === 'high' ? 'watch' : 'info');
  const rain = sections.forecast?.rain;
  if (rain && rain.level !== 'none') add(`${rain.level === 'heavy' ? 'Heavy' : 'Moderate'} rain in the forecast: about ${rain.totalMm} mm in 24 hours (Open-Meteo model)`, 'forecast', rain.level === 'heavy' ? 'watch' : 'info');
  const q = sections.quakes?.items?.find((x) => x.magnitude >= 2.5 && x.distanceKm <= 100);
  if (q) add(`Magnitude ${q.magnitude} earthquake ${Math.round(q.distanceKm)} km away (USGS, ${age(sections.quakes)})`, 'quakes', q.magnitude >= 4.5 ? 'watch' : 'info');
  const fire = sections.fires?.items?.find((x) => x.distanceKm <= 25);
  if (fire) add(`Satellite heat detection ${Math.round(fire.distanceKm)} km away (NASA FIRMS, ${age(sections.fires)})`, 'fires', 'watch');
  const aq = (sections.airQuality?.items || []).reduce((m, x) => (x.aqi > (m?.aqi ?? -1) ? x : m), null);
  if (aq && aq.aqi >= 101) add(`Air quality index ${aq.aqi}${aq.category ? ` (${aq.category})` : ''} for ${aq.area || 'the reporting area'} (AirNow)`, 'airQuality', aq.aqi >= 151 ? 'warning' : 'watch');
  const z = sections.zones?.items?.[0];
  if (z) add(`Inside an operator ${String(z.type).replace(/_/g, ' ')} zone${z.exercise ? ' (exercise)' : ''}`, 'zones', 'watch');
  for (const exercise of [false, true]) {
    const hot = (sections.devices?.items || []).filter((d) => d.exercise === exercise && ['critical', 'elevated'].includes(d.tier));
    if (hot.length) add(`${exercise ? 'Exercise: ' : ''}${hot.length} Safe Home ${hot.length === 1 ? 'box' : 'boxes'} nearby ${hot.length === 1 ? 'reports' : 'report'} critical or elevated conditions (Safe Home, ${hot.some((d) => d.lastKnown) ? 'includes last known readings' : 'current'})`, 'devices', hot.some((d) => d.tier === 'critical') ? 'warning' : 'watch');
  }
  const r = sections.regionalRisk?.items?.find((x) => x.hotspot?.is);
  if (r) add(`${r.exercise ? 'Exercise: ' : ''}Area summary: ${r.priority.label} across ${r.deviceCount} boxes`, 'regionalRisk', 'watch');
  const d = sections.declarations?.items?.[0];
  if (d) add(`Federal disaster declaration on record for this county: ${d.title}`, 'declarations');
  const s = sections.shelters?.items?.[0];
  if (s) add(`Nearest open shelter in the cached list: ${s.name}, ${Math.round(s.distanceKm)} km (FEMA, ${age(sections.shelters)})`, 'shelters');
  const weight = { warning: 0, watch: 1, info: 2 };
  return out.sort((x, y) => weight[x.severity] - weight[y.severity]).slice(0, 8);
}

export function buildLimits(sections) {
  const out = [];
  for (const [id, s] of Object.entries(sections)) {
    const t = TITLES[id];
    if (s.status === 'not_cached') out.push(`${t} not loaded yet`);
    else if (s.status === 'needs_key') out.push(`${t}: ${s.reason.toLowerCase()}`);
    else if (s.status === 'unknown') out.push(`${t} unknown${s.reason ? `. ${s.reason}` : ''}`);
    else if (s.status === 'error') out.push(`${t} source unavailable`);
    else if (s.status === 'stale') out.push(`${t} out of date`);
  }
  out.push('Public data describes the area. It does not describe conditions inside any building.');
  return out;
}

// ---------- main ----------
export async function getPlace(db, { lat, lon, demo = false, exerciseOnly = false, liveOnly = false, env = {}, fetcher, now = new Date() } = {}) {
  const started = Date.now();
  const exerciseOnlyMode = demo || exerciseOnly;
  const modes = exerciseOnlyMode ? [true] : liveOnly ? [false] : [false, true];
  let upstreamTouched = null;
  const ctx = {
    db, env, now, lat, lon, modes, fetcher: fetcher || ((...a) => globalThis.fetch(...a)),
    touchUpstream: () => (upstreamTouched ||= bump(db, 'place:global', now).catch(() => 0)),
  };
  const memo = (fn) => { let p; return () => { if (!p) { p = fn(ctx); p.catch(() => {}); } return p; }; };
  ctx.nwsPoint = memo(loadNwsPoint);
  ctx.openMeteo = memo(loadOpenMeteo);
  await ensurePlaceIndexes(db);
  await ensureFeedIndexes(db).catch(() => {});

  // Place first: it also tells us whether the point is in the United States at all.
  let geoRes = null;
  try { geoRes = await Promise.race([loadCensus(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2800).unref?.())]); } catch { /* name falls back below */ }
  if (geoRes?.value?.none) throw new HttpError(422, 'That point is not in the lower 48 states.');
  ctx.geo = geoRes?.value || null;

  const budget = () => Math.max(500, Math.min(LIMITS.sectionMs, LIMITS.totalMs - (Date.now() - started)));
  const run = async (id, fn) => {
    let timer;
    try {
      return await Promise.race([fn(ctx), new Promise((_, rej) => { timer = setTimeout(() => rej(new UpstreamError('The source took too long to answer.')), budget()); })]);
    } catch (e) {
      return section(id, 'error', { reason: e instanceof UpstreamError ? e.reason : 'Source unavailable' });
    } finally { clearTimeout(timer); }
  };
  const boxes = run('devices', nearbyBoxes);
  const entries = await Promise.all([
    ['weatherNow', weatherNow], ['forecast', forecast], ['alerts', alerts], ['floodZone', floodZone], ['gauges', gauges], ['riverForecast', riverForecast], ['tides', tides],
    ['quakes', quakes], ['fires', fires], ['airQuality', airQuality], ['shelters', shelters], ['declarations', declarations], ['zones', zones],
  ].map(async ([id, fn]) => [id, await run(id, fn)]));
  const nb = await boxes;
  const sections = Object.fromEntries(entries);
  if (nb.status === 'error') { sections.devices = nb; sections.regionalRisk = section('regionalRisk', 'error', { reason: nb.reason }); }
  else { sections.devices = nb.devices; sections.regionalRisk = nb.regionalRisk; }
  const ordered = Object.fromEntries(SECTION_IDS.map((id) => [id, sections[id]]));

  const pt = ctx.nwsPoint ? await ctx.nwsPoint().then((r) => r.value, () => null) : null;
  const om = await ctx.openMeteo().then((r) => r.value, () => null);
  const tz = pt && !pt.none ? pt.timeZone : null;
  const name = ctx.geo?.city || ctx.geo?.county?.name || (pt && !pt.none && pt.city ? `Near ${pt.city}` : 'Unnamed place');
  return {
    asOf: now.toISOString(), query: { lat, lon }, mode: exerciseOnlyMode ? 'exercise' : 'live',
    place: {
      name, county: ctx.geo?.county?.name || null, countyFips: ctx.geo?.county?.fips || null, state: ctx.geo?.state?.abbr || (pt && !pt.none ? pt.state : null) || null,
      timeZone: tz || null, elevationM: om?.elevationM ?? null, source: [ctx.geo ? 'US Census' : null, om?.elevationM != null ? 'Open-Meteo' : null].filter(Boolean).join(', ') || 'unknown',
    },
    sections: ordered, standsOut: buildStandsOut(ordered, { tz, now }), limits: buildLimits(ordered), advisory: ADVISORY,
  };
}

// ---------- HTTP ----------
function parseCoord(raw, name, min, max) {
  if (raw === null || raw === '') throw new HttpError(400, `${name} is required`);
  if (!/^-?\d{1,3}(\.\d{1,5})?$/.test(raw)) throw new HttpError(400, `${name} must be a number with at most 5 decimals`);
  const v = Number(raw);
  if (v < min || v > max) throw new HttpError(400, `${name} is out of range`);
  return v;
}
function fail(err) {
  if (err instanceof HttpError) {
    const res = json({ error: err.message }, err.status);
    if (err.status === 429) res.headers.set('Retry-After', '60');
    return res;
  }
  const down = /Mongo|ECONNREFUSED|ETIMEDOUT|Server selection/i.test(`${err?.name} ${err?.message}`);
  console.error('Place lookup failed', err?.name);
  return json({ error: down ? 'Database unavailable' : 'Internal error' }, down ? 503 : 500);
}

export async function opsPlace(ctx) {
  try {
    if (ctx.request.method !== 'GET') throw new HttpError(405, `Method ${ctx.request.method} not allowed`);
    const url = new URL(ctx.request.url);
    const auth = opsAuth(ctx, url);
    const lat = parseCoord(url.searchParams.get('lat'), 'lat', -90, 90);
    const lon = parseCoord(url.searchParams.get('lon'), 'lon', -180, 180);
    if (!inConus(lat, lon)) throw new HttpError(422, 'That point is not in the lower 48 states.');
    const now = ctx.now || new Date();
    const mode = url.searchParams.get('mode');
    return await withDb(ctx.env || {}, ctx.injectedDb, async (db) => {
      await ensurePlaceIndexes(db);
      if (await bump(db, `place:actor:${auth.actor}`, now) > LIMITS.perActorPerMin) throw new HttpError(429, 'Too many place lookups. Try again in a minute.');
      const g = await db.collection('place_limits').findOne({ _id: bucketKey('place:global', now) });
      if ((g?.count || 0) >= LIMITS.globalPerMin) throw new HttpError(429, 'Place lookups are busy. Try again in a minute.');
      const body = await getPlace(db, { lat, lon, demo: auth.demo, exerciseOnly: mode === 'exercise', liveOnly: mode === 'live', env: ctx.env || {}, fetcher: ctx.fetcher, now });
      return json(body);
    });
  } catch (e) { return fail(e); }
}
