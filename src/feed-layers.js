import { EXTRA_LAYERS } from './extra-feeds.js';
// External layer definitions: where each public feed lives, how it is cached and how it is parsed.
// Parsers are pure so tests can feed them saved samples. Network goes through the injected `get`.
import { FeedError } from './feed-error.js';
import { geohashCenter } from './feed-geo.js';

const ARCGIS_LIMIT = 500;
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
export const RAIN = { heavyPeakMmph: 7.6, heavy24hMm: 50, moderatePeakMmph: 2.5, moderate24hMm: 12.7 };

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v, max = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null);
const point = (lng, lat, properties, id) => ({ type: 'Feature', ...(id !== undefined ? { id } : {}), geometry: { type: 'Point', coordinates: [lng, lat] }, properties });
const state = (env) => (/^[A-Za-z]{2}$/.test(env.FEEDS_STATE || '') ? env.FEEDS_STATE.toUpperCase() : 'TX');
const nwsScope = (env) => env.NWS_SCOPE === 'national' ? 'US' : state(env);
const envelope = (b) => b.join(',');

export function feedMetadata(layer, env = {}) {
  const area = layer.scopeKey?.(env);
  const type = ['nws', 'declarations'].includes(layer.id) ? (area === 'US' ? 'national' : 'state')
    : layer.id === 'eia' ? 'balancing-authority' : layer.scope === 'all' ? 'global' : 'requested-area';
  return { coverage: { type, area: area || (type === 'global' ? 'world' : 'bounded map tiles') }, note: layer.note || 'Geographic context does not establish conditions at an individual home.' };
}

// ---------- parsers ----------
export function parseNws(json) {
  if (!Array.isArray(json?.features)) throw new FeedError(502, 'Weather alerts feed sent unreadable data.');
  const features = json.features.filter(f => f && typeof f === 'object').map((f) => ({
    type: 'Feature',
    id: f.id,
    geometry: f.geometry || null,
    properties: {
      event: text(f.properties?.event, 80),
      severity: text(f.properties?.severity, 20),
      urgency: text(f.properties?.urgency, 20),
      headline: text(f.properties?.headline, 200),
      areaDesc: text(f.properties?.areaDesc, 300),
      sent: f.properties?.sent || null,
      expires: f.properties?.expires || f.properties?.ends || null,
      description: text(f.properties?.description, 400),
    },
  }));
  return { features, truncated: Boolean(json.pagination?.next) };
}

export function parseGauges(json) {
  const bySite = new Map();
  for (const series of json?.value?.timeSeries || []) {
    const site = series.sourceInfo?.siteCode?.[0]?.value;
    const loc = series.sourceInfo?.geoLocation?.geogLocation;
    const noData = Number(series.variable?.noDataValue);
    const values = (series.values?.[0]?.value || []).filter((v) => Number(v.value) !== noData && Number.isFinite(Number(v.value)));
    const last = values[values.length - 1];
    if (!site || !last || !Number.isFinite(loc?.longitude) || !Number.isFinite(loc?.latitude)) continue;
    bySite.set(site, point(loc.longitude, loc.latitude, { site, name: text(series.sourceInfo.siteName, 120), stage: Number(last.value), unit: series.variable?.unit?.unitCode || 'ft', observedAt: last.dateTime }, site));
  }
  return { features: [...bySite.values()] };
}

export function parseQuakes(json) {
  const features = (json?.features || [])
    .filter((f) => Array.isArray(f.geometry?.coordinates))
    .map((f) => point(f.geometry.coordinates[0], f.geometry.coordinates[1], { mag: num(f.properties?.mag), place: text(f.properties?.place, 120), time: num(f.properties?.time), url: typeof f.properties?.url === 'string' && f.properties.url.startsWith('https://') ? f.properties.url : null }, f.id));
  return { features };
}

export function parseFirms(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  const head = lines[0].split(',');
  if (!head.includes('latitude') || !head.includes('longitude')) throw new FeedError(502, 'Fire feed sent unreadable data.');
  const at = (name) => head.indexOf(name);
  const features = [];
  for (const line of lines.slice(1, 3001)) {
    const c = line.split(',');
    const lat = num(c[at('latitude')]), lng = num(c[at('longitude')]);
    if (lat === null || lng === null) continue;
    features.push(point(lng, lat, { acqDate: c[at('acq_date')] || null, acqTime: c[at('acq_time')] || null, confidence: c[at('confidence')] || null, frp: num(c[at('frp')]), satellite: c[at('satellite')] || null, daynight: c[at('daynight')] || null }));
  }
  return { features, truncated: lines.length > 3001 };
}

export function parseAirnow(json) {
  if (!Array.isArray(json)) throw new FeedError(502, 'Air quality feed sent unreadable data.');
  const features = json
    .filter((o) => Number.isFinite(o.Latitude) && Number.isFinite(o.Longitude))
    .map((o) => point(o.Longitude, o.Latitude, { area: text(o.ReportingArea, 80), parameter: text(o.ParameterName, 20), aqi: num(o.AQI), category: text(o.Category?.Name, 40), observedOn: text(o.DateObserved, 12), hour: num(o.HourObserved) }));
  return { features };
}

export function parseEia(json) {
  const rows = json?.response?.data;
  if (!Array.isArray(rows)) throw new FeedError(502, 'Grid feed sent unreadable data.');
  return { features: [], extra: { metric: 'electricity_demand', outageData: false,
    note: 'Hourly balancing-authority demand is not a count or map of household power outages.',
    series: rows.slice(0, 48).map((r) => ({ period: text(r.period, 30), region: text(r.respondent, 12), value: num(r.value), unit: text(r['value-units'], 40) || 'megawatthours' })) } };
}

export function parseArcgis(json, pick) {
  const raw = json?.features || [];
  const features = raw.map((f) => ({ type: 'Feature', id: f.id ?? f.properties?.OBJECTID ?? f.properties?.objectid, geometry: f.geometry, properties: pick(f.properties || {}) }));
  return { features, truncated: Boolean(json?.exceededTransferLimit || json?.properties?.exceededTransferLimit || raw.length >= ARCGIS_LIMIT) };
}

export const pickNfhl = (p) => ({ FLD_ZONE: text(p.FLD_ZONE, 20), SFHA_TF: text(p.SFHA_TF, 5), ZONE_SUBTY: text(p.ZONE_SUBTY, 80) });
export const pickShelter = (p) => ({ name: text(p.shelter_name, 120), address: text(p.address, 120), city: text(p.city, 60), state: text(p.state, 2), zip: text(p.zip, 10), status: text(p.shelter_status, 20), capacity: num(p.evacuation_capacity), population: num(p.total_population), pets: text(p.pet_accommodations_code, 40), accessible: text(p.wheelchair_accessible, 20), org: text(p.org_name, 80) });

export function rainLevel(peak, total) {
  if (peak >= RAIN.heavyPeakMmph || total >= RAIN.heavy24hMm) return 'heavy';
  if (peak >= RAIN.moderatePeakMmph || total >= RAIN.moderate24hMm) return 'moderate';
  return 'none';
}

// Open-Meteo returns one object for one location and an array for several.
export function parseOpenMeteo(json, cells) {
  const list = Array.isArray(json) ? json : [json];
  const out = new Map();
  cells.forEach((cell, i) => {
    const hourly = list[i]?.hourly?.precipitation;
    const vals = Array.isArray(hourly) ? hourly.filter((v) => Number.isFinite(v)) : [];
    if (!vals.length) return;
    const total = vals.reduce((a, b) => a + b, 0), peak = Math.max(...vals);
    const [lng, lat] = geohashCenter(cell);
    out.set(cell, { features: [point(lng, lat, { gh5: cell, precip24h_mm: Math.round(total * 10) / 10, peak_mmph: Math.round(peak * 10) / 10, level: rainLevel(peak, total), hours: vals.length })] });
  });
  return out;
}

// ---------- fetchers ----------
// Run one request per tile; a failed tile becomes an Error value so other tiles still count.
const perTile = (fn) => async (tiles, ctx) => {
  const settled = await Promise.allSettled(tiles.map((t) => fn(t, ctx)));
  return new Map(tiles.map((t, i) => [t.key, settled[i].status === 'fulfilled' ? settled[i].value : settled[i].reason]));
};
const single = (fn) => async (tiles, ctx) => new Map([[tiles[0].key, await fn(tiles[0], ctx)]]);
// ArcGIS caps one answer at 500 features, so dense layers read a few pages (resultOffset) per tile.
const arcgis = (base, fields, pick, { extra = {}, pages = 1 } = {}) => perTile(async (tile, { get }) => {
  const features = [];
  let truncated = false;
  for (let page = 0; page < pages; page++) {
    const q = new URLSearchParams({ where: '1=1', geometry: envelope(tile.bbox), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: fields, outSR: '4326', resultRecordCount: String(ARCGIS_LIMIT), resultOffset: String(page * ARCGIS_LIMIT), f: 'geojson', ...extra });
    const got = parseArcgis(await get(`${base}/query?${q}`), pick);
    features.push(...got.features);
    truncated = got.truncated;
    if (!got.truncated) break;
  }
  return { features, truncated };
});

async function fetchDeclarations(tiles, { env, get, now }) {
  const st = state(env);
  const since = new Date(now.getTime() - 730 * 86400000).toISOString().slice(0, 10);
  const filter = `state eq '${st}' and declarationDate ge '${since}T00:00:00.000z'`;
  const select = 'disasterNumber,declarationTitle,incidentType,declarationDate,fipsStateCode,fipsCountyCode,designatedArea,declarationType';
  const json = await get(`https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=${encodeURIComponent(filter)}&$orderby=${encodeURIComponent('declarationDate desc')}&$top=400&$select=${select}`);
  const rows = json?.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) throw new FeedError(502, 'Declarations feed sent unreadable data.');
  const counties = new Map();
  for (const r of rows) {
    const geoid = `${r.fipsStateCode}${r.fipsCountyCode}`;
    if (!/^\d{5}$/.test(geoid)) continue;
    if (!counties.has(geoid)) counties.set(geoid, { geoid, statewide: r.fipsCountyCode === '000', area: text(r.designatedArea, 80), state: st, declarations: [] });
    const c = counties.get(geoid);
    if (c.declarations.length < 5) c.declarations.push({ disasterNumber: r.disasterNumber, title: text(r.declarationTitle, 100), incidentType: text(r.incidentType, 40), declarationDate: r.declarationDate, declarationType: text(r.declarationType, 4) });
  }
  const shapes = new Map();
  const named = [...counties.values()].filter((c) => !c.statewide);
  if (named.length) {
    try {
      const fips = rows[0].fipsStateCode;
      const where = `STATE='${fips}' AND COUNTY IN (${named.map((c) => `'${c.geoid.slice(2)}'`).join(',')})`;
      const q = new URLSearchParams({ where, outFields: 'GEOID,NAME', outSR: '4326', maxAllowableOffset: '0.01', f: 'geojson' });
      const geo = await get(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query?${q}`);
      for (const f of geo.features || []) shapes.set(f.properties?.GEOID, f.geometry);
    } catch { /* keep the list even when county outlines are unavailable */ }
  }
  const features = [...counties.values()].map((c) => ({ type: 'Feature', id: c.geoid, geometry: shapes.get(c.geoid) || null, properties: { geoid: c.geoid, area: c.area, state: c.state, statewide: c.statewide, declarationTitle: c.declarations[0].title, incidentType: c.declarations[0].incidentType, declarationDate: c.declarations[0].declarationDate, latest: c.declarations[0], declarations: c.declarations } }));
  return new Map([[tiles[0].key, { features, truncated: rows.length >= 400, extra: { outlines: shapes.size === named.length } }]]);
}

async function fetchWeather(tiles, { get }) {
  const cells = tiles.map((t) => t.key.slice(4));
  const centers = cells.map(geohashCenter);
  const q = `latitude=${centers.map((c) => c[1].toFixed(4)).join(',')}&longitude=${centers.map((c) => c[0].toFixed(4)).join(',')}&hourly=precipitation&forecast_hours=24&timezone=UTC`;
  const parsed = parseOpenMeteo(await get(`${OPEN_METEO}?${q}`), cells);
  return new Map(tiles.map((t) => [t.key, parsed.get(t.key.slice(4)) || new FeedError(502, 'No rain data for this cell.')]));
}

const keyOf = (env, name) => env[name] || '';

// scope: 'tile' = 0.25 degree grid, 'cell' = geohash5 cell, 'all' = one document per scopeKey.
export const LAYERS = {
  ...EXTRA_LAYERS,
  nfhl: { id: 'nfhl', name: 'FEMA flood hazard zones', scope: 'tile', ttlS: 86400, maxSpan: 0.75, maxTiles: 16, minZoom: 11, attribution: 'FEMA National Flood Hazard Layer',
    fetchMany: arcgis('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28', 'FLD_ZONE,SFHA_TF,ZONE_SUBTY,OBJECTID', pickNfhl, { extra: { maxAllowableOffset: '0.0002' }, pages: 4 }) },
  declarations: { id: 'declarations', name: 'FEMA disaster declarations', scope: 'all', scopeKey: (env) => state(env), ttlS: 86400, attribution: 'OpenFEMA and US Census TIGERweb',
    note: 'State declarations from the last two years, capped at 400 records. Declaration areas are not current storm or damage boundaries.', fetchMany: fetchDeclarations },
  nws: { id: 'nws', name: 'National Weather Service alerts', scope: 'all', scopeKey: nwsScope, ttlS: 120, attribution: 'National Weather Service',
    note: 'Active alerts for the configured scope. Alerts without supplied polygons remain in the list; absence of a polygon is not an all-clear.',
    fetchMany: single(async (t, { get, env }) => parseNws(await get(`https://api.weather.gov/alerts/active${nwsScope(env) === 'US' ? '' : `?area=${state(env)}`}`))),
    postFilter: (features, now) => features.filter((f) => !f.properties?.expires || new Date(f.properties.expires) > now) },
  gauges: { id: 'gauges', name: 'USGS river gauges', scope: 'tile', ttlS: 600, maxTiles: 25, attribution: 'USGS National Water Information System',
    note: 'River stage measurements have station-specific datums; they do not establish water depth or flooding at a home.',
    fetchMany: perTile(async (t, { get }) => parseGauges(await get(`https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${envelope(t.bbox.map((v) => v.toFixed(4)))}&parameterCd=00065&siteStatus=active`))) },
  quakes: { id: 'quakes', name: 'USGS earthquakes, last day', scope: 'all', ttlS: 300, attribution: 'USGS Earthquake Hazards Program',
    fetchMany: single(async (t, { get }) => parseQuakes(await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'))) },
  weather: { id: 'weather', name: 'Forecast rain, next 24 hours', scope: 'cell', ttlS: 1800, maxTiles: 25, attribution: 'Open-Meteo.com', note: 'Forecast precipitation at sampled cell centers, not observed water at a home.', fetchMany: fetchWeather },
  shelters: { id: 'shelters', name: 'FEMA open shelters', scope: 'tile', ttlS: 600, maxTiles: 25, attribution: 'FEMA ESF6-SS (National Shelter System)',
    fetchMany: arcgis('https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/FeatureServer/0', 'shelter_name,address,city,state,zip,shelter_status,evacuation_capacity,total_population,pet_accommodations_code,wheelchair_accessible,org_name', pickShelter) },
  firms: { id: 'firms', name: 'NASA satellite fire detections, last day', scope: 'tile', ttlS: 900, maxTiles: 25, keyEnv: 'FIRMS_MAP_KEY', attribution: 'NASA FIRMS',
    note: 'Satellite thermal detections are context; they are not fire perimeters or confirmation that a home is burning.',
    fetchMany: perTile(async (t, { get, env }) => parseFirms(await get(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(keyOf(env, 'FIRMS_MAP_KEY'))}/VIIRS_NOAA20_NRT/${envelope(t.bbox)}/1`, { as: 'text' }))) },
  airnow: { id: 'airnow', name: 'AirNow air quality', scope: 'tile', ttlS: 1800, maxTiles: 25, keyEnv: 'AIRNOW_API_KEY', attribution: 'US EPA AirNow',
    note: 'Reporting-area air quality near each tile center, not an indoor sensor reading at a home.',
    fetchMany: perTile(async (t, { get, env }) => {
      const lng = (t.bbox[0] + t.bbox[2]) / 2, lat = (t.bbox[1] + t.bbox[3]) / 2;
      return parseAirnow(await get(`https://www.airnowapi.org/aq/observation/current/ziplatLong?format=application/json&latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&distance=25&api_key=${encodeURIComponent(keyOf(env, 'AIRNOW_API_KEY'))}`));
    }) },
  eia: { id: 'eia', name: 'EIA grid demand (ERCOT)', scope: 'all', scopeKey: () => 'ERCO', ttlS: 3600, keyEnv: 'EIA_API_KEY', attribution: 'US Energy Information Administration',
    note: 'ERCOT hourly electricity demand only. This source does not report household power outages.',
    fetchMany: single(async (t, { get, env }) => parseEia(await get(`https://api.eia.gov/v2/electricity/rto/region-data/data/?frequency=hourly&data[0]=value&facets[respondent][]=ERCO&facets[type][]=D&sort[0][column]=period&sort[0][direction]=desc&length=24&api_key=${encodeURIComponent(keyOf(env, 'EIA_API_KEY'))}`))) },
};

export const LAYER_IDS = Object.keys(LAYERS);
