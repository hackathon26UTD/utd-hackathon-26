import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { ensureHouseholds, resolveHousehold, activeHouseholdMember, householdSnapshots, mutateHousehold, listHouseholds, householdsHandler } from '../src/households.js';
import { issueCustomerSession, customerCookie } from '../src/operator-session.js';
import { customerHandler } from '../src/customer.js';
const owner = 'owner@example.test', viewer = 'viewer@example.test', outsider = 'outsider@example.test';
const now = new Date('2026-11-08T12:00:00Z');
let mongo, client, db, env, serial = 0;
before(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); client = await MongoClient.connect(mongo.getUri()); });
after(async () => { await client?.close(); await mongo?.stop(); });
beforeEach(async () => {
  db = client.db('households_' + ++serial);
  env = { SESSION_SECRET: 'household-test-only-secret', MONGODB_URI: mongo.getUri(), MONGODB_DB: db.databaseName };
  await db.collection('customer_accounts').insertMany([owner, viewer, outsider].map(_id => ({ _id, sessionGeneration: crypto.randomUUID(), hash: 'test-password-hash', salt: 'test-salt', createdAt: new Date(0) })));
  await ensureHouseholds(db);
});
async function device(email = owner, options = {}) {
  const _id = new ObjectId(); const linkId = crypto.randomUUID();
  await db.collection('devices').insertOne({ _id, lastSeen: now, meta: {}, ...options.device });
  await db.collection('customer_links').insertOne({ _id: linkId, deviceId: String(_id), customerEmail: email, active: true, exercise: false, linkedAt: now, nickname: 'Living room', contactName: 'PRIVATE CONTACT', ...options.link });
  return { id: linkId, deviceId: String(_id) };
}
const mutate = (email, body, options) => mutateHousehold(db, email, body, options);
const create = async (linkIds = []) => (await mutate(owner, { action: 'create', name: 'Home', linkIds })).household;
const invite = (h, email = viewer, role = 'viewer', options) => mutate(owner, { action: 'invite', householdId: h.id, email, role }, options);
async function join(h, email = viewer, role = 'viewer') { const i = await invite(h, email, role); await mutate(email, { action: 'accept', token: i.token }); return i; }
async function cookie(email = owner) { const a = await db.collection('customer_accounts').findOne({ _id: email }); return customerCookie(await issueCustomerSession(env, email, { db, verifiedAccount: a })).split(';')[0]; }
async function request(method = 'GET', { email = owner, body, query = '', origin = 'https://home.test', auth = true, deps = {} } = {}) {
  const req = new Request('https://home.test/api/customer/households' + query, { method, headers: { ...(auth ? { Cookie: await cookie(email) } : {}), Origin: origin, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return householdsHandler({ request: req, env, db, deps });
}
const denied = p => assert.rejects(p, e => [403, 404].includes(e.status));

test('create schema and owner defaults; public API omits credentials and hashes', async () => {
  const d = await device(); const h = await create([d.id]);
  const a = await resolveHousehold(db, { email: owner, householdId: h.id });
  assert.equal(typeof a.household._id, 'string'); assert.equal(a.member.role, 'owner');
  assert.equal(a.household.ownerGeneration, (await db.collection('customer_accounts').findOne({ _id: owner })).sessionGeneration);
  assert.deepEqual(a.member.preferences, { device: false, weather: false }); assert.equal(a.member.emailVerifiedAt, null);
  assert.equal(a.links.length, 1);
  await invite(h);
  const response = await request('GET', { query: '?id=' + h.id }); assert.equal(response.status, 200);
  const text = await response.text();
  for (const privateValue of ['inviteHash', 'sessionGeneration', 'ownerGeneration', 'accountGeneration', 'test-password-hash', 'PRIVATE CONTACT', 'keyHash']) assert.ok(!text.includes(privateValue), privateValue);
});

test('foreign IDs and owner-only mutations are denied', async () => {
  const h = await create(); await join(h);
  await denied(resolveHousehold(db, { email: outsider, householdId: h.id }));
  for (const action of ['update', 'delete', 'invite', 'revoke']) await denied(mutate(viewer, { action, householdId: h.id, name: 'Stolen', email: outsider, role: 'viewer' }));
  assert.equal((await request('GET', { email: outsider, query: '?id=' + h.id })).status, 403);
});

test('selection rejects foreign, inactive, exercise, missing and disabled devices', async () => {
  const foreign = await device(outsider), inactive = await device(owner, { link: { active: false } }), exercise = await device(owner, { link: { exercise: true } }), disabled = await device(owner, { device: { disabled: true } }), hiddenExercise = await device(owner, { device: { meta: { exercise: true } } });
  for (const d of [foreign, inactive, exercise, disabled, hiddenExercise, { id: 'missing' }]) await assert.rejects(create([d.id]), e => e.status === 400);
  const d = await device(); await assert.rejects(create([d.id, d.id]), e => e.status === 400);
  await assert.rejects(create(Array.from({ length: 21 }, (_, i) => 'id-' + i)), e => e.status === 400);
});

test('selected snapshots preserve stale/unknown semantics and isolate all risk/message loads', async () => {
  const selected = await device(owner, { device: { lastSeen: new Date(+now - 3600000) } });
  await device(); const h = await create([selected.id]); await join(h);
  const calls = [], messages = [];
  const access = await resolveHousehold(db, { email: viewer, householdId: h.id });
  const snapshots = await householdSnapshots(db, access, { now, deps: {
    loadRisk: async (_, options) => { calls.push(...options.deviceIds); return [{ deviceId: selected.deviceId, status: 'normal' }]; },
    customerView: () => ({ status: 'normal' }), customerMessages: async (_, id) => { messages.push(id); return []; },
  } });
  assert.deepEqual(calls, [selected.deviceId]); assert.deepEqual(messages, [selected.deviceId]);
  assert.equal(snapshots.length, 1); assert.equal(snapshots[0].status, 'no_recent_signal');
  assert.ok(!JSON.stringify(snapshots).includes('PRIVATE CONTACT'));
  const missing = await householdSnapshots(db, access, { now, deps: { loadRisk: async () => { throw new Error('unavailable'); } } });
  assert.equal(missing[0].status, 'no_recent_signal');
});

test('alerts-only members can resolve preferences but cannot obtain snapshots', async () => {
  const h = await create(); const i = await join(h, viewer, 'alerts');
  await denied(resolveHousehold(db, { email: viewer, householdId: h.id }));
  const a = await resolveHousehold(db, { email: viewer, householdId: h.id, requireView: false });
  assert.ok(await activeHouseholdMember(db, i.member.id));
  await denied(householdSnapshots(db, a));
  const response = await request('GET', { email: viewer, query: '?id=' + h.id });
  assert.equal(response.status, 200); const data = await response.json(); assert.ok(!('devices' in data)); assert.ok(!('members' in data));
});

test('invitation binds addressed account; acceptance consumes once without verifying email', async () => {
  const h = await create(), i = await invite(h);
  assert.match(i.token, /^[a-f\d]{64}$/); assert.equal(i.delivery, 'not_emailed');
  const pending = await db.collection('household_members').findOne({ _id: i.member.id });
  assert.notEqual(pending.inviteHash, i.token); assert.equal(new Date(pending.inviteExpiresAt) - new Date(pending.createdAt), 7 * 86400000);
  await assert.rejects(mutate(outsider, { action: 'accept', token: i.token }), e => e.status === 400);
  await mutate(viewer, { action: 'accept', token: i.token });
  await assert.rejects(mutate(viewer, { action: 'accept', token: i.token }), e => e.status === 400);
  const m = (await activeHouseholdMember(db, i.member.id)).member;
  assert.equal(m.emailVerifiedAt, null); assert.equal(m.verifiedEmail, null); assert.equal(m.inviteHash, null);
  assert.deepEqual(m.preferences, { device: false, weather: false });
});

test('expiry and revoke prevent invitation acceptance', async () => {
  const h = await create(), expired = await invite(h, viewer, 'viewer', { now });
  await assert.rejects(mutate(viewer, { action: 'accept', token: expired.token }, { now: new Date(+now + 7 * 86400000) }), e => e.status === 400);
  await mutate(owner, { action: 'revoke', householdId: h.id, memberId: expired.member.id });
  await assert.rejects(mutate(viewer, { action: 'accept', token: expired.token }, { now }), e => e.status === 400);
  assert.equal((await db.collection('household_members').findOne({ _id: expired.member.id })).status, 'revoked');
});

test('concurrent acceptance succeeds exactly once', async () => {
  const h = await create(), i = await invite(h);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => mutate(viewer, { action: 'accept', token: i.token })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('concurrent revoke and acceptance cannot resurrect membership', async () => {
  const h = await create(), i = await invite(h);
  await Promise.allSettled([mutate(viewer, { action: 'accept', token: i.token }), mutate(owner, { action: 'revoke', householdId: h.id, memberId: i.member.id })]);
  assert.equal((await db.collection('household_members').findOne({ _id: i.member.id })).status, 'revoked');
  assert.equal(await activeHouseholdMember(db, i.member.id), null);
});

test('owner quota is transaction guarded under parallel creation', async () => {
  const results = await Promise.allSettled(Array.from({ length: 9 }, () => create()));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 5);
  assert.equal(await db.collection('households').countDocuments({ active: true }), 5);
});

test('member quota includes owner and cannot be exceeded concurrently', async () => {
  const h = await create();
  const results = await Promise.allSettled(Array.from({ length: 23 }, (_, i) => invite(h, `guest${i}@example.test`)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 19);
  assert.equal(await db.collection('household_members').countDocuments({ householdId: h.id, status: { $in: ['active', 'pending'] } }), 20);
});

test('duplicate pending invitations cannot bypass email uniqueness', async () => {
  const h = await create();
  const results = await Promise.allSettled([invite(h), invite(h)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('owner unlink, reassign, disable and delete remove shared snapshots immediately', async () => {
  for (const change of ['unlink', 'reassign', 'disable', 'delete']) {
    const d = await device(), h = await create([d.id]); const i = await join(h);
    if (change === 'unlink') await db.collection('customer_links').updateOne({ _id: d.id }, { $set: { active: false } });
    if (change === 'reassign') await db.collection('customer_links').updateOne({ _id: d.id }, { $set: { customerEmail: outsider } });
    if (change === 'disable') await db.collection('devices').updateOne({ _id: new ObjectId(d.deviceId) }, { $set: { disabled: true } });
    if (change === 'delete') await db.collection('devices').deleteOne({ _id: new ObjectId(d.deviceId) });
    const a = await activeHouseholdMember(db, i.member.id); assert.deepEqual(a.links, []); assert.deepEqual(await householdSnapshots(db, a), []);
  }
});

test('account recreation and changed email invalidate old membership', async () => {
  const h = await create(), i = await join(h);
  await db.collection('customer_accounts').updateOne({ _id: viewer }, { $set: { sessionGeneration: 'recreated' } });
  assert.equal(await activeHouseholdMember(db, i.member.id), null); await denied(resolveHousehold(db, { email: viewer, householdId: h.id }));
  const replacement = await invite(h); await mutate(viewer, { action: 'accept', token: replacement.token });
  assert.equal(await activeHouseholdMember(db, i.member.id), null);
  await db.collection('customer_accounts').deleteOne({ _id: viewer });
  await db.collection('customer_accounts').insertOne({ _id: 'changed@example.test', sessionGeneration: 'recreated' });
  assert.equal(await activeHouseholdMember(db, replacement.member.id), null);
});

test('owner account generation, email and disablement invalidate entire household', async () => {
  const h = await create(), i = await join(h); const ownerAccount = await db.collection('customer_accounts').findOne({ _id: owner });
  await db.collection('customer_accounts').updateOne({ _id: owner }, { $set: { disabled: true } }); assert.equal(await activeHouseholdMember(db, i.member.id), null);
  await db.collection('customer_accounts').updateOne({ _id: owner }, { $set: { disabled: false, sessionGeneration: 'new-owner' } }); assert.equal(await activeHouseholdMember(db, i.member.id), null);
  await db.collection('customer_accounts').deleteOne({ _id: owner });
  await db.collection('customer_accounts').insertOne({ ...ownerAccount, _id: 'changed@example.test' });
  assert.equal(await activeHouseholdMember(db, i.member.id), null);
});

test('revoke and leave disable preferences and retain audit records', async () => {
  const h = await create(), i = await join(h);
  await db.collection('household_members').updateOne({ _id: i.member.id }, { $set: { emailVerifiedAt: now, verifiedEmail: viewer, preferences: { device: true, weather: true } } });
  await mutate(viewer, { action: 'leave', householdId: h.id });
  const m = await db.collection('household_members').findOne({ _id: i.member.id });
  assert.equal(m.status, 'revoked'); assert.equal(m.emailVerifiedAt, null); assert.deepEqual(m.preferences, { device: false, weather: false });
  assert.equal(await activeHouseholdMember(db, i.member.id), null);
  await assert.rejects(mutate(owner, { action: 'leave', householdId: h.id }), e => e.status === 400);
});

test('preferences are per member and mutation cannot elevate role or opt in others', async () => {
  const h = await create(), i = await join(h);
  await mutate(owner, { action: 'update', householdId: h.id, name: 'Renamed', preferences: { device: true, weather: true }, role: 'owner' });
  const m = (await activeHouseholdMember(db, i.member.id)).member;
  assert.equal(m.role, 'viewer'); assert.deepEqual(m.preferences, { device: false, weather: false });
  assert.deepEqual((await listHouseholds(db, viewer))[0].member.preferences, { device: false, weather: false });
});

test('household deletion revokes active and pending members and prevents reuse', async () => {
  const h = await create(), active = await join(h), pending = await invite(h, outsider);
  await mutate(owner, { action: 'delete', householdId: h.id });
  assert.equal(await activeHouseholdMember(db, active.member.id), null);
  await assert.rejects(mutate(outsider, { action: 'accept', token: pending.token }), e => e.status === 400);
  assert.equal(await db.collection('household_members').countDocuments({ householdId: h.id, status: 'revoked' }), 3);
  assert.deepEqual(await listHouseholds(db, owner), []);
});

test('snapshots recheck access after slow risk load and never return revoked content', async () => {
  const d = await device(), h = await create([d.id]), i = await join(h);
  const a = await activeHouseholdMember(db, i.member.id);
  await denied(householdSnapshots(db, a, { deps: { loadRisk: async () => { await mutate(owner, { action: 'revoke', householdId: h.id, memberId: i.member.id }); return []; } } }));
});

test('snapshot post-check removes device deselected during risk load', async () => {
  const d = await device(), h = await create([d.id]), i = await join(h);
  const a = await activeHouseholdMember(db, i.member.id);
  const result = await householdSnapshots(db, a, { deps: { loadRisk: async () => { await mutate(owner, { action: 'update', householdId: h.id, linkIds: [] }); return []; } } });
  assert.deepEqual(result, []);
});

test('signed sessions and same-origin mutations enforced; revoked sessions denied', async () => {
  assert.equal((await request('GET', { auth: false })).status, 401);
  assert.equal((await request('POST', { origin: 'https://attacker.test', body: { action: 'create', name: 'Home', linkIds: [] } })).status, 403);
  const c = await cookie(); await db.collection('customer_accounts').updateOne({ _id: owner }, { $set: { sessionGeneration: 'new' } });
  const response = await householdsHandler({ request: new Request('https://home.test/api/customer/households', { headers: { Cookie: c } }), db, env }); assert.equal(response.status, 401);
  await denied(mutate(owner, { action: 'create', name: 'Home', linkIds: [] }, { expectedGeneration: 'old' }));
});

test('read-only membership never grants owner device APIs', async () => {
  const d = await device(), h = await create([d.id]); await join(h);
  const req = new Request('https://home.test/api/customer/devices', { headers: { Cookie: await cookie(viewer) } });
  const response = await customerHandler('devices', { request: req, env, db });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).devices, []);
  const del = new Request('https://home.test/api/customer/devices?id=' + d.id, { method: 'DELETE', headers: { Cookie: await cookie(viewer), Origin: 'https://home.test' } });
  assert.equal((await customerHandler('devices', { request: del, env, db })).status, 404);
});

test('atomic mutation rate limit stops excess requests', async () => {
  const keyHash = await import('../src/auth.js').then(m => m.sha256Hex('household-account:' + owner));
  const bucket = Math.floor(Date.now() / 900000);
  await db.collection('household_rate_limits').insertOne({ _id: `${keyHash}:${bucket}`, count: 60, expiresAt: new Date(Date.now() + 1800000) });
  assert.equal((await request('POST', { body: { action: 'create', name: 'Home', linkIds: [] } })).status, 429);
  assert.equal(await db.collection('households').countDocuments(), 0);
});

test('shared GET leaves risk cache and message acknowledgements untouched', async () => {
  const d = await device(), h = await create([d.id]); await join(h);
  const response = await request('GET', { email: viewer, query: '?id=' + h.id });
  assert.equal(response.status, 200);
  assert.equal(await db.collection('risk_state').countDocuments(), 0);
  assert.equal(await db.collection('device_logs').countDocuments(), 0);
});

test('last-known critical status remains urgent and risk loads are read-only', async () => {
  const d = await device(owner, { device: { lastSeen: new Date(+now - 3600000) } }), h = await create([d.id]); await join(h);
  const a = await resolveHousehold(db, { email: viewer, householdId: h.id });
  const result = await householdSnapshots(db, a, { now, deps: {
    loadRisk: async (_, options) => { assert.equal(options.readOnly, true); return [{ deviceId: d.deviceId, status: 'critical', offline: true }]; },
    customerView: () => ({ status: 'urgent', statusText: 'Last known critical report.' }),
  } });
  assert.equal(result[0].status, 'urgent'); assert.equal(result[0].statusText, 'Last known critical report.');
});

test('concurrent deletion and update cannot reactivate a deleted household', async () => {
  const h = await create(), i = await join(h);
  await Promise.allSettled([mutate(owner, { action: 'update', householdId: h.id, name: 'New name' }), mutate(owner, { action: 'delete', householdId: h.id })]);
  assert.equal((await db.collection('households').findOne({ _id: h.id })).active, false);
  assert.equal(await activeHouseholdMember(db, i.member.id), null);
});
