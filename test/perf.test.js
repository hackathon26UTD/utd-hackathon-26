import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { seedListUri, connectionUri, withDatabase, withRequestDatabase, isManagedDb, resetIndexMemo, clientOptions } from '../lib/mongodb.js';
import { ensureOnce } from '../src/db.js';
import { percentile, summarize } from '../scripts/bench-api.mjs';

test('seed list address keeps credentials, options and every host', () => {
  const uri = seedListUri('mongodb+srv://user:p%40ss@cl.example.net/app?retryWrites=true&w=majority',
    [{ name: 'b.example.net', port: 27017 }, { name: 'a.example.net', port: 27017 }],
    [['authSource=admin&replicaSet=rs0']]);
  assert.ok(uri.startsWith('mongodb://user:p%40ss@a.example.net:27017,b.example.net:27017/app?'));
  for (const part of ['retryWrites=true', 'authSource=admin', 'replicaSet=rs0', 'tls=true']) assert.ok(uri.includes(part), part);
  assert.equal(seedListUri('mongodb+srv://cl.example.net', []), null);
  assert.equal(seedListUri('mongodb://plain', [{ name: 'x', port: 1 }]), null);
});

test('connectionUri resolves once, then reuses the seed list; failures fall back', async () => {
  resetIndexMemo();
  let calls = 0;
  const resolver = { resolveSrv: async () => { calls++; return [{ name: 'h1.example.net', port: 27017 }]; }, resolveTxt: async () => [['replicaSet=rs']] };
  const env = { MONGODB_URI: 'mongodb+srv://u:p@seed-test.example.net/db' };
  const first = await connectionUri(env, resolver);
  assert.ok(first.startsWith('mongodb://u:p@h1.example.net:27017'));
  assert.equal(await connectionUri(env, resolver), first);
  assert.equal(calls, 1);
  resetIndexMemo();
  const broken = { resolveSrv: async () => { throw new Error('dns down'); }, resolveTxt: async () => [] };
  assert.equal(await connectionUri(env, broken), env.MONGODB_URI);
  assert.equal(await connectionUri({ ...env, MONGODB_SEED_URI: 'mongodb://explicit' }, broken), 'mongodb://explicit');
  assert.equal(await connectionUri({ MONGODB_URI: 'mongodb://direct/db' }, broken), 'mongodb://direct/db');
  resetIndexMemo();
});

test('client options stay small: one connection, polled monitoring', () => {
  const o = clientOptions();
  assert.equal(o.maxPoolSize, 1);
  assert.equal(o.serverMonitoringMode, 'poll');
});

test('ensureOnce runs setup once for managed databases and always for injected ones', async () => {
  let n = 0;
  const injected = {};
  await ensureOnce(injected, 'k', async () => { n++; });
  await ensureOnce(injected, 'k', async () => { n++; });
  assert.equal(n, 2);
  assert.equal(isManagedDb(injected), false);
});

test('one connection per request, shared across calls; index creation is asked once', async (t) => {
  const mongod = await MongoMemoryServer.create();
  t.after(() => mongod.stop());
  const env = { MONGODB_URI: mongod.getUri(), MONGODB_DB: 'perf', MONGODB_DISABLE_SEED: '1' };
  const admin = new MongoClient(mongod.getUri());
  await admin.connect();
  t.after(() => admin.close());
  const created = async () => (await admin.db('admin').command({ serverStatus: 1 })).connections.totalCreated;

  const before = await created();
  await withDatabase(env, (db) => db.command({ ping: 1 }));
  await withDatabase(env, (db) => db.command({ ping: 1 }));
  const unscoped = (await created()) - before;

  const mid = await created();
  await withRequestDatabase(async () => {
    await withDatabase(env, (db) => db.command({ ping: 1 }));
    await withDatabase(env, (db) => { assert.ok(isManagedDb(db)); return db.command({ ping: 1 }); });
  });
  const scoped = (await created()) - mid;
  assert.ok(scoped < unscoped, `scoped ${scoped} should open fewer connections than unscoped ${unscoped}`);

  // After the scope closes, background work still gets a working client.
  let late;
  await withRequestDatabase(async () => { late = () => withDatabase(env, (db) => db.command({ ping: 1 })); });
  assert.equal((await late()).ok, 1);

  // Repeat createIndex calls on managed databases return the same promise without a second command.
  let first, second;
  await withDatabase(env, async (db) => {
    first = db.collection('idx').createIndex({ a: 1 });
    second = db.collection('idx').createIndex({ a: 1 });
    assert.equal(first, second);
    await first;
  });
});

test('percentile and summarize report p50 and p95', () => {
  const xs = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(percentile(xs, 50), 10);
  assert.equal(percentile(xs, 95), 19);
  const s = summarize([...xs, NaN]);
  assert.equal(s.n, 20);
  assert.equal(s.failed, 1);
  assert.equal(s.p50, 10);
});
