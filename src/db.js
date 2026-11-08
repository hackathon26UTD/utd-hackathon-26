import { ObjectId } from 'mongodb';
import { HttpError, badRequest } from './http.js';
import { withDatabase, isManagedDb, DEFAULT_DB } from '../lib/mongodb.js';

// Cloudflare Workers cannot safely reuse sockets across requests. lib/mongodb.js opens one small
// client per request (shared with the auth middleware) and closes it when done.
// Tests inject `db` directly.
export async function withDb(env, injected, fn) {
  if (injected) return fn(injected);
  if (!env.MONGODB_URI) throw new HttpError(503, 'MONGODB_URI is not configured on the server');
  return withDatabase(env, fn, { timeoutMs: 5000, dbName: env.MONGODB_DB || DEFAULT_DB });
}

// Run one-time setup (indexes, catalog sync) once per isolate instead of on every request.
// Injected test databases always run it. A failed setup is retried on the next request.
const setupDone = new Map();
export function ensureOnce(db, key, setup) {
  if (!isManagedDb(db)) return setup();
  const id = `${db.databaseName}:${key}`;
  let run = setupDone.get(id);
  if (!run) {
    run = Promise.resolve().then(setup);
    setupDone.set(id, run);
    run.catch(() => setupDone.delete(id));
  }
  return run;
}

export function oid(id, what = 'id') {
  if (typeof id !== 'string' || !ObjectId.isValid(id) || id.length !== 24) throw badRequest(`Invalid ${what}`);
  return new ObjectId(id);
}

export { ObjectId };

// Creates indexes the first time they are needed; idempotent and cheap after that.
export async function ensureIndexes(db) {
  await Promise.all([
    db.collection('devices').createIndex({ keyHash: 1 }, { unique: true }),
    db.collection('readings').createIndex({ deviceId: 1, sensor: 1, ts: -1 }),
    db.collection('readings').createIndex({ ts: -1 }),
    db.collection('alerts').createIndex({ status: 1, createdAt: -1 }),
    db.collection('events').createIndex({ deviceId: 1, ts: -1 }),
  ]);
}
