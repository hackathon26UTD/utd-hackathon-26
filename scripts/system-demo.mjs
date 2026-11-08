// Isolated, synthetic exercise. --nvidia explicitly opts into hosted inference.
// Never connects to Atlas or the live site.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { opsAgent, opsSystem } from '../src/system-api.js';
import { writeFile } from 'node:fs/promises';

const server = await MongoMemoryServer.create();
const client = await MongoClient.connect(server.getUri());
const now = new Date(), id = new ObjectId(), homeId = new ObjectId();
const db = client.db('homebeacon_system_demo');
const env = { API_ADMIN_KEY: crypto.randomUUID() };
const useNvidia = process.argv.includes('--nvidia');
if (useNvidia) {
  const { env: configured } = await import('./env.mjs');
  for (const key of ['NVIDIA_API_KEY', 'NVIDIA_BASE_URL', 'NVIDIA_MODEL']) {
    if (configured[key]) env[key] = configured[key];
  }
}
const ctx = (method, path, body) => ({ env, injectedDb: db, now,
  request: new Request('https://demo.invalid' + path, { method, headers: { Authorization: `Bearer ${env.API_ADMIN_KEY}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) }) });
try {
  await db.collection('devices').insertOne({ _id: id, homeId, disabled: false, meta: { exercise: true }, lastSeen: now });
  const reading = (sensor, value, secondsAgo) => ({ deviceId: id, sensor, value,
    ts: new Date(now.getTime() - secondsAgo * 1000), receivedAt: now });
  await db.collection('readings').insertMany([
    reading('mains_power', true, 180), reading('water_detected', false, 180),
    reading('water_detected', true, 80), reading('mains_power', false, 65),
    reading('wifi_connected', false, 60), reading('battery_mv', 8000, 50),
    reading('queue_depth', 12, 45), reading('wifi_connected', true, 5), reading('api_reachable', true, 4),
  ]);
  await db.collection('incidents').insertOne({ deviceId: id, homeId, type: 'flood', severity: 'critical', status: 'open',
    simulated: true, detectedAt: new Date(now.getTime() - 80_000), lastObservedAt: new Date(now.getTime() - 80_000) });
  const response = await opsAgent(ctx('POST', '/api/ops/agent?mode=exercise', {
    requestId: 'local-system-demo', deviceId: String(id), engine: useNvidia ? 'nemotron' : 'simulator', goalHours: 24,
    // Deliberately fictional numbers for demonstrating the formula, not the team's AA pack.
    budget: { remainingWh: 8, basis: 'assumption', reserveFraction: 0.15, loadsWatts: { normal: 1, saver: 0.2, critical: 0.4 } },
  }));
  const run = await response.json();
  if (response.status !== 201) throw new Error(run.error || 'Demo did not complete');
  const evidence = await (await opsSystem(ctx('GET', `/api/ops/system?mode=exercise&device_id=${id}`))).json();
  console.log(useNvidia
    ? 'HOME BEACON SYSTEM DEMO — SYNTHETIC DATA, REAL NVIDIA INFERENCE'
    : 'HOME BEACON SYSTEM DEMO — SYNTHETIC DATA, SIMULATED AGENT, NO NVIDIA CALL');
  console.log('Story: water detected → power lost → Wi-Fi lost → local queue → reconnect → review checkpoint.');
  for (const step of run.trace) console.log(`${step.number}. ${step.tool}: ${step.status}`);
  console.log(`Mode: ${run.checkpoint.policies[0].mode}. Camera/display off in proposed policy; sensing/logging/relay retained.`);
  console.log(`Illustrative runtime: ${run.checkpoint.budget.devices[0].projectedHours} h. Goal: 24 h. Assumptions are not measurements.`);
  console.log(`Checkpoint: ${run.checkpoint.state}; persisted in isolated MongoDB and retrieved successfully.`);
  const saved = await (await opsAgent(ctx('GET', `/api/ops/agent?mode=exercise&run_id=${run.id}`))).json();
  if (saved.id !== run.id || !['read_sensor_timeline', 'correlate_signals', 'plan_power_budget', 'save_review_checkpoint'].every(tool => saved.trace.some(step => step.tool === tool))) throw new Error('Checkpoint read-back failed');
  if (process.argv.includes('--output')) {
    const path = process.argv[process.argv.indexOf('--output') + 1];
    if (!path || path.startsWith('--')) throw new Error('--output requires a filename');
    await writeFile(path, JSON.stringify({ label: useNvidia ? 'SYNTHETIC SENSORS — real NVIDIA inference' : 'SIMULATION — no real sensors or NVIDIA inference', run, evidence }, null, 2) + '\n');
    console.log('Saved the synthetic review artifact.');
  }
} finally { await client.close(); await server.stop(); }
