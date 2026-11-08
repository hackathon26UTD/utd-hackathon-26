import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { onRequest as login } from '../functions/api/session.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { onRequest as account } from '../functions/api/account.js';
import { passwordHash, readSession } from '../src/operator-session.js';

let server, client, db, env;
const password = 'test-only-operator-password';
const operatorEmail = 'second-operator@example.test';
const origin = 'https://home.test';
before(async () => {
  if (!process.env.TEST_MONGODB_URI) server = await MongoMemoryServer.create();
  const uri = process.env.TEST_MONGODB_URI || server.getUri();
  client = await MongoClient.connect(uri);
  env = {
    MONGODB_URI: uri, MONGODB_DB: `operator_login_test_${process.pid}`,
    SESSION_SECRET: 'test-only-session-secret',
    OPERATOR_EMAIL: 'legacy@example.test', OPERATOR_PASSWORD_SALT: 'legacy-test-salt',
    OPERATOR_PASSWORD_HASH: await passwordHash(password, 'legacy-test-salt'),
  };
  db = client.db(env.MONGODB_DB);
});
beforeEach(async () => {
  await db.collection('operator_accounts').deleteMany({});
  await db.collection('login_attempts').deleteMany({});
  const salt = 'new-operator-test-salt';
  await db.collection('operator_accounts').insertOne({
    _id: operatorEmail, role: 'operator', salt, hash: await passwordHash(password, salt),
  });
});
after(async () => { await db?.dropDatabase(); await client?.close(); await server?.stop(); });

function signIn(email, suppliedPassword = password, extra = {}, settings = env) {
  return login({ env: settings, request: new Request(`${origin}/api/session`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: suppliedPassword, ...extra }),
  }) });
}
function sessionRequest(response) {
  return new Request(`${origin}/api/session`, { headers: { Cookie: response.headers.get('Set-Cookie') } });
}

test('an explicitly provisioned operator signs in without replacing the legacy operator', async () => {
  const response = await signIn('  SECOND-OPERATOR@example.test ');
  assert.equal(response.status, 200);
  const session = await readSession(sessionRequest(response), env);
  assert.equal(session.email, operatorEmail);
  assert.equal(session.role, 'operator');
  assert.equal(session.accountBacked, true);
  const context = {
    env, data: {}, request: new Request(`${origin}/api/layers`, {
      method: 'POST', headers: { Origin: origin, Cookie: response.headers.get('Set-Cookie') },
    }), next() { return new Response(null, { status: 204 }); },
  };
  assert.equal((await middleware(context)).status, 204);
  assert.equal(context.data.operator.role, 'operator');
  const legacy = await signIn(env.OPERATOR_EMAIL);
  assert.equal(legacy.status, 200);
  assert.equal((await readSession(sessionRequest(legacy), env)).role, 'operator');
});

test('database operators work without a configured legacy operator', async () => {
  const settings = { ...env, OPERATOR_EMAIL: undefined, OPERATOR_PASSWORD_HASH: undefined, OPERATOR_PASSWORD_SALT: undefined };
  const response = await signIn(operatorEmail, password, {}, settings);
  assert.equal(response.status, 200);
  assert.equal((await readSession(sessionRequest(response), settings)).role, 'operator');
});

test('session startup exposes display preferences only to operators without changing readings', async () => {
  const id = 'beac10000000000000000001';
  const settings = { ...env, WIFI_PREVIEW_DEVICE_IDS: `invalid, ${id.toUpperCase()}, ${id},*` };
  const observation = { deviceId: id, sensor: 'wifi_connected', value: false, ts: new Date('2026-11-08T16:00:00Z') };
  await db.collection('readings').insertOne(observation);
  const before = await db.collection('readings').find({}).toArray();
  const signedIn = await signIn(operatorEmail, password, {}, settings);
  const response = await login({ env: settings, request: sessionRequest(signedIn) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    authenticated: true, email: operatorEmail, role: 'operator',
    displayPreferences: { wifiConnectedDeviceIds: [id] },
  });
  const noPreview = await login({ env, request: sessionRequest(signedIn) });
  assert.deepEqual((await noPreview.json()).displayPreferences, { wifiConnectedDeviceIds: [] });
  const anonymous = await login({ env: settings, request: new Request(`${origin}/api/session`) });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { authenticated: false });
  await db.collection('operator_accounts').updateOne({ _id: operatorEmail }, { $set: { role: 'demo' } });
  const demo = await signIn(operatorEmail, password, {}, settings);
  const demoResponse = await login({ env: settings, request: sessionRequest(demo) });
  assert.equal(demoResponse.status, 200);
  assert.deepEqual(await demoResponse.json(), { authenticated: true, email: operatorEmail, role: 'demo' });
  assert.deepEqual(await db.collection('readings').find({}).toArray(), before);
});

test('wrong passwords, unknown users and non-operator rows cannot create operator sessions', async () => {
  assert.equal((await signIn(operatorEmail, 'incorrect-password')).status, 401);
  assert.equal((await signIn('unknown@example.test', password, { role: 'operator' })).status, 401);
  for (const role of ['customer', 'admin', null]) {
    await db.collection('operator_accounts').updateOne({ _id: operatorEmail }, { $set: { role } });
    assert.equal((await signIn(operatorEmail)).status, 401);
  }
  const accountRecord = await db.collection('operator_accounts').findOne({ _id: 'unknown@example.test' });
  assert.equal(accountRecord, null);
});

test('demo login remains a demo and cannot reach privileged operations', async () => {
  await db.collection('operator_accounts').updateOne({ _id: operatorEmail }, { $set: { role: 'demo' } });
  const response = await signIn(operatorEmail, password, { role: 'operator' });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('Set-Cookie');
  assert.equal((await readSession(sessionRequest(response), env)).role, 'demo');
  const blocked = await middleware({
    env, data: {}, request: new Request(`${origin}/api/ops/agent`, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie },
    }), next() { throw new Error('Demo reached an operator-only operation'); },
  });
  assert.equal(blocked.status, 403);
});

test('disabling an operator rejects login and revokes an existing session', async () => {
  const response = await signIn(operatorEmail);
  await db.collection('operator_accounts').updateOne({ _id: operatorEmail }, { $set: { disabled: true } });
  assert.equal((await signIn(operatorEmail)).status, 401);
  assert.equal(await readSession(sessionRequest(response), env), null);
});

test('removing or changing a provisioned account invalidates its existing session', async () => {
  const response = await signIn(operatorEmail);
  await db.collection('operator_accounts').updateOne({ _id: operatorEmail }, { $set: { role: 'demo' } });
  assert.equal(await readSession(sessionRequest(response), env), null);
  await db.collection('operator_accounts').deleteOne({ _id: operatorEmail });
  assert.equal(await readSession(sessionRequest(response), env), null);
  assert.equal(await readSession(sessionRequest(response), { SESSION_SECRET: env.SESSION_SECRET }), null);
});

test('a provisioned operator can change their password and the previous session is revoked', async () => {
  const response = await signIn(operatorEmail);
  const changed = await account({ env, request: new Request(`${origin}/api/account`, {
    method: 'PATCH', headers: { Origin: origin, Cookie: response.headers.get('Set-Cookie'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: password, newPassword: 'new-test-only-operator-password' }),
  }) });
  assert.equal(changed.status, 200);
  assert.equal(await readSession(sessionRequest(response), env), null);
  assert.equal((await signIn(operatorEmail)).status, 401);
  assert.equal((await signIn(operatorEmail, 'new-test-only-operator-password')).status, 200);
});

test('reusing a provisioned email and identical timestamp/credentials cannot revive an old operator cookie', async () => {
  await db.collection('operator_accounts').updateOne({_id: operatorEmail}, {$set: {createdAt: new Date(1)}});
  const original = await db.collection('operator_accounts').findOne({_id: operatorEmail});
  const signedIn = await signIn(operatorEmail);
  const oldSession = await readSession(sessionRequest(signedIn), env);
  assert.ok(oldSession.accountGeneration);
  await db.collection('operator_accounts').deleteOne({_id: operatorEmail});
  await db.collection('operator_accounts').insertOne(original);
  assert.equal(await readSession(sessionRequest(signedIn), env), null);
  const replacement = await signIn(operatorEmail);
  const newSession = await readSession(sessionRequest(replacement), env);
  assert.equal(replacement.status, 200);
  assert.notEqual(oldSession.accountGeneration, newSession.accountGeneration);
  assert.equal(await readSession(sessionRequest(signedIn), env), null);
});

test('configured legacy operator is generation-bound and deleting/recreating its profile revokes the cookie', async () => {
  const signedIn = await signIn(env.OPERATOR_EMAIL);
  const oldSession = await readSession(sessionRequest(signedIn), env);
  assert.ok(oldSession.accountGeneration);
  await db.collection('operator_accounts').deleteOne({_id: env.OPERATOR_EMAIL});
  assert.equal(await readSession(sessionRequest(signedIn), env), null);
  const replacement = await signIn(env.OPERATOR_EMAIL);
  assert.equal(replacement.status, 200);
  assert.notEqual((await readSession(sessionRequest(replacement), env)).accountGeneration, oldSession.accountGeneration);
  assert.equal(await readSession(sessionRequest(signedIn), env), null);
});
