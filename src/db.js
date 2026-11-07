import { MongoClient, ObjectId } from 'mongodb';
import { HttpError, badRequest } from './http.js';

// Cloudflare Workers cannot safely reuse sockets across requests, so each request
// opens one small client and closes it when done. Tests inject `db` directly.
export async function withDb(env, injected, fn) {
  if (injected) return fn(injected);
  if (!env.MONGODB_URI) throw new HttpError(503, 'MONGODB_URI is not configured on the server');
  const client = new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    appName: 'utd-hackathon-26-api',
  });
  try {
    await client.connect();
    return await fn(client.db(env.MONGODB_DB || 'utd_hackathon_26'));
  } finally {
    await client.close().catch(() => {});
  }
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
