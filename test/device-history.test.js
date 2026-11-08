import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { ensureDataStore, materializeDailyStats } from '../src/data-store.js';
import { deviceHistory } from '../src/device-history.js';
import { onRequest as customer } from '../functions/api/customer/history.js';
import { onRequest as ops } from '../functions/api/ops/device-history.js';
import { issueCustomerSession, customerCookie } from '../src/operator-session.js';

// Always disposable: never inherit a production connection string.
async function disposableMongo() {
  const server = await MongoMemoryServer.create();
  const client = await MongoClient.connect(server.getUri());
  return { db: client.db('device_history_test'), close: async () => { await client.close(); await server.stop(); } };
}
let isolated, db, ownerCookie, otherCookie;
const now = new Date('2026-11-08T12:00:00Z'), DAY = 86400000;
const env = { SESSION_SECRET: 'isolated-history-session-secret', API_ADMIN_KEY: 'isolated-history-admin' };
before(async () => {
  isolated = await disposableMongo(); db = isolated.db; await ensureDataStore(db);
  for (const email of ['owner@example.test', 'other@example.test']) await db.collection('customer_accounts').insertOne({ _id: email, createdAt: new Date(Date.now() - 1000) });
  ownerCookie = customerCookie(await issueCustomerSession(env, 'owner@example.test')).split(';')[0];
  otherCookie = customerCookie(await issueCustomerSession(env, 'other@example.test')).split(';')[0];
});
after(async () => isolated?.close());
async function device(extra = {}) {
  const _id = new ObjectId(); await db.collection('devices').insertOne({ _id, ...extra }); return _id;
}
async function sample(id, extra = {}) {
  const row = { meta: { deviceId: id }, eventId: new ObjectId().toString(), observedAt: now, clockSource: 'device', temperature_c: 20, humidity_pct: 50, battery_pct: 80, water_detected: false, main_power_available: true, ...extra };
  await db.collection('telemetry').insertOne(row); return row;
}
const call = (fn, id, options = {}) => fn({ env, injectedDb: db, now, request: new Request(`https://local.test/api/history?id=${id}${options.query || ''}`, { method: options.method || 'GET', headers: options.headers || {} }), data: options.data });

test('customer current cookie + active owner link; no identity/address leaks; ops denies demo', async () => {
  const id = await device({ homeId: new ObjectId(), name: 'PRIVATE', meta: { address: 'PRIVATE' } });
  const link = new ObjectId().toString();
  await db.collection('customer_links').insertOne({ _id: link, deviceId: id, customerEmail: 'owner@example.test', active: true });
  await sample(id); await materializeDailyStats(db, { now });
  assert.equal((await call(customer, link)).status, 401);
  assert.equal((await call(customer, link, { headers: { Cookie: otherCookie } })).status, 404);
  assert.equal((await call(customer, id, { headers: { Cookie: ownerCookie } })).status, 404);
  const r = await call(customer, link, { headers: { Cookie: ownerCookie } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const body = await r.json(); assert.deepEqual(Object.keys(body), ['days', 'local', 'daily', 'baseline']);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|deviceId|homeId|customerEmail|keyHash/);
  await db.collection('customer_links').updateOne({ _id: link }, { $set: { active: false } });
  assert.equal((await call(customer, link, { headers: { Cookie: ownerCookie } })).status, 404);
  assert.equal((await call(ops, id)).status, 401);
  assert.equal((await call(ops, id, { data: { operator: { role: 'demo' } } })).status, 403);
  assert.equal((await call(ops, id, { headers: { Authorization: 'Bearer isolated-history-admin' } })).status, 200);
  await db.collection('customer_links').updateOne({ _id: link }, { $set: { active: true } });
  await db.collection('customer_accounts').updateOne({ _id: 'owner@example.test' }, { $set: { passwordChangedAt: new Date(Date.now() + 1000) } });
  assert.equal((await call(customer, link, { headers: { Cookie: ownerCookie } })).status, 401);
});

test('qualified per-sensor count and span; hazards, missing validity, low battery and untrusted time excluded', async () => {
  const id = await device();
  for (let i = 0; i < 30; i++) await sample(id, { observedAt: new Date(+now - 3 * DAY + i * 2 * 3600000), temperature_c: 10 + i, ...(i ? { humidity_pct: undefined } : {}) });
  for (const extra of [{ water_detected: true }, { water_detected: null }, { main_power_available: false }, { main_power_available: null }, { battery_pct: 19 }, { battery_pct: null }, { temperature_c: 55 }, { clockSource: 'server_fallback' }, { clockSource: null }]) await sample(id, extra);
  await materializeDailyStats(db, { now });
  const h = await deviceHistory(db, String(id), { now });
  assert.equal(h.baseline.status, 'observed_reference');
  assert.equal(h.baseline.metrics.temperature_c.count, 30);
  assert.equal(h.baseline.metrics.temperature_c.mean, 24.5);
  assert.equal(h.baseline.metrics.humidity_pct.count, 1);
  assert.equal(h.baseline.metrics.humidity_pct.status, 'insufficient_history');
  assert.equal(h.daily.reduce((n, r) => n + (r.metrics.temperature_c?.count || 0), 0), 39);
  const short = await deviceHistory(db, String(id), { now, days: 1 });
  assert.equal(short.baseline.status, 'insufficient_history');
});

test('critical device or home incidents exclude baseline; exercise/simulation is never archived or served', async () => {
  const homeId = new ObjectId(), id = await device({ homeId });
  await sample(id); await materializeDailyStats(db, { now });
  const incident = await db.collection('incidents').insertOne({ homeId, deviceId: new ObjectId(), severity: 'critical', status: 'acknowledged' });
  assert.deepEqual((await deviceHistory(db, String(id), { now })).baseline.metrics, {});
  await materializeDailyStats(db, { now });
  assert.deepEqual((await db.collection('device_daily_stats').findOne({ deviceId: id })).qualifiedMetrics, {});
  await db.collection('incidents').updateOne({ _id: incident.insertedId }, { $set: { status: 'resolved' } });
  await materializeDailyStats(db, { now });
  assert.equal((await deviceHistory(db, String(id), { now })).baseline.metrics.temperature_c.count, 1);
  for (const flags of [{ meta: { exercise: true } }, { simulated: true }, { meta: { simulated: true } }]) {
    const excluded = await device(flags); await sample(excluded); await materializeDailyStats(db, { now });
    assert.equal(await db.collection('device_daily_stats').countDocuments({ deviceId: excluded }), 0);
    await assert.rejects(deviceHistory(db, String(excluded), { now }), /Live device not found/);
  }
});

test('daily recomputation is idempotent, late replay updates original day, missing metrics stay absent', async () => {
  const id = await device(); const row = await sample(id, { observedAt: new Date(+now - 5 * DAY), humidity_pct: undefined });
  const { _id, ...duplicate } = row; await db.collection('telemetry').insertOne(duplicate);
  await materializeDailyStats(db, { now }); await materializeDailyStats(db, { now });
  let h = await deviceHistory(db, String(id), { now });
  assert.equal(h.daily.length, 1); assert.equal(h.daily[0].metrics.temperature_c.count, 1);
  assert.equal(h.daily[0].day, '2026-11-03'); assert.equal(h.daily[0].metrics.humidity_pct, undefined);
  await sample(id, { observedAt: row.observedAt, temperature_c: 30 });
  await materializeDailyStats(db, { now });
  h = await deviceHistory(db, String(id), { now });
  assert.equal(h.daily[0].metrics.temperature_c.mean, 25); assert.equal(h.baseline.metrics.temperature_c.count, 2);
});

test('archive survives raw TTL, including the partial boundary day, without recounting', async () => {
  const id = await device();
  const metric = { mean: 22, min: 21, max: 23, count: 30, unit: '°C', label: 'Temperature' };
  for (const day of ['2026-09-01', '2026-10-09']) await db.collection('device_daily_stats').insertOne({ deviceId: id, day, metrics: { temperature_c: metric }, qualificationVersion: 1, qualifiedMetrics: { temperature_c: { ...metric, firstObservedAt: new Date(day + 'T00:00:00Z'), lastObservedAt: new Date(day + 'T23:00:00Z') } } });
  await sample(id, { observedAt: new Date('2026-10-09T18:00:00Z'), temperature_c: 99 });
  await materializeDailyStats(db, { now });
  await db.collection('telemetry').deleteMany({ 'meta.deviceId': id });
  await materializeDailyStats(db, { now });
  const h = await deviceHistory(db, String(id), { now });
  assert.equal(h.daily.length, 2); assert.equal(h.daily[1].metrics.temperature_c.mean, 22);
  assert.equal(h.baseline.metrics.temperature_c.count, 60); assert.equal(h.baseline.status, 'observed_reference');
});

test('invalid days, methods and missing IDs fail explicitly; empty history has no fabricated zeros', async () => {
  const id = await device();
  const h = await deviceHistory(db, String(id), { now });
  assert.deepEqual(h.daily, []); assert.deepEqual(h.baseline.metrics, {}); assert.equal(h.baseline.status, 'insufficient_history');
  for (const days of [0, 366, 1.5, NaN]) await assert.rejects(deviceHistory(db, String(id), { days }), /days must/);
  assert.equal((await call(ops, id, { method: 'POST' })).status, 405);
  assert.equal((await call(ops, 'invalid', { headers: { Authorization: 'Bearer isolated-history-admin' } })).status, 400);
});
