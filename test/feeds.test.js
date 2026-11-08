import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { bboxIntersects, cellsFor, geohashBounds, geohashEncode, parseBbox, tilesFor } from '../src/feed-geo.js';
import { parseAirnow, parseArcgis, parseEia, parseFirms, parseGauges, parseNws, parseOpenMeteo, parseQuakes, pickNfhl, rainLevel } from '../src/feed-layers.js';
import { validateGeometry, validateZoneInput } from '../src/zones.js';
import { getFeedStatus, readCachedOverlays, refreshContext, refreshLayer } from '../src/feeds.js';
import { handleFeeds, handleOverlays } from '../src/feeds-api.js';

let server, client, db;
before(async () => {
  const uri = process.env.TEST_MONGODB_URI || (server = await MongoMemoryServer.create()).getUri();
  client = await MongoClient.connect(uri);
  db = client.db('feeds_test');
});
after(async () => { await db?.dropDatabase(); await client?.close(); await server?.stop(); });
beforeEach(async () => { for (const c of ['overlay_zones', 'feed_cache', 'audit_log']) await db.collection(c).deleteMany({}); });

const NOW = new Date('2026-11-07T18:00:00Z');
const later = (s) => new Date(NOW.getTime() + s * 1000);
const BOX = [-96.8, 32.95, -96.7, 33.0];
const square = (x, y, d = 0.01) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function stub(routes) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    for (const [needle, make] of routes) if (String(url).includes(needle)) return typeof make === 'function' ? make(String(url)) : make;
    return reply('nope', 404);
  };
  fetcher.calls = calls;
  return fetcher;
}

const nfhlBody = { features: [{ id: 7, type: 'Feature', geometry: square(-96.78, 32.96, 0.02), properties: { FLD_ZONE: 'AE', SFHA_TF: 'T', ZONE_SUBTY: 'FLOODWAY', OBJECTID: 7, extra: 'dropped' } }] };
const nwsBody = { features: [
  { id: 'a1', geometry: square(-96.9, 32.9, 0.2), properties: { event: 'Flash Flood Warning', severity: 'Severe', headline: 'h', expires: '2026-11-07T20:00:00Z', areaDesc: 'Dallas' } },
  { id: 'a2', geometry: null, properties: { event: 'Wind Advisory', expires: '2026-11-07T17:00:00Z' } },
  { id: 'a3', geometry: null, properties: { event: 'Heat Advisory', expires: '2026-11-08T05:00:00Z' } },
] };

// ---------- geometry helpers ----------
test('bbox parsing rejects malformed and reversed boxes', () => {
  assert.deepEqual(parseBbox('-96.8,32.9,-96.7,33'), [-96.8, 32.9, -96.7, 33]);
  for (const bad of ['', '1,2,3', 'a,b,c,d', '5,0,4,1', '-200,0,0,1', '0,0,1,95', '1,,3,4']) assert.throws(() => parseBbox(bad), /bbox|Provide/);
  assert.equal(parseBbox(undefined, { required: false }), null);
});

test('tiles cover the box on a quarter degree grid, nearest first', () => {
  const tiles = tilesFor([-96.8, 32.95, -96.7, 33.0]);
  assert.deepEqual(tiles.map((t) => t.key).sort(), ['t:-387:131', 't:-388:131']);
  assert.equal(tilesFor([-96.8, 32.9, -96.7, 33.1]).length, 4, 'a box crossing a tile edge needs both rows');
  assert.ok(tiles.every((t) => bboxIntersects(t.bbox, [-96.8, 32.95, -96.7, 33.0])));
  assert.equal(tilesFor([0, 0, 0.25, 0.25]).length, 1);
});

test('geohash encode and bounds agree, cellsFor stays inside the cap', () => {
  assert.equal(geohashEncode(-122.4194, 37.7749, 5), '9q8yy');
  const [w, s, e, n] = geohashBounds('9q8yy');
  assert.ok(-122.4194 >= w && -122.4194 <= e && 37.7749 >= s && 37.7749 <= n);
  const cells = cellsFor([-97, 32.5, -96.5, 33], 5, 25);
  assert.equal(cells.length, 25);
  assert.equal(cellsFor([-96.8, 32.95, -96.7, 33.0], 5, 25).length, 6);
  assert.ok(cells.every((c) => c.length === 5));
});

// ---------- parsers ----------
test('parsers keep only safe, small fields and tolerate odd upstream shapes', () => {
  const nws = parseNws(nwsBody);
  assert.equal(nws.features.length, 3);
  assert.equal(nws.features[1].geometry, null);
  assert.deepEqual(Object.keys(parseArcgis(nfhlBody, pickNfhl).features[0].properties).sort(), ['FLD_ZONE', 'SFHA_TF', 'ZONE_SUBTY']);
  assert.equal(parseArcgis({ features: [], exceededTransferLimit: true }, pickNfhl).truncated, true);
  const gauges = parseGauges({ value: { timeSeries: [
    { sourceInfo: { siteCode: [{ value: '08057000' }], siteName: 'Trinity R', geoLocation: { geogLocation: { latitude: 32.7, longitude: -96.8 } } }, variable: { noDataValue: -999999, unit: { unitCode: 'ft' } }, values: [{ value: [{ value: '4.1', dateTime: 't1' }, { value: '-999999', dateTime: 't2' }] }] },
    { sourceInfo: { siteCode: [{ value: 'empty' }], geoLocation: { geogLocation: { latitude: 1, longitude: 2 } } }, variable: { noDataValue: -999999 }, values: [{ value: [] }] },
  ] } });
  assert.equal(gauges.features.length, 1);
  assert.equal(gauges.features[0].properties.stage, 4.1);
  const quakes = parseQuakes({ features: [{ id: 'q', geometry: { coordinates: [-100, 31, 8] }, properties: { mag: 2.1, place: 'x', time: 1, url: 'javascript:alert(1)' } }] });
  assert.deepEqual(quakes.features[0].geometry.coordinates, [-100, 31]);
  assert.equal(quakes.features[0].properties.url, null);
  const firms = parseFirms('latitude,longitude,acq_date,acq_time,confidence,frp,satellite,daynight\n32.1,-97.2,2026-11-07,1830,n,3.2,N20,D\nbad,row,x\n');
  assert.equal(firms.features.length, 1);
  assert.throws(() => parseFirms('Invalid MAP_KEY'), /unreadable/);
  assert.throws(() => parseAirnow({ WebServiceError: 'x' }), /unreadable/);
  assert.equal(parseAirnow([{ Latitude: 32.9, Longitude: -96.7, ParameterName: 'PM2.5', AQI: 61, Category: { Name: 'Moderate' } }]).features[0].properties.aqi, 61);
  assert.equal(parseEia({ response: { data: [{ period: 'p', respondent: 'ERCO', value: '45000', 'value-units': 'megawatthours' }] } }).extra.series[0].value, 45000);
});

test('rain levels and Open-Meteo parsing; missing hours stay unknown', () => {
  assert.equal(rainLevel(8, 10), 'heavy');
  assert.equal(rainLevel(1, 60), 'heavy');
  assert.equal(rainLevel(3, 5), 'moderate');
  assert.equal(rainLevel(0.2, 1), 'none');
  const cells = ['9vgm0', '9vgm1', '9vgm2'];
  const out = parseOpenMeteo([{ hourly: { precipitation: [0, 9, 1] } }, { hourly: { precipitation: [null, null] } }, { hourly: { precipitation: [0.1] } }], cells);
  assert.equal(out.get('9vgm0').features[0].properties.level, 'heavy');
  assert.equal(out.has('9vgm1'), false);
  assert.equal(parseOpenMeteo({ hourly: { precipitation: [0.5] } }, ['9vgm0']).size, 1);
});

// ---------- zone validation ----------
test('zone geometry validation', () => {
  assert.deepEqual(validateGeometry({ type: 'Point', coordinates: [-96.75, 32.98] }).coordinates, [-96.75, 32.98]);
  assert.equal(validateGeometry(square(-96.8, 32.9)).type, 'Polygon');
  const bad = [
    null, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { type: 'Point', coordinates: [200, 0] }, { type: 'Point', coordinates: ['a', 1] },
    { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [0, 0], [1, 0], [1, 1], [0, 0]]] },
    { type: 'Polygon', coordinates: [square(0, 0, 1).coordinates[0], [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]].concat([[0, 0]]).slice(0, 3)] },
  ];
  for (const g of bad) assert.throws(() => validateGeometry(g), /point|Draw|polygon|ring|edge|repeated|hole|zones can be/i, JSON.stringify(g));
  const ring = Array.from({ length: 250 }, (_, i) => [-96 + 0.001 * Math.cos(i / 40), 32 + 0.001 * Math.sin(i / 40)]);
  ring.push(ring[0]);
  assert.throws(() => validateGeometry({ type: 'Polygon', coordinates: [ring] }), /at most 200/);
  const withHole = { type: 'Polygon', coordinates: [square(0, 0, 1).coordinates[0], [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]]] };
  assert.equal(validateGeometry(withHole).coordinates.length, 2);
});

test('zone fields: type, text limits, control characters and time order', () => {
  const ok = { type: 'evacuation', name: ' North \u0007 side ', note: 'x', geometry: square(-96.8, 32.9) };
  const v = validateZoneInput(ok);
  assert.equal(v.name, 'North   side');
  assert.equal(v.active, true);
  assert.throws(() => validateZoneInput({ ...ok, type: 'party' }), /type must/);
  assert.throws(() => validateZoneInput({ ...ok, name: 'n'.repeat(81) }), /80/);
  assert.throws(() => validateZoneInput({ ...ok, note: 'n'.repeat(301) }), /300/);
  assert.throws(() => validateZoneInput({ ...ok, name: '  ' }), /required/);
  assert.throws(() => validateZoneInput({ ...ok, startsAt: 'tomorrow-ish' }), /startsAt/);
  assert.throws(() => validateZoneInput({ ...ok, active: 'yes' }), /active/);
  assert.deepEqual(Object.keys(validateZoneInput({ name: 'only' }, { partial: true })), ['name']);
});

// ---------- zone endpoints ----------
const OP = { email: 'op@example.test', role: 'operator' };
const DEMO = { email: 'demo@homebeacon.local', role: 'demo' };
const call = (method, path, { body, operator = OP, fetcher, now = NOW, env = {} } = {}) =>
  handleOverlays(new Request('https://home.test' + path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) }), env, { db, operator, fetcher, now });
const zoneBody = (over = {}) => ({ type: 'evacuation', name: 'Creek Road', note: 'Leave by 6 pm', geometry: square(-96.78, 32.96), ...over });

test('operators create, list, update and retire zones; each write is audited', async () => {
  let res = await call('POST', '/api/overlays?layer=zones', { body: zoneBody() });
  assert.equal(res.status, 201);
  const { zone } = await res.json();
  assert.equal(zone.properties.version, 1);
  assert.equal(zone.properties.exercise, false);
  assert.equal(zone.properties.createdBy, OP.email);

  res = await call('GET', '/api/overlays?layer=zones&bbox=-96.9,32.9,-96.7,33.0');
  let list = await res.json();
  assert.equal(list.features.length, 1);
  assert.equal(list.hb.stale, false);
  res = await call('GET', '/api/overlays?layer=zones&bbox=-90,10,-89,11');
  assert.equal((await res.json()).features.length, 0);
  res = await call('GET', '/api/overlays?layer=zones&type=closure');
  assert.equal((await res.json()).features.length, 0);

  res = await call('PATCH', `/api/overlays?layer=zones&id=${zone.id}`, { body: { version: 1, name: 'Creek Road east' } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).zone.properties.version, 2);
  res = await call('PATCH', `/api/overlays?layer=zones&id=${zone.id}`, { body: { version: 1, name: 'stale write' } });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).currentVersion, 2);
  res = await call('PATCH', `/api/overlays?layer=zones&id=${zone.id}`, { body: { name: 'no version' } });
  assert.equal(res.status, 400);

  res = await call('DELETE', `/api/overlays?layer=zones&id=${zone.id}`, { body: { version: 1 } });
  assert.equal(res.status, 409);
  res = await call('DELETE', `/api/overlays?layer=zones&id=${zone.id}`, { body: { version: 2 } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).zone.properties.active, false);
  list = await (await call('GET', '/api/overlays?layer=zones')).json();
  assert.equal(list.features.length, 0);
  list = await (await call('GET', '/api/overlays?layer=zones&inactive=1')).json();
  assert.equal(list.features.length, 1);
  assert.equal(await db.collection('overlay_zones').countDocuments(), 1, 'delete is soft');

  const audit = await db.collection('audit_log').find({}).sort({ at: 1 }).toArray();
  assert.deepEqual(audit.map((a) => a.action), ['zone.create', 'zone.update', 'zone.delete']);
  assert.ok(audit.every((a) => a.actor.id === OP.email && a.actor.type === 'operator' && /^gh5:/.test(a.region) && a.exercise === false));
});

test('zone writes reject bad input and unknown ids with plain errors', async () => {
  let res = await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] } }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /crosses/);
  res = await call('PATCH', '/api/overlays?layer=zones&id=nothex', { body: { version: 1, name: 'x' } });
  assert.equal(res.status, 400);
  res = await call('PATCH', '/api/overlays?layer=zones&id=aaaaaaaaaaaaaaaaaaaaaaaa', { body: { version: 1, name: 'x' } });
  assert.equal(res.status, 404);
  res = await call('DELETE', '/api/overlays?layer=zones', { body: {} });
  assert.equal(res.status, 400);
  res = await call('POST', '/api/overlays?layer=nws', { body: {} });
  assert.equal(res.status, 405);
  res = await call('GET', '/api/overlays?layer=bogus');
  assert.equal(res.status, 400);
  res = await call('PUT', '/api/overlays?layer=zones');
  assert.equal(res.status, 405);
});

test('exercise zones never mix with live zones and the demo role is read only', async () => {
  await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ name: 'Live zone' }) });
  await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ name: 'Drill zone', exercise: true }) });
  const names = async (path, operator) => (await (await call('GET', path, { operator })).json()).features.map((f) => f.properties.name);
  assert.deepEqual(await names('/api/overlays?layer=zones'), ['Live zone']);
  assert.deepEqual(await names('/api/overlays?layer=zones&exercise=1'), ['Drill zone']);
  assert.deepEqual(await names('/api/overlays?layer=zones', DEMO), ['Drill zone']);
  assert.deepEqual(await names('/api/overlays?layer=zones&exercise=0', DEMO), ['Drill zone'], 'demo cannot ask for live data');
  const demoList = await (await call('GET', '/api/overlays?layer=zones', { operator: DEMO })).json();
  assert.equal(demoList.features[0].properties.createdBy, undefined, 'operator emails are not shown to demo');
  for (const m of ['POST', 'PATCH', 'DELETE']) {
    const res = await call(m, '/api/overlays?layer=zones&id=aaaaaaaaaaaaaaaaaaaaaaaa', { body: { ...zoneBody(), version: 1 }, operator: DEMO });
    assert.equal(res.status, 403);
  }
  const res = await call('GET', '/api/overlays?layer=zones', { operator: { email: 'c@x.test', role: 'customer' } });
  assert.equal(res.status, 403);
  const admin = await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ name: 'Script zone' }), operator: null });
  assert.equal((await admin.json()).zone.properties.createdBy, 'admin-key');
});

test('zone writes are rate limited per actor', async () => {
  await db.collection('audit_log').insertMany(Array.from({ length: 60 }, () => ({ at: NOW, actor: { type: 'operator', id: OP.email }, action: 'zone.update' })));
  const res = await call('POST', '/api/overlays?layer=zones', { body: zoneBody() });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
});

test('active zone window: future and ended zones are not active', async () => {
  const { loadActiveZones } = await import('../src/feeds.js');
  await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ name: 'now' }) });
  await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ name: 'future', startsAt: later(3600).toISOString() }) });
  await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ name: 'ended', startsAt: later(-7200).toISOString(), endsAt: later(-60).toISOString() }) });
  const res = await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ name: 'backwards', startsAt: later(10).toISOString(), endsAt: later(5).toISOString() }) });
  assert.equal(res.status, 400);
  const active = await loadActiveZones(db, { now: NOW });
  assert.deepEqual(active.map((z) => z.properties.name), ['now']);
  assert.deepEqual((await loadActiveZones(db, { now: later(4000) })).map((z) => z.properties.name).sort(), ['future', 'now']);
});

// ---------- feed cache ----------
const routes = () => [
  ['NFHL/MapServer/28/query', () => reply(nfhlBody)],
  ['api.weather.gov/alerts', () => reply(nwsBody)],
];

test('a layer is fetched once per TTL, then served from the cache', async () => {
  const f = stub(routes());
  const first = await refreshLayer(db, {}, 'nfhl', BOX, { fetcher: f, now: NOW });
  const calls = f.calls.length;
  assert.ok(calls >= 1 && calls <= 4);
  assert.equal(first.features.length, 1, 'a polygon seen in several tiles is returned once');
  assert.equal(first.hb.stale, false);
  assert.equal(first.hb.ageS, 0);
  assert.equal(first.hb.source, 'FEMA flood hazard zones');
  assert.ok(f.calls.every((u) => u.includes('f=geojson') && u.includes('outSR=4326')));
  const again = await refreshLayer(db, {}, 'nfhl', BOX, { fetcher: f, now: later(3600) });
  assert.equal(f.calls.length, calls, 'no new upstream calls while fresh');
  assert.equal(again.hb.ageS, 3600);
  const expired = await refreshLayer(db, {}, 'nfhl', BOX, { fetcher: f, now: later(86401) });
  assert.ok(f.calls.length > calls);
  assert.equal(expired.hb.ageS, 0);
});

test('upstream failure serves the last copy flagged stale; with no copy it is a 503 naming the layer', async () => {
  const good = stub(routes());
  await refreshLayer(db, {}, 'nws', null, { fetcher: good, now: NOW });
  const down = stub([['api.weather.gov', reply('boom', 503)]]);
  const stale = await refreshLayer(db, {}, 'nws', null, { fetcher: down, now: later(600) });
  assert.equal(stale.hb.stale, true);
  assert.equal(stale.hb.ageS, 600);
  assert.equal(stale.features.length, 2);
  const status = (await getFeedStatus(db, { now: later(600) })).find((s) => s.id === 'nws');
  assert.equal(status.status, 'stale');
  assert.match(status.lastError, /error \(503\)/);

  const res = await call('GET', '/api/overlays?layer=quakes', { fetcher: stub([['earthquake.usgs.gov', reply('x', 500)]]) });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.layer, 'quakes');
  assert.ok(body.error);
  assert.equal((await getFeedStatus(db, { now: NOW })).find((s) => s.id === 'quakes').status, 'error');
});

test('alerts past their expiry are dropped; alerts without shapes are kept in the list', async () => {
  const out = await refreshLayer(db, {}, 'nws', null, { fetcher: stub(routes()), now: NOW });
  assert.deepEqual(out.features.map((f) => f.id).sort(), ['a1', 'a3']);
  assert.equal(out.features.find((f) => f.id === 'a3').geometry, null);
});

test('keyed feeds say needs_key, call nothing, and never put a key in output', async () => {
  const f = stub([]);
  await assert.rejects(refreshLayer(db, {}, 'firms', BOX, { fetcher: f, now: NOW }), (e) => e.status === 503 && e.extra.status === 'needs_key' && e.extra.layer === 'firms');
  assert.equal(f.calls.length, 0);
  const sources = await getFeedStatus(db, { env: {}, now: NOW });
  assert.equal(sources.find((s) => s.id === 'firms').status, 'needs_key');
  assert.equal(sources.find((s) => s.id === 'firms').keyName, 'FIRMS_MAP_KEY');

  const SECRET = 'sekret-firms-key-0123';
  const csv = 'latitude,longitude,acq_date,acq_time,confidence,frp\n32.97,-96.75,2026-11-07,1700,h,5\n';
  const ok = stub([['firms.modaps', reply(csv)]]);
  const out = await refreshLayer(db, { FIRMS_MAP_KEY: SECRET }, 'firms', BOX, { fetcher: ok, now: NOW });
  assert.equal(out.features.length, 1);
  assert.ok(ok.calls[0].includes(SECRET), 'key is used server side');
  assert.equal(JSON.stringify(out).includes(SECRET), false);
  assert.equal(JSON.stringify(await db.collection('feed_cache').find({}).toArray()).includes(SECRET), false);
  const bad = stub([['firms.modaps', reply('Invalid MAP_KEY')]]);
  await db.collection('feed_cache').deleteMany({});
  await assert.rejects(refreshLayer(db, { FIRMS_MAP_KEY: SECRET }, 'firms', BOX, { fetcher: bad, now: NOW }), (e) => !JSON.stringify([e.message, e.extra]).includes(SECRET));
  assert.equal(JSON.stringify(await db.collection('feed_cache').find({}).toArray()).includes(SECRET), false);
  const err = (await getFeedStatus(db, { env: { FIRMS_MAP_KEY: SECRET }, now: NOW })).find((s) => s.id === 'firms');
  assert.equal(JSON.stringify(err).includes(SECRET), false);
});

test('area limits: wide boxes are refused for heavy layers, bbox is required for tile layers', async () => {
  let res = await call('GET', '/api/overlays?layer=nfhl&bbox=-98,31,-95,34', { fetcher: stub([]) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.layer, 'nfhl');
  assert.equal(body.minZoom, 11);
  res = await call('GET', '/api/overlays?layer=gauges', { fetcher: stub([]) });
  assert.equal(res.status, 400);
  res = await call('GET', '/api/overlays?layer=nws', { fetcher: stub(routes()) });
  assert.equal(res.status, 200, 'statewide layers need no bbox');
});

test('oversized upstream data is truncated to the cache cap and says so', async () => {
  const big = { features: Array.from({ length: 4000 }, (_, i) => ({ id: i, type: 'Feature', geometry: square(-96.79 + (i % 10) * 0.001, 32.96, 0.0005), properties: { FLD_ZONE: 'X'.repeat(15) } })) };
  const huge = { features: big.features.map((f) => ({ ...f, geometry: { type: 'Polygon', coordinates: [Array.from({ length: 60 }, (_, k) => [-96.79 + k * 1e-6, 32.96 + k * 1e-6]).concat([[-96.79, 32.96]])] } })) };
  const out = await refreshLayer(db, {}, 'nfhl', [-96.79, 32.96, -96.78, 32.97], { fetcher: stub([['NFHL', () => reply(huge)]]), now: NOW });
  assert.equal(out.hb.truncated, true);
  const doc = await db.collection('feed_cache').findOne({ layer: 'nfhl' });
  assert.ok(JSON.stringify(doc.data).length <= 2 * 1024 * 1024 + 1024);
});

test('dense flood zone tiles are read in pages until the source runs out', async () => {
  const page = (n, from) => ({ features: Array.from({ length: n }, (_, i) => ({ id: from + i, type: 'Feature', geometry: square(-96.79 + (i % 20) * 0.0004, 32.96, 0.0003), properties: { FLD_ZONE: 'X' } })) });
  const f = stub([['resultOffset=0', () => reply({ ...page(500, 0), exceededTransferLimit: true })], ['resultOffset=500', () => reply(page(3, 500))]]);
  const out = await refreshLayer(db, {}, 'nfhl', [-96.795, 32.955, -96.78, 32.97], { fetcher: f, now: NOW });
  assert.equal(f.calls.length, 2);
  assert.equal(out.features.length, 503);
  assert.equal(out.hb.truncated, false);
});

test('rain by geohash cell: one batched call, per cell cache, unknown cells stay absent', async () => {
  const cells = ['9vgm0', '9vgm1'];
  const f = stub([['api.open-meteo.com', reply([{ hourly: { precipitation: [0, 12, 3] } }, { hourly: { precipitation: [null] } }])]]);
  const out = await refreshLayer(db, {}, 'weather', null, { fetcher: f, now: NOW, cells });
  assert.equal(f.calls.length, 1);
  assert.equal(out.features.length, 1);
  assert.equal(out.features[0].properties.level, 'heavy');
  assert.equal(out.hb.missingTiles, 1);
  assert.equal(out.hb.truncated, true, 'a missing cell marks the result partial');
  const ctx = await readCachedOverlays(db, { layers: ['weather'], cells, now: later(60) });
  assert.deepEqual(Object.keys(ctx.weather), ['9vgm0']);
  assert.equal(ctx.weather['9vgm0'].level, 'heavy');
  assert.deepEqual(Object.keys(ctx.weather['9vgm0']).sort(), ['level', 'peak_mmph', 'precip24h_mm']);
});

test('declarations join county outlines by FIPS and survive missing outlines', async () => {
  const dec = { DisasterDeclarationsSummaries: [
    { disasterNumber: 5677, declarationTitle: 'HYDRA FIRE', incidentType: 'Fire', declarationDate: '2026-09-01T00:00:00.000Z', fipsStateCode: '48', fipsCountyCode: '113', designatedArea: 'Dallas (County)', declarationType: 'DR' },
    { disasterNumber: 5600, declarationTitle: 'STORMS', incidentType: 'Severe Storm', declarationDate: '2026-05-01T00:00:00.000Z', fipsStateCode: '48', fipsCountyCode: '113', designatedArea: 'Dallas (County)', declarationType: 'DR' },
    { disasterNumber: 5601, declarationTitle: 'FREEZE', incidentType: 'Freezing', declarationDate: '2026-02-01T00:00:00.000Z', fipsStateCode: '48', fipsCountyCode: '000', designatedArea: 'Statewide', declarationType: 'EM' },
  ] };
  const tiger = { features: [{ type: 'Feature', geometry: square(-97.0, 32.55, 0.4), properties: { GEOID: '48113', NAME: 'Dallas County' } }] };
  const f = stub([['fema.gov/api/open', reply(dec)], ['tigerweb', reply(tiger)]]);
  const out = await refreshLayer(db, {}, 'declarations', null, { fetcher: f, now: NOW });
  const dallas = out.features.find((x) => x.id === '48113');
  assert.equal(dallas.geometry.type, 'Polygon');
  assert.equal(dallas.properties.declarations.length, 2);
  assert.equal(dallas.properties.latest.title, 'HYDRA FIRE');
  assert.equal(out.features.find((x) => x.id === '48000').geometry, null);
  assert.ok(f.calls[0].includes("state%20eq%20'TX'") || f.calls[0].includes("state%20eq%20'TX'".replace(/'/g, '%27')));

  await db.collection('feed_cache').deleteMany({});
  const noTiger = stub([['fema.gov/api/open', reply(dec)], ['tigerweb', reply('x', 500)]]);
  const partial = await refreshLayer(db, {}, 'declarations', null, { fetcher: noTiger, now: NOW });
  assert.equal(partial.features.length, 2);
  assert.equal(partial.features.find((x) => x.id === '48113').geometry, null);
});

test('readCachedOverlays returns the risk context from cache only and never throws', async () => {
  await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ name: 'Evac' }) });
  await call('POST', '/api/overlays?layer=zones', { body: zoneBody({ name: 'Drill', exercise: true }) });
  const empty = await readCachedOverlays(db, { bbox: BOX, now: NOW });
  assert.deepEqual(Object.keys(empty).sort(), ['declarations', 'nfhl', 'nws', 'status', 'weather', 'zones']);
  assert.equal(empty.zones.length, 1);
  assert.equal(empty.zones[0].properties.type, 'evacuation');
  assert.equal(empty.zones[0].geometry.type, 'Polygon');
  assert.equal(empty.status.nfhl.status, 'unverified', 'nothing cached means unknown, not clear');
  assert.equal(empty.status.zones.status, 'ok');
  assert.deepEqual((await readCachedOverlays(db, { bbox: BOX, now: NOW, exercise: true })).zones.map((z) => z.properties.name), ['Drill']);

  const f = stub(routes());
  await refreshLayer(db, {}, 'nfhl', BOX, { fetcher: f, now: NOW });
  await refreshLayer(db, {}, 'nws', null, { fetcher: f, now: NOW });
  const before = f.calls.length;
  const ctx = await readCachedOverlays(db, { bbox: BOX, now: later(120), env: {} });
  assert.equal(f.calls.length, before);
  assert.equal(ctx.nfhl.length, 1);
  assert.equal(ctx.nfhl[0].properties.FLD_ZONE, 'AE');
  assert.equal(ctx.nws.length, 2);
  assert.equal(ctx.status.nws.status, 'stale', '2 minute alert cache has expired by 120 s');
  assert.equal(ctx.status.nfhl.status, 'ok');

  const broken = { collection: () => { throw new Error('db gone'); } };
  const safe = await readCachedOverlays(broken, { bbox: BOX, now: NOW });
  assert.equal(safe.status.zones.status, 'error');
  assert.deepEqual(safe.nws, []);
});

test('refreshContext warms stale layers then reads, ignoring failures', async () => {
  const f = stub([['api.weather.gov', reply(nwsBody)], ['NFHL', reply('x', 500)]]);
  const ctx = await refreshContext(db, {}, { bbox: BOX, layers: ['nws', 'nfhl'], now: NOW, fetcher: f });
  assert.equal(ctx.nws.length, 2);
  assert.deepEqual(ctx.nfhl, []);
  assert.equal(ctx.status.nfhl.status, 'unverified');
});

// ---------- feed endpoints ----------
test('GET /api/feeds lists every source with the documented fields', async () => {
  await refreshLayer(db, {}, 'nws', null, { fetcher: stub(routes()), now: NOW });
  const res = await handleFeeds(new Request('https://home.test/api/feeds'), {}, { db, operator: OP, now: later(30) });
  assert.equal(res.status, 200);
  const { sources, asOf } = await res.json();
  assert.ok(asOf);
  const ids = sources.map((s) => s.id);
  for (const id of ['nfhl', 'declarations', 'nws', 'gauges', 'quakes', 'weather', 'firms', 'airnow', 'eia', 'shelters', 'zones']) assert.ok(ids.includes(id), id);
  const nws = sources.find((s) => s.id === 'nws');
  assert.deepEqual(['id', 'name', 'status', 'fetchedAt', 'ageS', 'ttlS', 'featureCount', 'attribution'].filter((k) => !(k in nws)), []);
  assert.equal(nws.status, 'ok');
  assert.equal(nws.ageS, 30);
  assert.equal(nws.featureCount, 2);
  assert.equal(sources.find((s) => s.id === 'shelters').status, 'unverified');
  assert.equal(sources.find((s) => s.id === 'airnow').status, 'needs_key');
});

test('POST /api/feeds warms a layer for operators only', async () => {
  const f = stub(routes());
  const post = (operator, body) => handleFeeds(new Request('https://home.test/api/feeds', { method: 'POST', body: JSON.stringify(body) }), {}, { db, operator, fetcher: f, now: NOW });
  assert.equal((await post(DEMO, { layer: 'nws' })).status, 403);
  assert.equal((await post(OP, { layer: 'nope' })).status, 400);
  assert.equal((await post(OP, { layer: 'nfhl' })).status, 400, 'bbox required');
  const res = await post(OP, { layer: 'nws' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).featureCount, 2);
  assert.equal((await handleFeeds(new Request('https://home.test/api/feeds', { method: 'DELETE' }), {}, { db, operator: OP })).status, 405);
});

test('Pages Function wrappers pass the signed-in operator through', async () => {
  const { onRequest } = await import('../functions/api/overlays.js');
  const res = await onRequest({ request: new Request('https://home.test/api/overlays?layer=zones'), env: {}, data: { operator: { email: 'c@x.test', role: 'customer' } } });
  assert.equal(res.status, 403);
  const feeds = await import('../functions/api/feeds.js');
  assert.equal((await feeds.onRequest({ request: new Request('https://home.test/api/feeds'), env: {}, data: { operator: { role: 'customer' } } })).status, 403);
});
