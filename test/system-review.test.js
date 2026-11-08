import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sensorChecks, responderBrief } from '../src/system-review.js';
import { prepareModelEvidence, MODEL_AGENT_PACK_TOKENS } from '../src/system-model-input.js';
import { buildPack } from '../src/harness/pack.js';
import { investigateSystem } from '../src/system-agent.js';
import { summarizeModelContext } from '../src/model-context.js';
import { devicePolicy, powerBudget } from '../domain/system-policy.js';

const NOW = '2026-11-08T12:00:00.000Z', DEVICE = 'a'.repeat(24);
let next = 0;
const row = (sensor, value, seconds = 0, extra = {}) => ({ id: `reading:${++next}`, deviceId: DEVICE, sensor, value,
  observedAt: new Date(Date.parse(NOW) - seconds * 1000).toISOString(), receivedAt: NOW,
  stale: seconds > 120, delayed: seconds > 120, ...extra });
function snapshot(observations, extra = {}) {
  const latest = Object.fromEntries([...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).map(o => [o.sensor, o]));
  const devices = [{ id: DEVICE, latest, lastReceivedAt: NOW, latchedCritical: false }];
  return { targetDeviceId: DEVICE, mode: 'exercise', generatedAt: NOW, observations, devices, events: [], incidents: [],
    policies: devices.map(d => devicePolicy(d, new Date(NOW))), scope: 'One exercise device', coverage: [], ...extra };
}
function checkpoint(evidence, extra = {}) {
  return { interpretation: 'The recorded observations require review; current occupancy is unknown.',
    interpretationSource: 'model_unverified', evidenceIds: evidence.observations.map(o => o.id),
    nextAction: 'check_device_health', sensorChecks: sensorChecks(evidence), budget: powerBudget(evidence.policies), ...extra };
}

test('an uncorroborated flame signal is never negated by room temperature or a negative smoke reading', () => {
  for (const smoke of [null, false]) {
    const e = snapshot([row('flame', true), row('temp_c', 22), ...(smoke === null ? [] : [row('smoke_alarm', smoke)])]);
    const check = sensorChecks(e).items.find(c => c.code === 'flame_needs_corroboration');
    assert.equal(check.status, 'review');
    assert.match(check.detail, /does not rule out fire/);
    assert.equal(e.policies[0].mode, 'critical');
    assert.ok(!check.evidenceIds.includes(e.devices[0].latest.temp_c.id), 'room temperature is not negative fire evidence');
  }
});

test('only contemporaneous positive signals corroborate; old positive alerts remain unresolved and stale', () => {
  const e = snapshot([row('flame', true, 600), row('smoke_alarm', true, 590)]);
  const check = sensorChecks(e).items.find(c => c.code === 'flame_and_smoke_signals');
  assert.ok(check); assert.equal(check.stale, true); assert.match(check.detail, /not confirmed/);
  assert.equal(e.policies[0].mode, 'critical');
  e.devices[0].latest.smoke_alarm = row('smoke_alarm', true, 1);
  assert.ok(sensorChecks(e).items.some(c => c.code === 'flame_needs_corroboration'));
});

test('a same-time latest-value conflict keeps both source records; ordinary changes over time are not conflicts', () => {
  const older = row('water_detected', false, 60), yes = row('water_detected', true), no = row('water_detected', false);
  const e = snapshot([older, yes, no, row('mains_power', true)]);
  const checks = sensorChecks(e), conflict = checks.items.find(c => c.code === 'conflicting_water_detected');
  assert.deepEqual(new Set(conflict.evidenceIds), new Set([yes.id, no.id]));
  const projected = prepareModelEvidence({ evidence: e, externalContext: summarizeModelContext({}, { mode: 'exercise' }), maxChars: 7000 });
  for (const id of conflict.evidenceIds) assert.ok(projected.evidenceIds.has(id));
  const chronological = snapshot([older, yes, row('mains_power', true)]);
  assert.ok(!sensorChecks(chronological).items.some(c => c.code.startsWith('conflicting_')));
});

test('receipt freshness does not disguise stale observations, and unknown gaps are not normal readings', () => {
  const e = snapshot([row('water_detected', true, 300)]);
  const checks = sensorChecks(e);
  assert.ok(checks.items.some(c => c.code === 'stale_latest_readings' && c.status === 'unknown'));
  assert.ok(checks.items.some(c => c.code === 'delayed_delivery'));
  assert.ok(checks.items.some(c => c.code === 'missing_mains_power' && c.evidenceIds.length === 0));
  assert.equal(e.policies[0].mode, 'critical');
  const empty = sensorChecks(snapshot([]));
  assert.equal(empty.items.length, 2); assert.ok(empty.items.every(c => c.status === 'unknown'));
});

test('checks are bounded with explicit omissions, and do not mutate the evidence', () => {
  const e = snapshot([row('water_detected', true, 300), row('flame', true, 300)]);
  const original = JSON.stringify(e);
  const result = sensorChecks(e, { maxItems: 1 });
  assert.equal(result.items.length, 1); assert.ok(result.omittedCount > 0);
  assert.equal(JSON.stringify(e), original);
});

test('responder brief contains allowlisted facts and separate unverified interpretation, with unknown runtime and no actions sent', () => {
  const e = snapshot([row('flame', true), row('temp_c', 22)], { address: 'PRIVATE ADDRESS', keyHash: 'SECRET KEY' });
  const c = checkpoint(e), allowed = new Set([e.observations[0].id]);
  const brief = responderBrief({ evidence: e, checkpoint: c, allowedIds: allowed });
  assert.equal(brief.status, 'pending_review'); assert.equal(brief.messagesSent, false); assert.equal(brief.hardwareApplied, false);
  assert.equal(brief.interpretation.source, 'model_unverified');
  assert.ok(brief.unknowns.some(x => /runtime is unknown/.test(x)));
  assert.ok(brief.facts.every(f => allowed.has(f.id)));
  assert.ok(!/PRIVATE ADDRESS|SECRET KEY/.test(JSON.stringify(brief)));
  assert.match(brief.text, /NEMOTRON INTERPRETATION — UNVERIFIED/);
  assert.match(brief.text, /No responder was dispatched/);
  assert.match(brief.text, /No contemporaneous positive smoke-alarm signal|flame|Flame/);
  assert.equal(brief.nextAction.label, 'Check device health');
});

test('brief preserves stale unresolved incidents and distinguishes simulator output', () => {
  const old = row('water_detected', true, 600);
  const incident = { id: 'incident:one', deviceId: DEVICE, type: 'flood', severity: 'critical', status: 'open', detectedAt: old.observedAt };
  const e = snapshot([old], { incidents: [incident] });
  const c = checkpoint(e, { interpretationSource: 'simulator_not_ai' });
  const brief = responderBrief({ evidence: e, checkpoint: c, allowedIds: new Set([old.id, incident.id]) });
  assert.equal(brief.facts[0].kind, 'incident'); assert.equal(brief.facts[0].stale, true);
  assert.match(brief.text, /critical; open/);
  assert.match(brief.text, /SIMULATOR OUTPUT — NOT AI/);
  assert.ok(!brief.text.includes('NEMOTRON INTERPRETATION'));
});

test('the smaller grounding pack keeps every required safety section', () => {
  const pack = buildPack({ purpose: 'agent', budgetTokens: MODEL_AGENT_PACK_TOKENS });
  for (const section of ['role', 'untrusted', 'format', 'stale']) assert.ok(pack.included.includes(section));
  assert.match(pack.text, /runtime narrows nextAction/);
  assert.ok(!pack.text.includes('review_water_observation'), 'pack must not contradict narrowed runtime actions');
});

test('a flame-only investigation offers supported actions and can correct one invented water action', async () => {
  const e = snapshot([row('flame', true, 15), row('temp_c', 22, 15), row('mains_power', true, 15)]);
  const call = (id, name, args = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  let round = 0, readPayload;
  const result = await investigateSystem({ evidence: e, complete: async input => {
    const actions = input.tools.find(t => t.function.name === 'save_review_checkpoint').function.parameters.properties.nextAction.enum;
    assert.ok(!actions.includes('review_water_observation'));
    assert.ok(!actions.includes('review_power_outage'));
    if (++round === 1) return { tool_calls: [call('r1', 'read_sensor_timeline')] };
    readPayload = JSON.parse(input.messages.find(m => m.tool_call_id === 'r1').content);
    if (round === 2) return { tool_calls: [call('c1', 'correlate_signals'), call('p1', 'plan_power_budget')] };
    if (round === 3) return { tool_calls: [call('bad', 'save_review_checkpoint', { summary: 'Invented water concern.', evidenceIds: [e.observations[0].id], nextAction: 'review_water_observation' })] };
    assert.equal(JSON.parse(input.messages.at(-1).content).saved, false);
    return { tool_calls: [call('corrected', 'save_review_checkpoint', { summary: 'Recorded: a fresh flame-sensor signal. Unknown: fire confirmation. Next: check device health.', evidenceIds: [e.observations[0].id], nextAction: 'check_device_health' })] };
  } });
  assert.equal(result.checkpoint.nextAction, 'check_device_health');
  assert.equal(result.checkpoint.validation.correctionAttempts, 1);
  assert.ok(result.trace.some(t => t.status === 'correction_requested'));
  assert.ok(!result.checkpoint.responderBrief.text.includes('Invented water'));
  assert.deepEqual(readPayload.devices[0].latestFreshness.stale, []);
  assert.ok(readPayload.devices[0].latestFreshness.fresh.includes('flame'));
  assert.equal(readPayload.observations[0][readPayload.observationColumns.indexOf('observedAgeSeconds')], 15);
});

test('a repeated unsupported action fails without producing a checkpoint or brief', async () => {
  const e = snapshot([row('flame', true)]);
  let round = 0;
  const call = (id, name, args = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  await assert.rejects(investigateSystem({ evidence: e, complete: async () => {
    if (++round === 1) return { tool_calls: [call('r', 'read_sensor_timeline')] };
    if (round === 2) return { tool_calls: [call('c', 'correlate_signals'), call('p', 'plan_power_budget')] };
    return { tool_calls: [call(`bad${round}`, 'save_review_checkpoint', { summary: 'Unsupported water claim.', evidenceIds: [e.observations[0].id], nextAction: 'review_water_observation' })] };
  } }), /without supporting evidence/);
  assert.equal(round, 4);
});
