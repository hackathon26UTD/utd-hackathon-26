import { test, before, after } from 'node:test';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { handle } from '../src/app.js';
import { setupBeacon, reconcileReceipt } from '../src/beacon.js';
let server, client, db, device, key, home, uri;
const env = { API_ADMIN_KEY: 'test-admin' };
async function call(method, path, body, auth = 'admin', injected = db) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth === 'admin') headers.Authorization = 'Bearer test-admin';
  if (auth === 'device') headers['X-Device-Key'] = key;
  const r = await handle(new Request(`http://local/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env, { db: injected });
  return { status: r.status, body: await r.json() };
}
const reading = (id, extra = {}) => ({ device_id: device.id, event_id: id, observed_at: new Date(Date.now() - 1000).toISOString(), water_detected: true, ...extra });
before(async () => {
  if (!process.env.TEST_MONGODB_URI) server = await MongoMemoryServer.create();
  uri = process.env.TEST_MONGODB_URI || server.getUri();
  client = await MongoClient.connect(uri);
  db = client.db('beacon_test');
  assert.equal((await call('POST', '/setup')).status, 200);
  const h = await call('POST', '/beacon/homes', { label: 'Fictional home', location: { type: 'Point', coordinates: [-96.75, 32.98] } });
  home = h.body.home;
  const d = await call('POST', '/devices', { name: 'ESP32' });
  device = d.body.device; key = d.body.deviceKey;
  assert.equal((await call('PATCH', `/beacon/devices/${device.id}/home`, { home_id: home.id })).status, 200);
});
after(async () => { await client?.close(); await server?.stop(); });

test('bootstrap is idempotent, verifies time-series options, preserves other collections', async () => {
  await setupBeacon(db);
  const info = await db.listCollections({ name: 'telemetry' }).next();
  assert.equal(info.options.timeseries.timeField, 'observedAt');
  assert.equal(info.options.expireAfterSeconds, 2592000);
  const other = client.db('incompatible_test');
  await other.createCollection('telemetry');
  await assert.rejects(setupBeacon(other), /Existing telemetry/);
  await other.dropDatabase();
});
test('authenticated telemetry persists, retries deduplicate, and concurrent wet readings share an incident', async () => {
  const payload = reading('first', { sequence: 10, battery_pct: 80 });
  const first = await call('POST', '/beacon/ingest', payload, 'device');
  assert.equal(first.status, 202);
  assert.equal(first.body.incident_ids.length, 1);
  assert.equal((await call('POST', '/beacon/ingest', payload, 'device')).body.duplicate, true);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call('POST', '/beacon/ingest', reading(`concurrent-${i}`), 'device')));
  assert.ok(results.every(r => r.status === 202), JSON.stringify(results));
  assert.equal(await db.collection('incidents').countDocuments({ type: 'flood', status: 'open' }), 1);
  assert.equal(await db.collection('telemetry').countDocuments({ eventId: 'first' }), 1);
  assert.equal((await call('POST', '/beacon/ingest', { ...payload, battery_pct: 90 }, 'device')).status, 409);
  const history = await call('GET', `/beacon/devices/${device.id}/telemetry`);
  assert.equal(history.body.telemetry.length, 9);
  assert.ok((await db.collection('telemetry').findOne({ eventId: 'first' })).observedAt instanceof Date);
  const latest = await call('GET', `/devices/${device.id}`);
  assert.equal(latest.body.device.keyHash, undefined);
  assert.ok(latest.body.device.latestTelemetry);
  assert.equal((await call('GET', `/readings/latest?deviceId=${device.id}`)).body.latest.find(r => r.sensor === 'water_detected').value, true);
});
test('validation, device identity, auth, and query limits', async () => {
  for (const extra of [{ battery_pct: 101 }, { humidity_pct: -1 }, { temperature_c: 'hot' }, { water_detected: 1 }, { sequence: -1 }, { observed_at: 'yesterday' }, { observed_at: null }, { observed_at: new Date(Date.now() + 600000).toISOString() }]) {
    assert.equal((await call('POST', '/beacon/ingest', reading('invalid', extra), 'device')).status, 400);
  }
  assert.equal((await call('POST', '/beacon/ingest', null, 'device')).status, 400);
  assert.equal((await call('POST', '/beacon/ingest', reading('no-auth'), 'none')).status, 401);
  assert.equal((await call('POST', '/beacon/ingest', reading('wrong-device', { device_id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }), 'device')).status, 403);
  assert.equal((await call('GET', '/beacon/incidents', undefined, 'none')).status, 401);
  assert.equal((await call('GET', '/beacon/incidents?status=invalid')).status, 400);
  assert.equal((await call('GET', `/beacon/devices/${device.id}/telemetry?from=2020-01-01&to=2026-01-01`)).status, 400);
});
test('offline replay keeps newest device state; fallback clock retries remain stable', async () => {
  const fresh = reading('fresh', { water_detected: false, battery_pct: 88 });
  await call('POST', '/beacon/ingest', fresh, 'device');
  await call('POST', '/beacon/ingest', reading('old', { observed_at: new Date(Date.now() - 3600000).toISOString(), battery_pct: 12 }), 'device');
  assert.equal((await call('GET', `/devices/${device.id}`)).body.device.latestTelemetry.battery_pct, 88);
  const fallback = { device_id: device.id, event_id: 'fallback', main_power_available: false };
  assert.equal((await call('POST', '/beacon/ingest', fallback, 'device')).status, 202);
  assert.equal((await call('POST', '/beacon/ingest', fallback, 'device')).body.duplicate, true);
});
test('operator transitions are audited, dry readings do not auto-resolve, nearby homes uses geo index', async () => {
  const list = await call('GET', `/beacon/homes/${home.id}/incidents`);
  const flood = list.body.incidents.find(i => i.type === 'flood');
  await call('POST', '/beacon/ingest', reading('dry', { water_detected: false }), 'device');
  assert.equal((await call('PATCH', `/beacon/incidents/${flood.id}`, { status: 'acknowledged' }, 'none')).status, 401);
  assert.equal((await call('PATCH', `/beacon/incidents/${flood.id}`, { status: 'acknowledged' })).body.incident.status, 'acknowledged');
  assert.equal((await call('PATCH', `/beacon/incidents/${flood.id}`, { status: 'resolved' })).body.incident.status, 'resolved');
  assert.equal(await db.collection('incident_events').countDocuments({ eventType: 'status_change_result', outcome: 'applied' }), 2);
  assert.equal((await call('GET', '/beacon/homes/nearby?lat=32.98&lon=-96.75&radius_m=500')).body.homes.length, 1);
  assert.equal((await call('GET', '/beacon/homes/nearby?lat=99&lon=1')).status, 400);
});
test('partial write is not blindly retried; explicit reconciliation permits completion', async () => {
  const payload = reading('ambiguous');
  let failed = false;
  const broken = { collection(name) {
    if (name !== 'telemetry') return db.collection(name);
    return { async insertOne(doc) { await db.collection(name).insertOne(doc); failed = true; const e = new Error('private URI sentinel'); e.name = 'MongoNetworkError'; throw e; } };
  } };
  const res = await call('POST', '/beacon/ingest', payload, 'device', broken);
  assert.equal(res.status, 503); assert.ok(failed);
  assert.equal(JSON.stringify(res.body).includes('sentinel'), false);
  assert.equal((await call('POST', '/beacon/ingest', payload, 'device')).status, 409);
  await reconcileReceipt(db, `${device.id}:ambiguous`);
  assert.equal((await call('POST', '/beacon/ingest', payload, 'device')).status, 202);
  assert.equal(await db.collection('telemetry').countDocuments({ eventId: 'ambiguous' }), 1);
});

test('synthetic seed reruns without duplicating homes, telemetry or incidents', async () => {
  const run = promisify(execFile);
  const options = { env: { ...process.env, MONGODB_URI: uri, MONGODB_DB: 'beacon_seed_test', BEACON_DEMO_DEVICE_KEY: 'local-test-key-with-sufficient-entropy' } };
  await run(process.execPath, ['scripts/beacon-db.mjs', 'seed'], options);
  await run(process.execPath, ['scripts/beacon-db.mjs', 'seed'], options);
  const seeded = client.db('beacon_seed_test');
  assert.equal(await seeded.collection('homes').countDocuments(), 3);
  assert.equal(await seeded.collection('devices').countDocuments({ 'meta.exercise': true }), 3);
  assert.equal(await seeded.collection('telemetry').countDocuments(), 2);
  assert.equal(await seeded.collection('incidents').countDocuments({ simulated: true }), 2);
  await seeded.dropDatabase();
});

test('ingestion refuses an unbootstrapped DB before creating an ordinary telemetry collection', async () => {
  const empty = client.db('beacon_uninitialized');
  const originalDevice = await db.collection('devices').findOne({ _id: new ObjectId(device.id) });
  const originalHome = await db.collection('homes').findOne({ _id: originalDevice.homeId });
  await empty.collection('devices').insertOne(originalDevice);
  await empty.collection('homes').insertOne(originalHome);
  assert.equal((await call('POST', '/beacon/ingest', reading('before-setup'), 'device', empty)).status, 503);
  assert.equal(await empty.listCollections({ name: 'telemetry' }).next(), null);
  await empty.dropDatabase();
});

test('high temperature opens an incident; post-persist retry does not reopen a resolved incident', async () => {
  const hot = await call('POST', '/beacon/ingest', reading('hot', { water_detected: false, temperature_c: 56 }), 'device');
  assert.equal(hot.status, 202);
  assert.equal((await call('GET', '/beacon/incidents?status=open&severity=high')).body.incidents[0].type, 'high_temperature');
  const payload = reading('partial-projection');
  const broken = { collection(name) {
    if (name !== 'readings') return db.collection(name);
    return { async updateOne() { const e = new Error('test write failure'); e.name = 'MongoNetworkError'; throw e; } };
  } };
  assert.equal((await call('POST', '/beacon/ingest', payload, 'device', broken)).status, 503);
  const receiptId = `${device.id}:partial-projection`;
  assert.equal((await db.collection('ingestion_receipts').findOne({ _id: receiptId })).state, 'persisted');
  const observation = await db.collection('incident_events').findOne({ _id: `${receiptId}:flood` });
  assert.equal((await call('PATCH', `/beacon/incidents/${observation.incidentId}`, { status: 'resolved' })).status, 200);
  const replay = await call('POST', '/beacon/ingest', payload, 'device');
  assert.equal(replay.status, 202);
  assert.deepEqual(replay.body.incident_ids, [String(observation.incidentId)]);
  assert.equal(await db.collection('incidents').countDocuments({ type: 'flood', status: 'open' }), 0);
  assert.equal(await db.collection('telemetry').countDocuments({ eventId: 'partial-projection' }), 1);
});
