import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { loadFleetReview, buildFleetReview } from '../src/fleet-review-evidence.js';
import { investigateFleet, simulatedFleetCompletion } from '../src/fleet-review-agent.js';
import { opsReviewQueue } from '../src/fleet-review-api.js';

let server, client, db;
const NOW = new Date('2026-11-08T15:00:00Z'), ago = s => new Date(NOW.getTime() - s * 1000);
const env = { API_ADMIN_KEY: 'fleet-test-only' };
const ctx = (method, path = '/api/ops/review-queue?mode=exercise', body, extra = {}) => ({
  request: new Request(`https://test.local${path}`, { method, headers: { Authorization: `Bearer ${env.API_ADMIN_KEY}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }),
  env, injectedDb: db, now: NOW, data: { operator: { email: 'test-operator@example.invalid' } }, ...extra,
});
const parsed = async response => ({ status: response.status, body: await response.json() });
const oid = n => new ObjectId(n.toString(16).padStart(24, '0'));
const device = (n, extra = {}) => ({ _id: oid(n), meta: { exercise: true }, name: 'PRIVATE NAME', keyHash: 'SECRET', ...extra });
const row = (d, sensor, value, seconds = 0) => ({ deviceId: d._id, sensor, value, ts: ago(seconds), receivedAt: NOW });
async function seed() {
  const a = device(1, { homeId: oid(100) }), b = device(2, { homeId: oid(100) }), c = device(3);
  await db.collection('devices').insertMany([a, b, c]);
  await db.collection('readings').insertMany([row(a, 'water_detected', true), row(a, 'mains_power', false), row(b, 'flame', false, 900), row(c, 'water_detected', false)]);
  return { a, b, c };
}
before(async () => {
  if (!process.env.TEST_MONGODB_URI) server = await MongoMemoryServer.create();
  client = await MongoClient.connect(process.env.TEST_MONGODB_URI || server.getUri()); db = client.db(`fleet_review_test_${process.pid}`);
});
beforeEach(async () => { await db.dropDatabase(); });
after(async () => { await db?.dropDatabase(); await client?.close(); await server?.stop(); });

test('fleet GET is authenticated, operator-only and never calls a model', async () => {
  await seed(); let called = false;
  const request = new Request('https://test.local/api/ops/review-queue');
  assert.equal((await opsReviewQueue(ctx('GET', undefined, undefined, { request }))).status, 401);
  assert.equal((await opsReviewQueue(ctx('GET', undefined, undefined, { data: { operator: { role: 'demo' } } }))).status, 403);
  const got = await parsed(await opsReviewQueue(ctx('GET', undefined, undefined, { fetcher: async () => { called = true; throw Error(); } })));
  assert.equal(got.status, 200); assert.equal(called, false); assert.equal(got.body.queue.length, 2);
  assert.ok(!/PRIVATE NAME|SECRET/.test(JSON.stringify(got.body)));
  assert.equal(await db.collection('fleet_review_runs').countDocuments(), 0);
});

test('same-home grouping isolates data modes, disabled devices and unsafe metadata', async () => {
  const { a } = await seed();
  const live = device(4, { homeId: a.homeId, meta: {} }), disabled = device(5, { disabled: true });
  await db.collection('devices').insertMany([live, disabled]);
  await db.collection('readings').insertMany([row(live, 'flame', true), row(disabled, 'flame', true), row(a, 'operator_notes', 'RUN SHELL SECRET'), row(a, 'flame', 'INJECTED')]);
  const exercise = await loadFleetReview(db, { exercise: true, now: NOW });
  assert.equal(exercise.coverage.totalDevices, 3); assert.equal(exercise.queue.find(q => q.homeId).deviceIds.length, 2);
  assert.ok(!/INJECTED|RUN SHELL|SECRET/.test(JSON.stringify(exercise)));
  assert.ok(exercise.queue.every(q => !q.deviceIds.includes(String(live._id))));
  const actual = await loadFleetReview(db, { now: NOW }); assert.equal(actual.queue.length, 1);
  assert.deepEqual(actual.queue[0].deviceIds, [String(live._id)]);
});

test('stale critical and latest help outrank fresh quiet readings; late OK cannot erase help', async () => {
  const { a, c } = await seed();
  await db.collection('incidents').insertMany([
    { deviceId: c._id, simulated: true, status: 'open', type: 'flood', severity: 'critical', detectedAt: ago(10000) },
    { deviceId: c._id, simulated: true, status: 'open', type: 'flood', severity: 'low', detectedAt: ago(20000) },
  ]);
  await db.collection('events').insertMany([
    { deviceId: a._id, type: 'help.request', ts: ago(500), data: { observed_at: ago(600).toISOString() } },
    { deviceId: a._id, type: 'ok.report', ts: ago(1), data: { observed_at: ago(700).toISOString() } },
  ]);
  const snap = await loadFleetReview(db, { exercise: true, now: NOW });
  assert.ok(snap.queue.every(q => q.priority === 'urgent_review'));
  const help = snap.queue.find(q => q.deviceId === String(a._id));
  assert.ok(help.reasons.some(r => r.code === 'help_request'));
  assert.equal(help.evidence.find(r => r.type === 'help.request').stale, true);
  const critical = snap.queue.find(q => q.deviceId === String(c._id));
  assert.ok(critical.evidence.some(r => r.severity === 'critical' && r.stale));
  assert.equal(critical.coverage.incidentCount, 2); assert.equal(critical.coverage.evidenceOmitted, 1);
  assert.ok(critical.unknowns.some(s => /Occupancy/.test(s)));
});

test('empty/no-reading homes are unknown and future values do not become current evidence', async () => {
  const d = device(8, { lastSeen: NOW }); await db.collection('devices').insertOne(d);
  await db.collection('readings').insertMany([row(d, 'water_detected', true, -10), row(d, 'battery_pct', 80), row(d, 'api_reachable', true)]);
  const snap = await loadFleetReview(db, { exercise: true, now: NOW });
  assert.equal(snap.queue[0].priority, 'visibility_review'); assert.equal(snap.queue[0].lastConditionObservedAt, null); assert.equal(snap.queue[0].lastObservedAt, NOW.toISOString()); assert.equal(snap.queue[0].evidence.length, 2); assert.ok(!snap.queue[0].evidence.some(r => r.sensor === 'water_detected'));
  assert.match(snap.queue[0].reasons[0].label, /unknown/);
});

test('bounded scan and shortlist explicitly disclose unseen devices/homes', async () => {
  await db.collection('devices').insertMany(Array.from({ length: 241 }, (_, n) => device(n + 1)));
  await db.collection('incidents').insertOne({ deviceId: oid(241), simulated: true, status: 'open', severity: 'critical', detectedAt: ago(10) });
  const snap = await loadFleetReview(db, { exercise: true, now: NOW });
  assert.equal(snap.coverage.devicesExamined, 240); assert.equal(snap.coverage.totalDevices, 241); assert.equal(snap.coverage.devicesOmitted, 1);
  assert.equal(snap.queue.length, 12); assert.equal(snap.coverage.homesOmitted, 228); assert.equal(snap.coverage.partial, true);
  assert.match(snap.policy, /only a shortlist within that scan/); assert.match(snap.coverage.scanOrder, /within the examined/);
});

test('POST requires explicit engine, cannot accept client evidence or use simulator on live records', async () => {
  await seed();
  for (const body of [{ requestId: 'missing-engine' }, { requestId: 'injected-evidence', engine: 'simulator', snapshot: {} }]) assert.equal((await opsReviewQueue(ctx('POST', undefined, body))).status, 400);
  assert.equal((await opsReviewQueue(ctx('POST', '/api/ops/review-queue', { requestId: 'live-simulator', engine: 'simulator' }))).status, 400);
  assert.equal((await opsReviewQueue(ctx('POST', undefined, { requestId: 'missing-nvidia', engine: 'nemotron' }))).status, 503);
});

test('fleet run persists once, scopes retrieval and retains an immutable snapshot on retry', async () => {
  const { a } = await seed(); const body = { requestId: 'fleet-run-001', engine: 'simulator' };
  const first = await parsed(await opsReviewQueue(ctx('POST', undefined, body)));
  assert.equal(first.status, 201); assert.equal(first.body.state, 'completed'); assert.equal(first.body.simulated, true); assert.equal(first.body.modelVerified, false);
  assert.deepEqual(first.body.trace.map(s => s.tool), ['read_fleet_shortlist', 'check_review_gaps', 'save_fleet_checkpoint']);
  assert.equal(first.body.checkpoint.interpretationSource, 'simulator_not_ai'); assert.equal(first.body.checkpoint.messagesSent, false);
  assert.deepEqual(first.body.checkpoint.reviewedIds, first.body.snapshot.queue.map(q => q.id));
  await db.collection('readings').deleteMany({ deviceId: a._id });
  const retry = await parsed(await opsReviewQueue(ctx('POST', undefined, body)));
  assert.equal(retry.status, 200); assert.deepEqual(retry.body.snapshot, first.body.snapshot);
  assert.equal(await db.collection('fleet_review_runs').countDocuments(), 1);
  assert.equal((await opsReviewQueue(ctx('POST', undefined, { ...body, engine: 'nemotron' }))).status, 409);
  const readPath = `/api/ops/review-queue?mode=exercise&run_id=${first.body.id}`;
  assert.equal((await opsReviewQueue(ctx('GET', readPath))).status, 200);
  assert.equal((await opsReviewQueue(ctx('GET', readPath, undefined, { data: { operator: { email: 'another@example.invalid' } } }))).status, 404);
  assert.equal((await opsReviewQueue(ctx('GET', `/api/ops/review-queue?run_id=${first.body.id}`))).status, 404);
});

test('model must perform required tools and cite supplied queue summary IDs', async () => {
  await seed(); const snapshot = await loadFleetReview(db, { exercise: true, now: NOW });
  const call = (name, args = {}) => ({ tool_calls: [{ id: 'call1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  await assert.rejects(investigateFleet({ snapshot, complete: async () => call('run_shell') }), /unsupported/);
  await assert.rejects(investigateFleet({ snapshot, complete: async () => call('read_fleet_shortlist', { homeId: 'other' }) }), /scope/);
  await assert.rejects(investigateFleet({ snapshot, complete: async () => call('save_fleet_checkpoint', { summary: 'skip', evidenceIds: [snapshot.queue[0].id] }) }), /skipped/);
  const sim = simulatedFleetCompletion(snapshot);
  await assert.rejects(investigateFleet({ snapshot, complete: async input => {
    const value = await sim(input);
    if (value.tool_calls[0].function.name === 'save_fleet_checkpoint') value.tool_calls[0].function.arguments = JSON.stringify({ summary: 'fabricated', evidenceIds: ['home:unknown'] });
    return value;
  } }), /valid shortlist/);
  let called = false;
  const big = structuredClone(snapshot); big.queue[0].unknowns.push('x'.repeat(20000));
  await assert.rejects(investigateFleet({ snapshot: big, complete: async () => { called = true; } }), /input limit/);
  assert.equal(called, false);
});

test('real-provider path persists completed tool traces and failures without secret responses', async () => {
  await seed(); const snapshot = await loadFleetReview(db, { exercise: true, now: NOW });
  const completion = simulatedFleetCompletion(snapshot), requests = [];
  const fetcher = async (url, init) => { requests.push(JSON.parse(init.body)); return Response.json({ choices: [{ message: await completion() }] }); };
  const yes = await parsed(await opsReviewQueue(ctx('POST', undefined, { requestId: 'mock-real-001', engine: 'nemotron' }, { env: { ...env, NVIDIA_API_KEY: 'never-print' }, fetcher })));
  assert.equal(yes.status, 201); assert.equal(yes.body.modelVerified, true); assert.equal(yes.body.checkpoint.interpretationSource, 'model_unverified');
  assert.equal(requests.length, 3); assert.ok(!/PRIVATE NAME|SECRET/.test(JSON.stringify(requests)));
  const fail = await parsed(await opsReviewQueue(ctx('POST', undefined, { requestId: 'mock-fail-001', engine: 'nemotron' }, {
    env: { ...env, NVIDIA_API_KEY: 'never-print' }, fetcher: async () => new Response('SECRET upstream', { status: 503 }),
  })));
  assert.equal(fail.status, 502); assert.equal(fail.body.state, 'failed'); assert.ok(fail.body.id); assert.ok(!JSON.stringify(fail.body).includes('SECRET'));
});

test('expired fleet run becomes failed and is not silently retried', async () => {
  await seed(); const body = { requestId: 'expired-run-001', engine: 'simulator' };
  const first = await parsed(await opsReviewQueue(ctx('POST', undefined, body)));
  await db.collection('fleet_review_runs').updateOne({ _id: first.body.id }, { $set: { state: 'running', createdAt: ago(181) } });
  const recovered = await parsed(await opsReviewQueue(ctx('GET', `/api/ops/review-queue?mode=exercise&run_id=${first.body.id}`)));
  assert.equal(recovered.body.state, 'failed'); assert.match(recovered.body.error, /timed out/);
  const retry = await parsed(await opsReviewQueue(ctx('POST', undefined, body))); assert.equal(retry.body.state, 'failed');
});


test('full 12-home multi-device shortlist fits the model budget with all concerns and gaps', async () => {
  const devices = Array.from({ length: 240 }, (_, n) => device(n + 1, { homeId: oid(1000 + Math.floor(n / 20)) }));
  const readings = devices.flatMap((d, n) => [['water_detected', true], ['water_detected', false], ['flame', true], ['flame', 42], ['smoke_alarm', true], ['mains_power', false], ['mains_power', true], ['api_reachable', false]].map(([sensor, value], i) => ({ ...row(d, sensor, value, 600), _id: oid(10000 + n * 10 + i) })));
  const incidents = devices.map((d, n) => ({ _id: d._id, count: 20, row: { _id: oid(30000 + n), deviceId: d._id, type: 'flood', severity: 'critical', status: 'open', detectedAt: ago(600) } }));
  const helps = devices.flatMap((d, n) => ['help.request', 'ok.report'].map((type, i) => ({ _id: oid(40000 + n * 2 + i), deviceId: d._id, type, ts: ago(300) })));
  const snapshot = buildFleetReview({ devices, readings, incidents, helps, exercise: true, now: NOW });
  assert.equal(snapshot.queue.length, 12);
  const sim = simulatedFleetCompletion(snapshot); let largest = 0;
  const result = await investigateFleet({ snapshot, complete: async input => { largest = Math.max(largest, JSON.stringify({ messages: input.messages, tools: input.tools }).length); return sim(input); } });
  assert.equal(result.checkpoint.reviewedIds.length, 12); assert.ok(largest <= 16000, String(largest));
});


test('latest tied binary readings preserve concerns, conflicts and unsupported values in DB and pure snapshots', async () => {
  const d = device(90); await db.collection('devices').insertOne(d);
  const readings = [
    { ...row(d, 'water_detected', true), _id: oid(500) }, { ...row(d, 'water_detected', false), _id: oid(501) },
    { ...row(d, 'mains_power', true), _id: oid(502) }, { ...row(d, 'power.mains', false), _id: oid(503) },
    { ...row(d, 'flame', 42), _id: oid(504) },
  ];
  await db.collection('readings').insertMany(readings);
  for (const snap of [await loadFleetReview(db, { exercise: true, now: NOW }), buildFleetReview({ devices: [d], readings, incidents: [], helps: [], exercise: true, now: NOW })]) {
    const q = snap.queue[0];
    assert.equal(q.priority, 'observation_review');
    assert.equal(q.evidence.filter(r => r.sensor === 'water_detected').length, 2);
    assert.equal(q.evidence.filter(r => r.sensor === 'mains_power').length, 2);
    assert.ok(q.reasons.some(r => r.code === 'water_observation'));
    assert.ok(q.reasons.some(r => r.code === 'power_observation'));
    assert.ok(q.reasons.some(r => r.code === 'conflicting_latest_readings'));
    assert.ok(q.reasons.some(r => r.code === 'unsupported_binary_value'));
    assert.ok(q.unknowns.some(s => /external power is unknown/.test(s)));
  }
  await db.collection('readings').deleteMany({ deviceId: d._id });
  await db.collection('readings').insertOne(row(d, 'water_detected', 42));
  const invalid = (await loadFleetReview(db, { exercise: true, now: NOW })).queue[0];
  assert.equal(invalid.lastConditionObservedAt, null); assert.notEqual(invalid.priority, 'routine_review');
});

test('equal-time help and OK retain help; a strictly newer observed OK can resolve it', async () => {
  const d = device(91); await db.collection('devices').insertOne(d);
  await db.collection('events').insertMany([
    { _id: oid(600), deviceId: d._id, type: 'help.request', ts: ago(20), data: { observed_at: ago(30).toISOString() } },
    { _id: oid(601), deviceId: d._id, type: 'ok.report', ts: ago(10), data: { observed_at: ago(30).toISOString() } },
  ]);
  const q = (await loadFleetReview(db, { exercise: true, now: NOW })).queue[0];
  assert.equal(q.priority, 'urgent_review'); assert.ok(q.reasons.some(r => r.code === 'conflicting_checkins'));
  assert.equal(q.evidence.filter(r => r.kind === 'event').length, 2);
  await db.collection('events').insertOne({ deviceId: d._id, type: 'ok.report', ts: ago(1), data: { observed_at: ago(5).toISOString() } });
  assert.equal((await loadFleetReview(db, { exercise: true, now: NOW })).queue[0].priority, 'visibility_review');
});

test('model input states complete coverage and requests correction for an invented partial scan', async () => {
  await seed(); const snapshot = await loadFleetReview(db, { exercise: true, now: NOW });
  let calls = 0, sawCorrection = false;
  const sim = simulatedFleetCompletion(snapshot);
  const result = await investigateFleet({ snapshot, complete: async input => {
    calls++;
    if (calls <= 2) return sim(input);
    if (calls === 3) {
      const packet = JSON.parse(input.messages.find(m => m.role === 'tool' && JSON.parse(m.content).entries)?.content);
      assert.equal(packet.coverage.scanComplete, true); assert.equal(packet.coverage.shortlistComplete, true);
      assert.match(packet.coverageStatement, /Device scan complete/);
      return { tool_calls: [{ id: 'bad_coverage', type: 'function', function: { name: 'save_fleet_checkpoint', arguments: JSON.stringify({ summary: `${snapshot.queue[0].label} requires review due to a partial device scan.`, evidenceIds: [snapshot.queue[0].id] }) } }] };
    }
    sawCorrection = input.messages.some(m => m.role === 'tool' && m.content.includes('Remove the unsupported partial-scan claim'));
    return { tool_calls: [{ id: 'corrected_coverage', type: 'function', function: { name: 'save_fleet_checkpoint', arguments: JSON.stringify({ summary: `${snapshot.queue[0].label} has a water observation requiring review.`, evidenceIds: [snapshot.queue[0].id] }) } }] };
  } });
  assert.equal(sawCorrection, true); assert.equal(result.trace.length, 3); assert.match(result.checkpoint.coverageStatement, /complete/);
  assert.doesNotMatch(result.checkpoint.interpretation, /partial/);
});


test('coverage guard accepts direct negation but still rejects an affirmative partial-scan clause', async () => {
  await seed(); const snapshot = await loadFleetReview(db, { exercise: true, now: NOW });
  const run = sentence => {
    let calls = 0; const sim = simulatedFleetCompletion(snapshot);
    return investigateFleet({ snapshot, complete: async input => {
      if (++calls <= 2) return sim(input);
      return { tool_calls: [{ id: `coverage_case_${calls}`, type: 'function', function: { name: 'save_fleet_checkpoint', arguments: JSON.stringify({
        summary: `${snapshot.queue[0].label} has a water observation requiring review. ${sentence}`, evidenceIds: [snapshot.queue[0].id],
      }) } }] };
    } });
  };
  for (const sentence of ['Coverage is authoritative: no partial scans.', 'There is no incomplete shortlist.', 'The device scan is not partial; the shortlist is not truncated.', 'This is not a partial device scan.']) {
    const result = await run(sentence);
    assert.equal(result.trace.length, 3); assert.match(result.checkpoint.coverageStatement, /Device scan complete/);
    assert.equal(result.checkpoint.interpretationSource, 'model_unverified');
  }
  for (const sentence of ['This is only a partial scan.', 'No partial scans were expected, but this is a partial device scan.', 'Not only partial scan results matter.']) {
    await assert.rejects(run(sentence), /did not match its supplied groups or coverage/);
  }
});
