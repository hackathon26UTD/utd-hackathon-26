// Security boundaries against a disposable, loopback-only replica set. Never loads .env.
// Proxies only schedule/fail a real Mongo operation; transactions and all state remain real.
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { createFleetBatch, fleetAction, listFleet } from '../src/fleet.js';
import { createPairing, claimDevice, unlinkDevice, updateCustomerDevice, listCustomerDevices, ensureCustomerIndexes } from '../src/customer.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { onRequest as fleetRoute } from '../functions/api/ops/fleet.js';
import { onRequest as batchRoute } from '../functions/api/ops/fleet-batch.js';
import { onRequest as actionRoute } from '../functions/api/ops/fleet/[id]/action.js';
import { onRequest as customerRoute } from '../functions/api/customer/devices/[id].js';
import { onRequest as pairingRoute } from '../functions/api/ops/pairing.js';
import { issueSession, issueCustomerSession, sessionCookie, customerCookie } from '../src/operator-session.js';
import { notifyHelpStatus, notifyMessageReceipt } from '../src/email-events.js';
import { pairingDigest } from '../src/pairing-code.js';
import { requireDevice } from '../src/auth.js';
import { ingestWithDownlink } from '../src/live-api.js';
import { refreshHouseholdAlerts, deliverHouseholdOutbox } from '../src/household-alerts.js';

const env = { SESSION_SECRET: 'synthetic-fleet-security-pepper', API_ADMIN_KEY: 'synthetic-admin-only' };
const origin = 'https://security.example.test';
const actor = { type: 'operator', id: 'security-test' };
const options = { env, origin, actor };
let replica, client, db, sequence = 0;
before(async () => {
  replica = await MongoMemoryReplSet.create({ instanceOpts: [{ ip: '127.0.0.1' }], replSet: { count: 1, ip: '127.0.0.1' } });
  client = await MongoClient.connect(replica.getUri());
});
beforeEach(async () => { db = client.db(`fleet_security_${++sequence}`); await ensureCustomerIndexes(db); });
after(async () => { await client?.close(); await replica?.stop(); });
const provision = async () => (await createFleetBatch(db, { count: 1 }, options)).devices[0];
const claim = (d, email = 'owner@example.test', database = db, extra = {}, deps = {}) => claimDevice(database,
  { email, serial: d.serial, code: d.pairingCode, consent: true, contactName: 'Synthetic Owner', ...extra }, { env, ...deps });
const issue = (d, database = db) => createPairing(database, { deviceId: d.deviceId, origin, actor: { actor, deps: {} } });
const action = (d, name, database = db, extra = {}) => fleetAction(database, d.deviceId,
  { action: name, confirmSerial: d.serial, reason: 'Synthetic maintenance', ...extra }, options);
const device = d => db.collection('devices').findOne({ _id: new ObjectId(d.deviceId) });
const pairing = d => db.collection('device_pairing').findOne({ _id: d.deviceId });
const fulfilled = outcomes => outcomes.filter(o => o.status === 'fulfilled');
const capture = promise => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
function intercept(database, collectionName, method, hook) {
  return new Proxy(database, { get(target, key) {
    if (key === 'collection') return name => {
      const collection = target.collection(name);
      if (name !== collectionName) return collection;
      return new Proxy(collection, { get(coll, prop) {
        if (prop === method) return (...args) => hook(() => coll[prop](...args), args);
        const value = Reflect.get(coll, prop); return typeof value === 'function' ? value.bind(coll) : value;
      } });
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
function latch() {
  let arrive, release;
  const entered = new Promise(r => { arrive = r; });
  const resume = new Promise(r => { release = r; });
  return { entered, release, async hold() { arrive(); await resume; } };
}
function failAudit(database = db) {
  return intercept(database, 'audit_log', 'insertOne', async () => { throw new Error('synthetic audit outage'); });
}
async function route(handler, path, { method = 'GET', body, cookie, admin = false, headers = {}, params = {}, database = db } = {}) {
  const request = new Request(origin + path, { method, headers: {
    Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { Authorization: `Bearer ${env.API_ADMIN_KEY}` } : {}), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const context = { request, env, data: {}, db: database, injectedDb: database, params };
  return middleware({ ...context, next: next => handler({ ...context, request: next || request }) });
}
const operatorCookie = async role => sessionCookie(await issueSession(env, 'operator@example.test', role));
async function ownerCookie(email) {
  const account = { _id: email, sessionGeneration: crypto.randomUUID(), hash: 'synthetic', salt: 'synthetic' };
  await db.collection('customer_accounts').insertOne(account);
  return customerCookie(await issueCustomerSession(env, email, { db, verifiedAccount: account }));
}
function noCredentials(value, secrets) {
  const text = JSON.stringify(value);
  for (const secret of secrets) if (secret) assert.equal(text.includes(secret), false, 'credential appeared in a public projection');
  assert.doesNotMatch(text, /"(?:keyHash|codeHash|salt|deviceKey|pairingCode)"/);
}

test('concurrent claims have one owner and replay fails before and after unlink', async () => {
  const d = await provision();
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => claim(d, `owner${i}@example.test`)));
  assert.equal(fulfilled(outcomes).length, 1);
  const link = fulfilled(outcomes)[0].value;
  assert.equal(await db.collection('customer_links').countDocuments({ active: true }), 1);
  assert.equal(await db.collection('homes').countDocuments({}), 1);
  assert.equal(await db.collection('audit_log').countDocuments({ action: 'customer.claim' }), 1);
  assert.equal((await pairing(d)).codeHash, undefined);
  await assert.rejects(() => claim(d));
  await unlinkDevice(db, { email: link.customerEmail, linkId: link._id });
  await assert.rejects(() => claim(d));
});

test('claim, customer unlink, and fleet mutations roll back on audit failure', async () => {
  const d = await provision(), initial = await pairing(d);
  await assert.rejects(() => claim(d, 'owner@example.test', failAudit()));
  assert.equal((await pairing(d)).codeHash, initial.codeHash);
  assert.equal(await db.collection('homes').countDocuments({}), 0);
  assert.equal(await db.collection('customer_links').countDocuments({}), 0);
  const link = await claim(d);
  await assert.rejects(() => unlinkDevice(failAudit(), { email: link.customerEmail, linkId: link._id }));
  assert.equal((await db.collection('customer_links').findOne({ _id: link._id })).active, true);
  assert.equal((await device(d)).unlinkedAt, undefined);
  await assert.rejects(() => action(d, 'disable', failAudit()));
  assert.equal((await device(d)).disabled, false);
  await assert.rejects(() => action(d, 'force_unlink', failAudit()));
  assert.equal((await db.collection('customer_links').findOne({ _id: link._id })).active, true);
});

test('batch rollback leaves no usable credentials or inventory after audit failure', async () => {
  await assert.rejects(() => createFleetBatch(failAudit(), { count: 3 }, options));
  for (const name of ['devices', 'device_pairing', 'audit_log']) assert.equal(await db.collection(name).countDocuments({}), 0);
});

test('competing customer and fleet unlink produce exactly one committed release', async () => {
  const d = await provision(), link = await claim(d);
  const outcomes = await Promise.allSettled([
    unlinkDevice(db, { email: link.customerEmail, linkId: link._id }), action(d, 'force_unlink'),
    unlinkDevice(db, { email: link.customerEmail, linkId: link._id }),
  ]);
  assert.equal(fulfilled(outcomes).length, 1);
  assert.equal(await db.collection('customer_links').countDocuments({ active: true }), 0);
  assert.equal((await pairing(d)).codeHash, undefined);
  assert.equal(await db.collection('audit_log').countDocuments({ action: { $in: ['customer.unlink', 'fleet.force_unlink'] } }), 1);
});

test('claim racing reissue never leaves an active owner with a reusable code', async () => {
  for (let i = 0; i < 4; i++) {
    const d = await provision();
    await Promise.allSettled([claim(d), action(d, 'reissue_code')]);
    const active = await db.collection('customer_links').findOne({ deviceId: d.deviceId, active: true });
    const p = await pairing(d);
    if (active) { assert.equal(p.claimed, true); assert.equal(p.codeHash, undefined); }
    else { assert.equal(p.claimed, false); assert.ok(p.codeHash); }
  }
});

test('SEC-01 legacy createPairing cannot reopen a code after a concurrent claim', { timeout: 15000 }, async () => {
  const d = await provision(), pause = latch();
  const delayed = intercept(db, 'device_pairing', 'updateOne', async (run, args) => {
    if (args[1]?.$set?.claimed === false) await pause.hold();
    return run();
  });
  const pending = capture(issue(d, delayed));
  await pause.entered;
  try { await claim(d); } finally { pause.release(); }
  await pending;
  const p = await pairing(d);
  assert.equal(p.claimed, true, 'legacy issuance reopened a pairing after ownership committed');
  assert.equal(p.codeHash, undefined);
});

test('legacy createPairing racing claim and unlink serializes after release or rejects', { timeout: 15000 }, async () => {
  const d = await provision(), pause = latch();
  const delayed = intercept(db, 'device_pairing', 'updateOne', async (run, args) => {
    if (args[1]?.$set?.claimed === false) await pause.hold();
    return run();
  });
  const pending = capture(issue(d, delayed));
  await pause.entered;
  try {
    const link = await claim(d);
    await unlinkDevice(db, { email: link.customerEmail, linkId: link._id });
  } finally { pause.release(); }
  const result = await pending;
  await assert.rejects(() => claim(d), 'the original, consumed card remains unusable');
  if (result.status === 'fulfilled') {
    // withTransaction may retry after unlink: this is a valid new issuance, not replay.
    const events = await db.collection('audit_log').find({ deviceId: d.deviceId }).sort({ _id: 1 }).toArray();
    assert.deepEqual(events.map(e => e.action), ['customer.claim', 'customer.unlink', 'pairing.issue']);
    assert.equal((await device(d)).ownershipRevision, 3);
    const next = await claim({ ...d, pairingCode: result.value.pairingCode }, 'other@example.test');
    assert.equal(next.active, true); assert.equal((await pairing(d)).codeHash, undefined);
  } else assert.equal((await pairing(d)).codeHash, undefined);
});

test('concurrent legacy issuance preserves serial and only the final returned card claims', async () => {
  const d = await provision();
  const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => issue(d)));
  const cards = fulfilled(outcomes).map(o => o.value), p = await pairing(d);
  assert.ok(cards.length > 0);
  for (const card of cards) assert.equal(card.serial, d.serial);
  const matches = await Promise.all(cards.map(async card => (await pairingDigest(p, card.pairingCode, env)) === p.codeHash));
  assert.equal(matches.filter(Boolean).length, 1);
  await claim({ ...d, pairingCode: cards[matches.indexOf(true)].pairingCode });
  assert.equal(await db.collection('customer_links').countDocuments({ active: true }), 1);
});

test('legacy issuance rolls back its new card and revision when audit fails', async () => {
  const d = await provision(), p = await pairing(d);
  await assert.rejects(() => issue(d, failAudit()));
  assert.equal((await pairing(d)).codeHash, p.codeHash);
  assert.equal((await device(d)).ownershipRevision, undefined);
  await claim(d);
});

test('SEC-02 legacy operator release rolls back when its audit write fails', async () => {
  const d = await provision(), link = await claim(d);
  const result = await route(pairingRoute, `/api/ops/pairing?device_id=${d.deviceId}`, { method: 'DELETE', admin: true, database: failAudit() });
  assert.equal(result.status, 503);
  assert.equal((await db.collection('customer_links').findOne({ _id: link._id })).active, true,
    'failed legacy release committed the ownership change without its audit');
});

test('SEC-02 operator-specific release audit failure cannot commit a customer-attributed unlink', async () => {
  const d = await provision(), link = await claim(d);
  const priorPairing = await pairing(d), priorDevice = await device(d);
  const broken = intercept(db, 'audit_log', 'insertOne', async (run, args) => {
    if (args[0]?.action === 'link.release') throw new Error('synthetic operator audit outage');
    return run();
  });
  const result = await route(pairingRoute, `/api/ops/pairing?device_id=${d.deviceId}`, { method: 'DELETE', admin: true, database: broken });
  assert.deepEqual({ status: result.status,
    active: (await db.collection('customer_links').findOne({ _id: link._id })).active,
    customerUnlinks: await db.collection('audit_log').countDocuments({ deviceId: d.deviceId, action: 'customer.unlink' }),
  }, { status: 503, active: true, customerUnlinks: 0 }, 'operator release committed before its operator-attributed audit');
  assert.deepEqual(await pairing(d), priorPairing);
  assert.deepEqual(await device(d), priorDevice);
  assert.equal(await db.collection('audit_log').countDocuments({ deviceId: d.deviceId, action: 'link.release' }), 0);
});

test('SEC-02 successful releases retain the authenticated operator or customer actor', async () => {
  const d = await provision(); await claim(d);
  const response = await route(pairingRoute, `/api/ops/pairing?device_id=${d.deviceId}`, {
    method: 'DELETE', cookie: await operatorCookie('operator'),
  });
  assert.equal(response.status, 200);
  const entries = await db.collection('audit_log').find({ deviceId: d.deviceId, action: { $in: ['link.release', 'customer.unlink'] } }).toArray();
  assert.equal(entries.length, 1); assert.equal(entries[0].action, 'link.release');
  assert.deepEqual(entries[0].actor, { type: 'operator', id: 'operator@example.test' });
  assert.equal(await db.collection('customer_links').countDocuments({ deviceId: d.deviceId, active: true }), 0);
  const own = await provision(), link = await claim(own);
  const released = await route(customerRoute, `/api/customer/devices/${link._id}`, {
    method: 'DELETE', params: { id: link._id }, cookie: await ownerCookie(link.customerEmail),
    body: { actor: { type: 'operator', id: 'forged@example.test' }, action: 'link.release' },
  });
  assert.equal(released.status, 200);
  const customerEntries = await db.collection('audit_log').find({ deviceId: own.deviceId, action: { $in: ['link.release', 'customer.unlink'] } }).toArray();
  assert.equal(customerEntries.length, 1); assert.equal(customerEntries[0].action, 'customer.unlink');
  assert.equal(customerEntries[0].actor.type, 'customer');
  assert.equal(customerEntries[0].actor.id, (await db.collection('audit_log').findOne({ deviceId: own.deviceId, action: 'customer.claim' })).actor.id);
});

test('customer routes enforce ownership, session separation, same-origin and immutable fields', async () => {
  const d = await provision(), link = await claim(d), other = await ownerCookie('other@example.test');
  const path = `/api/customer/devices/${link._id}`, params = { id: link._id };
  for (const method of ['PATCH', 'DELETE']) {
    const r = await route(customerRoute, path, { method, params, cookie: other, ...(method === 'PATCH' ? { body: { nickname: 'Stolen' } } : {}) });
    assert.equal(r.status, 404);
  }
  const cookie = await ownerCookie(link.customerEmail);
  assert.equal((await route(customerRoute, path, { method: 'PATCH', params, cookie, body: { customerEmail: 'other@example.test' } })).status, 400);
  assert.equal((await route(customerRoute, path, { method: 'DELETE', params, cookie, headers: { Origin: 'https://evil.test' } })).status, 403);
  for (const auth of [{ admin: true }, { cookie: await operatorCookie('operator') }])
    assert.equal((await route(customerRoute, path, { ...auth, params })).status, 401);
  assert.deepEqual(await listCustomerDevices(db, { email: 'other@example.test' }), []);
  assert.equal((await db.collection('customer_links').findOne({ _id: link._id })).active, true);
});

test('middleware restricts inventory provisioning to admin keys, never operator/customer/device credentials', async () => {
  for (const auth of [{}, { cookie: await operatorCookie('operator') }, { cookie: await operatorCookie('demo') },
    { cookie: await ownerCookie('owner@example.test') }, { headers: { 'X-Device-Key': 'dk_synthetic' } }]) {
    const r = await route(batchRoute, '/api/ops/fleet-batch', { method: 'POST', body: { count: 1 }, ...auth });
    assert.ok([401, 403].includes(r.status));
  }
  assert.equal(await db.collection('devices').countDocuments({}), 0);
  const r = await route(batchRoute, '/api/ops/fleet-batch', { method: 'POST', body: { count: 1 }, admin: true });
  assert.equal(r.status, 201); assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('legacy device registration denies browser operators and permits genuine admin keys, including trailing slash', async () => {
  const cookie = await operatorCookie('operator');
  for (const path of ['/api/devices', '/api/devices/']) {
    let calls = 0;
    const next = async request => { calls++; return new Response(null, { status: 204 }); };
    const makeRequest = headers => new Request(origin + path, { method: 'POST', headers: { Origin: origin, ...headers }, body: '{"name":"Synthetic box"}' });
    const denied = await middleware({ env, data: {}, request: makeRequest({ Cookie: cookie }), next });
    assert.equal(denied.status, 403, path); assert.equal(calls, 0, 'operator request reached the registration handler');
    const allowed = await middleware({ env, data: {}, request: makeRequest({ Authorization: `Bearer ${env.API_ADMIN_KEY}` }), next });
    assert.equal(allowed.status, 204, path); assert.equal(calls, 1, 'genuine admin request did not reach the registration handler');
  }
});

test('demo fleet reads remain exercise-only even with explicit live query; demo writes fail', async () => {
  const live = await provision(), exercise = await provision();
  await db.collection('devices').updateOne({ _id: new ObjectId(exercise.deviceId) }, { $set: { 'meta.exercise': true } });
  const cookie = await operatorCookie('demo');
  for (const query of ['', '?mode=live', '?mode=exercise']) {
    const r = await route(fleetRoute, '/api/ops/fleet' + query, { cookie });
    assert.equal(r.status, 200);
    const rows = (await r.json()).devices;
    assert.deepEqual(rows.map(d => d.id), [exercise.deviceId]);
    assert.ok(!rows.some(d => d.id === live.deviceId));
  }
  const r = await route(actionRoute, `/api/ops/fleet/${live.deviceId}/action`, { method: 'POST', cookie,
    params: { id: live.deviceId }, body: { action: 'disable', confirmSerial: live.serial, reason: 'Test' } });
  assert.equal(r.status, 403); assert.equal((await device(live)).disabled, false);
});

test('SEC-03 address-backed exercise claim does not create a live home', async () => {
  const d = await provision();
  await db.collection('devices').updateOne({ _id: new ObjectId(d.deviceId) }, { $set: { 'meta.exercise': true } });
  await db.collection('device_pairing').updateOne({ _id: d.deviceId }, { $set: { exercise: true } });
  await claim(d, 'owner@example.test', db, { address: '800 W Campbell Rd, Richardson TX 75080' }, {
    fetcher: async () => Response.json({ result: { addressMatches: [{ matchedAddress: 'Synthetic Test Address', coordinates: { x: -96.75, y: 32.98 } }] } }),
  });
  const home = await db.collection('homes').findOne({ _id: (await device(d)).homeId });
  assert.equal(home.exercise === true || home.meta?.exercise === true, true, 'exercise address leaked into the live homes scope');
});

test('read projections and audit records expose no keys or pairing material', async () => {
  const d = await provision(), p = await pairing(d), link = await claim(d, 'owner@example.test', db, { consent: false });
  const secrets = [d.deviceKey, d.pairingCode, p.codeHash, p.salt];
  const fleet = await listFleet(db);
  assert.equal(fleet.devices[0].linkedCustomer, null);
  noCredentials(fleet, secrets);
  noCredentials(await listCustomerDevices(db, { email: link.customerEmail }), secrets);
  noCredentials(await db.collection('audit_log').find({}).toArray(), secrets);
  const r = await route(pairingRoute, `/api/ops/pairing?device_id=${d.deviceId}`, { admin: true });
  assert.equal(r.headers.get('Cache-Control'), 'no-store'); noCredentials(await r.json(), secrets);
});

test('wrong-code lockout, expiry, pepper mismatch and disabled devices reject without ownership', async () => {
  const d = await provision();
  const wrong = d.pairingCode === '22222222' ? '33333333' : '22222222';
  await Promise.allSettled(Array.from({ length: 12 }, () => claim({ ...d, pairingCode: wrong })));
  assert.ok((await pairing(d)).failures >= 10); await assert.rejects(() => claim(d));
  const fresh = await action(d, 'reissue_code'); d.pairingCode = fresh.pairingCode;
  await assert.rejects(() => claim(d, 'owner@example.test', db, {}, { env: { SESSION_SECRET: 'wrong-synthetic-pepper' } }));
  await db.collection('device_pairing').updateOne({ _id: d.deviceId }, { $set: { expiresAt: new Date(0) } });
  await assert.rejects(() => claim(d));
  const next = await action(d, 'reissue_code'); d.pairingCode = next.pairingCode;
  await action(d, 'disable'); await assert.rejects(() => claim(d));
  assert.equal(await db.collection('customer_links').countDocuments({}), 0);
  const p = await pairing(d); assert.notEqual(await pairingDigest(p, d.pairingCode, env), await pairingDigest(p, d.pairingCode, { SESSION_SECRET: 'different' }));
});

test('pause suppresses both customer event senders, expiry resumes, unlink revokes recipient', async () => {
  const d = await provision(), link = await claim(d), now = new Date();
  let sends = 0;
  const mailEnv = { ...env, RESEND_API_KEY: 're_synthetic_never_sent' };
  const deps = { now, fetcher: async () => { sends++; return Response.json({ id: 'synthetic-mail' }); }, sleep: async () => {}, log: () => {} };
  const help = () => notifyHelpStatus(db, mailEnv, { deviceId: d.deviceId, status: 'review_queued' }, deps);
  const receipt = () => notifyMessageReceipt(db, mailEnv, { deviceId: d.deviceId, messageId: 'synthetic-message', state: 'received', title: 'Test' }, deps);
  await updateCustomerDevice(db, { email: link.customerEmail, linkId: link._id, body: { notificationsPausedUntil: new Date(now.getTime() + 60000).toISOString() }, now });
  assert.equal((await help()).reason, 'paused'); assert.equal((await receipt()).reason, 'paused');
  assert.equal(sends, 0); assert.equal(await db.collection('email_events').countDocuments({}), 0);
  deps.now = new Date(now.getTime() + 60001);
  assert.equal((await help()).ok, true); assert.equal((await receipt()).ok, true); assert.equal(sends, 2);
  await unlinkDevice(db, { email: link.customerEmail, linkId: link._id });
  assert.equal((await help()).reason, 'no_customer'); assert.equal((await receipt()).reason, 'no_customer'); assert.equal(sends, 2);
});

test('SEC-04 pausing during email preparation suppresses the not-yet-sent notification', { timeout: 15000 }, async () => {
  const d = await provision(), link = await claim(d), pause = latch(), now = new Date();
  let sends = 0;
  const delayed = intercept(db, 'email_events', 'countDocuments', async run => { await pause.hold(); return run(); });
  const pending = capture(notifyHelpStatus(delayed, { ...env, RESEND_API_KEY: 're_synthetic_never_sent' },
    { deviceId: d.deviceId, status: 'review_queued' }, { now, fetcher: async () => { sends++; return Response.json({ id: 'synthetic' }); }, sleep: async () => {}, log: () => {} }));
  await pause.entered;
  try {
    await updateCustomerDevice(db, { email: link.customerEmail, linkId: link._id,
      body: { notificationsPausedUntil: new Date(now.getTime() + 60000).toISOString() }, now });
  } finally { pause.release(); }
  const outcome = await pending;
  assert.equal(sends, 0, 'an alert was handed to the sender after the pause committed');
  assert.equal(outcome.status, 'fulfilled'); assert.equal(outcome.value.reason, 'paused');
  assert.equal(await db.collection('email_events').countDocuments({ status: 'suppressed', reason: 'paused' }), 1);
});

test('both legacy email senders recheck unlink and consent before provider handoff', { timeout: 15000 }, async () => {
  for (const kind of ['help', 'receipt']) for (const change of ['unlink', 'consent']) {
    const d = await provision(), link = await claim(d), pause = latch();
    let sends = 0;
    const delayed = intercept(db, 'email_events', 'countDocuments', async run => { await pause.hold(); return run(); });
    const mailEnv = { ...env, RESEND_API_KEY: 're_synthetic_never_sent' };
    const deps = { fetcher: async () => { sends++; return Response.json({ id: 'synthetic' }); }, sleep: async () => {}, log: () => {} };
    const pending = capture(kind === 'help'
      ? notifyHelpStatus(delayed, mailEnv, { deviceId: d.deviceId, status: 'review_queued' }, deps)
      : notifyMessageReceipt(delayed, mailEnv, { deviceId: d.deviceId, messageId: 'synthetic', state: 'received', title: 'Test' }, deps));
    await pause.entered;
    try {
      if (change === 'unlink') await unlinkDevice(db, { email: link.customerEmail, linkId: link._id });
      else await db.collection('customer_links').updateOne({ _id: link._id }, { $set: { consent: false } });
    } finally { pause.release(); }
    const outcome = await pending;
    assert.equal(sends, 0, `${kind} sender ignored ${change}`);
    assert.equal(outcome.status, 'fulfilled');
    assert.equal(outcome.value.reason, change === 'unlink' ? 'no_customer' : 'no_consent');
  }
  assert.equal(await db.collection('email_events').countDocuments({ status: 'suppressed' }), 4);
});

test('household alert queue respects pause before enqueue and before an already-queued send', async () => {
  const d = await provision(), link = await claim(d), now = new Date();
  await ownerCookie(link.customerEmail);
  const account = await db.collection('customer_accounts').findOne({ _id: link.customerEmail });
  await db.collection('devices').updateOne({ _id: new ObjectId(d.deviceId) }, { $set: { lastSeen: now } });
  await db.collection('households').insertOne({ _id: 'security-house', ownerEmail: link.customerEmail,
    ownerGeneration: account.sessionGeneration, active: true, linkIds: [link._id] });
  await db.collection('household_members').insertOne({ _id: 'security-member', householdId: 'security-house',
    email: link.customerEmail, accountGeneration: account.sessionGeneration, status: 'active', role: 'owner',
    preferences: { device: true, weather: false }, preferencesVersion: 1, preferencesUpdatedAt: new Date(+now - 10000),
    emailVerifiedAt: new Date(+now - 9000), verifiedEmail: link.customerEmail });
  const mailEnv = { ...env, HOME_EMAIL_ENABLED: 'true', HOME_EMAIL_FROM: 'alerts@example.test',
    RESEND_API_KEY: 're_synthetic_never_sent', RESEND_WEBHOOK_SECRET: 'synthetic-webhook' };
  let sends = 0;
  const deps = { loadRisk: async () => [{ deviceId: d.deviceId, status: 'critical' }],
    customerView: () => ({ status: 'urgent', statusText: 'Synthetic water report', conditions: [] }), customerMessages: async () => [] };
  const opts = { now, deps, fetcher: async () => { sends++; return new Response('{}', { status: 503 }); } };
  const setPause = value => updateCustomerDevice(db, { email: link.customerEmail, linkId: link._id,
    body: { notificationsPausedUntil: value }, now });
  await setPause(new Date(+now + 3600000).toISOString());
  await refreshHouseholdAlerts(db, mailEnv, opts);
  assert.equal(sends, 0); assert.equal(await db.collection('household_mail_outbox').countDocuments({}), 0);
  await setPause(null);
  await refreshHouseholdAlerts(db, mailEnv, { ...opts, now: new Date(+now + 61000) });
  assert.equal(sends, 1); assert.equal(await db.collection('household_mail_outbox').countDocuments({ status: 'retry' }), 1);
  await setPause(new Date(+now + 3600000).toISOString());
  await deliverHouseholdOutbox(db, mailEnv, { ...opts, now: new Date(+now + 182000) });
  assert.equal(sends, 1); assert.equal(await db.collection('household_mail_outbox').countDocuments({ status: 'suppressed' }), 1);
});

test('rotated and disabled device credentials cannot ingest or generate first-report lifecycle evidence', async () => {
  const d = await provision(), rotated = await action(d, 'rotate_key');
  const request = key => new Request(origin + '/api/ingest', { method: 'POST', headers: { 'X-Device-Key': key }, body: JSON.stringify({ sensor: 'temperature', value: 23, unit: 'C' }) });
  await assert.rejects(() => requireDevice(request(d.deviceKey), db), { status: 401 });
  assert.equal((await ingestWithDownlink({ request: request(d.deviceKey), env, injectedDb: db })).status, 401);
  await action(d, 'disable');
  assert.equal((await ingestWithDownlink({ request: request(rotated.deviceKey), env, injectedDb: db })).status, 401);
  assert.equal(await db.collection('device_logs').countDocuments({}), 0);
  assert.equal((await device(d)).firstReportAt, undefined);
});
