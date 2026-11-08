// Downlink information boxes: validation, fan-out, device pull, acks, expiry, cancel, customer view (module C).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { sha256Hex } from '../src/auth.js';
import { ensureLiveIndexes } from '../src/live.js';
import { cancelMessage, createMessage, customerMessages, deviceReport, listMessages, markCustomerSeen, parseMessageInput, pullForDevice } from '../src/messages.js';
import { deviceMessages, opsMessages } from '../src/live-api.js';

const env = { API_ADMIN_KEY: 'test-admin' };
let server, client, db;
const T0 = new Date('2026-11-07T12:00:00Z');
const after_ = (min) => new Date(T0.getTime() + min * 60_000);

before(async () => {
  if (!process.env.TEST_MONGODB_URI) server = await MongoMemoryServer.create();
  client = await MongoClient.connect(process.env.TEST_MONGODB_URI || server.getUri());
  db = client.db('messages_test');
  await ensureLiveIndexes(db);
});
after(async () => { await client?.close(); await server?.stop(); });

async function addDevice(name, { lng, lat, exercise = false, key = `dk_${name}` } = {}) {
  let homeId;
  if (lng !== undefined) {
    homeId = new ObjectId();
    await db.collection('homes').insertOne({ _id: homeId, location: { type: 'Point', coordinates: [lng, lat] } });
  }
  const r = await db.collection('devices').insertOne({ name, keyHash: await sha256Hex(key), disabled: false, lastSeen: T0, ...(homeId ? { homeId } : {}), meta: exercise ? { exercise: true } : {} });
  return { id: String(r.insertedId), key, doc: { _id: r.insertedId, meta: exercise ? { exercise: true } : {} } };
}
const msg = (ids, extra = {}) => ({ scope: { type: 'device', deviceIds: ids }, kind: 'info', severity: 'info', title: 'Hello', body: 'Stay calm', ...extra });
const ctxOf = (method, path, { body, admin = true, key, data, now } = {}) => ({
  request: new Request(`http://local${path}`, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer test-admin' } : {}), ...(key ? { 'X-Device-Key': key } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  env, data, injectedDb: db, now,
});
const call = async (fn, ...a) => { const r = await fn(ctxOf(...a)); return { status: r.status, body: await r.json(), headers: r.headers }; };

test('validation enforces the small screen limits and rejects links and secrets', () => {
  const ok = parseMessageInput(msg(['a'.repeat(24)]));
  assert.equal(ok.expiresInMin, 360, 'default expiry is 6 hours');
  assert.equal(ok.requiresAck, false);
  const bad = (extra, re) => assert.throws(() => parseMessageInput(msg(['a'.repeat(24)], extra)), re);
  bad({ title: '' }, /title is required/);
  bad({ title: 'x'.repeat(21) }, /at most 20/);
  bad({ title: 'x'.repeat(20) , body: 'y'.repeat(81) }, /body can be at most 80/);
  bad({ title: 'café' }, /plain keyboard/);
  bad({ body: 'emoji \u{1F600}' }, /plain keyboard/);
  bad({ body: 'see http://evil.test now' }, /links/);
  bad({ body: 'go to example.com' }, /links/);
  bad({ body: 'key dk_abc' }, /key or password/);
  bad({ body: 'the Password is x' }, /key or password/);
  bad({ body: 'a'.repeat(40) }, /key or password/);
  bad({ body: '0123456789abcdef0123456789abcdef' }, /key or password/);
  bad({ kind: 'alarm' }, /kind must be/);
  bad({ severity: 'panic' }, /severity must be/);
  bad({ expiresInMin: 0 }, /expiresInMin/);
  bad({ expiresInMin: 10081 }, /expiresInMin/);
  bad({ expiresInMin: 1.5 }, /expiresInMin/);
  bad({ requiresAck: 'yes' }, /requiresAck/);
  assert.throws(() => parseMessageInput({ ...msg([]), scope: { type: 'device', deviceIds: [] } }), /scope.deviceIds/);
  assert.throws(() => parseMessageInput({ ...msg([]), scope: { type: 'region', region: 'gh5:abc' } }), /scope.region/);
  assert.throws(() => parseMessageInput({ ...msg([]), scope: { type: 'bbox', bbox: [1, 2, 3] } }), /bbox/);
  assert.throws(() => parseMessageInput({ ...msg([]), scope: { type: 'planet' } }), /scope.type/);
  assert.throws(() => parseMessageInput([]), /object/);
});

test('sending to devices creates one delivery each, a sequence number and an audit entry', async () => {
  const a = await addDevice('send-a');
  const b = await addDevice('send-b');
  const r1 = await createMessage(db, msg([a.id, b.id], { requiresAck: true, customerVisible: true }), { operator: 'op@example.test', now: T0 });
  assert.equal(r1.deliveries, 2);
  assert.equal(r1.message.expiresAt, after_(360).toISOString());
  const r2 = await createMessage(db, msg([a.id]), { operator: 'op@example.test', now: T0 });
  assert.equal(r2.message.seq, r1.message.seq + 1);
  const rows = await db.collection('message_deliveries').find({ messageId: r1.message.id }).toArray();
  assert.deepEqual(rows.map((x) => x.state), ['queued', 'queued']);
  const audit = await db.collection('audit_log').findOne({ action: 'message.send', 'details.messageId': r1.message.id });
  assert.equal(audit.actor.id, 'op@example.test');
  assert.equal(audit.details.deliveries, 2);
  await assert.rejects(createMessage(db, msg([a.id, new ObjectId().toString()]), { now: T0 }), /not found/);
});

test('exercise and live devices cannot be messaged across modes', async () => {
  const live = await addDevice('mode-live');
  const ex = await addDevice('mode-ex', { exercise: true });
  await assert.rejects(createMessage(db, msg([ex.id]), { exercise: false, now: T0 }), /not found/);
  await assert.rejects(createMessage(db, msg([live.id]), { exercise: true, now: T0 }), /not found/);
  const ok = await createMessage(db, msg([ex.id]), { exercise: true, now: T0 });
  assert.equal(ok.message.exercise, true);
  assert.ok((await listMessages(db, { exercise: true, now: T0 })).messages.some((m) => m.id === ok.message.id));
  assert.ok(!(await listMessages(db, { exercise: false, now: T0 })).messages.some((m) => m.id === ok.message.id));
});

test('region and bbox sends fan out on the server, capped at 200 devices', async () => {
  const inside = [];
  for (let i = 0; i < 3; i++) inside.push(await addDevice(`reg-in-${i}`, { lng: -96.66 + i * 0.001, lat: 33.24 }));
  await addDevice('reg-out', { lng: -80, lat: 25 });
  const r = await createMessage(db, { ...msg([]), scope: { type: 'region', region: 'gh5:9vgm0' } }, { now: T0 });
  assert.equal(r.deliveries, 3);
  const targets = (await db.collection('message_deliveries').find({ messageId: r.message.id }).toArray()).map((x) => x.deviceId).sort();
  assert.deepEqual(targets, inside.map((d) => d.id).sort());
  assert.equal((await db.collection('audit_log').findOne({ 'details.messageId': r.message.id })).region, 'gh5:9vgm0');
  await assert.rejects(createMessage(db, { ...msg([]), scope: { type: 'bbox', bbox: [10, 10, 11, 11] } }, { now: T0 }), /No devices/);
  // Many devices in a small box: only 200 get the message and the result says so.
  const homeId = new ObjectId();
  await db.collection('homes').insertOne({ _id: homeId, location: { type: 'Point', coordinates: [10.5, 10.5] } });
  await db.collection('devices').insertMany(Array.from({ length: 205 }, (_, i) => ({ name: `crowd-${i}`, keyHash: `h${i}`, homeId, meta: {} })));
  const big = await createMessage(db, { ...msg([]), scope: { type: 'bbox', bbox: [10, 10, 11, 11] } }, { now: T0 });
  assert.equal(big.deliveries, 200);
  assert.equal(big.truncated, true);
});

test('a device holds at most five live messages; extra devices in a fan-out are skipped', async () => {
  const full = await addDevice('cap-full');
  const roomy = await addDevice('cap-roomy');
  for (let i = 0; i < 5; i++) await createMessage(db, msg([full.id], { title: `m${i}` }), { operator: `cap-op-${i}`, now: T0 });
  await assert.rejects(createMessage(db, msg([full.id]), { operator: 'cap-x', now: T0 }), /already have 5/);
  const mixed = await createMessage(db, msg([full.id, roomy.id]), { operator: 'cap-y', now: T0 });
  assert.equal(mixed.deliveries, 1);
  assert.deepEqual(mixed.skipped, [full.id]);
  // After they expire there is room again.
  const later = await createMessage(db, msg([full.id]), { operator: 'cap-z', now: after_(400) });
  assert.equal(later.deliveries, 1);
});

test('sending is rate limited per operator', async () => {
  const d = await addDevice('rate');
  const other = await addDevice('rate2');
  for (let i = 0; i < 30; i++) await db.collection('device_messages').insertOne({ seq: 1_000_000 + i, createdBy: 'busy@example.test', createdAt: T0 });
  await assert.rejects(createMessage(db, msg([d.id]), { operator: 'busy@example.test', now: T0 }), (e) => e.status === 429);
  assert.equal((await createMessage(db, msg([other.id]), { operator: 'calm@example.test', now: T0 })).deliveries, 1);
  const res = await opsMessages(ctxOf('POST', '/api/ops/messages', { body: msg([d.id]), data: { operator: { email: 'busy@example.test' } }, now: T0 }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
});

test('device pull marks queued as delivered, follows the cursor and limits to three', async () => {
  const d = await addDevice('pull');
  const seqs = [];
  for (let i = 0; i < 4; i++) seqs.push((await createMessage(db, msg([d.id], { title: `p${i}` }), { operator: `pull-op-${i}`, now: T0 })).message.seq);
  const p1 = await pullForDevice(db, d.doc, { after: 0, limit: 3, now: after_(1) });
  assert.deepEqual(p1.messages.map((m) => m.title), ['p0', 'p1', 'p2']);
  assert.equal(p1.cursor, seqs[2]);
  assert.equal(p1.poll_after_s, 30);
  assert.deepEqual(Object.keys(p1.messages[0]).sort(), ['body', 'expires_at', 'id', 'kind', 'requires_ack', 'seq', 'severity', 'title']);
  const p2 = await pullForDevice(db, d.doc, { after: p1.cursor, now: after_(1) });
  assert.deepEqual(p2.messages.map((m) => m.title), ['p3']);
  assert.equal(p2.cursor, seqs[3]);
  const p3 = await pullForDevice(db, d.doc, { after: p2.cursor, now: after_(1) });
  assert.deepEqual(p3.messages, []);
  assert.equal(p3.cursor, seqs[3], 'cursor does not move when nothing is new');
  const states = (await db.collection('message_deliveries').find({ deviceId: d.id }).toArray()).map((x) => x.state);
  assert.ok(states.every((s) => s === 'delivered'));
  // A rebooted device that asks from zero gets the still-live ones again.
  assert.equal((await pullForDevice(db, d.doc, { after: 0, now: after_(2) })).messages.length, 3);
  assert.ok(await db.collection('device_logs').findOne({ deviceId: d.id, code: 'message.delivered', source: 'server' }));
  assert.equal(await db.collection('device_logs').countDocuments({ deviceId: d.id, code: 'message.delivered' }), 4, 'delivery is logged once per message');
});

test('an urgent message speeds up polling; expired and cancelled messages are not delivered', async () => {
  const d = await addDevice('urgent');
  const u = await createMessage(db, msg([d.id], { severity: 'urgent', title: 'Leave now', expiresInMin: 10 }), { now: T0 });
  const short = await createMessage(db, msg([d.id], { title: 'short', expiresInMin: 1 }), { now: T0 });
  const gone = await createMessage(db, msg([d.id], { title: 'gone' }), { now: T0 });
  await cancelMessage(db, gone.message.id, { operator: 'op', now: T0 });
  const p = await pullForDevice(db, d.doc, { now: after_(2) });
  assert.deepEqual(p.messages.map((m) => m.title), ['Leave now'], 'short expired after 1 min, gone was cancelled');
  assert.equal(p.poll_after_s, 10);
  assert.equal((await db.collection('message_deliveries').findOne({ messageId: short.message.id })).state, 'expired');
  const late = await pullForDevice(db, d.doc, { now: after_(11) });
  assert.deepEqual(late.messages, []);
  assert.equal(late.poll_after_s, 30);
  assert.equal((await db.collection('message_deliveries').findOne({ messageId: u.message.id })).state, 'expired');
});

test('shown and acked reports from the device', async () => {
  const d = await addDevice('ack');
  const other = await addDevice('ack-other');
  const m = await createMessage(db, msg([d.id], { requiresAck: true }), { now: T0 });
  assert.deepEqual(await deviceReport(db, d.doc, { messageId: m.message.id, state: 'shown' }, after_(1)), { state: 'delivered', shown: true });
  assert.ok((await db.collection('message_deliveries').findOne({ messageId: m.message.id })).shownAt);
  assert.deepEqual(await deviceReport(db, d.doc, { messageId: m.message.id, state: 'acked' }, after_(2)), { state: 'acked', shown: true });
  assert.deepEqual(await deviceReport(db, d.doc, { messageId: m.message.id, state: 'acked' }, after_(3)), { state: 'acked' }, 'ack is idempotent');
  const row = await db.collection('message_deliveries').findOne({ messageId: m.message.id });
  assert.equal(row.ackedBy, 'device');
  assert.equal((await pullForDevice(db, d.doc, { now: after_(4) })).messages.length, 0, 'acked messages stop coming back');
  await assert.rejects(deviceReport(db, other.doc, { messageId: m.message.id, state: 'acked' }, after_(2)), (e) => e.status === 404);
  await assert.rejects(deviceReport(db, d.doc, { messageId: 'zz', state: 'acked' }), /message_id/);
  await assert.rejects(deviceReport(db, d.doc, { messageId: m.message.id, state: 'read' }), /state must be/);
  const c = await createMessage(db, msg([d.id], { title: 'c' }), { now: T0 });
  await cancelMessage(db, c.message.id, { now: T0 });
  await assert.rejects(deviceReport(db, d.doc, { messageId: c.message.id, state: 'acked' }, after_(1)), (e) => e.status === 409);
});

test('cancel is idempotent, audited, and listing shows per-device states', async () => {
  const a = await addDevice('list-a');
  const b = await addDevice('list-b');
  const m = await createMessage(db, msg([a.id, b.id], { title: 'list me' }), { operator: 'lister', now: T0 });
  await pullForDevice(db, a.doc, { now: after_(1) });
  await deviceReport(db, a.doc, { messageId: m.message.id, state: 'acked' }, after_(2));
  let list = await listMessages(db, { deviceId: a.id, now: after_(3) });
  let found = list.messages.find((x) => x.id === m.message.id);
  assert.deepEqual(Object.fromEntries(found.deliveries.map((x) => [x.deviceId, x.state])), { [a.id]: 'acked', [b.id]: 'queued' });
  const c1 = await cancelMessage(db, m.message.id, { operator: 'lister', now: after_(4) });
  assert.equal(c1.cancelled, 1, 'only the unacknowledged delivery is cancelled');
  assert.equal((await cancelMessage(db, m.message.id, { now: after_(5) })).cancelled, 0);
  assert.equal(await db.collection('audit_log').countDocuments({ action: 'message.cancel', 'details.messageId': m.message.id }), 1);
  list = await listMessages(db, { deviceId: b.id, now: after_(6) });
  found = list.messages.find((x) => x.id === m.message.id);
  assert.equal(found.cancelled, true);
  assert.equal(found.deliveries.find((x) => x.deviceId === b.id).state, 'cancelled');
  assert.deepEqual((await listMessages(db, { state: 'acked', now: after_(6) })).messages.map((x) => x.id).includes(m.message.id), true);
  assert.deepEqual((await listMessages(db, { deviceId: new ObjectId().toString(), now: T0 })).messages, []);
  await assert.rejects(listMessages(db, { state: 'weird' }), /state must be/);
  await assert.rejects(cancelMessage(db, new ObjectId().toString(), {}), (e) => e.status === 404);
  await assert.rejects(cancelMessage(db, 'bad', {}), /Invalid/);
});

test('customer view shows only customer visible, live messages and confirms on read when asked', async () => {
  const d = await addDevice('cust');
  const hidden = await createMessage(db, msg([d.id], { title: 'ops only', customerVisible: false }), { now: T0 });
  const shown = await createMessage(db, msg([d.id], { title: 'for family', customerVisible: true, severity: 'advisory' }), { now: T0 });
  const confirm = await createMessage(db, msg([d.id], { title: 'please confirm', customerVisible: true, requiresAck: true }), { now: T0 });
  const short = await createMessage(db, msg([d.id], { title: 'brief', customerVisible: true, expiresInMin: 1 }), { now: T0 });
  let list = await customerMessages(db, d.id, after_(5));
  assert.deepEqual(list.map((m) => m.title).sort(), ['for family', 'please confirm']);
  assert.deepEqual(Object.keys(list[0]).sort(), ['body', 'expiresAt', 'id', 'seen', 'severity', 'title']);
  assert.ok(!list.some((m) => m.id === hidden.message.id || m.id === short.message.id));
  assert.equal(await markCustomerSeen(db, d.id, hidden.message.id, after_(5)), false, 'operator-only messages cannot be touched');
  assert.equal(await markCustomerSeen(db, d.id, short.message.id, after_(5)), false, 'expired');
  assert.equal(await markCustomerSeen(db, new ObjectId().toString(), shown.message.id, after_(5)), false, 'wrong device');
  assert.equal(await markCustomerSeen(db, d.id, shown.message.id, after_(5)), true);
  assert.equal((await db.collection('message_deliveries').findOne({ messageId: shown.message.id })).state, 'queued', 'reading does not confirm unless requested');
  assert.equal(await markCustomerSeen(db, d.id, confirm.message.id, after_(5)), true);
  const row = await db.collection('message_deliveries').findOne({ messageId: confirm.message.id });
  assert.equal(row.state, 'acked');
  assert.equal(row.ackedBy, 'customer');
  list = await customerMessages(db, d.id, after_(6));
  assert.ok(list.every((m) => m.seen));
});

test('operator and device HTTP handlers', async () => {
  const d = await addDevice('http-dev', { key: 'dk_http_dev_key' });
  assert.equal((await call(opsMessages, 'POST', '/api/ops/messages', { admin: false, body: msg([d.id]) })).status, 401);
  const demo = { operator: { role: 'demo' } };
  assert.equal((await call(opsMessages, 'POST', '/api/ops/messages', { admin: false, data: demo, body: msg([d.id]) })).status, 403);
  assert.equal((await call(opsMessages, 'GET', '/api/ops/messages', { admin: false, data: demo })).status, 200);
  assert.equal((await call(opsMessages, 'POST', '/api/ops/messages', { body: msg([d.id], { title: '' }) })).status, 400);
  const sent = await call(opsMessages, 'POST', '/api/ops/messages', { body: msg([d.id], { title: 'Water rising', body: 'Move valuables up', requiresAck: true }), data: { operator: { email: 'op@example.test' } } });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.deliveries, 1);
  assert.equal(sent.body.message.createdBy, 'op@example.test');
  const list = await call(opsMessages, 'GET', `/api/ops/messages?device_id=${d.id}&state=queued`);
  assert.equal(list.body.messages[0].title, 'Water rising');
  // Device side: key required, wrong key rejected, pull then ack.
  assert.equal((await call(deviceMessages, 'GET', '/api/device/messages', { admin: false })).status, 401);
  assert.equal((await call(deviceMessages, 'GET', '/api/device/messages', { admin: false, key: 'dk_wrong' })).status, 401);
  assert.equal((await call(deviceMessages, 'GET', '/api/device/messages', { admin: true })).status, 401, 'the admin key is not a device key');
  const pull = await call(deviceMessages, 'GET', '/api/device/messages?after=0&limit=3', { admin: false, key: d.key });
  assert.equal(pull.status, 200);
  assert.equal(pull.body.messages[0].requires_ack, true);
  assert.equal(pull.body.poll_after_s, 30);
  const ack = await call(deviceMessages, 'POST', '/api/device/messages', { admin: false, key: d.key, body: { message_id: pull.body.messages[0].id, state: 'acked' } });
  assert.deepEqual(ack.body, { state: 'acked', shown: true });
  assert.equal((await call(deviceMessages, 'GET', '/api/device/messages?limit=0', { admin: false, key: d.key })).body.messages.length, 0);
  assert.equal((await call(deviceMessages, 'PUT', '/api/device/messages', { admin: false, key: d.key })).status, 405);
  const del = await call(opsMessages, 'DELETE', `/api/ops/messages?id=${sent.body.message.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.message.cancelled, true);
  assert.equal((await call(opsMessages, 'DELETE', '/api/ops/messages?id=bad')).status, 400);
});
