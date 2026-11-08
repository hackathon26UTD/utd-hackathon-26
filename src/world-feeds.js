// Independent map context. Never used as precipitation or household risk evidence.
import { FeedError } from './feed-error.js';

export const ATMOSPHERE_URL = 'https://api.open-meteo.com/v1/forecast';
export const FAULTS_URL = 'https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer/21';
export const FAULT_PAGE_SIZE = 200;
export const FAULT_MAX_PAGES = 2;
const FAULT_MAX_POSITIONS = 20000;

// Deliberate request locations, NOT stations or statewide measurements. Keep IDs stable.
// 48 lower-48 capitals plus 12 additional metropolitan/regional locations.
export const ATMOSPHERE_SAMPLES = Object.freeze([
  ['AL', 'Montgomery', -86.30, 32.37], ['AZ', 'Phoenix', -112.07, 33.45],
  ['AR', 'Little Rock', -92.29, 34.75], ['CA', 'Sacramento', -121.49, 38.58],
  ['CO', 'Denver', -104.99, 39.74], ['CT', 'Hartford', -72.68, 41.76],
  ['DE', 'Dover', -75.52, 39.16], ['FL', 'Tallahassee', -84.28, 30.44],
  ['GA', 'Atlanta', -84.39, 33.75], ['ID', 'Boise', -116.20, 43.62],
  ['IL', 'Springfield', -89.65, 39.80], ['IN', 'Indianapolis', -86.16, 39.77],
  ['IA', 'Des Moines', -93.62, 41.59], ['KS', 'Topeka', -95.68, 39.05],
  ['KY', 'Frankfort', -84.87, 38.20], ['LA', 'Baton Rouge', -91.19, 30.45],
  ['ME', 'Augusta', -69.78, 44.31], ['MD', 'Annapolis', -76.49, 38.98],
  ['MA', 'Boston', -71.06, 42.36], ['MI', 'Lansing', -84.56, 42.73],
  ['MN', 'Saint Paul', -93.09, 44.95], ['MS', 'Jackson', -90.18, 32.30],
  ['MO', 'Jefferson City', -92.17, 38.58], ['MT', 'Helena', -112.04, 46.59],
  ['NE', 'Lincoln', -96.68, 40.81], ['NV', 'Carson City', -119.77, 39.16],
  ['NH', 'Concord', -71.54, 43.21], ['NJ', 'Trenton', -74.76, 40.22],
  ['NM', 'Santa Fe', -105.94, 35.69], ['NY', 'Albany', -73.76, 42.65],
  ['NC', 'Raleigh', -78.64, 35.78], ['ND', 'Bismarck', -100.78, 46.81],
  ['OH', 'Columbus', -83.00, 39.96], ['OK', 'Oklahoma City', -97.52, 35.47],
  ['OR', 'Salem', -123.04, 44.94], ['PA', 'Harrisburg', -76.89, 40.27],
  ['RI', 'Providence', -71.41, 41.82], ['SC', 'Columbia', -81.03, 34.00],
  ['SD', 'Pierre', -100.35, 44.37], ['TN', 'Nashville', -86.78, 36.16],
  ['TX', 'Austin', -97.74, 30.27], ['UT', 'Salt Lake City', -111.89, 40.76],
  ['VT', 'Montpelier', -72.58, 44.26], ['VA', 'Richmond', -77.44, 37.54],
  ['WA', 'Olympia', -122.90, 47.04], ['WV', 'Charleston', -81.63, 38.35],
  ['WI', 'Madison', -89.40, 43.07], ['WY', 'Cheyenne', -104.82, 41.14],
  ['DFW', 'Dallas–Fort Worth', -96.80, 32.78], ['HOU', 'Houston', -95.37, 29.76],
  ['LAX', 'Los Angeles', -118.24, 34.05], ['SFO', 'San Francisco', -122.42, 37.77],
  ['SAN', 'San Diego', -117.16, 32.72], ['MIA', 'Miami', -80.19, 25.76],
  ['JAX', 'Jacksonville', -81.66, 30.33], ['NYC', 'New York City', -74.01, 40.71],
  ['CHI', 'Chicago', -87.63, 41.88], ['SEA', 'Seattle', -122.33, 47.61],
  ['MCI', 'Kansas City', -94.58, 39.10], ['BIL', 'Billings', -108.50, 45.78],
].map(([id, name, lng, lat]) => Object.freeze({ id, name, lng, lat })));

const VARIABLES = {
  wind_kph: ['wind_speed_10m', 'km/h', 0, Infinity],
  wind_direction: ['wind_direction_10m', '°', 0, 360],
  solar_wm2: ['shortwave_radiation', 'W/m²', 0, Infinity],
  uv_index: ['uv_index', '', 0, Infinity],
  temperature_c: ['temperature_2m', '°C', -273.15, Infinity],
};
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clean = (v, max = 200) => typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null;
const position = (p) => Array.isArray(p) && p.length === 2 && p.every(finite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const badAtmosphere = () => new FeedError(502, 'Atmosphere source sent invalid coordinates, units, time or data.');

export function atmosphereRequestUrl() {
  const q = new URLSearchParams({
    latitude: ATMOSPHERE_SAMPLES.map(s => s.lat).join(','),
    longitude: ATMOSPHERE_SAMPLES.map(s => s.lng).join(','),
    hourly: Object.values(VARIABLES).map(v => v[0]).join(','),
    forecast_hours: '1', timezone: 'GMT', timeformat: 'unixtime',
    wind_speed_unit: 'kmh', temperature_unit: 'celsius',
  });
  return `${ATMOSPHERE_URL}?${q}`;
}

export function parseAtmosphere(json, samples = ATMOSPHERE_SAMPLES, now = new Date()) {
  if (!samples.length || samples.length > ATMOSPHERE_SAMPLES.length || !finite(now.getTime())) throw badAtmosphere();
  const rows = Array.isArray(json) ? json : samples.length === 1 ? [json] : [];
  // Do not shift a missing/reordered row onto an unrelated location.
  if (rows.length !== samples.length) throw badAtmosphere();
  let missingValues = 0;
  const features = rows.map((row, i) => {
    const sample = samples[i], h = row?.hourly, u = row?.hourly_units;
    if (!position([row?.longitude, row?.latitude]) || !position([sample.lng, sample.lat]) ||
        Math.abs(row.longitude - sample.lng) > 0.5 || Math.abs(row.latitude - sample.lat) > 0.5 ||
        (row.location_id !== undefined && row.location_id !== i) || row.utc_offset_seconds !== 0 ||
        u?.time !== 'unixtime' || !Array.isArray(h?.time) || h.time.length !== 1) throw badAtmosphere();
    const seconds = h.time[0];
    // One current hourly model step, never a receipt timestamp or arbitrary stale/future row.
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds * 1000 > now.getTime() ||
        now.getTime() - seconds * 1000 >= 2 * 3600000) throw badAtmosphere();
    const values = {};
    for (const [key, [variable, unit, min, max]] of Object.entries(VARIABLES)) {
      const array = h[variable];
      if (array !== undefined && (!Array.isArray(array) || array.length !== 1)) throw badAtmosphere();
      const value = array?.[0];
      values[key] = u[variable] === unit && finite(value) && value >= min && value <= max ? value : null;
      if (values[key] === null) missingValues++;
    }
    return { type: 'Feature', id: `atmosphere:${sample.id}`, geometry: { type: 'Point', coordinates: [row.longitude, row.latitude] }, properties: {
      ...values, name: sample.name, sampleId: sample.id, requestedLongitude: sample.lng, requestedLatitude: sample.lat,
      source: 'Open-Meteo', sourceUrl: ATMOSPHERE_URL, dataKind: 'model_forecast',
      observedAt: null, validAt: new Date(seconds * 1000).toISOString(), modelRunAt: null,
      windDirectionConvention: 'meteorological_from_degrees', solarIntervalSeconds: 3600,
    } };
  });
  if (missingValues === samples.length * Object.keys(VARIABLES).length) throw badAtmosphere();
  return { features, truncated: missingValues > 0, extra: {
    sampleCount: samples.length, missingValues, dataKind: 'model_forecast',
    units: { wind_kph: 'km/h', wind_direction: 'degrees from true north', solar_wm2: 'W/m²', uv_index: 'dimensionless', temperature_c: '°C' },
    sampling: 'Fixed lower-48 request locations; returned model grid coordinates. No interpolation or area-wide coverage.',
  } };
}

const badFaults = () => new FeedError(502, 'USGS fault source sent unreadable or invalid line data.');
export function parseFaults(json) {
  if (json?.error || json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) throw badFaults();
  // A changed CRS must not be interpreted as longitude/latitude.
  if (json.crs && json.crs?.properties?.name !== 'urn:ogc:def:crs:OGC:1.3:CRS84' && json.crs?.properties?.name !== 'EPSG:4326') throw badFaults();
  const flags = [json.exceededTransferLimit, json.properties?.exceededTransferLimit];
  if (flags.some(f => f !== undefined && typeof f !== 'boolean')) throw badFaults();
  let dropped = 0;
  const features = [];
  for (const f of json.features.slice(0, FAULT_PAGE_SIZE)) {
    const g = f?.geometry, p = f?.properties;
    const lines = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : null;
    if (f?.type !== 'Feature' || !p || !Number.isSafeInteger(p.OBJECTID) || p.OBJECTID < 0 ||
        !Array.isArray(lines) || !lines.length || lines.some(line => !Array.isArray(line) || line.length < 2 || !line.every(position))) throw badFaults();
    if (lines.reduce((n, line) => n + line.length, 0) > FAULT_MAX_POSITIONS) { dropped++; continue; }
    features.push({ type: 'Feature', id: `usgs-fault:${p.OBJECTID}`, geometry: { type: g.type, coordinates: g.coordinates }, properties: {
      name: clean(p.fault_name), section: clean(p.section_name), faultId: clean(p.fault_id, 40),
      age: clean(p.age, 100), slipRate: clean(p.slip_rate, 100),
      source: 'USGS Quaternary Fault and Fold Database', sourceUrl: FAULTS_URL,
      dataKind: 'geological', observedAt: null,
    } });
  }
  if (json.features.length && !features.length) throw badFaults();
  // Full pages are conservatively followed even if ArcGIS omits its transfer flag.
  const hasMore = flags.includes(true) || json.features.length >= FAULT_PAGE_SIZE;
  return { features, hasMore, truncated: hasMore || dropped > 0, dropped };
}

async function fetchFaultTile(tile, { get }) {
  const b = tile.bbox;
  if (!Array.isArray(b) || b.length !== 4 || !position(b.slice(0, 2)) || !position(b.slice(2)) ||
      b[0] >= b[2] || b[1] >= b[3] || b[2] - b[0] > 0.25 || b[3] - b[1] > 0.25) throw new FeedError(400, 'Fault queries require a bounded 0.25 degree tile.');
  const features = [], seen = new Set();
  let hasMore = false, dropped = 0, repeated = false;
  for (let page = 0; page < FAULT_MAX_PAGES; page++) {
    const q = new URLSearchParams({ where: '1=1', geometry: b.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,fault_name,section_name,fault_id,age,slip_rate', outSR: '4326',
      resultRecordCount: String(FAULT_PAGE_SIZE), resultOffset: String(page * FAULT_PAGE_SIZE), orderByFields: 'OBJECTID ASC',
      maxAllowableOffset: '0.001', f: 'geojson' });
    const result = parseFaults(await get(`${FAULTS_URL}/query?${q}`));
    for (const f of result.features) {
      if (seen.has(f.id)) { repeated = true; continue; }
      seen.add(f.id); features.push(f);
    }
    dropped += result.dropped;
    hasMore = result.hasMore;
    if (!hasMore || repeated) break;
  }
  return { features, truncated: hasMore || dropped > 0 || repeated };
}

async function fetchFaults(tiles, ctx) {
  if (tiles.length > 16) throw new FeedError(400, 'Too many fault tiles requested.');
  const result = new Map();
  // At most four concurrent upstream requests and two pages per tile.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, tiles.length) }, async () => {
    while (next < tiles.length) {
      const tile = tiles[next++];
      try { result.set(tile.key, await fetchFaultTile(tile, ctx)); }
      catch (err) { result.set(tile.key, err); }
    }
  }));
  return result;
}

export const WORLD_LAYERS = {
  atmosphere: { id: 'atmosphere', name: 'Sampled atmosphere forecast', scope: 'all', scopeKey: () => 'conus-samples-v1', ttlS: 1800, minZoom: 3,
    attribution: 'Open-Meteo.com (CC BY 4.0)',
    coverage: { type: 'sampled-national', area: '60 selected lower-48 locations', sampleCount: 60 },
    note: 'Sparse model forecast points, not observations or continuous coverage. Valid time is validAt; observedAt is null. Solar is the preceding-hour mean. Wind direction is where wind comes from.',
    async fetchMany(tiles, { get, now }) {
      const result = parseAtmosphere(await get(atmosphereRequestUrl()), ATMOSPHERE_SAMPLES, now);
      return new Map(tiles.map(t => [t.key, result]));
    } },
  faults: { id: 'faults', name: 'USGS geological fault traces', scope: 'tile', ttlS: 86400, maxSpan: 0.75, maxTiles: 16, minZoom: 10,
    attribution: 'USGS Quaternary Fault and Fold Database',
    coverage: { type: 'requested-area', area: 'USGS mapped US faults in up to 16 quarter-degree tiles; maximum view span 0.75 degrees', maxSpanDeg: 0.75, maxTiles: 16 },
    note: 'Geological traces, not earthquake predictions or current movement. Zoom in; age is the supplied deformation-age category. Empty coverage is not proof of no faults. Geometry simplified to 0.001 degrees.',
    fetchMany: fetchFaults },
};
