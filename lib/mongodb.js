import { MongoClient } from 'mongodb';
import { AsyncLocalStorage } from 'node:async_hooks';

// Pages requests have separate I/O lifetimes, so a socket can never outlive one request.
// What we can do is (1) open as few connections as possible per request, (2) skip the DNS
// lookups an SRV address needs, and (3) skip repeat index creation inside one isolate.
// See docs/PERFORMANCE.md for the measurements behind each choice.

const requestScope = new AsyncLocalStorage();

export const DEFAULT_DB = 'utd_hackathon_26';
const SEED_TTL_MS = 10 * 60 * 1000;
const seedCache = new Map(); // srv host -> { uri, expires }
const indexMemo = new Map(); // index identity -> Promise, per isolate

export function clientOptions(timeoutMs = 4000) {
  return {
    serverSelectionTimeoutMS: timeoutMs,
    connectTimeoutMS: timeoutMs,
    socketTimeoutMS: timeoutMs,
    maxPoolSize: 1,
    minPoolSize: 0,
    maxConnecting: 1,
    // 'poll' skips the extra streaming and round-trip-time connections the default opens per member.
    serverMonitoringMode: 'poll',
    appName: 'hb-api',
  };
}

/**
 * Turn a mongodb+srv:// address into the equivalent seed-list address, given the SRV and TXT
 * records. Pure so it can be tested without a network. Returns null when it cannot be done safely.
 */
export function seedListUri(srvUri, srvRecords, txtRecords = []) {
  const m = /^mongodb\+srv:\/\/(?:([^@/]*)@)?([^/?]+)(\/[^?]*)?(?:\?(.*))?$/.exec(srvUri || '');
  if (!m || !srvRecords?.length) return null;
  const [, userinfo, , path = '/', query = ''] = m;
  const hosts = srvRecords.map((r) => `${r.name}:${r.port}`).sort().join(',');
  const params = new URLSearchParams(query);
  const txt = new URLSearchParams(txtRecords.flat().join(''));
  for (const [k, v] of txt) if (!params.has(k)) params.set(k, v);
  if (!params.has('tls') && !params.has('ssl')) params.set('tls', 'true');
  return `mongodb://${userinfo ? userinfo + '@' : ''}${hosts}${path}?${params}`;
}

/**
 * Resolve once per isolate and reuse: later requests connect without any SRV or TXT lookup.
 * An operator can also set MONGODB_SEED_URI to a seed-list address and skip even the first lookup.
 */
export async function connectionUri(env, resolver) {
  if (env.MONGODB_SEED_URI) return env.MONGODB_SEED_URI;
  const uri = env.MONGODB_URI;
  if (!uri.startsWith('mongodb+srv://') || env.MONGODB_DISABLE_SEED === '1') return uri;
  const host = /^mongodb\+srv:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri)?.[1];
  const hit = host && seedCache.get(host);
  if (hit && hit.expires > Date.now()) return hit.uri;
  try {
    const dns = resolver || (await import('node:dns')).promises;
    const [srv, txt] = await Promise.all([
      dns.resolveSrv('_mongodb._tcp.' + host),
      dns.resolveTxt(host).catch(() => []),
    ]);
    const seeded = seedListUri(uri, srv, txt);
    if (seeded) { seedCache.set(host, { uri: seeded, expires: Date.now() + SEED_TTL_MS }); return seeded; }
  } catch { /* fall back to the original address; the driver does its own lookup */ }
  return uri;
}

function trace(env, client) {
  if (env.DB_TRACE !== '1') return;
  const log = (globalThis.__dbTrace ||= []);
  client.on('commandSucceeded', (e) => log.push({ cmd: e.commandName, ms: e.duration }));
  client.on('commandFailed', (e) => log.push({ cmd: e.commandName, ms: e.duration, failed: true }));
}

async function openClient(env, timeoutMs, resolver) {
  const t0 = Date.now();
  const uri = await connectionUri(env, resolver);
  const t1 = Date.now();
  const client = new MongoClient(uri, { ...clientOptions(timeoutMs), ...(env.DB_TRACE === '1' ? { monitorCommands: true } : {}) });
  trace(env, client);
  try {
    await client.connect();
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }
  if (env.DB_TRACE === '1') (globalThis.__dbTrace ||= []).push({ cmd: 'connect', seeded: uri.startsWith('mongodb://'), lookupMs: t1 - t0, connectMs: Date.now() - t1 });
  return client;
}

/** createIndex is idempotent, so inside one isolate each index only needs asking for once. */
const managed = new WeakSet();
/** True for databases handed out by withDatabase; tests that inject their own database are not. */
export const isManagedDb = (db) => managed.has(db);

function memoizeIndexCalls(db, dbName) {
  managed.add(db);
  const collection = db.collection.bind(db);
  db.collection = (name, options) => {
    const c = collection(name, options);
    for (const method of ['createIndex']) {
      const original = c[method].bind(c);
      c[method] = (spec, opts) => {
        const key = `${dbName}.${name}:${JSON.stringify(spec)}:${JSON.stringify(opts || {})}`;
        let hit = indexMemo.get(key);
        if (!hit) {
          hit = original(spec, opts);
          indexMemo.set(key, hit);
          hit.catch(() => indexMemo.delete(key));
        }
        return hit;
      };
    }
    return c;
  };
  return db;
}

export function resetIndexMemo() { indexMemo.clear(); seedCache.clear(); }

/**
 * Run `fn` so that every withDatabase call inside it shares one connection, and close it at the end.
 * Used by the API middleware: the session check and the handler no longer connect twice.
 */
export async function withRequestDatabase(fn) {
  const scope = { clients: new Map(), closed: false };
  try {
    return await requestScope.run(scope, fn);
  } finally {
    // Work that outlives the response (waitUntil) falls back to its own short-lived client.
    scope.closed = true;
    const open = [...scope.clients.values()];
    scope.clients.clear();
    await Promise.all(open.map((p) => p.then((c) => c.close(), () => {}))).catch(() => {});
  }
}

export async function withDatabase(env, operation, { timeoutMs = 4000, resolver, dbName = env.MONGODB_DB } = {}) {
  if (!env.MONGODB_URI || !dbName) {
    throw new Error('Database settings are missing');
  }
  const scope = requestScope.getStore();
  if (scope && !scope.closed) {
    let pending = scope.clients.get(env.MONGODB_URI);
    if (!pending) {
      pending = openClient(env, timeoutMs, resolver);
      scope.clients.set(env.MONGODB_URI, pending);
      pending.catch(() => scope.clients.delete(env.MONGODB_URI));
    }
    return operation(memoizeIndexCalls((await pending).db(dbName), dbName));
  }
  const client = await openClient(env, timeoutMs, resolver);
  try {
    return await operation(memoizeIndexCalls(client.db(dbName), dbName));
  } finally {
    await client.close().catch(() => {});
  }
}
