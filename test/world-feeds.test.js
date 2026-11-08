import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { ATMOSPHERE_SAMPLES, atmosphereRequestUrl, parseAtmosphere, parseFaults, WORLD_LAYERS, FAULT_PAGE_SIZE } from '../src/world-feeds.js';
import { LAYERS, feedMetadata } from '../src/feed-layers.js';
import { getFeedStatus, refreshLayer, readCachedOverlays } from '../src/feeds.js';

const NOW = new Date('2026-11-08T08:30:00Z');
const TIME = Date.parse('2026-11-08T08:00:00Z') / 1000;
const SAMPLE = ATMOSPHERE_SAMPLES[0];
const row = (s = SAMPLE, i = 0) => ({
  latitude: s.lat, longitude: s.lng, location_id: i, utc_offset_seconds: 0,
  hourly_units: { time: 'unixtime', wind_speed_10m: 'km/h', wind_direction_10m: '°', shortwave_radiation: 'W/m²', uv_index: '', temperature_2m: '°C' },
  hourly: { time: [TIME], wind_speed_10m: [0], wind_direction_10m: [360], shortwave_radiation: [0], uv_index: [0], temperature_2m: [-10] },
});
const parse = r => parseAtmosphere(r, [SAMPLE], NOW);
const line = (id = 1) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-122.1, 37.1], [-122.2, 37.2]] }, properties: {
  OBJECTID: id, fault_name: 'Fault', section_name: 'Section', fault_id: '1a', age: 'historic', slip_rate: 'Greater than 5.0 mm/yr',
} });
const fc = (features = [line()]) => ({ type: 'FeatureCollection', features });
const tile = { key: 'test', bbox: [-122.25, 37, -122, 37.25] };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('fixed national sampler is bounded, uniquely identified and requests one hour with explicit units/time', () => {
  assert.equal(ATMOSPHERE_SAMPLES.length, 60);
  assert.equal(new Set(ATMOSPHERE_SAMPLES.map(s => s.id)).size, 60);
  assert.ok(ATMOSPHERE_SAMPLES.every(s => s.lng >= -125 && s.lng <= -66 && s.lat >= 24 && s.lat <= 50));
  const u = new URL(atmosphereRequestUrl()), q = u.searchParams;
  assert.equal(u.origin, 'https://api.open-meteo.com');
  assert.equal(q.get('latitude').split(',').length, 60);
  assert.equal(q.get('longitude').split(',').length, 60);
  for (const [k, v] of Object.entries({ forecast_hours: '1', timeformat: 'unixtime', timezone: 'GMT', wind_speed_unit: 'kmh', temperature_unit: 'celsius' })) assert.equal(q.get(k), v);
  assert.equal(q.get('hourly').split(',').length, 5);
  assert.equal(q.has('apikey'), false);
  assert.equal(LAYERS.atmosphere, WORLD_LAYERS.atmosphere);
  assert.equal(LAYERS.faults, WORLD_LAYERS.faults);
  assert.equal(feedMetadata(LAYERS.atmosphere).coverage.type, 'sampled-national');
  assert.equal(LAYERS.atmosphere.minZoom, 0);
  assert.equal(feedMetadata(LAYERS.atmosphere).minZoom, 0);
  assert.equal(LAYERS.faults.minZoom, 10);
  assert.equal(LAYERS.faults.maxSpan, 0.75);
});

test('atmosphere preserves zeros, units, meteorological-from direction and model-valid time separately', () => {
  const r = row(); r.longitude += 0.02;
  const out = parse(r), p = out.features[0].properties;
  assert.equal(p.wind_kph, 0); assert.equal(p.wind_direction, 360);
  assert.equal(p.solar_wm2, 0); assert.equal(p.uv_index, 0); assert.equal(p.temperature_c, -10);
  assert.equal(p.observedAt, null); assert.equal(p.modelRunAt, null);
  assert.equal(p.validAt, '2026-11-08T08:00:00.000Z');
  assert.equal(p.dataKind, 'model_forecast'); assert.equal(p.solarIntervalSeconds, 3600);
  assert.equal(p.windDirectionConvention, 'meteorological_from_degrees');
  assert.equal(out.features[0].geometry.coordinates[0], r.longitude, 'draw at source grid, not invented station');
  assert.equal(p.requestedLongitude, SAMPLE.lng);
  assert.equal(out.truncated, false);
});

test('missing, coerced, out-of-range or wrongly labelled measurements remain null, never zero', () => {
  for (const value of [null, undefined, '', '10', false, NaN, Infinity, -1]) {
    const r = row(); r.hourly.wind_speed_10m = [value];
    assert.equal(parse(r).features[0].properties.wind_kph, null);
    assert.equal(parse(r).truncated, true);
  }
  for (const [variable, field, badUnit] of [
    ['wind_speed_10m', 'wind_kph', 'mph'], ['wind_direction_10m', 'wind_direction', 'rad'],
    ['shortwave_radiation', 'solar_wm2', 'kW/m²'], ['uv_index', 'uv_index', 'W/m²'], ['temperature_2m', 'temperature_c', '°F'],
  ]) {
    const r = row(); r.hourly_units[variable] = badUnit;
    assert.equal(parse(r).features[0].properties[field], null);
    delete r.hourly_units[variable];
    assert.equal(parse(r).features[0].properties[field], null);
    delete r.hourly[variable];
    assert.equal(parse(r).features[0].properties[field], null);
  }
  for (const direction of [-1, 361]) { const r = row(); r.hourly.wind_direction_10m = [direction]; assert.equal(parse(r).features[0].properties.wind_direction, null); }
  const r = row(); r.hourly.temperature_2m = [-274]; assert.equal(parse(r).features[0].properties.temperature_c, null);
});

test('invalid atmosphere structure, time, coordinates and all-missing payloads fail instead of replacing good cache', () => {
  for (const raw of [null, {}, { error: true }, [], [row(), row()]]) assert.throws(() => parse(raw), /Atmosphere/);
  for (const mutate of [
    r => { r.hourly.time = ['2026-11-08T08:00']; }, r => { r.hourly.time = [null]; },
    r => { r.hourly.time = [TIME + 3600]; }, r => { r.hourly.time = [TIME - 7200]; },
    r => { r.hourly.time = [TIME, TIME + 3600]; }, r => { r.hourly_units.time = 'iso8601'; },
    r => { r.utc_offset_seconds = 3600; }, r => { r.longitude = null; },
    r => { r.latitude = 91; }, r => { r.longitude = 181; }, r => { r.longitude += 0.51; },
    r => { r.location_id = 1; }, r => { r.hourly.wind_speed_10m = 5; },
    r => { r.hourly.wind_speed_10m = []; }, r => { r.hourly_units = {}; },
  ]) { const r = row(); mutate(r); assert.throws(() => parse(r), /Atmosphere/); }
  assert.throws(() => parseAtmosphere([row()], [], NOW), /Atmosphere/);
  assert.throws(() => parseAtmosphere(row(), [SAMPLE], new Date('invalid')), /Atmosphere/);
});

test('fault parser accepts line/multiline, retains supplied age text, nulls absent metadata', () => {
  const a = line(), b = line(2); b.geometry = { type: 'MultiLineString', coordinates: [a.geometry.coordinates, a.geometry.coordinates] };
  b.properties = { OBJECTID: 2 };
  const result = parseFaults(fc([a, b]));
  assert.equal(result.features.length, 2); assert.equal(result.truncated, false);
  assert.equal(result.features[0].properties.age, 'historic');
  assert.equal(result.features[0].properties.slipRate, 'Greater than 5.0 mm/yr');
  assert.equal(result.features[0].properties.observedAt, null);
  assert.equal(result.features[1].properties.name, null);
  assert.equal(result.features[1].properties.age, null);
  assert.equal(result.features[1].geometry.type, 'MultiLineString');
  assert.deepEqual(parseFaults(fc([])).features, []);
});

test('fault parser refuses invalid payloads, non-lines, wrong CRS and invalid geographic coordinates', () => {
  for (const raw of [null, {}, { features: [] }, { error: { message: 'bad' } }, { ...fc(), exceededTransferLimit: 'false' }, { ...fc(), crs: { properties: { name: 'EPSG:3857' } } }]) assert.throws(() => parseFaults(raw), /USGS/);
  for (const mutate of [
    f => { f.geometry = null; }, f => { f.geometry.type = 'Point'; },
    f => { f.geometry.coordinates = [[1, 2]]; }, f => { f.geometry.coordinates[0] = [181, 2]; },
    f => { f.geometry.coordinates[0] = [1, 91]; }, f => { f.geometry.coordinates[0] = ['1', 2]; },
    f => { f.geometry.coordinates[0] = [null, 2]; }, f => { f.geometry.coordinates[0] = [1, 2, 3]; },
    f => { f.properties.OBJECTID = null; }, f => { f.properties = null; },
  ]) { const f = line(); mutate(f); assert.throws(() => parseFaults(fc([f])), /USGS/); }
});

test('fault transfer flags and feature/position limits are visible as partial', () => {
  assert.equal(parseFaults({ ...fc(), properties: { exceededTransferLimit: true } }).truncated, true);
  assert.equal(parseFaults({ ...fc(), exceededTransferLimit: true }).hasMore, true);
  const many = parseFaults(fc(Array.from({ length: 201 }, (_, i) => line(i))));
  assert.equal(many.features.length, 200); assert.equal(many.truncated, true);
  const huge = line(2); huge.geometry.coordinates = Array.from({ length: 20001 }, () => [1, 2]);
  const result = parseFaults(fc([line(), huge]));
  assert.equal(result.features.length, 1); assert.equal(result.truncated, true); assert.equal(result.dropped, 1);
  assert.throws(() => parseFaults(fc([huge])), /USGS/);
});

test('fault requests use official national line layer, bounded boxes, ordered pagination and explicit CRS', async () => {
  const urls = [];
  const result = await LAYERS.faults.fetchMany([tile], { get: async url => {
    urls.push(url);
    return urls.length === 1 ? fc(Array.from({ length: FAULT_PAGE_SIZE }, (_, i) => line(i))) : fc([line(200)]);
  } });
  const got = result.get(tile.key);
  assert.equal(got.features.length, 201); assert.equal(got.truncated, false); assert.equal(urls.length, 2);
  const u = new URL(urls[1]), q = u.searchParams;
  assert.equal(u.origin, 'https://earthquake.usgs.gov'); assert.match(u.pathname, /Qfaults\/MapServer\/21\/query$/);
  for (const [k, v] of Object.entries({ geometry: tile.bbox.join(','), inSR: '4326', outSR: '4326', resultOffset: '200', resultRecordCount: '200', orderByFields: 'OBJECTID ASC', maxAllowableOffset: '0.001', f: 'geojson' })) assert.equal(q.get(k), v);
  const more = await LAYERS.faults.fetchMany([tile], { get: async () => ({ ...fc([line()]), exceededTransferLimit: true }) });
  assert.equal(more.get(tile.key).truncated, true, 'repeated or capped pages remain partial');
});

test('fault adapter enforces tile bounds, request budget and preserves failures per tile', async () => {
  let calls = 0;
  const get = async () => { calls++; return fc(); };
  for (const bbox of [null, [-123, 37, -121, 38], [-181, 37, -180.9, 37.1], [-122, 37, -122.25, 37.25], ['-122', 37, -121.9, 37.1]]) {
    const out = await LAYERS.faults.fetchMany([{ key: 'bad', bbox }], { get });
    assert.ok(out.get('bad') instanceof Error);
  }
  assert.equal(calls, 0);
  await assert.rejects(LAYERS.faults.fetchMany(Array(17).fill(tile), { get }), /Too many/);
  const error = new Error('test upstream failure');
  const result = await LAYERS.faults.fetchMany([tile], { get: async () => { throw error; } });
  assert.equal(result.get(tile.key), error);
  let active = 0, peak = 0;
  await LAYERS.faults.fetchMany(Array.from({ length: 16 }, (_, i) => ({ ...tile, key: String(i) })), { get: async () => {
    peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return fc([]);
  } });
  assert.ok(peak <= 4);
});

test('world feeds use existing TTL/stale cache and status; wide faults refuse fetching; rain/risk unchanged', async () => {
  const server = await MongoMemoryServer.create();
  const client = await MongoClient.connect(server.getUri());
  const db = client.db('world_feeds_isolated_test');
  try {
    let calls = 0;
    const fetcher = async () => { calls++; return reply(ATMOSPHERE_SAMPLES.map(row)); };
    const first = await refreshLayer(db, {}, 'atmosphere', null, { now: NOW, fetcher });
    assert.equal(first.features.length, 60); assert.equal(first.hb.refreshStatus, 'ok');
    assert.equal((await getFeedStatus(db, { now: NOW })).find(s => s.id === 'atmosphere').minZoom, 0);
    const subset = await refreshLayer(db, {}, 'atmosphere', [-87, 32, -86, 33], { now: NOW, fetcher });
    assert.equal(calls, 1); assert.equal(subset.features.length, 1); assert.equal(subset.hb.delivery, 'cached');
    const later = new Date(+NOW + 1801000);
    const stale = await refreshLayer(db, {}, 'atmosphere', null, { now: later, fetcher: async () => reply({ bad: true }) });
    assert.equal(stale.hb.stale, true); assert.equal(stale.hb.refreshStatus, 'error');
    assert.equal(stale.hb.fetchedAt, NOW.toISOString());
    assert.equal(stale.features[0].properties.validAt, first.features[0].properties.validAt);
    assert.equal((await getFeedStatus(db, { now: later })).find(s => s.id === 'atmosphere').status, 'stale');
    await assert.rejects(refreshLayer(db, {}, 'faults', [-125, 25, -66, 50], { now: NOW, fetcher }), e => e.status === 400 && e.extra.minZoom === 10 && e.extra.maxSpanDeg === 0.75);
    assert.equal(calls, 1);
    await assert.rejects(refreshLayer(db, {}, 'faults', tile.bbox, { now: NOW, fetcher: async () => reply({ bad: true }) }), e => e.status === 503);
    assert.equal((await getFeedStatus(db, { now: NOW })).find(s => s.id === 'faults').status, 'error');
    const f = await refreshLayer(db, {}, 'faults', tile.bbox, { now: NOW, fetcher: async () => reply(fc()) });
    assert.equal(f.features.length, 1); assert.equal(f.hb.refreshStatus, 'ok');
    assert.equal(f.hb.coverage.type, 'requested-area');
    const fStale = await refreshLayer(db, {}, 'faults', tile.bbox, { now: new Date(+NOW + (LAYERS.faults.ttlS + 1) * 1000), fetcher: async () => reply({ error: {} }) });
    assert.equal(fStale.hb.refreshStatus, 'error'); assert.equal(fStale.hb.stale, true); assert.equal(fStale.features.length, 1);
    const ctx = await readCachedOverlays(db, { now: NOW });
    assert.equal('atmosphere' in ctx, false); assert.equal('faults' in ctx, false); assert.deepEqual(ctx.weather, {});
  } finally { await client.close(); await server.stop(); }
});
