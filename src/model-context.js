import { ObjectId } from 'mongodb';
import { readCachedOverlays } from './feeds.js';
import { LAYERS } from './feed-layers.js';
import { geohashEncode } from './feed-geo.js';
import { SENSORS } from './system-evidence.js';

export const MODEL_CONTEXT_LAYERS = ['nws', 'declarations', 'nfhl', 'gauges', 'quakes', 'weather', 'shelters', 'firms', 'airnow', 'eia'];
const MAX_RECORDS = 5, MAX_RECORD_BYTES = 16000, MAX_TEXT = 200;
const encoder = new TextEncoder();
const clean = (v, max = MAX_TEXT) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null;
const iso = v => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : null;
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const FIELDS = {
  nws: ['event', 'severity', 'urgency', 'headline', 'areaDesc', 'sent', 'expires'],
  declarations: ['geoid', 'area', 'state', 'statewide', 'declarationTitle', 'incidentType', 'declarationDate'],
  nfhl: ['FLD_ZONE', 'SFHA_TF', 'ZONE_SUBTY'],
  gauges: ['site', 'name', 'stage', 'unit', 'observedAt'],
  quakes: ['mag', 'place', 'time'],
  weather: ['precip24h_mm', 'peak_mmph', 'level'],
  shelters: ['name', 'city', 'state', 'status', 'capacity', 'population', 'pets', 'accessible', 'org'],
  firms: ['acqDate', 'acqTime', 'confidence', 'frp', 'satellite', 'daynight'],
  airnow: ['area', 'parameter', 'aqi', 'category', 'observedOn', 'hour'],
  eia: ['period', 'region', 'value', 'unit'],
};
const SOURCE_URLS = {
  nws: 'https://www.weather.gov/', declarations: 'https://www.fema.gov/about/openfema',
  nfhl: 'https://www.fema.gov/flood-maps/national-flood-hazard-layer', gauges: 'https://waterdata.usgs.gov/',
  quakes: 'https://earthquake.usgs.gov/', weather: 'https://open-meteo.com/',
  shelters: 'https://gis.fema.gov/', firms: 'https://firms.modaps.eosdis.nasa.gov/',
  airnow: 'https://www.airnow.gov/', eia: 'https://www.eia.gov/electricity/gridmonitor/',
};
const NOTES = {
  weather: 'Forecast rain, not an observation at a home. Open-Meteo is not a government agency.',
  eia: 'Regional electricity demand, not a household outage feed. Demand changes do not prove an outage.',
  nfhl: 'Mapped flood hazard, not evidence of current inundation.',
  declarations: 'Disaster declaration history, not current conditions or claim eligibility.',
  firms: 'Satellite fire detections do not establish a fire at a particular home.',
  shelters: 'Cached shelter information requires confirmation before use.',
};
const STATUSES = new Set(['ok', 'stale', 'unverified', 'error', 'needs_key']);

/** Small, geometry-free provider payload. Cache metadata is never evidence of a successful live lookup. */
export function summarizeModelContext(context = {}, { now = new Date(), mode = 'live', scope = 'Regional context only; no home-level hazard intersection has been established.' } = {}) {
  let bytes = 0;
  const sources = MODEL_CONTEXT_LAYERS.map(id => {
    const meta = context.status?.[id] || {};
    const status = STATUSES.has(meta.status) ? meta.status : 'unverified';
    const fetchedAt = iso(meta.fetchedAt);
    const cachedState = ['cached', 'stale_cache'].includes(meta.dataState);
    const canProvide = (cachedState || ['ok', 'stale'].includes(status)) && Boolean(fetchedAt);
    const stale = status === 'stale' || meta.stale === true || meta.dataState === 'stale_cache';
    const raw = id === 'weather' ? Object.values(context.weather || {}).map(properties => ({ properties }))
      : id === 'eia' ? (context.eia?.series || []).map(properties => ({ properties }))
        : Array.isArray(context[id]) ? context[id] : [];
    const records = [];
    if (canProvide) {
      for (const [index, feature] of raw.slice(0, MAX_RECORDS).entries()) {
        const values = {};
        for (const field of FIELDS[id]) {
          const value = feature.properties?.[field];
          if (typeof value === 'string') values[field] = clean(value);
          else if (typeof value === 'boolean' || number(value) !== null) values[field] = value;
        }
        // Expired warnings must not be presented as current even if a caller bypassed the feed parser.
        if (id === 'nws' && values.expires && iso(values.expires) && Date.parse(values.expires) <= now.getTime()) continue;
        if (!Object.keys(values).length) continue;
        const record = { id: `context:${id}:${index + 1}`, sourceRecordId: clean(String(feature.id ?? ''), 160) || null, values };
        const size = encoder.encode(JSON.stringify(record)).length;
        if (bytes + size > MAX_RECORD_BYTES) break;
        bytes += size;
        records.push(record);
      }
    }
    return {
      id, name: LAYERS[id].name, attribution: LAYERS[id].attribution, sourceUrl: SOURCE_URLS[id],
      status, fetchedAt, ageS: number(meta.ageS), ttlS: LAYERS[id].ttlS, stale,
      sourceDataProvided: records.length > 0,
      dataState: canProvide ? (stale ? 'stale_cache' : 'cached') : 'unavailable',
      cachedRecordCount: canProvide ? raw.length : null, providedRecordCount: records.length,
      truncated: meta.truncated === true || (canProvide && raw.length > records.length),
      coverage: { type: clean(meta.coverage?.type, 40) || 'not_established', area: clean(meta.coverage?.area, 80) },
      note: [NOTES[id], clean(meta.note)].filter(Boolean).join(' '),
      // Do not forward provider error bodies, URLs, or credential-bearing query strings.
      ...(meta.lastError || status === 'error' ? { lastError: 'The source cache or its last refresh reported an error.', lastErrorAt: iso(meta.lastErrorAt) } : {}),
      records,
    };
  });
  return {
    version: 1, generatedAt: now.toISOString(), mode, retrieval: 'cache_only', dataOrigin: 'public_feed_cache',
    scope: clean(scope, 350), geometryIncluded: false, limitPerSource: MAX_RECORDS,
    sourceDataProvided: sources.some(source => source.sourceDataProvided),
    limitations: 'Only the listed cached records were provided. Missing, unavailable or empty sources were not consulted as evidence. No new upstream lookup was made. Regional context does not establish conditions at a home or replace deterministic sensor policies.' + (mode === 'exercise' ? ' Public feed records are real cached context; they do not describe the fictional exercise homes.' : ''),
    sources,
  };
}

function validPoint(point) {
  return Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(v => typeof v === 'number' && Number.isFinite(v)) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) < 90;
}

/** Coordinates are used only to read nearby cached tiles; they never enter the model payload. */
export async function loadModelContext(db, { env = {}, now = new Date(), mode = 'live', points = [] } = {}) {
  const valid = points.filter(validPoint).slice(0, 500);
  const cells = [...new Set(valid.map(([lng, lat]) => geohashEncode(lng, lat)))].slice(0, 32);
  let bbox;
  if (valid.length) {
    const xs = valid.map(p => p[0]), ys = valid.map(p => p[1]);
    const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // Broad fleets do not trigger enormous tile enumeration; local coverage stays unverified.
    if (e - w <= 1 && n - s <= 1) bbox = [Math.max(-180, w - .01), Math.max(-90, s - .01), Math.min(180, e + .01), Math.min(90, n + .01)];
  }
  const scope = !valid.length ? 'No verified device location. Region-wide cached context only; local coverage is not established.'
    : bbox ? 'Cached regional context around the selected device locations. No exact home-level hazard intersection was performed.'
      : 'Device locations span a broad area. Local tile layers are omitted; forecast cells are limited to 32. No home-level hazard intersection was performed.';
  try {
    const context = await readCachedOverlays(db, { env, now, exercise: mode === 'exercise', bbox, cells, layers: MODEL_CONTEXT_LAYERS });
    return summarizeModelContext(context, { now, mode, scope });
  } catch {
    return summarizeModelContext({ status: Object.fromEntries(MODEL_CONTEXT_LAYERS.map(id => [id, { status: 'error' }])) }, { now, mode, scope });
  }
}

export async function loadDeviceModelContext(db, evidence, { env = {}, now = new Date() } = {}) {
  const ids = (evidence.devices || []).map(d => d.id).filter(id => /^[a-f\d]{24}$/i.test(id)).map(id => new ObjectId(id));
  let points = [];
  try {
    const devices = await db.collection('devices').find({ _id: { $in: ids } }, { projection: { 'meta.longitude': 1, 'meta.latitude': 1, 'meta.lng': 1, 'meta.lat': 1, 'meta.location': 1 } }).limit(8).toArray();
    points = devices.map(d => [d.meta?.longitude ?? d.meta?.lng ?? d.meta?.location?.coordinates?.[0], d.meta?.latitude ?? d.meta?.lat ?? d.meta?.location?.coordinates?.[1]]);
  } catch { /* The model still receives explicit unknown location/coverage, not invented geography. */ }
  return loadModelContext(db, { env, now, mode: evidence.mode, points });
}

export function layerModelObservations(properties = []) {
  return properties.slice(0, 500).map(p => ({ id: clean(p.id, 100), observedAt: iso(p.observedAt), stale: p.stale === true,
    severity: ['critical', 'warning', 'normal', 'unknown'].includes(p.severity) ? p.severity : 'unknown',
    values: Object.fromEntries(SENSORS.filter(sensor => {
      const value = p.values?.[sensor];
      return typeof value === 'boolean' || number(value) !== null || (sensor === 'power_mode' && ['normal', 'saver', 'critical'].includes(value));
    }).map(sensor => [sensor, p.values[sensor]])),
  }));
}
