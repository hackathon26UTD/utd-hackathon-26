// Live polling, device detail, logs, audit and the ingest hook (module C).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { handle } from '../src/app.js';
import { sha256Hex } from '../src/auth.js';
import { geohashBounds, getLive, queryLogs, writeAudit, writeDeviceLog, ensureLiveIndexes } from '../src/live.js';
import { opsLive, opsDevice, opsLogs, deviceLogs, ingestWithDownlink } from '../src/live-api.js';

const env = { API_ADMIN_KEY: 'test-admin' };
let server, client, db;
const T0 = new Date('2026-11-07T12:00:00Z');
const mins = (n) => new Date(T0.getTime() - n * 60_000);

before(async () => {
  if (!process.env.TEST_MONGODB_URI) server = await MongoMemoryServer.create();
  client = await MongoClient.connect(process.env.TEST_MONGODB_URI || server.getUri());
  db = client.db('live_test');
  await ensureLiveIndexes(db);
});
after(async () => { await client?.close(); await server?.stop(); });

const ctxOf = (method, path, { body, admin = true, key, data, now } = {}) => ({
  request: new Request(`http://local${path}`, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer test-admin' } : {}), ...(key ? { 'X-Device-Key': key } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  env, data, injectedDb: db, now,
});
const call = async (fn, ...args) => { const r = await fn(ctxOf(...args)); return { status: r.status, body: await r.json(), headers: r.headers }; };

async function addHome(lng, lat) {
  const _id = new ObjectId();
  await db.collection('homes').insertOne({ _id, label: 'Fictional', location: { type: 'Point', coordinates: [lng, lat] } });
  return _id;
}
async function addDevice(name, { lng, lat, exercise = false, lastSeen = T0, key = `dk_${name}` } = {}) {
  const homeId = lng === undefined ? undefined : await addHome(lng, lat);
  const doc = { name, keyHash: await sha256Hex(key), disabled: false, createdAt: T0, lastSeen, ...(homeId ? { homeId } : {}), meta: exercise ? { exercise: true } : {} };
  const r = await db.collection('devices').insertOne(doc);
  return { id: String(r.insertedId), oid: r.insertedId, key };
}
const reading = (d, sensor, value, ts, unit) => db.collection('readings').insertOne({ deviceId: d.oid, sensor, value, ts, ...(unit ? { unit } : {}) });

test('geohash cells decode to their box', () => {
  const [w, s, e, n] = geohashBounds('9vgm0');
  assert.ok(w < -96.65 && e > -96.65 && s < 33.24 && n > 33.24, `${w},${s},${e},${n}`);
  assert.ok(e - w < 0.05 && n - s < 0.05, 'a 5 character cell is about 4.9 km wide');
  assert.equal(geohashBounds('abc!'), null);
});

test('operator endpoints refuse anonymous callers and demo cannot write', async () => {
  assert.equal((await call(opsLive, 'GET', '/api/ops/live', { admin: false })).status, 401);
  assert.equal((await call(opsLogs, 'GET', '/api/ops/logs', { admin: false })).status, 401);
  const demo = await call(opsLive, 'GET', '/api/ops/live', { admin: false, data: { operator: { role: 'demo' } } });
  assert.equal(demo.status, 200);
  assert.equal(demo.body.mode, 'exercise');
  assert.equal((await call(opsLive, 'POST', '/api/ops/live')).status, 405);
});

test('snapshot returns devices with latest readings, link, help, offline flag and a cursor', async () => {
  const a = await addDevice('snap-a', { lng: -96.75, lat: 32.98 });
  const b = await addDevice('snap-b', { lng: -96.74, lat: 32.99, lastSeen: mins(40) });
  const never = await addDevice('snap-never', { lng: -96.73, lat: 32.97, lastSeen: null });
  await reading(a, 'temp_c', 22, mins(1), 'C');
  await reading(a, 'temp_c', 24, mins(0.5), 'C');
  await reading(a, 'water_detected', false, mins(1));
  await db.collection('customer_links').insertOne({ deviceId: a.id, customerEmail: 'x@example.test', contactName: 'Pat', consent: true, active: true, linkedAt: mins(5) });
  await db.collection('device_help').insertOne({ _id: a.id, status: 'help_on_the_way', updatedAt: mins(2), history: [] });
  const r = await getLive(db, { now: T0, env });
  assert.equal(r.reset, true);
  assert.match(r.cursor, /^v1\.\d+$/);
  assert.equal(Number(r.cursor.slice(3)), T0.getTime() - 2000);
  const da = r.devices.find((d) => d.id === a.id);
  assert.equal(da.latest.temp_c.value, 24);
  assert.equal(da.latest.temp_c.unit, 'C');
  assert.equal(da.offline, false);
  assert.deepEqual(da.link, { linked: true, contactName: 'Pat', consent: true });
  assert.equal(da.help.status, 'help_on_the_way');
  assert.deepEqual([da.lng, da.lat], [-96.75, 32.98]);
  assert.equal(r.devices.find((d) => d.id === b.id).offline, true);
  const dn = r.devices.find((d) => d.id === never.id);
  assert.equal(dn.offline, true, 'a device that never reported is unknown, not healthy');
  assert.equal(dn.lastSeen, null);
  assert.deepEqual(dn.link, { linked: false });
  assert.equal(dn.help.status, 'none');
  assert.ok(['ok', 'unavailable'].includes(r.sources.risk));
});

test('exercise and live data stay apart, and only operators can ask for exercise', async () => {
  await addDevice('ex-1', { lng: -96.6, lat: 32.9, exercise: true });
  const live = await getLive(db, { now: T0 });
  assert.ok(!live.devices.some((d) => d.name === 'ex-1'));
  const ex = await getLive(db, { now: T0, exercise: true });
  assert.equal(ex.mode, 'exercise');
  assert.ok(ex.devices.length && ex.devices.every((d) => /^ex-/.test(d.name)));
  const viaHttp = await call(opsLive, 'GET', '/api/ops/live?mode=exercise');
  assert.ok(viaHttp.body.devices.some((d) => d.name === 'ex-1'));
  const demo = await call(opsLive, 'GET', '/api/ops/live', { admin: false, data: { operator: { role: 'demo' } } });
  assert.ok(demo.body.devices.every((d) => /^ex-/.test(d.name)));
});

test('region, bbox and single device filters', async () => {
  const inside = await addDevice('geo-in', { lng: -96.75, lat: 32.98 });
  await addDevice('geo-out', { lng: -90.0, lat: 30.0 });
  const bb = await getLive(db, { now: T0, bbox: [-96.8, 32.9, -96.7, 33.0] });
  assert.ok(bb.devices.some((d) => d.name === 'geo-in'));
  assert.ok(!bb.devices.some((d) => d.name === 'geo-out'));
  await addDevice('geo-cell', { lng: -96.66, lat: 33.24 });
  const [w, s, e, n] = geohashBounds('9vgm0');
  const gh = await call(opsLive, 'GET', '/api/ops/live?region=gh5:9vgm0');
  assert.equal(gh.status, 200);
  assert.deepEqual(gh.body.devices.map((d) => d.name), ['geo-cell']);
  for (const d of gh.body.devices) assert.ok(d.lng >= w && d.lng <= e && d.lat >= s && d.lat <= n);
  assert.equal((await call(opsLive, 'GET', '/api/ops/live?region=gh5:zzzz')).status, 400);
  assert.equal((await call(opsLive, 'GET', '/api/ops/live?bbox=1,2,3')).status, 400);
  const one = await call(opsLive, 'GET', `/api/ops/live?device_id=${inside.id}`);
  assert.deepEqual(one.body.devices.map((d) => d.id), [inside.id]);
  assert.equal((await call(opsLive, 'GET', `/api/ops/live?device_id=${new ObjectId()}`)).status, 404);
  assert.equal((await call(opsLive, 'GET', '/api/ops/live?device_id=nope')).status, 400);
});

test('incremental polls return only what changed, including help, newly offline and logs', async () => {
  const quiet = await addDevice('inc-quiet', { lng: -96.5, lat: 33.5, lastSeen: mins(1) });
  const busy = await addDevice('inc-busy', { lng: -96.5, lat: 33.51, lastSeen: mins(1) });
  const fading = await addDevice('inc-fading', { lng: -96.5, lat: 33.52, lastSeen: mins(16) });
  const box = [-96.6, 33.4, -96.4, 33.6];
  const first = await getLive(db, { now: mins(10), bbox: box });
  assert.equal(first.reset, true);
  // 10 minutes later: busy reports, someone sets help status, fading crossed the 15 minute line.
  await db.collection('devices').updateOne({ _id: busy.oid }, { $set: { lastSeen: mins(0.1) } });
  await db.collection('device_help').updateOne({ _id: quiet.id }, { $set: { status: 'review_queued', updatedAt: mins(0.2) } }, { upsert: true });
  await writeDeviceLog(db, { deviceId: busy.id, level: 'warn', code: 'test.log', msg: 'hello', at: mins(0.1) });
  await writeAudit(db, { actor: { type: 'operator', id: 'op@example.test' }, action: 'help.set', deviceId: quiet.id, at: mins(0.2), details: { status: 'review_queued' } });
  const second = await getLive(db, { now: T0, since: first.cursor, bbox: box });
  assert.equal(second.reset, false);
  const ids = second.devices.map((d) => d.name).sort();
  assert.deepEqual(ids, ['inc-busy', 'inc-fading', 'inc-quiet']);
  assert.equal(second.devices.find((d) => d.name === 'inc-fading').offline, true);
  assert.deepEqual(second.helpChanged.map((h) => [h.deviceId, h.status]), [[quiet.id, 'review_queued']]);
  assert.ok(second.logs.some((l) => l.code === 'test.log'));
  assert.ok(second.audit.some((a) => a.action === 'help.set'));
  // Nothing changed after that: the next poll is empty.
  const third = await getLive(db, { now: new Date(T0.getTime() + 60_000), since: second.cursor, bbox: box });
  assert.equal(third.devices.length, 0);
  assert.equal(third.logs.length, 0);
});

test('an old cursor falls back to a snapshot and a malformed cursor is refused', async () => {
  const old = `v1.${T0.getTime() - 3600_000}`;
  assert.equal((await getLive(db, { now: T0, since: old })).reset, true);
  const bad = await call(opsLive, 'GET', '/api/ops/live?since=yesterday');
  assert.equal(bad.status, 400);
});

test('messages and incidents appear in the live feed for in-scope devices', async () => {
  const d = await addDevice('feed-dev', { lng: -96.45, lat: 33.7 });
  await db.collection('message_deliveries').insertOne({ _id: `m1:${d.id}`, messageId: 'm1', deviceId: d.id, state: 'delivered', seq: 1, expiresAt: new Date(T0.getTime() + 3600_000), updatedAt: mins(1), createdAt: mins(5) });
  await db.collection('message_deliveries').insertOne({ _id: `m2:${d.id}`, messageId: 'm2', deviceId: d.id, state: 'queued', seq: 2, expiresAt: mins(30), updatedAt: mins(60), createdAt: mins(61) });
  await db.collection('incidents').insertOne({ deviceId: d.oid, type: 'flood', severity: 'critical', status: 'open', detectedAt: mins(3), updatedAt: mins(1), createdAt: mins(3) });
  const r = await getLive(db, { now: T0, deviceId: d.id });
  const m1 = r.messages.find((m) => m.id === 'm1');
  assert.equal(m1.state, 'delivered');
  assert.equal(r.messages.find((m) => m.id === 'm2')?.state, 'expired', 'overdue queued messages read as expired');
  assert.equal(r.incidents[0].type, 'flood');
});

test('device detail has a 60 minute series, logs, help history and link', async () => {
  const d = await addDevice('detail-dev', { lng: -96.7, lat: 32.8 });
  for (let i = 0; i < 5; i++) await reading(d, 'humidity_pct', 50 + i, mins(10 - i));
  await reading(d, 'humidity_pct', 99, mins(90));
  await writeDeviceLog(db, { deviceId: d.id, level: 'info', code: 'x', msg: 'one', at: mins(1) });
  await db.collection('device_help').insertOne({ _id: d.id, status: 'resolved', note: 'done', updatedAt: mins(1), history: [{ status: 'review_queued', at: mins(5) }] });
  const r = await call(opsDevice, 'GET', `/api/ops/device?id=${d.id}`, { now: T0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.series.humidity_pct.length, 5, 'only the last 60 minutes');
  assert.equal(r.body.latest.humidity_pct.value, 54);
  assert.equal(r.body.logs.length, 1);
  assert.equal(r.body.help.status, 'resolved');
  assert.equal(r.body.help.history.length, 1);
  assert.deepEqual(r.body.link, { linked: false });
  assert.equal((await call(opsDevice, 'GET', '/api/ops/device?id=bad')).status, 400);
  assert.equal((await call(opsDevice, 'GET', `/api/ops/device?id=${new ObjectId()}`)).status, 404);
  const ex = await addDevice('detail-ex', { exercise: true });
  assert.equal((await call(opsDevice, 'GET', `/api/ops/device?id=${ex.id}`)).status, 404, 'exercise device is not visible in live mode');
  assert.equal((await call(opsDevice, 'GET', `/api/ops/device?id=${ex.id}`, { admin: false, data: { operator: { role: 'demo' } } })).status, 200);
});

test('server Wi-Fi display preview is exact-device scoped and leaves telemetry and risk unchanged', async () => {
  const d = await addDevice('wifi-preview', { lng: -96.7, lat: 32.8 });
  const other = await addDevice('wifi-preview-other');
  const ex = await addDevice('wifi-preview-exercise', { exercise: true });
  await reading(d, 'wifi_connected', false, mins(1));
  const before = await call(opsDevice, 'GET', `/api/ops/device?id=${d.id}`, { now: T0 });
  const readWithPreview = async (id, mode = '') => {
    const ctx = ctxOf('GET', `/api/ops/device?id=${id}${mode}`, { now: T0 });
    ctx.env = { ...env, WIFI_PREVIEW_DEVICE_IDS: `invalid, ${d.id.toUpperCase()}, ${ex.id}` };
    const response = await opsDevice(ctx);
    assert.equal(response.status, 200);
    return response.json();
  };
  const after = await readWithPreview(d.id);
  assert.equal(before.body.displayPreview, null);
  assert.deepEqual(after.displayPreview, { wifiConnected: true, source: 'simulation' });
  assert.deepEqual({ ...after, displayPreview: null }, before.body, 'only presentation metadata changes');
  assert.equal(after.latest.wifi_connected.value, false);
  assert.equal((await db.collection('readings').findOne({ deviceId: d.oid })).value, false);
  assert.equal(await db.collection('readings').countDocuments({ deviceId: d.oid }), 1);
  assert.equal((await readWithPreview(other.id)).displayPreview, null);
  assert.equal((await readWithPreview(ex.id, '&mode=exercise')).displayPreview, null);
  const anonymous = ctxOf('GET', `/api/ops/device?id=${d.id}`, { admin: false, now: T0 });
  anonymous.env = { ...env, WIFI_PREVIEW_DEVICE_IDS: d.id };
  assert.equal((await opsDevice(anonymous)).status, 401);
});

test('audit entries drop anything that looks like a credential', async () => {
  await writeAudit(db, { actor: { type: 'operator', id: 'op@example.test' }, action: 'pair.create', details: { serial: 'HB-1', pairingCode: '123456', password: 'x', deviceKey: 'dk_abc', nested: { token: 't', ok: 1 } } });
  const row = await db.collection('audit_log').findOne({ action: 'pair.create' });
  assert.deepEqual(row.details, { serial: 'HB-1', nested: { ok: 1 } });
  const r = await writeDeviceLog(db, { deviceId: new ObjectId(), level: 'info', code: 'k', msg: 'key is dk_0123456789abcdef0123456789abcdef0123456789abcdef' });
  assert.equal(r, true);
  assert.equal((await db.collection('device_logs').findOne({ code: 'k' })).msg, '[redacted]');
});

test('log query filters by device, region, level, time and mode', async () => {
  const a = await addDevice('log-a', { lng: -96.3, lat: 33.3 });
  const b = await addDevice('log-b', { lng: -80.0, lat: 25.0 });
  const e = await addDevice('log-ex', { lng: -96.3, lat: 33.3, exercise: true });
  await writeDeviceLog(db, { deviceId: a.id, level: 'error', code: 'l1', msg: 'a error', at: mins(5) });
  await writeDeviceLog(db, { deviceId: a.id, level: 'info', code: 'l2', msg: 'a info', at: mins(4) });
  await writeDeviceLog(db, { deviceId: b.id, level: 'info', code: 'l3', msg: 'b info', at: mins(3) });
  await writeDeviceLog(db, { deviceId: e.id, level: 'info', code: 'l4', msg: 'ex info', at: mins(2), exercise: true });
  await writeAudit(db, { actor: { type: 'operator', id: 'op' }, action: 'zone.create', region: 'gh5:9vgm0', at: mins(1), details: {} });
  const one = await queryLogs(db, { kind: 'device', deviceId: a.id });
  assert.deepEqual(one.entries.map((x) => x.code), ['l2', 'l1'], 'newest first');
  assert.deepEqual((await queryLogs(db, { kind: 'device', deviceId: a.id, level: 'error' })).entries.map((x) => x.code), ['l1']);
  const region = await queryLogs(db, { kind: 'all', bbox: [-96.4, 33.2, -96.2, 33.4], regionKey: 'gh5:9vgm0' });
  assert.ok(region.entries.some((x) => x.code === 'l1') && !region.entries.some((x) => x.code === 'l3' || x.code === 'l4'));
  assert.ok(region.entries.some((x) => x.action === 'zone.create'), 'audit entries tagged with the region');
  const timed = await queryLogs(db, { kind: 'device', deviceId: a.id, since: mins(4.5), until: mins(3.5) });
  assert.deepEqual(timed.entries.map((x) => x.code), ['l2']);
  assert.ok((await queryLogs(db, { kind: 'device', exercise: true })).entries.every((x) => x.code === 'l4' || x.deviceId !== a.id));
  const http = await call(opsLogs, 'GET', `/api/ops/logs?kind=device&device_id=${a.id}&limit=1`);
  assert.equal(http.body.entries.length, 1);
  assert.equal((await call(opsLogs, 'GET', '/api/ops/logs?kind=bogus')).status, 400);
  assert.equal((await call(opsLogs, 'GET', '/api/ops/logs?level=loud')).status, 400);
});

test('device log upload validates, caps and redacts', async () => {
  const d = await addDevice('logup', { lng: -96.2, lat: 33.0, key: 'dk_logup_key' });
  const ok = await call(deviceLogs, 'POST', '/api/device/logs', { admin: false, key: d.key, body: { entries: [
    { ts: new Date().toISOString(), level: 'warn', code: 'wifi.drop', msg: 'WiFi lost' },
    { level: 'error', code: 'oops', msg: 'token is dk_0123456789abcdef0123456789abcdef0123456789abcdef' },
  ] } });
  assert.equal(ok.status, 202);
  assert.equal(ok.body.accepted, 2);
  const rows = await db.collection('device_logs').find({ deviceId: d.id }).sort({ code: 1 }).toArray();
  assert.equal(rows.find((r) => r.code === 'oops').msg, '[redacted]');
  assert.equal(rows[0].source, 'device');
  const tooMany = await call(deviceLogs, 'POST', '/api/device/logs', { admin: false, key: d.key, body: { entries: Array.from({ length: 21 }, () => ({ level: 'info', code: 'a', msg: 'm' })) } });
  assert.equal(tooMany.status, 400);
  assert.equal((await call(deviceLogs, 'POST', '/api/device/logs', { admin: false, key: d.key, body: { entries: [{ level: 'loud', code: 'a', msg: 'm' }] } })).status, 400);
  assert.equal((await call(deviceLogs, 'POST', '/api/device/logs', { admin: false, key: d.key, body: { entries: [{ level: 'info', code: 'bad code!', msg: 'm' }] } })).status, 400);
  const long = await call(deviceLogs, 'POST', '/api/device/logs', { admin: false, key: d.key, body: { entries: [{ level: 'info', code: 'long', msg: 'word '.repeat(100) }] } });
  assert.equal(long.status, 202);
  assert.equal((await db.collection('device_logs').findOne({ code: 'long' })).msg.length, 120);
  const bad = await call(deviceLogs, 'POST', '/api/device/logs', { admin: false, key: 'dk_wrong', body: { entries: [{ level: 'info', code: 'a', msg: 'm' }] } });
  assert.equal(bad.status, 401);
  const fails = await db.collection('audit_log').findOne({ action: 'device.key_rejected' });
  assert.ok(fails.details.count >= 1);
  assert.equal(JSON.stringify(fails).includes('dk_wrong'), false, 'the rejected key is never stored');
});

test('ingest hook leaves the original response intact and adds downlink hints and logs', async () => {
  assert.equal((await handle(new Request('http://local/api/setup', { method: 'POST', headers: { Authorization: 'Bearer test-admin' } }), env, { db })).status, 200);
  const home = await addHome(-96.1, 32.5);
  const key = 'dk_hook_device';
  const ins = await db.collection('devices').insertOne({ name: 'hook', keyHash: await sha256Hex(key), disabled: false, createdAt: T0, lastSeen: null, homeId: home, meta: { exercise: true } });
  const id = String(ins.insertedId);
  const beacon = (eventId, extra = {}) => ctxOf('POST', '/api/beacon/ingest', { admin: false, key, body: { device_id: id, event_id: eventId, temperature_c: 30, ...extra } });
  const first = await ingestWithDownlink(beacon('e1'));
  const body1 = await first.json();
  assert.equal(first.status, 202);
  assert.equal(body1.accepted, true);
  assert.equal(body1.duplicate, false);
  assert.ok(Array.isArray(body1.incident_ids));
  assert.equal(body1.messages_pending, 0);
  assert.equal(body1.poll_after_s, 30);
  // The unchanged handler gives the same fields minus the two additions.
  const direct = await (await handle(beacon('e1').request, env, { db })).json();
  const { messages_pending, poll_after_s, ...rest } = body1;
  assert.deepEqual({ ...rest, duplicate: true }, direct);
  assert.ok(await db.collection('device_logs').findOne({ deviceId: id, code: 'seen.first' }));
  // A queued urgent message shows up as a pending hint with a faster poll.
  await db.collection('message_deliveries').insertOne({ _id: `m:${id}`, messageId: 'm', deviceId: id, seq: 1, state: 'queued', severity: 'urgent', expiresAt: new Date(Date.now() + 3600_000), updatedAt: new Date(), createdAt: new Date() });
  const again = await (await ingestWithDownlink(beacon('e2'))).json();
  assert.equal(again.messages_pending, 1);
  assert.equal(again.poll_after_s, 10);
  // Bad input still returns the handler's own error, untouched.
  const badRes = await ingestWithDownlink(ctxOf('POST', '/api/beacon/ingest', { admin: false, key, body: { device_id: id } }));
  assert.equal(badRes.status, 400);
  assert.equal(Object.hasOwn(await badRes.json(), 'messages_pending'), false);
  // Wrong key: the handler's 401 passes through and is counted.
  const totalRejected = async()=> (await db.collection('audit_log').find({action:'device.key_rejected'}).toArray()).reduce((n,x)=>n+(x.details?.count||0),0);
  const before401 = await totalRejected();
  const wrong = await ingestWithDownlink(ctxOf('POST', '/api/beacon/ingest', { admin: false, key: 'dk_nope', body: { device_id: id, event_id: 'x', temperature_c: 1 } }));
  assert.equal(wrong.status, 401);
  assert.equal(await totalRejected(),before401+1);
});

test('legacy ingest hook logs gaps and power mode changes only when the mode changes', async () => {
  const key = 'dk_legacy_power';
  const old = new Date(Date.now() - 40 * 60_000);
  const ins = await db.collection('devices').insertOne({ name: 'legacy', keyHash: await sha256Hex(key), disabled: false, createdAt: old, lastSeen: old, meta: { exercise: true } });
  const id = String(ins.insertedId);
  const post = (readings) => ingestWithDownlink(ctxOf('POST', '/api/ingest', { admin: false, key, body: { readings } }));
  let res = await post([{ sensor: 'power_mode', value: 'normal' }, { sensor: 'battery_pct', value: 90 }]);
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.accepted, 2);
  assert.equal(body.messages_pending, 0);
  assert.ok(await db.collection('device_logs').findOne({ deviceId: id, code: 'seen.gap' }), 'return after 40 minutes is logged');
  assert.equal(await db.collection('device_logs').countDocuments({ deviceId: id, code: 'power.mode' }), 0, 'first normal report is not a transition');
  await post([{ sensor: 'power_mode', value: 'saver' }]);
  await post([{ sensor: 'power_mode', value: 'saver' }]);
  await post([{ sensor: 'power_mode', value: 'critical' }]);
  const logs = await db.collection('device_logs').find({ deviceId: id, code: 'power.mode' }).sort({ _id: 1 }).toArray();
  assert.deepEqual(logs.map((l) => l.level), ['warn', 'error']);
  assert.match(logs[0].msg, /from normal to saver/);
  assert.equal(await db.collection('device_logs').countDocuments({ deviceId: id, code: 'seen.gap' }), 1, 'no gap after the second report');
});
