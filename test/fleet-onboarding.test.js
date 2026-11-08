import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { createFleetBatch, fleetBatchHandler, fleetHandler, fleetAction, listFleet } from '../src/fleet.js';
import { claimDevice, unlinkDevice, updateCustomerDevice, listCustomerDevices, createPairing } from '../src/customer.js';
import { recordAcceptedReport, fleetStatus, recordSilentBoxes } from '../src/device-lifecycle.js';
import { sha256Hex, requireDevice } from '../src/auth.js';
import { ingestWithDownlink } from '../src/live-api.js';
let server, client, db;
const env = { SESSION_SECRET: 'only-test-pepper', API_ADMIN_KEY: 'only-test-admin' }, origin = 'https://home.test', actor = { type: 'operator', id: 'test' };
const options = { env, origin, actor };
before(async () => { server = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); client = await MongoClient.connect(server.getUri()); db = client.db('fleet_onboarding_test'); });
after(async () => { await client?.close(); await server?.stop(); });
const provision = async () => (await createFleetBatch(db, { count: 1 }, options)).devices[0];
const link = (d, email = 'one@example.test') => claimDevice(db, { email, serial: d.serial, code: d.pairingCode, consent: false }, { env });
const action = (d, name, extras = {}) => fleetAction(db, d.deviceId, { action: name, confirmSerial: d.serial, reason: 'Test maintenance', ...extras }, options);
const getDevice = d => db.collection('devices').findOne({ _id: new ObjectId(d.deviceId) });

test('batch makes unlocated private-key boxes; operator sessions cannot provision', async () => {
  const batch = await createFleetBatch(db, { count: 2 }, options);
  assert.equal(batch.devices.length, 2);
  for (const d of batch.devices) {
    const record = await getDevice(d), pairing = await db.collection('device_pairing').findOne({ _id: d.deviceId });
    assert.equal(record.homeId, undefined); assert.equal(record.lastSeen, null);
    assert.equal(pairing.expiresAt, null); assert.match(d.pairingCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    assert.equal(d.qr, `${origin}/customer#claim=${d.serial}.${d.pairingCode}`);
    assert.equal(record.keyHash, await sha256Hex(d.deviceKey));
    assert.ok(!JSON.stringify(pairing).includes(d.pairingCode));
  }
  const ctx = { env, injectedDb: db, data: { operator: { role: 'operator' } }, request: new Request(origin + '/api/ops/fleet-batch', { method: 'POST', headers: { Authorization: 'Bearer ' + env.API_ADMIN_KEY, Origin: origin }, body: '{"count":1}' }) };
  assert.equal((await fleetBatchHandler(ctx)).status, 403);
  assert.equal((await fleetBatchHandler({ ...ctx, data: {}, request: new Request(ctx.request.url, { method: 'POST', body: '{"count":1}' }) })).status, 401);
  await assert.rejects(() => createFleetBatch(db, { count: 101 }, options));
});

test('claim, report, silence, recovery, settings, unlink and reissue form one lifecycle', async () => {
  const d = await provision(); const l = await link(d);
  let device = await getDevice(d);
  assert.ok(device.homeId); assert.equal((await db.collection('homes').findOne({ _id: device.homeId })).location, undefined);
  assert.equal(fleetStatus(device, l).reason, 'awaiting_first_report');
  const request = new Request(origin + '/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': d.deviceKey, 'X-Firmware-Version': '1.2.3' }, body: JSON.stringify({ sensor: 'temperature', value: 23, unit: 'C' }) });
  const response = await ingestWithDownlink({ request, env, injectedDb: db });
  assert.equal(response.status, 202, await response.clone().text());
  device = await getDevice(d); assert.equal(fleetStatus(device, l).state, 'active'); assert.equal(device.firmwareVersion, '1.2.3');
  await recordAcceptedReport(db, { ...device, lastSeen: null }, new Date());
  assert.equal(await db.collection('device_logs').countDocuments({ deviceId: d.deviceId, code: 'fleet.first_report' }), 1);
  const later = new Date(new Date(device.lastSeen).getTime() + 16 * 60000);
  await recordSilentBoxes(db, [device], [l], later); await recordSilentBoxes(db, [device], [l], later);
  assert.equal(await db.collection('device_logs').countDocuments({ deviceId: d.deviceId, code: 'fleet.silent' }), 1);
  assert.equal(fleetStatus(device, l, later).reason, 'silent');
  await recordAcceptedReport(db, device, later); await recordAcceptedReport(db, device, later);
  assert.equal(await db.collection('device_logs').countDocuments({ deviceId: d.deviceId, code: 'fleet.recovered' }), 1);
  await updateCustomerDevice(db, { email: l.customerEmail, linkId: l._id, body: { nickname: 'Hall', room: 'Entry', notificationsPausedUntil: new Date(Date.now() + 3600000).toISOString() } });
  const views = await listCustomerDevices(db, { email: l.customerEmail });
  const view = views.find(v => v.id === l._id); assert.equal(view.nickname, 'Hall'); assert.equal(view.serial, d.serial); assert.equal(view.status, 'no_recent_signal');
  await assert.rejects(() => updateCustomerDevice(db, { email: 'intruder@example.test', linkId: l._id, body: { nickname: 'No' } }), { status: 404 });
  await assert.rejects(() => action(d, 'reassign_home', { homeId: String(device.homeId) }), { status: 409 });
  await unlinkDevice(db, { email: l.customerEmail, linkId: l._id });
  assert.equal(fleetStatus(await getDevice(d), null).reason, 'unlinked');
  await assert.rejects(() => link(d));
  const replacement = await action(d, 'reissue_code');
  const reclaimed = await link({ ...d, pairingCode: replacement.pairingCode }, 'new@example.test');
  assert.ok(reclaimed.active);
});

test('wrong-code lockout, concurrent claims, cross-customer deletion and key rotation', async () => {
  const d = await provision();
  for (let i = 0; i < 10; i++) await assert.rejects(() => link({ ...d, pairingCode: '22222222' }));
  await assert.rejects(() => link(d));
  const next = await action(d, 'reissue_code'); d.pairingCode = next.pairingCode;
  const outcomes = await Promise.allSettled([link(d, 'a@example.test'), link(d, 'b@example.test')]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  const linked = outcomes.find(o => o.status === 'fulfilled').value;
  await assert.rejects(() => unlinkDevice(db, { email: 'other@example.test', linkId: linked._id }), { status: 404 });
  const rotated = await action(d, 'rotate_key');
  const req = key => new Request(origin, { headers: { 'X-Device-Key': key } });
  await assert.rejects(() => requireDevice(req(d.deviceKey), db), { status: 401 });
  assert.equal(String((await requireDevice(req(rotated.deviceKey), db))._id), d.deviceId);
  await action(d, 'disable'); await assert.rejects(() => requireDevice(req(rotated.deviceKey), db), { status: 401 });
  await action(d, 'enable'); await action(d, 'force_unlink');
  const fleet = await listFleet(db); assert.equal(JSON.stringify(fleet).includes(rotated.deviceKey), false);
  assert.equal(JSON.stringify(fleet).includes('keyHash'), false);
});

test('legacy six-digit cards still claim and cookie writes reject cross-origin', async () => {
  const d = await provision();
  const p = await createPairing(db, { deviceId: d.deviceId, origin, actor: { actor, deps: {} } });
  // Reissuing a v2 card through the legacy path must explicitly reset its hash version.
  await link({ ...d, pairingCode: p.pairingCode });
  const ctx = { env, injectedDb: db, data: { operator: { role: 'operator' } }, request: new Request(origin + '/api/ops/fleet/' + d.deviceId + '/action', { method: 'POST', headers: { Authorization: 'Bearer ' + env.API_ADMIN_KEY, Origin: 'https://evil.test' }, body: JSON.stringify({ action: 'disable', confirmSerial: d.serial, reason: 'Test' }) }) };
  assert.equal((await fleetHandler(ctx)).status, 403);
  const demo = await fleetHandler({ ...ctx, data: { operator: { role: 'demo' } }, request: new Request(origin + '/api/ops/fleet', { headers: { Authorization: 'Bearer ' + env.API_ADMIN_KEY } }) });
  assert.equal((await demo.json()).devices.length, 0);
});
