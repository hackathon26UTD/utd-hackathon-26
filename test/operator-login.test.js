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
