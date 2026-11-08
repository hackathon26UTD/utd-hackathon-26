// Reproducible isolated demo. --nvidia sends only these fictional records to the configured model.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { opsAgent } from '../src/system-api.js';
import { opsReviewQueue } from '../src/fleet-review-api.js';
import { seedNemotronReviewFixture } from './lib/nemotron-review-fixture.mjs';

const useNvidia = process.argv.includes('--nvidia');
const engine = useNvidia ? 'nemotron' : 'simulator';
const env = { API_ADMIN_KEY: crypto.randomUUID() };
if (useNvidia) {
  const { env: configured } = await import('./env.mjs');
  for (const key of ['NVIDIA_API_KEY', 'NVIDIA_BASE_URL', 'NVIDIA_MODEL']) if (configured[key]) env[key] = configured[key];
}
let server, client;
try {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  const db = client.db('safehome_nemotron_review_demo'), now = new Date();
  const fixture = await seedNemotronReviewFixture(db, now);
  const context = (method, path, body) => ({ env, injectedDb: db, now,
    request: new Request('https://demo.invalid' + path, { method, headers: { Authorization: `Bearer ${env.API_ADMIN_KEY}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }) });
  const call = async (handler, method, path, body) => {
    const response = await handler(context(method, path, body));
    const result = await response.json();
    assert.ok(response.ok, `Demo request failed (HTTP ${response.status}): ${result.error || 'Unknown failure'}`);
    return result;
  };
  const queue = await call(opsReviewQueue, 'GET', '/api/ops/review-queue?mode=exercise');
  assert.equal(queue.mode, 'exercise');
  const fleet = await call(opsReviewQueue, 'POST', '/api/ops/review-queue?mode=exercise', { requestId: 'isolated-fleet-review', engine });
  assert.equal(fleet.state, 'completed');
  const saved = await call(opsReviewQueue, 'GET', `/api/ops/review-queue?mode=exercise&run_id=${fleet.id}`);
  assert.equal(saved.id, fleet.id); assert.equal(saved.state, 'completed');
  const device = await call(opsAgent, 'POST', '/api/ops/agent?mode=exercise', { requestId: 'isolated-flame-crosscheck', engine, deviceId: fixture.devices.flame, goalHours: 24 });
  assert.equal(device.state, 'completed');
  assert.ok(device.checkpoint.sensorChecks?.items?.length, 'Sensor checks must be present');
  assert.ok(device.checkpoint.responderBrief?.text, 'Responder brief must be exportable');
  assert.equal(device.checkpoint.hardwareApplied, false);
  assert.equal(device.checkpoint.messagesSent, false);
  assert.equal(device.checkpoint.budget.basis, 'unknown');
  console.log(useNvidia ? 'SYNTHETIC EXERCISE — REAL NEMOTRON INFERENCE' : 'SYNTHETIC EXERCISE — SCRIPTED SIMULATOR, NOT AI');
  console.log(JSON.stringify({ homes: queue.queue.length, fleetState: fleet.state, fleetTools: fleet.trace.map(step => step.tool),
    savedRunVerified: true, deviceState: device.state, sensorChecks: device.checkpoint.sensorChecks.items.map(check => check.code),
    briefStatus: device.checkpoint.responderBrief.status, runtimeBasis: device.checkpoint.budget.basis, hardwareApplied: false, messagesSent: false }));
  if (process.argv.includes('--output')) {
    const path = process.argv[process.argv.indexOf('--output') + 1];
    if (!path || path.startsWith('--')) throw Error('--output requires a file path');
    await writeFile(path, JSON.stringify({ label: fixture.label, inference: useNvidia ? 'real_nemotron' : 'simulator_not_ai', queue, fleet, device }, null, 2) + '\n');
    console.log('Saved synthetic review artifact.');
  }
} finally {
  await client?.close();
  await server?.stop();
}
