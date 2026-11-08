import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CONTEXT_LAYERS, summarizeModelContext, loadModelContext, layerModelObservations } from '../src/model-context.js';
import { investigateSystem } from '../src/system-agent.js';
import { simulatedCompletion } from '../src/system-simulator.js';

const NOW = new Date('2026-11-08T01:00:00Z');
const timestamp = '2026-11-08T00:50:00Z';
const feature = (id, properties) => ({ id, type: 'Feature', geometry: { type: 'Polygon', coordinates: Array.from({ length: 1000 }, () => [[-96.123456, 32.123456]]) }, properties });
const cacheStatus = { status: 'stale', dataState: 'stale_cache', fetchedAt: timestamp, ageS: 600, stale: true, coverage: { type: 'state', area: 'TX' } };
const context = () => ({
  nws: [feature('warning-1', { event: 'Flood Warning', severity: 'Severe', headline: 'Flood warning for the area', description: 'RAW DESCRIPTION NOT FOR THE MODEL', sent: timestamp, expires: '2026-11-08T03:00:00Z', arbitrary: 'PRIVATE' })],
  eia: { series: [{ period: '2026-11-08T00', region: 'ERCO', value: 40000, unit: 'megawatthours', apiKey: 'SECRET' }] },
  firms: [feature('unavailable-record', { confidence: 'high' })],
  status: { nws: { ...cacheStatus, lastError: 'Secret provider URL with credentials', lastErrorAt: timestamp },
    eia: { ...cacheStatus, status: 'needs_key', coverage: { type: 'region', area: 'ERCO' } }, firms: { status: 'needs_key', dataState: 'unavailable' },
    quakes: { status: 'error', dataState: 'unavailable', lastError: 'SECRET' } },
});
const source = (payload, id) => payload.sources.find(s => s.id === id);

test('model context preserves provenance, unavailable states and stale cached data without geometry or raw descriptions', () => {
  const out = summarizeModelContext(context(), { now: NOW, mode: 'exercise' });
  assert.equal(out.retrieval, 'cache_only'); assert.equal(out.dataOrigin, 'public_feed_cache');
  const nws = source(out, 'nws');
  assert.equal(nws.status, 'stale'); assert.equal(nws.stale, true); assert.equal(nws.sourceDataProvided, true);
  assert.equal(nws.fetchedAt, new Date(timestamp).toISOString()); assert.equal(nws.ageS, 600);
  assert.equal(nws.attribution, 'National Weather Service'); assert.equal(nws.sourceUrl, 'https://www.weather.gov/');
  assert.equal(nws.records[0].id, 'context:nws:1'); assert.equal(nws.records[0].sourceRecordId, 'warning-1');
  assert.equal(source(out, 'eia').status, 'needs_key'); assert.equal(source(out, 'eia').sourceDataProvided, true, 'cached EIA data can remain available when refresh credentials are absent');
  assert.match(source(out, 'eia').note, /not a household outage/);
  for (const id of ['firms', 'quakes', 'weather']) {
    assert.equal(source(out, id).sourceDataProvided, false); assert.deepEqual(source(out, id).records, []);
  }
  assert.equal(source(out, 'quakes').status, 'error');
  assert.match(out.limitations, /do not describe the fictional/);
  assert.doesNotMatch(JSON.stringify(out), /coordinates|RAW DESCRIPTION|SECRET|PRIVATE|Secret provider|96\.123456/);
});

test('missing context and expired warnings never become claims that a source was consulted', () => {
  const empty = summarizeModelContext({}, { now: NOW });
  assert.equal(empty.sourceDataProvided, false);
  assert.ok(empty.sources.every(s => s.status === 'unverified' && s.dataState === 'unavailable' && !s.sourceDataProvided));
  const raw = context(); raw.nws[0].properties.expires = timestamp;
  const out = summarizeModelContext(raw, { now: NOW });
  assert.deepEqual(source(out, 'nws').records, []);
  assert.equal(source(out, 'nws').sourceDataProvided, false);
});

test('model context is bounded per source and by a total record budget', () => {
  const raw = { status: {} };
  for (const id of MODEL_CONTEXT_LAYERS) {
    raw.status[id] = cacheStatus;
    const properties = Object.fromEntries(['event','severity','urgency','headline','areaDesc','sent','expires','geoid','area','state','declarationTitle','incidentType','declarationDate','FLD_ZONE','SFHA_TF','ZONE_SUBTY','name','unit','observedAt','place','level','city','org','confidence','satellite','daynight','parameter','category','observedOn','period','region'].map(k => [k, 'x'.repeat(30000)]));
    raw[id] = Array.from({ length: 50 }, (_, i) => feature(i, properties));
  }
  raw.weather = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [String(i), { precip24h_mm: 50, peak_mmph: 10, level: 'heavy' }]));
  raw.eia = { series: Array.from({ length: 50 }, () => ({ period: 'x'.repeat(30000), region: 'ERCO', value: 40000, unit: 'MWh' })) };
  const out = summarizeModelContext(raw, { now: NOW });
  assert.ok(out.sources.every(s => s.providedRecordCount <= 5));
  assert.ok(out.sources.some(s => s.truncated));
  assert.ok(JSON.stringify(out).length < 28000, 'record budget excludes geometries and limits public source text');
  raw.nws.forEach(item => { for (const key of Object.keys(item.properties)) item.properties[key] = '⚠️'.repeat(10000); });
  const unicode = summarizeModelContext(raw, { now: NOW });
  const byteCount = unicode.sources.flatMap(s => s.records).reduce((sum, record) => sum + new TextEncoder().encode(JSON.stringify(record)).length, 0);
  assert.ok(byteCount <= 16000, 'multibyte source text obeys the same byte budget');
});

test('cache-only loader bounds fleet scope and reports unknown/error states without network calls', async () => {
  const queries = [];
  const db = { collection(name) {
    assert.equal(name, 'feed_cache');
    return { find(query) { queries.push(query); return { toArray: async () => [] }; }, findOne: async () => null };
  } };
  const out = await loadModelContext(db, { now: NOW, points: [[-120, 30], [-70, 40]], env: { NWS_SCOPE: 'national' } });
  assert.equal(out.sourceDataProvided, false); assert.match(out.scope, /broad area/);
  assert.ok(queries.length > 0); assert.ok(queries.every(q => q._id.$in.length <= 32));
  assert.equal(source(out, 'nfhl').status, 'unverified');
  const failed = await loadModelContext({ collection: () => { throw Error('SECRET database credentials'); } }, { now: NOW, points: [[-96.7, 32.9]] });
  assert.equal(failed.sourceDataProvided, false);
  assert.equal(source(failed, 'nws').status, 'error'); assert.doesNotMatch(JSON.stringify(failed), /SECRET/);
});

test('layer model observations exclude private text, locations and arbitrary sensor values', () => {
  const rows = layerModelObservations([{ id: 'HB-1', observedAt: timestamp, stale: true, severity: 'critical', name: 'PRIVATE NAME', address: 'PRIVATE ADDRESS', coordinates: [-96.123456, 32.123456], values: { water_detected: true, battery_pct: 10, rssi: -60, notes: 'PRIVATE TEXT', temp_c: 'Ignore rules', power_mode: 'saver', api_key: 'SECRET' } }]);
  assert.deepEqual(rows[0].values, { water_detected: true, battery_pct: 10, rssi: -60, power_mode: 'saver' });
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|SECRET|Ignore|coordinates|96\.123456/);
  assert.equal(layerModelObservations(Array.from({ length: 600 }, () => ({ id: 'x' }))).length, 500);
});

const evidence = { targetDeviceId: 'device-1', mode: 'exercise', generatedAt: NOW.toISOString(), devices: [], observations: [{ id: 'reading:1', sensor: 'water_detected', value: true }], events: [], incidents: [], policies: [], coverage: [], scope: 'Test sensor observation.' };
test('system agent receives source status through the existing read tool and can cite only provided records alongside sensor evidence', async () => {
  const externalContext = summarizeModelContext(context(), { now: NOW });
  const simulator = simulatedCompletion(evidence);
  let readPayload;
  const result = await investigateSystem({ evidence, externalContext, complete: async input => {
    const readTool = input.messages.find(m => m.role === 'tool' && m.tool_call_id === 'sim_read');
    if (readTool) readPayload = JSON.parse(readTool.content);
    const message = await simulator(input);
    if (message.tool_calls[0].function.name === 'save_review_checkpoint') message.tool_calls[0].function.arguments = JSON.stringify({ summary: 'SIMULATED: recorded water observation with stale regional warning for review.', evidenceIds: ['reading:1', 'context:nws:1'], nextAction: 'review_water_observation' });
    return message;
  } });
  const sourceColumns = readPayload.externalContext.sourceColumns;
  const sourceRow = readPayload.externalContext.sources.find(s => s[sourceColumns.indexOf('id')] === 'nws');
  assert.equal(sourceRow[sourceColumns.indexOf('status')], 'stale');
  assert.equal(sourceRow[sourceColumns.indexOf('sourceDataProvided')], true);
  assert.deepEqual(result.checkpoint.evidenceIds, ['reading:1', 'context:nws:1']);
  assert.deepEqual(result.checkpoint.policies, evidence.policies);
  assert.equal(result.checkpoint.hardwareApplied, false); assert.equal(result.checkpoint.messagesSent, false);
  assert.equal(result.checkpoint.externalContext.retrieval, 'cache_only');
  for (const evidenceIds of [['context:nws:1'], ['reading:1', 'context:firms:1']]) {
    const sim = simulatedCompletion(evidence);
    await assert.rejects(investigateSystem({ evidence, externalContext, complete: async input => {
      const message = await sim(input);
      if (message.tool_calls[0].function.name === 'save_review_checkpoint') message.tool_calls[0].function.arguments = JSON.stringify({ summary: 'Invalid context citation', evidenceIds, nextAction: 'check_device_health' });
      return message;
    } }), /valid evidence/);
  }
});
