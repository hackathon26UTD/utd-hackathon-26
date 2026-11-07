import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { withDatabase } from '../lib/mongodb.js';
import { onRequestGet } from '../functions/api/ready.js';

try {
  await withDatabase(process.env, async (db) => {
    assert.equal((await db.command({ ping: 1 })).ok, 1);
    const collection = db.collection('_integration_checks');
    const _id = randomUUID();
    try {
      await collection.insertOne({ _id, purpose: 'connection-check', createdAt: new Date() });
      assert.equal((await collection.findOne({ _id })).purpose, 'connection-check');
    } finally {
      await collection.deleteOne({ _id });
    }
  });
  const response = await onRequestGet({ env: process.env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mongodb.connected, true);
  console.log('MongoDB ping, isolated write/read/cleanup, and readiness check passed.');
} catch (error) {
  console.error('MongoDB check failed. Connection details are hidden. Error type:', error.name);
  process.exitCode = 1;
}
