// Risk engine tests: pure functions first, then loader and endpoint against in-memory MongoDB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { SENSORS } from '../src/risk/config.js';
import { geohashBounds, geohashDecode, geohashEncode, deviceLngLat, parseBbox, pointInGeometry } from '../src/risk/geo.js';
import { assessDevice } from '../src/risk/device.js';
import { aggregateRegions, applyRegionBoosts, followUps } from '../src/risk/region.js';
import { customerView } from '../src/risk/customer.js';
import { loadRisk } from '../src/risk/load.js';
import { onRequestGet as riskGet } from '../functions/api/risk.js';

const NOW = new Date('2026-11-07T18:00:00.000Z');
const ago = (min) => new Date(NOW.getTime() - min * 60000);
let seq = 0;
const rd = (sensor, value, min = 1) => ({ _id: `r${++seq}`, sensor, value, ts: ago(min), receivedAt: ago(min) });
const dev = (id = 'a'.repeat(24), extra = {}) => ({ _id: id, name: 'Home', lastSeen: ago(1), ...extra });
const assess = (readings, ctx = {}, extra = {}) => assessDevice({ device: dev(), readings, location: [-96.75, 32.98], ...extra }, ctx, NOW);
const box = (c, d = 0.01) => ({ type: 'Polygon', coordinates: [[[c[0] - d, c[1] - d], [c[0] + d, c[1] - d], [c[0] + d, c[1] + d], [c[0] - d, c[1] + d], [c[0] - d, c[1] - d]]] });

// ---------- geo ----------
test('geohash encodes the reference example and decodes inside its cell', () => {
  assert.equal(geohashEncode(-5.6, 42.6, 5), 'ezs42');
  const [w, s, e, n] = geohashBounds('ezs42');
  assert.ok(-5.6 >= w && -5.6 <= e && 42.6 >= s && 42.6 <= n);
  const c = geohashDecode('ezs42');
  assert.equal(geohashEncode(c.lng, c.lat, 5), 'ezs42');
  assert.throws(() => geohashEncode(200, 0), RangeError);
  assert.throws(() => geohashBounds('abc!'), RangeError);
});

test('point in polygon handles holes and multipolygons, and ignores points and bad shapes', () => {
  const outer = box([0, 0], 10), hole = box([0, 0], 2).coordinates[0];
  const donut = { type: 'Polygon', coordinates: [outer.coordinates[0], hole] };
  assert.equal(pointInGeometry([5, 5], donut), true);
  assert.equal(pointInGeometry([0, 0], donut), false);
  assert.equal(pointInGeometry([50, 5], donut), false);
  assert.equal(pointInGeometry([20.5, 0], { type: 'MultiPolygon', coordinates: [outer.coordinates, box([20, 0], 1).coordinates] }), true);
  assert.equal(pointInGeometry([0, 0], { type: 'Point', coordinates: [0, 0] }), false);
  assert.equal(pointInGeometry([0, 0], { type: 'Polygon', coordinates: 'bad' }), false);
  assert.equal(pointInGeometry([0, 0], null), false);
});

test('device location prefers the home, falls back to meta, else null', () => {
  const homes = new Map([['h1', { location: { type: 'Point', coordinates: [-96.7, 33] } }]]);
  assert.deepEqual(deviceLngLat({ homeId: 'h1', meta: { latitude: 1, longitude: 2 } }, homes), [-96.7, 33]);
  assert.deepEqual(deviceLngLat({ meta: { latitude: 32.9, longitude: -96.8 } }, homes), [-96.8, 32.9]);
  assert.equal(deviceLngLat({ meta: { latitude: 99, longitude: 0 } }, homes), null);
  assert.equal(deviceLngLat({}, homes), null);
  assert.equal(parseBbox('1,2,3,4').length, 4);
  assert.equal(parseBbox('3,2,1,4'), null);
  assert.equal(parseBbox('x'), null);
});

// ---------- device ladder ----------
test('no readings is unknown, never normal', () => {
  const a = assessDevice({ device: { _id: 'd1' }, readings: [] }, {}, NOW);
  assert.equal(a.status, 'unknown');
  assert.equal(a.offline, true);
  assert.equal(a.priority.score, 20);
  assert.equal(a.priority.tier, 'P3');
  assert.match(a.advisory, /Advisory only/);
});

test('fresh in-range readings with no triggers are normal', () => {
  const a = assess([rd('temp_c', 22), rd('humidity_pct', 40), rd('mains_power', true), rd('battery_pct', 95)]);
  assert.equal(a.status, 'normal');
  assert.equal(a.offline, false);
  assert.deepEqual(a.reasons, []);
  assert.equal(a.priority.score, 0);
  assert.deepEqual(a.power, { mains: true, battery_pct: 95, mode: null, stale: false });
});

const THRESHOLDS = [
  ['temp_c', 39.9, 'normal'], ['temp_c', 40, 'watch'], ['temp_c', 1, 'normal'], ['temp_c', 0, 'watch'], ['temp_c', 48, 'elevated'], ['temp_c', 55, 'critical'],
  ['humidity_pct', 74, 'normal'], ['humidity_pct', 75, 'watch'], ['humidity_pct', 90, 'elevated'],
  ['moisture_pct', 59, 'normal'], ['moisture_pct', 60, 'watch'], ['moisture_pct', 80, 'elevated'],
  ['water_detected', false, 'normal'], ['water_detected', true, 'critical'],
  ['water_level_mm', 4, 'normal'], ['water_level_mm', 5, 'watch'], ['water_level_mm', 10, 'elevated'], ['water_level_mm', 20, 'critical'],
  ['smoke_alarm', true, 'critical'], ['fire_flame', true, 'critical'], ['smoke_alarm', false, 'normal'],
  ['co_ppm', 34, 'normal'], ['co_ppm', 35, 'watch'], ['co_ppm', 70, 'elevated'], ['co_ppm', 150, 'critical'],
  ['pm25_ugm3', 54, 'normal'], ['pm25_ugm3', 55, 'watch'], ['pm25_ugm3', 150, 'elevated'], ['pm25_ugm3', 250, 'critical'],
  ['voc_index', 199, 'normal'], ['voc_index', 200, 'watch'], ['voc_index', 350, 'elevated'],
  ['battery_pct', 41, 'normal'], ['battery_pct', 40, 'watch'], ['battery_pct', 20, 'elevated'],
  ['mains_power', false, 'watch'], ['mains_power', true, 'normal'],
  ['power_mode', 'normal', 'normal'], ['power_mode', 'saver', 'watch'], ['power_mode', 'critical', 'elevated'],
  ['wan_connected', false, 'watch'], ['wan_connected', true, 'normal'],
  ['rssi_dbm', -84, 'normal'], ['rssi_dbm', -85, 'watch'],
  ['tilt_deg', 9, 'normal'], ['tilt_deg', 10, 'watch'], ['tilt_deg', 25, 'elevated'],
  ['shock_g', 3.9, 'normal'], ['shock_g', 4, 'elevated'],
];
for (const [sensor, value, expected] of THRESHOLDS) {
  test(`threshold ${sensor}=${value} is ${expected}`, () => {
    // mains_power false alone must not combine with battery here, so only one reading is supplied.
    assert.equal(assess([rd(sensor, value)]).status, expected);
  });
}

test('every configured sensor has a range or enum and a stale limit', () => {
  for (const [name, c] of Object.entries(SENSORS)) {
    assert.ok(c.staleMin > 0, name);
    assert.ok(c.kind === 'bool' || c.kind === 'enum' || (Number.isFinite(c.min) && Number.isFinite(c.max)), name);
  }
});

test('reason text is a plain sentence with evidence', () => {
  const a = assess([rd('water_detected', true, 12), rd('temp_c', 21, 1)]);
  assert.equal(a.status, 'critical');
  const r = a.reasons[0];
  assert.match(r.text, /^Water was reported at the sensor 12 minutes ago\./);
  assert.equal(r.evidence[0].stale, true);
  const fresh = assess([rd('water_detected', true, 2)]).reasons[0];
  assert.equal(fresh.text, 'Water was reported at the sensor 2 minutes ago.');
  assert.equal(r.evidence[0].sensor, 'water_detected');
  assert.ok(r.evidence[0].evidenceId);
});

test('out of range readings are discarded, not clamped', () => {
  const a = assess([rd('temp_c', 200), rd('humidity_pct', 140), rd('co_ppm', 'abc')]);
  assert.equal(a.status, 'unknown');
  assert.equal(a.discarded.length, 3);
  assert.deepEqual(a.discarded.map((d) => d.reason).sort(), ['out_of_range', 'out_of_range', 'wrong_type']);
  assert.equal(a.power.battery_pct, null);
});

test('a stale critical reading keeps critical and says when it was last reported', () => {
  const a = assess([rd('water_detected', true, 40), rd('temp_c', 21, 1)]);
  assert.equal(a.status, 'critical');
  assert.equal(a.reasons[0].evidence[0].stale, true);
  assert.match(a.reasons[0].text, /40 minutes ago/);
  assert.match(a.reasons[0].text, /last report/);
  assert.equal(a.priority.score, 100);
});

test('only a newer fresh reading replaces a critical one', () => {
  const same = assess([rd('water_detected', true, 40), rd('water_detected', true, 40)]);
  assert.equal(same.status, 'critical');
  const cleared = assess([rd('water_detected', true, 40), rd('water_detected', false, 1)]);
  assert.equal(cleared.status, 'normal');
  const outOfOrder = assess([rd('water_detected', false, 30), rd('water_detected', true, 1)]);
  assert.equal(outOfOrder.status, 'critical');
});

test('stale non-critical hazard evidence is unknown with priority 70, never normal', () => {
  const a = assess([rd('humidity_pct', 95, 45), rd('temp_c', 21, 1)]);
  assert.equal(a.status, 'unknown');
  assert.equal(a.staleHazard, true);
  assert.equal(a.priority.score, 70);
  assert.equal(a.priority.tier, 'P2');
  assert.ok(a.reasons.some((r) => r.ruleId === 'humidity_high' && r.evidence[0].stale));
});

test('every reading stale and benign is unknown', () => {
  const a = assess([rd('temp_c', 21, 20), rd('humidity_pct', 40, 40)], {}, { device: dev('b'.repeat(24), { lastSeen: ago(1) }) });
  assert.equal(a.status, 'unknown');
  assert.equal(a.staleHazard, false);
});

test('offline alone is never critical and never normal', () => {
  const a = assess([rd('humidity_pct', 40, 20)], {}, { device: dev('c'.repeat(24), { lastSeen: ago(60) }) });
  assert.equal(a.offline, true);
  assert.equal(a.status, 'unknown');
  assert.ok(a.reasons.some((r) => r.ruleId === 'offline' && /20 minutes/.test(r.text)));
  const edge = assess([rd('temp_c', 21, 1)], {}, { device: dev('c'.repeat(24), { lastSeen: ago(15) }) });
  assert.equal(edge.offline, false);
});

test('mains off with low battery is elevated and replaces its two watch reasons', () => {
  const low = assess([rd('mains_power', false), rd('battery_pct', 25)]);
  assert.equal(low.status, 'elevated');
  assert.deepEqual(low.reasons.map((r) => r.ruleId), ['mains_off_battery_low']);
  assert.equal(low.reasons[0].evidence.length, 2);
  const ok = assess([rd('mains_power', false), rd('battery_pct', 80)]);
  assert.equal(ok.status, 'watch');
  const edge = assess([rd('mains_power', false), rd('battery_pct', 30)]);
  assert.equal(edge.status, 'elevated');
});

test('water rising 5 mm in 10 minutes is elevated even below the level threshold', () => {
  const rising = assess([rd('water_level_mm', 2, 8), rd('water_level_mm', 7, 1)]);
  assert.equal(rising.status, 'elevated');
  assert.ok(rising.reasons.some((r) => r.ruleId === 'water_rising' && /rose 5 mm in 10 minutes/.test(r.text)));
  const slow = assess([rd('water_level_mm', 2, 8), rd('water_level_mm', 6, 1)]);
  assert.equal(slow.status, 'watch');
  assert.ok(!slow.reasons.some((r) => r.ruleId === 'water_rising'));
  assert.equal(assess([rd('water_level_mm', 0, 20), rd('water_level_mm', 6, 1)]).status, 'watch');
  const viaSeries = assessDevice({ device: dev(), readings: [rd('water_level_mm', 7, 1)], series: { water_level_mm: [{ ts: ago(9), value: 1 }, { ts: ago(1), value: 7 }] }, location: null }, {}, NOW);
  assert.equal(viaSeries.status, 'elevated');
});

test('string numbers and 0/1 booleans from the legacy ingest path are accepted', () => {
  assert.equal(assess([rd('water_detected', 1)]).status, 'critical');
  assert.equal(assess([rd('co_ppm', '80')]).status, 'elevated');
  assert.equal(assess([rd('wan_connected', 'false')]).status, 'watch');
  assert.equal(assess([rd('unknown_sensor', 5), rd('temp_c', 20)]).status, 'normal');
});

test('power fields are reported, including power save mode', () => {
  const a = assess([rd('mains_power', true), rd('battery_pct', 35), rd('power_mode', 'saver')]);
  assert.equal(a.status, 'watch');
  assert.deepEqual(a.power, { mains: true, battery_pct: 35, mode: 'saver', stale: false });
  assert.deepEqual(a.reasons.map((r) => r.ruleId).sort(), ['battery_low', 'power_saver']);
});

// ---------- overlays and priority ----------
const here = [-96.75, 32.98];
const ctxAll = (over = {}) => ({
  zones: [{ id: 'z1', type: 'evacuation', name: 'North', active: true, geometry: box(here) }],
  nfhl: [{ type: 'Feature', geometry: box(here), properties: { FLD_ZONE: 'AE', SFHA_TF: 'T' } }],
  nws: [{ type: 'Feature', geometry: box(here), properties: { event: 'Flash Flood Warning' } }],
  declarations: [{ geometry: box(here), properties: { declarationTitle: 'Severe storms' } }],
  weather: { [geohashEncode(here[0], here[1], 5)]: { level: 'heavy', precip24h_mm: 80, peak_mmph: 25 } },
  ...over,
});

test('priority boosts add up for zones, flood areas, alerts and heavy rain with a water signal', () => {
  const a = assess([rd('humidity_pct', 92)], ctxAll());
  assert.equal(a.status, 'elevated');
  assert.equal(a.priority.base, 60);
  assert.deepEqual(a.priority.boosts.map((b) => b.points), [15, 10, 10, 10]);
  assert.equal(a.priority.score, 100);
  assert.equal(a.priority.tier, 'P1');
  assert.equal(a.priority.label, 'Review now');
  assert.deepEqual(a.correlations.map((c) => c.kind).sort(), ['declaration', 'flood_zone', 'heavy_rain', 'weather_alert', 'zone']);
});

test('heavy rain does not boost without a water or moisture signal', () => {
  const a = assess([rd('temp_c', 22)], ctxAll({ zones: [], nfhl: [], nws: [], declarations: [] }));
  assert.equal(a.priority.score, 0);
  assert.ok(a.correlations.some((c) => c.kind === 'heavy_rain'));
});

test('unknown box inside an evacuation zone scores 35 and stays P3', () => {
  const a = assess([], ctxAll({ nfhl: [], nws: [], declarations: [], weather: {} }));
  assert.equal(a.priority.score, 35);
  assert.equal(a.priority.tier, 'P3');
});

test('inactive, expired, non-evacuation and non-flood overlays do not boost', () => {
  const ctx = {
    zones: [
      { id: 'z', type: 'evacuation', active: false, geometry: box(here) },
      { id: 'z2', type: 'evacuation', active: true, endsAt: ago(5).toISOString(), geometry: box(here) },
      { id: 'z3', type: 'staging', active: true, geometry: box(here) },
      { id: 'z4', type: 'evacuation', active: true, geometry: box([-90, 30]) },
    ],
    nfhl: [{ geometry: box(here), properties: { FLD_ZONE: 'X', SFHA_TF: 'F' } }],
    nws: [{ geometry: box(here), properties: { event: 'Heat Advisory' } }, { geometry: null, properties: { event: 'Flood Watch' } }],
  };
  const a = assess([rd('temp_c', 22)], ctx);
  assert.deepEqual(a.priority.boosts, []);
  assert.deepEqual(a.correlations.map((c) => c.kind).sort(), ['flood_zone', 'zone']);
});

test('boxes with no location get no overlay correlation', () => {
  const a = assessDevice({ device: dev(), readings: [rd('temp_c', 22)], location: null }, ctxAll(), NOW);
  assert.deepEqual(a.correlations, []);
  assert.equal(a.location, null);
});

test('contact flag needs a linked customer with consent and carries no personal data', () => {
  const base = { device: dev(), readings: [rd('temp_c', 22)], location: here };
  assert.equal(assessDevice({ ...base, link: { linked: true, consent: true, contactName: 'Sam' } }, {}, NOW).hasContact, true);
  assert.equal(assessDevice({ ...base, link: { linked: true, consent: false } }, {}, NOW).hasContact, false);
  assert.equal(assessDevice({ ...base }, {}, NOW).hasContact, false);
  assert.ok(!JSON.stringify(assessDevice({ ...base, link: { linked: true, consent: true, contactName: 'Sam' } }, {}, NOW)).includes('Sam'));
});

// ---------- customer view ----------
test('customer view maps the ladder to plain statuses without leaking internals', () => {
  const crit = customerView(assess([rd('water_detected', true, 3), rd('smoke_alarm', true, 3)]), NOW);
  assert.equal(crit.status, 'urgent');
  assert.match(crit.statusText, /911/);
  assert.match(crit.statusText, /cannot confirm/);
  assert.ok(crit.conditions.length >= 2);
  assert.match(crit.conditions[0].text, /3 minutes ago/);
  assert.equal(customerView(assess([rd('humidity_pct', 80)]), NOW).status, 'needs_attention');
  assert.equal(customerView(assess([rd('temp_c', 20)]), NOW).status, 'normal');
  const none = customerView(assessDevice({ device: { _id: 'x' }, readings: [] }, {}, NOW), NOW);
  assert.equal(none.status, 'no_recent_signal');
  const staleCrit = customerView(assess([rd('water_detected', true, 40)]), NOW);
  assert.equal(staleCrit.status, 'urgent');
  assert.match(staleCrit.conditions[0].text, /40 minutes ago/);
  assert.match(staleCrit.conditions[0].text, /out of date/);
  const blob = JSON.stringify([crit, staleCrit, none]);
  for (const bad of ['evidenceId', 'deviceId', 'aaaaaaaa', 'ruleId', 'safe to', 'occupied', '—']) assert.ok(!blob.includes(bad), bad);
  assert.deepEqual(Object.keys(crit).sort(), ['conditions', 'statusText', 'status'].sort());
});

test('no user facing copy uses an em dash', () => {
  const a = assess([rd('water_detected', true, 3), rd('mains_power', false), rd('battery_pct', 20)], ctxAll());
  assert.ok(!JSON.stringify([a, customerView(a, NOW)]).includes('—'));
});

// ---------- regions ----------
const cell = geohashDecode(geohashEncode(-96.75, 32.98, 5));
const at = (i) => [cell.lng + ((i % 5) - 2) * 0.004, cell.lat + (Math.floor(i / 5) - 1) * 0.004];
const mk = (i, readings, lastSeenMin = 1, extra = {}) => assessDevice({ device: dev(String(i).padStart(24, '0'), { lastSeen: ago(lastSeenMin) }), readings, location: at(i), ...extra }, {}, NOW);

test('cells need three boxes and count every status', () => {
  const two = [mk(1, [rd('temp_c', 20)]), mk(2, [rd('temp_c', 20)])];
  assert.deepEqual(aggregateRegions(two, { now: NOW }), []);
  const five = [mk(1, [rd('temp_c', 20)]), mk(2, [rd('humidity_pct', 80)]), mk(3, [rd('humidity_pct', 95)]), mk(4, [rd('water_detected', true)]), mk(5, [])];
  const [r] = aggregateRegions(five, { now: NOW, precision: 5 });
  assert.equal(r.key, `gh5:${geohashEncode(cell.lng, cell.lat, 5)}`);
  assert.equal(r.deviceCount, 5);
  assert.deepEqual(r.counts, { unknown: 1, normal: 1, watch: 1, elevated: 1, critical: 1 });
  assert.equal(r.bbox.length, 4);
  assert.ok(r.advisory);
});

test('hotspot rules: three elevated, two critical same hazard, or three worsened', () => {
  const three = [1, 2, 3].map((i) => mk(i, [rd('humidity_pct', 95)]));
  assert.equal(aggregateRegions(three, { now: NOW })[0].hotspot.is, true);
  const twoCrit = [mk(1, [rd('water_detected', true)]), mk(2, [rd('water_level_mm', 30)]), mk(3, [rd('temp_c', 20)])];
  const hot = aggregateRegions(twoCrit, { now: NOW })[0];
  assert.equal(hot.hotspot.is, true);
  assert.match(hot.hotspot.reasons[0], /critical water/);
  const mixed = [mk(1, [rd('water_detected', true)]), mk(2, [rd('smoke_alarm', true)]), mk(3, [rd('temp_c', 20)])];
  assert.equal(aggregateRegions(mixed, { now: NOW })[0].hotspot.is, false);
  const calm = [1, 2, 3].map((i) => mk(i, [rd('temp_c', 20)]));
  assert.equal(aggregateRegions(calm, { now: NOW })[0].hotspot.is, false);
  const worse = aggregateRegions(calm, { now: NOW, worsened: new Set(calm.map((a) => a.deviceId)) })[0];
  assert.equal(worse.hotspot.is, true);
  assert.equal(worse.worsened30m, 3);
});

test('grid or internet outage needs half offline within 15 minutes of each other', () => {
  const off = (i, min) => mk(i, [rd('temp_c', 20, min + 20)], min);
  const grid = [off(1, 30), off(2, 33), off(3, 38), mk(4, [rd('temp_c', 20)])];
  const r = aggregateRegions(grid, { now: NOW })[0];
  assert.equal(r.outage, 'possible_grid_or_isp_outage');
  assert.equal(r.offlineShare, 0.75);
  assert.ok(!r.correlations.find((c) => c.kind === 'outage').text.includes('corroborate'));
  assert.equal(r.counts.critical, 0);
  const corroborated = [off(1, 30), off(2, 33), off(3, 38), mk(4, [rd('mains_power', false), rd('battery_pct', 90)])];
  assert.match(aggregateRegions(corroborated, { now: NOW })[0].correlations.find((c) => c.kind === 'outage').text, /mains reports corroborate/);
  const spread = [off(1, 20), off(2, 60), off(3, 120), mk(4, [rd('temp_c', 20)])];
  assert.equal(aggregateRegions(spread, { now: NOW })[0].outage, 'isolated_offline');
  const few = [off(1, 30), mk(2, [rd('temp_c', 20)]), mk(3, [rd('temp_c', 20)]), mk(4, [rd('temp_c', 20)])];
  assert.equal(aggregateRegions(few, { now: NOW })[0].outage, 'isolated_offline');
  const none = [1, 2, 3].map((i) => mk(i, [rd('temp_c', 20)]));
  assert.equal(aggregateRegions(none, { now: NOW })[0].outage, 'none');
});

test('outage cells boost priority of their boxes by 5 points once', () => {
  const off = (i, min) => mk(i, [rd('temp_c', 20, min + 20)], min);
  const group = [off(1, 30), off(2, 33), off(3, 38), mk(4, [rd('temp_c', 20)])];
  const regions = aggregateRegions(group, { now: NOW });
  const boosted = applyRegionBoosts(group, regions);
  assert.deepEqual(boosted.map((a) => a.priority.score), [25, 25, 25, 5]);
  assert.deepEqual(applyRegionBoosts(boosted, regions).map((a) => a.priority.score), [25, 25, 25, 5]);
  assert.equal(group[0].priority.score, 20);
});

test('region correlations count boxes inside overlays and rising water', () => {
  const ctx = { zones: [{ id: 'z', type: 'evacuation', geometry: box([cell.lng, cell.lat], 0.05) }] };
  const group = [1, 2, 3].map((i) => assessDevice({ device: dev(String(i).padStart(24, '0')), readings: [rd('water_level_mm', 1, 8), rd('water_level_mm', 8, 1)], location: at(i) }, ctx, NOW));
  const r = aggregateRegions(group, { now: NOW })[0];
  assert.ok(r.correlations.some((c) => c.kind === 'zone' && /3 of 3/.test(c.text)));
  assert.equal(r.rising, 3);
  assert.ok(r.priority.score >= 75);
});

test('follow ups list P1 and P2 only, most urgent first, with contact flag and limit', () => {
  const list = [
    mk(1, [rd('temp_c', 20)]),
    mk(2, [rd('humidity_pct', 95)], 1, { link: { linked: true, consent: true } }),
    mk(3, [rd('water_detected', true)]),
    mk(4, [rd('humidity_pct', 80)]),
  ];
  const f = followUps(list, 10);
  assert.deepEqual(f.map((x) => x.tier), ['P1', 'P2']);
  assert.equal(f[0].deviceId, list[2].deviceId);
  assert.equal(f[1].hasContact, true);
  assert.match(f[0].why, /Water was reported/);
  assert.equal(followUps(list, 1).length, 1);
});

// ---------- loader and endpoint ----------
let mongod, client, db;
before(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db('risk_test');
});
after(async () => {
  await client?.close();
  await mongod?.stop();
});

async function seed({ exercise = false, n = 3, offset = 0, water = false } = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const home = { _id: new ObjectId(), location: { type: 'Point', coordinates: at(i + offset) } };
    const device = { _id: new ObjectId(), name: `Box ${i}`, homeId: home._id, disabled: false, keyHash: 'secret-hash', lastSeen: ago(1), meta: exercise ? { exercise: true } : {} };
    await db.collection('homes').insertOne(home);
    await db.collection('devices').insertOne(device);
    await db.collection('readings').insertMany([
      { deviceId: device._id, sensor: 'temp_c', value: 21, ts: ago(1), receivedAt: ago(1) },
      ...(water ? [{ deviceId: device._id, sensor: 'water_detected', value: true, ts: ago(2), receivedAt: ago(2) }] : []),
    ]);
    ids.push(String(device._id));
  }
  return ids;
}

test('loader assesses live boxes only, never exposes keys, and keeps exercise data apart', async () => {
  await db.dropDatabase();
  const live = await seed({ n: 3, water: true });
  const ex = await seed({ exercise: true, n: 3, offset: 5 });
  const r = await loadRisk(db, { now: NOW, readOnly: true }, { readCachedOverlays: null });
  assert.equal(r.mode, 'live');
  assert.deepEqual(r.assessments.map((a) => a.deviceId).sort(), [...live].sort());
  assert.ok(r.assessments.every((a) => a.status === 'critical'));
  assert.ok(!JSON.stringify(r).includes('secret-hash'));
  assert.equal(r.regions.length, 1);
  assert.equal(r.regions[0].hotspot.is, true);
  assert.equal(r.followUps.length, 3);
  const e = await loadRisk(db, { now: NOW, exercise: true, readOnly: true }, { readCachedOverlays: null });
  assert.equal(e.mode, 'exercise');
  assert.deepEqual(e.assessments.map((a) => a.deviceId).sort(), [...ex].sort());
  assert.ok(e.assessments.every((a) => a.status === 'normal'));
});

test('loader filters by bbox and device ids, and reads the newest evidence', async () => {
  await db.dropDatabase();
  const ids = await seed({ n: 4, water: true });
  const all = await loadRisk(db, { now: NOW, readOnly: true }, { readCachedOverlays: null });
  const target = all.assessments[0];
  const [lng, lat] = target.location;
  const small = await loadRisk(db, { now: NOW, bbox: [lng - 0.0001, lat - 0.0001, lng + 0.0001, lat + 0.0001], readOnly: true }, { readCachedOverlays: null });
  assert.deepEqual(small.assessments.map((a) => a.deviceId), [target.deviceId]);
  const one = await loadRisk(db, { now: NOW, deviceIds: [ids[1], 'not-an-id'], readOnly: true }, { readCachedOverlays: null });
  assert.deepEqual(one.assessments.map((a) => a.deviceId), [ids[1]]);
  assert.equal(one.limited, false);
  // A newer clear reading replaces the old critical one.
  await db.collection('readings').insertOne({ deviceId: new ObjectId(ids[1]), sensor: 'water_detected', value: false, ts: ago(0.5), receivedAt: ago(0.5) });
  const cleared = await loadRisk(db, { now: NOW, deviceIds: [ids[1]], readOnly: true }, { readCachedOverlays: null });
  assert.equal(cleared.assessments[0].status, 'normal');
});

test('loader passes overlay context in, and survives a failing feed', async () => {
  await db.dropDatabase();
  await seed({ n: 3 });
  let args;
  const overlays = async (_db, a) => { args = a; return { zones: [{ type: 'Feature', id: 'z', geometry: box([cell.lng, cell.lat], 0.1), properties: { id: 'z', type: 'evacuation', active: true } }], status: { zones: 'ok' } }; };
  const r = await loadRisk(db, { now: NOW, readOnly: true }, { readCachedOverlays: overlays });
  assert.ok(r.assessments.every((a) => a.priority.score === 15 && a.correlations[0].kind === 'zone' && a.correlations[0].sourceId === 'z'));
  assert.equal(args.exercise, false);
  assert.equal(args.bbox.length, 4);
  assert.deepEqual(args.cells, [geohashEncode(cell.lng, cell.lat, 5)]);
  assert.deepEqual(r.sources, { zones: 'ok' });
  const broken = await loadRisk(db, { now: NOW, readOnly: true }, { readCachedOverlays: async () => { throw new Error('feed down'); } });
  assert.equal(broken.assessments.length, 3);
  assert.equal(broken.sources.overlays, 'error');
});

test('status changes are stored and a recent worsening feeds the hotspot rule', async () => {
  await db.dropDatabase();
  const ids = await seed({ n: 3 });
  const deps = { readCachedOverlays: null, writeDeviceLog: async () => {} };
  const first = await loadRisk(db, { now: NOW }, deps);
  assert.equal(first.regions[0].worsened30m, 0);
  assert.equal(await db.collection('risk_state').countDocuments(), 3);
  await db.collection('readings').insertMany(ids.map((id) => ({ deviceId: new ObjectId(id), sensor: 'humidity_pct', value: 80, ts: ago(0.2), receivedAt: ago(0.2) })));
  const later = new Date(NOW.getTime() + 60000);
  const second = await loadRisk(db, { now: later }, deps);
  assert.ok(second.assessments.every((a) => a.status === 'watch'));
  assert.equal(second.regions[0].worsened30m, 3);
  assert.equal(second.regions[0].hotspot.is, true);
  const st = await db.collection('risk_state').findOne({ _id: ids[0] });
  assert.equal(st.status, 'watch');
  assert.equal(st.prevStatus, 'normal');
  // Same status again: still counted inside the 30 minute window, and not rewritten.
  const third = await loadRisk(db, { now: new Date(NOW.getTime() + 10 * 60000) }, deps);
  assert.equal(third.regions[0].worsened30m, 3);
  // After the window it stops counting.
  const fourth = await loadRisk(db, { now: new Date(NOW.getTime() + 40 * 60000) }, deps);
  assert.equal(fourth.regions[0].worsened30m, 0);
});

test('discarded readings are logged once per new bad reading', async () => {
  await db.dropDatabase();
  const [id] = await seed({ n: 1 });
  await db.collection('readings').insertOne({ deviceId: new ObjectId(id), sensor: 'co_ppm', value: 99999, ts: ago(1), receivedAt: ago(1) });
  const logs = [];
  const deps = { readCachedOverlays: null, writeDeviceLog: async (_d, e) => { logs.push(e); } };
  const r = await loadRisk(db, { now: NOW }, deps);
  assert.equal(r.assessments[0].discarded.length, 1);
  assert.equal(r.assessments[0].status, 'normal');
  await loadRisk(db, { now: NOW }, deps);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].code, 'reading_discarded');
  assert.equal(logs[0].deviceId, id);
  assert.match(logs[0].msg, /co_ppm/);
  assert.ok(!/99999/.test(logs[0].msg));
});

test('links count as contact only with consent and expose no names', async () => {
  await db.dropDatabase();
  const [a, b] = await seed({ n: 2 });
  await db.collection('customer_links').insertMany([
    { deviceId: a, customerEmail: 'x@example.test', contactName: 'Sam', consent: true, active: true },
    { deviceId: b, customerEmail: 'y@example.test', contactName: 'Lee', consent: false, active: true },
  ]);
  const r = await loadRisk(db, { now: NOW, readOnly: true }, { readCachedOverlays: null });
  const by = Object.fromEntries(r.assessments.map((x) => [x.deviceId, x.hasContact]));
  assert.deepEqual(by, { [a]: true, [b]: false });
  assert.ok(!/Sam|Lee|example\.test/.test(JSON.stringify(r)));
});

const ctxFor = (query, data = { operator: { email: 'o@example.test', role: 'operator' } }, extra = {}) => ({
  request: new Request(`https://home.test/api/risk${query}`), env: { API_ADMIN_KEY: 'k' }, data, db, deps: { readCachedOverlays: null, writeDeviceLog: async () => {} }, ...extra,
});

test('endpoint returns devices with follow ups and caches nothing', async () => {
  await db.dropDatabase();
  const ids = await seed({ n: 3, water: true });
  await seed({ exercise: true, n: 3, offset: 5 });
  const res = await riskGet(ctxFor(''));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.equal(body.mode, 'live');
  assert.deepEqual(body.assessments.map((a) => a.deviceId).sort(), [...ids].sort());
  assert.equal(body.followUps.length, 3);
  assert.ok(body.asOf);
  assert.equal(body.regions, undefined);
  const regions = await (await riskGet(ctxFor('?level=regions&precision=5'))).json();
  assert.equal(regions.regions.length, 1);
  assert.equal(regions.assessments, undefined);
  const one = await (await riskGet(ctxFor(`?device_id=${ids[0]}`))).json();
  assert.equal(one.assessments.length, 1);
});

test('endpoint: demo sees exercise data only, operators can opt in to exercise, strangers are refused', async () => {
  await db.dropDatabase();
  await seed({ n: 3, water: true });
  const ex = await seed({ exercise: true, n: 3, offset: 5 });
  const demo = await (await riskGet(ctxFor('', { operator: { email: 'd@example.test', role: 'demo' } }))).json();
  assert.equal(demo.mode, 'exercise');
  assert.deepEqual(demo.assessments.map((a) => a.deviceId).sort(), [...ex].sort());
  assert.equal(await db.collection('risk_state').countDocuments({ exercise: true }), 0, 'demo reads write nothing');
  const demoTryingLive = await (await riskGet(ctxFor('?mode=live', { operator: { email: 'd@example.test', role: 'demo' } }))).json();
  assert.equal(demoTryingLive.mode, 'exercise');
  const opEx = await (await riskGet(ctxFor('?mode=exercise'))).json();
  assert.equal(opEx.mode, 'exercise');
  const nobody = await riskGet(ctxFor('', undefined, { data: {} }));
  assert.equal(nobody.status, 401);
  const admin = await riskGet({ ...ctxFor('', {}), request: new Request('https://home.test/api/risk', { headers: { Authorization: 'Bearer k' } }) });
  assert.equal(admin.status, 200);
});

test('endpoint validates its query and reports missing boxes and missing database', async () => {
  await db.dropDatabase();
  await seed({ n: 1 });
  for (const q of ['?level=nope', '?bbox=1,2', '?precision=9', '?device_id=zzz', '?limit=0', '?limit=x']) {
    const res = await riskGet(ctxFor(q));
    assert.equal(res.status, 400, q);
    assert.ok((await res.json()).error);
  }
  assert.equal((await riskGet(ctxFor(`?device_id=${'f'.repeat(24)}`))).status, 404);
  const down = await riskGet({ ...ctxFor(''), db: undefined, env: { API_ADMIN_KEY: 'k' } });
  assert.equal(down.status, 503);
  assert.deepEqual(Object.keys(await down.json()), ['error']);
});
