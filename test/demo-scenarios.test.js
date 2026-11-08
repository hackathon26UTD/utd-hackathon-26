import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoScenario, DEFAULT_DEMO_SCENARIO, DEMO_SCENARIOS } from '../domain/demo-scenarios.js';
import { onRequest } from '../functions/api/demo.js';
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';

const now = Date.parse('2026-11-07T20:00:00Z');
const ids = DEMO_SCENARIOS.map(scenario => scenario.id);
const request = (query = '', method = 'GET', headers) => new Request(`https://home.test/api/demo${query}`, { method, headers });

test('every demo scenario is explicit synthetic data with the same valid home identities', () => {
  let identities;
  for (const id of ids) {
    const result = createDemoScenario(id, now);
    assert.equal(result.mode, 'synthetic');
    assert.equal(result.synthetic, true);
    assert.equal(result.issuedAt, new Date(now).toISOString());
    assert.equal(result.scenario.id, id);
    assert.equal(result.properties.length, 95);
    const current = result.properties.map(home => [home.id, home.coordinates]);
    if (identities) assert.deepEqual(current, identities);
    identities = current;
    assert.equal(new Set(result.properties.map(home => home.id)).size, 95);
    for (const home of result.properties) {
      assert.equal(home.synthetic, true);
      assert.equal(home.source, 'synthetic-demo');
      assert.equal(home.scenario, id);
      assert.ok(['normal', 'elevated', 'critical', 'unknown'].includes(home.severity));
      assert.ok(home.coordinates.every(Number.isFinite));
      assert.ok(Math.abs(home.coordinates[0]) <= 180 && Math.abs(home.coordinates[1]) <= 90);
      assert.ok(Date.parse(home.observedAt) <= now);
      assert.ok(home.values.battery_pct >= 0 && home.values.battery_pct <= 100);
      assert.equal(home.values.mains_power, home.sensors.mains);
      assert.equal(home.values.water_detected, home.sensors.water);
      assert.equal(home.values.wan_connected, home.sensors.wan);
      assert.ok(home.reasons.length);
    }
    assert.equal(result.summary.total, result.properties.length);
    assert.equal(result.summary.normal + result.summary.elevated + result.summary.critical + result.summary.unknown, 95);
    assert.equal(result.summary.notReporting, result.properties.filter(home => home.stale).length);
  }
});

test('scenario transitions preserve uncertainty and unresolved water incidents', () => {
  const normal = createDemoScenario('normal', now);
  assert.equal(normal.summary.normal, 95);
  assert.equal(normal.summary.notReporting, 0);
  const power = createDemoScenario('power-outage', now);
  assert.ok(power.summary.elevated > 0 && power.summary.unknown > 0);
  assert.ok(power.properties.some(home => !home.values.mains_power));
  assert.ok(power.properties.every(home => !home.values.water_detected));
  const storm = createDemoScenario('water-hurricane', now);
  const staleCritical = storm.properties.find(home => home.stale && home.values.water_detected);
  assert.ok(staleCritical);
  assert.equal(staleCritical.severity, 'critical');
  assert.equal(staleCritical.risk.priority.tier, 'P1');
  const recovered = createDemoScenario('recovery', now);
  assert.equal(recovered.summary.notReporting, 0);
  for (const home of storm.properties.filter(home => home.values.water_detected)) {
    const after = recovered.properties.find(candidate => candidate.id === home.id);
    assert.equal(after.values.water_detected, false);
    assert.equal(after.values.mains_power, true);
    assert.equal(after.severity, 'elevated');
    assert.equal(after.reviewRequired, true);
    assert.equal(after.incidents[0].id, home.incidents[0].id);
    assert.equal(after.incidents[0].status, 'open');
  }
});

test('storm overlay is valid closed synthetic GeoJSON and never presented in unrelated scenarios', () => {
  for (const id of ids) {
    const overlay = createDemoScenario(id, now).overlays.exerciseWind;
    assert.equal(overlay.type, 'FeatureCollection');
    assert.equal(overlay.features.length, id === 'water-hurricane' ? 3 : 0);
    for (const feature of overlay.features) {
      assert.equal(feature.properties.synthetic, true);
      assert.equal(feature.properties.scenario, id);
      assert.equal(feature.geometry.type, 'Polygon');
      const ring = feature.geometry.coordinates[0];
      assert.deepEqual(ring[0], ring.at(-1));
      assert.ok(ring.flat().every(Number.isFinite));
    }
  }
});

test('snapshots are deterministic, independent values and reject invalid inputs', () => {
  const first = createDemoScenario('water-hurricane', now);
  const expected = createDemoScenario('water-hurricane', now);
  assert.deepEqual(first, expected);
  first.properties[0].values.battery_pct = -100;
  first.properties[0].coordinates[0] = 0;
  first.overlays.exerciseWind.features[0].geometry.coordinates[0][0][0] = 0;
  first.scenarios[0].label = 'Changed';
  assert.deepEqual(createDemoScenario('water-hurricane', now), expected);
  assert.throws(() => createDemoScenario('live', now), RangeError);
  assert.throws(() => createDemoScenario('normal', NaN), RangeError);
  assert.throws(() => createDemoScenario('normal', Infinity), RangeError);
});

test('anonymous demo requests pass the API boundary without reading credentials or account data', async () => {
  const forbidden = new Proxy({}, { get() { throw new Error('Demo accessed live application context'); } });
  for (const method of ['GET', 'HEAD']) {
    const req = request('?scenario=normal', method, { Authorization: 'Bearer unrelated-account-value', 'X-Device-Key': 'unrelated-device-value' });
    let forwarded = 0;
    const result = await apiMiddleware({ request: req, env: forbidden, data: forbidden, next: async () => {
      forwarded++;
      return onRequest({ request: req, env: forbidden, data: forbidden });
    } });
    assert.equal(forwarded, 1);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('X-HomeBeacon-Data'), 'synthetic');
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    if (method === 'HEAD') assert.equal(await result.text(), '');
    else {
      const body = await result.json();
      assert.equal(body.scenario.id, 'normal');
      assert.ok(body.properties.every(home => home.synthetic));
    }
  }
});

test('demo endpoint defaults predictably and accepts only the documented scenario allowlist', async () => {
  assert.equal((await (await onRequest({ request: request() })).json()).scenario.id, DEFAULT_DEMO_SCENARIO);
  for (const id of ids) {
    const response = await onRequest({ request: request(`?scenario=${id}`) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).scenario.id, id);
  }
  for (const query of ['?scenario=', '?scenario=live', '?scenario=../command-center', '?scenario=normal&scenario=recovery']) {
    const response = await onRequest({ request: request(query) });
    assert.equal(response.status, 400);
    assert.deepEqual((await response.json()).allowedScenarios, ids);
  }
  const head = await onRequest({ request: request('?scenario=live', 'HEAD') });
  assert.equal(head.status, 400);
  assert.equal(await head.text(), '');
});

test('demo endpoint refuses mutation methods without reading payloads or application context', async () => {
  const forbidden = new Proxy({}, { get() { throw new Error('Mutation touched application context'); } });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await onRequest({ request: request('', method), env: forbidden, data: forbidden });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
    assert.equal((await response.json()).error, 'This demo is read-only.');
  }
});
