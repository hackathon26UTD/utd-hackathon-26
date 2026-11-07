// Flood-zone routes against an in-memory MongoDB with a fake FEMA service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { handle } from '../src/app.js';
import { classifyZone, setFloodFetch } from '../src/flood.js';

const ADMIN = 'ak_flood_test';
let mongod, client, db, femaCalls = 0;

const fema = (features) => async (url) => {
  femaCalls++;
  const u = new URL(url);
  if (u.searchParams.get('f') === 'geojson') {
    return Response.json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-96.8, 32.7], [-96.79, 32.7], [-96.79, 32.71], [-96.8, 32.7]]] }, properties: { FLD_ZONE: 'AE', ZONE_SUBTY: 'FLOODWAY', SFHA_TF: 'T', STATIC_BFE: -9999 } }] });
  }
  return Response.json({ features });
};

before(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db('flood_test');
});
after(async () => { setFloodFetch((...a) => fetch(...a)); await client?.close(); await mongod?.stop(); });

const call = async (method, path) => {
  const res = await handle(new Request(`http://local/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN}` } }), { API_ADMIN_KEY: ADMIN }, { db });
  return { status: res.status, body: await res.json() };
};

test('classifyZone maps FEMA designations to plain risk levels', () => {
  assert.equal(classifyZone({ FLD_ZONE: 'AE', SFHA_TF: 'T' }), 'high');
  assert.equal(classifyZone({ FLD_ZONE: 'VE', SFHA_TF: 'T' }), 'high');
  assert.equal(classifyZone({ FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F' }), 'moderate');
  assert.equal(classifyZone({ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE', SFHA_TF: 'F' }), 'moderate');
  assert.equal(classifyZone({ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' }), 'minimal');
  assert.equal(classifyZone({ FLD_ZONE: 'D', SFHA_TF: 'F' }), 'undetermined');
  assert.equal(classifyZone(undefined), 'unmapped');
});

test('zone lookup picks the most severe polygon and caches it', async () => {
  setFloodFetch(fema([
    { attributes: { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999 } },
    { attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T', STATIC_BFE: 412 } },
  ]));
  femaCalls = 0;
  const a = await call('GET', '/flood/zone?lat=32.7&lon=-96.8');
  assert.equal(a.status, 200);
  assert.equal(a.body.risk, 'high');
  assert.equal(a.body.zone, 'AE');
  assert.equal(a.body.baseFloodElevationFt, 412);
  assert.equal(a.body.cached, false);
  const b = await call('GET', '/flood/zone?lat=32.7&lon=-96.8');
  assert.equal(b.body.cached, true);
  assert.equal(femaCalls, 1, 'second lookup served from MongoDB');
});

test('unmapped points and bad input', async () => {
  setFloodFetch(fema([]));
  assert.equal((await call('GET', '/flood/zone?lat=40&lon=-100')).body.risk, 'unmapped');
  assert.equal((await call('GET', '/flood/zone?lat=abc&lon=1')).status, 400);
  assert.equal((await call('GET', '/flood/zones?bbox=-97,32,-96,33')).status, 400, 'bbox too large');
  assert.equal((await call('GET', '/flood/zones?bbox=1,2,3')).status, 400);
});

test('FEMA outage returns 503, not a crash', async () => {
  setFloodFetch(async () => { throw new Error('network down'); });
  const r = await call('GET', '/flood/zone?lat=10&lon=10');
  assert.equal(r.status, 503);
});

test('polygons come back as GeoJSON with risk and are cached', async () => {
  setFloodFetch(fema([]));
  femaCalls = 0;
  const r = await call('GET', '/flood/zones?bbox=-96.84,32.76,-96.80,32.79');
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 'FeatureCollection');
  assert.equal(r.body.features[0].properties.risk, 'high');
  assert.equal((await call('GET', '/flood/zones?bbox=-96.84,32.76,-96.80,32.79')).body.cached, true);
  assert.equal(femaCalls, 1);
});

test('home refresh adds floodZone to homes only', async () => {
  setFloodFetch(fema([{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999 } }]));
  await db.collection('homes').insertMany([
    { label: 'House 1', location: { type: 'Point', coordinates: [-96.73, 32.95] } },
    { label: 'House 2', location: { type: 'Point', coordinates: [-96.74, 32.96] } },
  ]);
  const r = await call('POST', '/flood/homes/refresh');
  assert.equal(r.body.updated, 2);
  assert.deepEqual(r.body.byRisk, { moderate: 2 });
  const h = await db.collection('homes').findOne({ label: 'House 1' });
  assert.equal(h.floodZone.risk, 'moderate');
  assert.equal(h.label, 'House 1');
  assert.equal((await call('POST', '/flood/homes/refresh')).body.checked, 0, 'fresh homes are skipped');
});
