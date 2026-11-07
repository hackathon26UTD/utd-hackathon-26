// End-to-end API tests against a real (in-memory) MongoDB server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { handle } from '../src/app.js';

const ADMIN = 'ak_test_admin';
let mongod, client, db, env;

before(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db('api_test');
  env = { API_ADMIN_KEY: ADMIN, MONGODB_URI: mongod.getUri(), MONGODB_DB: 'api_test' };
});
after(async () => {
  await client?.close();
  await mongod?.stop();
});

async function call(method, path, { body, admin, deviceKey, envOverride, real } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers.Authorization = `Bearer ${ADMIN}`;
  if (deviceKey) headers['X-Device-Key'] = deviceKey;
  const req = new Request(`http://local/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  // `real` exercises the per-request MongoClient path used on Cloudflare.
  const res = await handle(req, { ...env, ...envOverride }, real ? {} : { db });
  return { status: res.status, body: res.status === 204 ? null : await res.json(), headers: res.headers };
}

test('health pings the real database through MONGODB_URI', async () => {
  const r = await call('GET', '/health', { real: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.mongodb.reachable, true);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test('setup creates indexes via a real connection', async () => {
  const r = await call('POST', '/setup', { admin: true, real: true });
  assert.equal(r.status, 200);
});

test('write endpoints require the admin key', async () => {
  assert.equal((await call('POST', '/devices', { body: { name: 'x' } })).status, 401);
  assert.equal((await call('GET', '/devices')).status, 401);
  assert.equal((await call('GET', '/devices', { envOverride: { API_PUBLIC_READ: 'true' } })).status, 200);
});

test('device lifecycle, ingest, rules, alerts', async () => {
  const created = await call('POST', '/devices', { admin: true, body: { name: 'Fridge sensor', type: 'esp32' } });
  assert.equal(created.status, 201);
  const { deviceKey, device } = created.body;
  assert.match(deviceKey, /^dk_[0-9a-f]{48}$/);
  assert.equal(device.keyHash, undefined, 'key hash must never be returned');

  assert.equal((await call('POST', '/ingest', { deviceKey: 'dk_wrong', body: { sensor: 't', value: 1 } })).status, 401);

  const rule = await call('POST', '/rules', { admin: true, body: { sensor: 'temp_c', op: '>', threshold: 8, severity: 'critical', message: 'Fridge too warm' } });
  assert.equal(rule.status, 201);

  const ok = await call('POST', '/ingest', { deviceKey, body: { readings: [{ sensor: 'temp_c', value: 4.2, unit: 'C' }, { sensor: 'door', value: true }] } });
  assert.deepEqual(ok.body, { accepted: 2, alertsTriggered: 0 });

  const hot = await call('POST', '/ingest', { deviceKey, body: { sensor: 'temp_c', value: 9.5 } });
  assert.equal(hot.body.alertsTriggered, 1);
  const again = await call('POST', '/ingest', { deviceKey, body: [{ sensor: 'temp_c', value: 10 }, { sensor: 'temp_c', value: 11 }] });
  assert.equal(again.body.alertsTriggered, 0, 'open alert is deduplicated');

  const alerts = await call('GET', '/alerts?status=open', { admin: true });
  assert.equal(alerts.body.alerts.length, 1);
  assert.equal(alerts.body.alerts[0].count, 3);
  assert.equal(alerts.body.alerts[0].lastValue, 11);

  const ack = await call('PATCH', `/alerts/${alerts.body.alerts[0].id}`, { admin: true, body: { status: 'resolved' } });
  assert.equal(ack.body.alert.status, 'resolved');

  const latest = await call('GET', `/readings/latest?deviceId=${device.id}`, { admin: true });
  const temp = latest.body.latest.find((x) => x.sensor === 'temp_c');
  assert.equal(temp.value, 11);

  const list = await call('GET', '/readings?sensor=temp_c&limit=2', { admin: true });
  assert.equal(list.body.count, 2);

  const stats = await call('GET', '/readings/stats?sensor=temp_c&bucket=3600', { admin: true });
  assert.equal(stats.body.series.length, 1);
  assert.equal(stats.body.series[0].max, 11);

  const dev = await call('GET', `/devices/${device.id}`, { admin: true });
  assert.equal(dev.body.device.readingCount, 5);
  assert.ok(dev.body.device.lastSeen);

  const rotated = await call('PATCH', `/devices/${device.id}`, { admin: true, body: { rotateKey: true } });
  assert.notEqual(rotated.body.deviceKey, deviceKey);
  assert.equal((await call('POST', '/ingest', { deviceKey, body: { sensor: 'x', value: 1 } })).status, 401);
});

test('ingest validation', async () => {
  const { deviceKey } = (await call('POST', '/devices', { admin: true, body: { name: 'v' } })).body;
  assert.equal((await call('POST', '/ingest', { deviceKey, body: { sensor: 'bad sensor!', value: 1 } })).status, 400);
  assert.equal((await call('POST', '/ingest', { deviceKey, body: { sensor: 'ok', value: { nested: 1 } } })).status, 400);
  assert.equal((await call('POST', '/ingest', { deviceKey, body: Array.from({ length: 501 }, () => ({ sensor: 'a', value: 1 })) })).status, 400);
});

test('events from devices and admins', async () => {
  const { deviceKey } = (await call('POST', '/devices', { admin: true, body: { name: 'button' } })).body;
  assert.equal((await call('POST', '/events', { deviceKey, body: { type: 'button.press', data: { n: 1 } } })).status, 201);
  assert.equal((await call('POST', '/events', { admin: true, body: { type: 'demo.start' } })).status, 201);
  assert.equal((await call('POST', '/events', { body: { type: 'anon' } })).status, 401);
  const ev = await call('GET', '/events?type=button.press', { admin: true });
  assert.equal(ev.body.events.length, 1);
});

test('generic store CRUD and injection safety', async () => {
  const c = await call('POST', '/store/tasks', { admin: true, body: { title: 'Wire sensor', status: 'open', $where: 'evil', 'a.b': 1 } });
  assert.equal(c.status, 201);
  assert.equal(c.body.item.$where, undefined);
  assert.equal(c.body.item['a.b'], undefined);
  const id = c.body.item.id;
  await call('POST', '/store/tasks', { admin: true, body: { title: 'Pitch', status: 'done' } });

  const open = await call('GET', `/store/tasks?filter=${encodeURIComponent('{"status":"open"}')}`, { admin: true });
  assert.equal(open.body.count, 1);
  assert.equal((await call('GET', `/store/tasks?filter=${encodeURIComponent('{"status":{"$ne":1}}')}`, { admin: true })).status, 400);

  const p = await call('PATCH', `/store/tasks/${id}`, { admin: true, body: { status: 'done' } });
  assert.equal(p.body.item.status, 'done');
  assert.equal((await call('GET', `/store/tasks/${id}`, { admin: true })).body.item.title, 'Wire sensor');
  assert.equal((await call('DELETE', `/store/tasks/${id}`, { admin: true })).status, 200);
  assert.equal((await call('GET', `/store/tasks/${id}`, { admin: true })).status, 404);
  assert.equal((await call('GET', '/store/Bad-Name', { admin: true })).status, 400);
});

test('routing errors and CORS preflight', async () => {
  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('PUT', '/devices', { admin: true })).status, 405);
  assert.equal((await call('GET', '/devices/notanid', { admin: true })).status, 400);
  assert.equal((await call('OPTIONS', '/ingest')).status, 204);
});

test('missing database config returns 503, not a crash', async () => {
  const req = new Request('http://local/api/devices', { headers: { Authorization: `Bearer ${ADMIN}` } });
  const res = await handle(req, { API_ADMIN_KEY: ADMIN });
  assert.equal(res.status, 503);
});
