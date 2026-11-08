import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareModelEvidence, MODEL_REQUEST_CHARS } from '../src/system-model-input.js';
import { investigateSystem } from '../src/system-agent.js';
import { simulatedCompletion } from '../src/system-simulator.js';
import { summarizeModelContext } from '../src/model-context.js';
import { devicePolicy } from '../domain/system-policy.js';

const NOW = '2026-11-08T12:00:00.000Z', TARGET = 'a'.repeat(24), PEER = 'b'.repeat(24);
function fixture(history = 200) {
  let next = 1;
  const reading = (deviceId, sensor, value, seconds = 0) => ({ id: `reading:${(next++).toString(16).padStart(24, '0')}`,
    deviceId, sensor, value, observedAt: new Date(Date.parse(NOW) - seconds * 1000).toISOString(), receivedAt: NOW,
    stale: seconds > 120, delayed: seconds > 120 });
  const observations = [reading(TARGET, 'water_detected', true, 20), reading(TARGET, 'mains_power', false, 30),
    reading(TARGET, 'wifi_connected', true, 10), reading(TARGET, 'api_reachable', false, 9), reading(PEER, 'mains_power', true, 600)];
  observations.push(...Array.from({ length: history }, (_, n) => reading(TARGET, 'rssi', -70, n + 1)));
  const events = [{ id: 'event:help', deviceId: PEER, type: 'help.request', observedAt: NOW, receivedAt: NOW }];
  const incidents = [{ id: 'incident:water', deviceId: PEER, type: 'flood', severity: 'critical', status: 'open', detectedAt: NOW, lastObservedAt: NOW }];
  const devices = [TARGET, PEER].map(id => ({ id, homeId: 'home-test', lastReceivedAt: NOW,
    latest: Object.fromEntries([...observations].reverse().filter(o => o.deviceId === id).map(o => [o.sensor, o])),
    latchedCritical: id === PEER, helpObservation: id === PEER ? { evidenceId: 'event:help', type: 'help.request', observedAt: NOW, receivedAt: NOW } : null }));
  const evidence = { targetDeviceId: TARGET, mode: 'exercise', generatedAt: NOW, observations, events, incidents, devices,
    policies: devices.map(d => devicePolicy(d, new Date(NOW))), coverage: devices.map(d => ({ deviceId: d.id, historyTruncated: history >= 200, eventsTruncated: false, incidentsTruncated: false })),
    scope: 'Target and same-home peer; bounded history; co-occurrence does not prove causation.' };
  return { evidence, externalContext: summarizeModelContext({}, { now: new Date(NOW), mode: 'exercise' }) };
}

test('compaction preserves latest, stale and critical evidence and all policy fields without changing storage snapshots', () => {
  const input = fixture(), original = JSON.stringify(input);
  const result = prepareModelEvidence({ ...input, maxChars: 7000 });
  const read = result.tools.read_sensor_timeline;
  assert.ok(JSON.stringify(result.tools).length <= 7000);
  assert.ok(read.coverage.observationsOmitted > 0);
  assert.equal(read.coverage.completeHistory, false);
  for (const device of input.evidence.devices) for (const row of Object.values(device.latest)) assert.ok(result.evidenceIds.has(row.id));
  assert.ok(result.evidenceIds.has('event:help'));
  assert.ok(result.evidenceIds.has('incident:water'));
  const peerRow = read.observations.find(row => row[1] === 1 && row[2] === 'mains_power');
  assert.equal(peerRow[4], 600); assert.equal(peerRow[5], 0);
  assert.equal(peerRow[6], true); assert.equal(peerRow[7], true);
  for (const relation of result.tools.correlate_signals.relations) for (const id of relation.evidenceIds) assert.ok(result.evidenceIds.has(id));
  assert.deepEqual(result.tools.plan_power_budget.policies, input.evidence.policies);
  assert.ok(result.tools.plan_power_budget.policies.every(p => p.mode === 'critical' && p.appliedToHardware === false));
  assert.equal(JSON.stringify(input), original);
});

test('oversized mandatory state fails before any model call instead of removing latest or unresolved evidence', async () => {
  const input = fixture(0);
  input.evidence.incidents.push(...Array.from({ length: 100 }, (_, n) => ({ ...input.evidence.incidents[0], id: `incident:${n.toString().padStart(24, '0')}` })));
  let calls = 0;
  await assert.rejects(investigateSystem({ ...input, complete: async () => { calls++; } }), /required evidence exceeds/);
  assert.equal(calls, 0);
  assert.equal(input.evidence.incidents.length, 101);
});

test('maximum retained history uses bounded conversations and the simulator cites only emitted records', async () => {
  const input = fixture(200), simulator = simulatedCompletion(input.evidence), sizes = [];
  let emitted;
  const result = await investigateSystem({ ...input, complete: async payload => {
    sizes.push(JSON.stringify({ messages: payload.messages, tools: payload.tools }).length);
    const read = payload.messages.find(m => m.role === 'tool' && m.tool_call_id === 'sim_read');
    if (read) emitted = JSON.parse(read.content);
    return simulator(payload);
  } });
  assert.equal(result.trace.length, 4);
  assert.ok(sizes.every(n => n <= MODEL_REQUEST_CHARS));
  assert.ok(result.checkpoint.modelCoverage.observationsOmitted > 0);
  const ids = new Set([...emitted.observations, ...emitted.events, ...emitted.incidents].map(row => row[0]));
  assert.ok(result.checkpoint.evidenceIds.every(id => ids.has(id)));
});

test('source IDs omitted from model history cannot be cited in a checkpoint', async () => {
  const input = fixture(200), simulator = simulatedCompletion(input.evidence);
  let omitted;
  await assert.rejects(investigateSystem({ ...input, complete: async payload => {
    const read = payload.messages.find(m => m.role === 'tool' && m.tool_call_id === 'sim_read');
    if (read) {
      const sent = new Set(JSON.parse(read.content).observations.map(row => row[0]));
      omitted = input.evidence.observations.find(row => !sent.has(row.id))?.id;
    }
    const reply = await simulator(payload);
    if (reply.tool_calls[0].function.name === 'save_review_checkpoint') {
      assert.ok(omitted);
      const args = JSON.parse(reply.tool_calls[0].function.arguments);
      args.evidenceIds = [omitted]; reply.tool_calls[0].function.arguments = JSON.stringify(args);
    }
    return reply;
  } }), /valid evidence/);
});

test('large cached context is explicitly omitted and cannot masquerade as supplied evidence', () => {
  const input = fixture(0), source = input.externalContext.sources[0];
  source.records = [{ id: 'context:nws:1', values: { headline: 'x'.repeat(16000) } }];
  source.sourceDataProvided = true; source.status = 'ok'; source.fetchedAt = NOW;
  const result = prepareModelEvidence({ ...input, maxChars: 7000 });
  assert.equal(result.contextIds.size, 0);
  assert.equal(result.externalContext.sourceDataProvided, false);
  assert.equal(result.externalContext.sources[0].sourceDataProvided, false);
  assert.equal(result.externalContext.sources[0].modelOmittedRecordCount, 1);
  assert.deepEqual(result.tools.read_sensor_timeline.externalContext.records, []);
  assert.equal(source.records.length, 1);
});

test('repeated read calls refer to the already supplied snapshot without duplicating its payload', async () => {
  const input = fixture(200); let round = 0, firstId, repeated;
  const call = (id, name, args = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const result = await investigateSystem({ ...input, complete: async payload => {
    assert.ok(JSON.stringify({ messages: payload.messages, tools: payload.tools }).length <= MODEL_REQUEST_CHARS);
    if (++round === 1) return { tool_calls: [call('read1', 'read_sensor_timeline')] };
    if (round === 2) {
      firstId = JSON.parse(payload.messages.find(m => m.tool_call_id === 'read1').content).observations[0][0];
      return { tool_calls: [call('read2', 'read_sensor_timeline'), call('relate', 'correlate_signals'), call('power', 'plan_power_budget')] };
    }
    repeated = JSON.parse(payload.messages.find(m => m.tool_call_id === 'read2').content);
    return { tool_calls: [call('save', 'save_review_checkpoint', { summary: 'Recorded observations require review.', evidenceIds: [firstId], nextAction: 'check_device_health' })] };
  } });
  assert.equal(repeated.alreadyProvidedInToolCall, 'read1');
  assert.ok(!Object.hasOwn(repeated, 'observations'));
  assert.equal(result.trace.length, 5);
});
