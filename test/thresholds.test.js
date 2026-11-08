// Sensor thresholds: single readings for the sensor names the boxes actually send, and rules that
// need a condition to last (power out for an hour, water wet for minutes, alarm beeping, box tipped).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { SENSORS, SUSTAIN_SENSORS, COMPOUND, durationText, thresholdTable } from '../src/risk/config.js';
import { assessDevice, normalizeValue } from '../src/risk/device.js';
import { loadRisk, loadOnsets } from '../src/risk/load.js';

const NOW = new Date('2026-11-07T18:00:00.000Z');
const ago = (min) => new Date(NOW.getTime() - min * 60000);
let seq = 0;
const rd = (sensor, value, min = 1) => ({ _id: `t${++seq}`, sensor, value, ts: ago(min), receivedAt: ago(min) });
const dev = () => ({ _id: 'b'.repeat(24), name: 'Home', lastSeen: ago(1) });
const assess = (readings, extra = {}) => assessDevice({ device: dev(), readings, location: [-96.75, 32.98], ...extra }, {}, NOW);
/** Readings every `step` minutes from `fromMin` ago up to 1 minute ago. */
const run = (sensor, value, fromMin, step = 5) => { const out = []; for (let m = fromMin; m >= 1; m -= step) out.push(rd(sensor, value, m)); if (out.at(-1) && out.at(-1).ts.getTime() !== ago(1).getTime()) out.push(rd(sensor, value, 1)); return out; };

// ---------- single readings from the real firmware names ----------
const SINGLE = [
  ['water_raw', 700, 'normal'], ['water_raw', 800, 'watch'], ['water_raw', 1500, 'elevated'],
  ['flame', 0, 'normal'], ['flame', 1, 'critical'], ['flame', true, 'critical'],
  ['tilt', 0, 'normal'], ['tilt', 1, 'watch'],
  ['accel_dev_mg', 499, 'normal'], ['accel_dev_mg', 500, 'watch'], ['accel_dev_mg', 1500, 'elevated'],
  ['sound_hits', 5, 'normal'], ['sound_hits', 6, 'elevated'],
  ['battery_mv', 7300, 'normal'], ['battery_mv', 7200, 'watch'], ['battery_mv', 6600, 'elevated'],
  ['mains_power', false, 'watch'], ['mains_power', 0, 'watch'], ['mains_power', true, 'normal'],
];
for (const [sensor, value, expected] of SINGLE) {
  test(`one ${sensor}=${value} reading is ${expected}`, () => {
    assert.equal(assess([rd(sensor, value)]).status, expected);
  });
}

test('a near-zero battery voltage is a sensor fault, not an empty battery', () => {
  const a = assess([rd('battery_mv', 120)]);
  assert.equal(a.status, 'unknown');
  assert.equal(a.discarded[0].reason, 'out_of_range');
});

// ---------- durations ----------
test('mains power off escalates with how long it has lasted', () => {
  assert.equal(assess(run('mains_power', false, 30)).status, 'watch');
  const hour = assess([rd('mains_power', true, 80), ...run('mains_power', false, 70)]);
  assert.equal(hour.status, 'elevated');
  assert.equal(hour.reasons[0].ruleId, 'mains_off_1h');
  assert.equal(hour.reasons[0].heldMin, 69);
  assert.match(hour.reasons[0].text, /^Mains power has been reported off for 69 minutes 1 minute ago\./);
  assert.equal(hour.reasons[0].since, ago(70).toISOString());
  const four = assess([rd('mains_power', true, 300), ...run('mains_power', false, 250, 10)]);
  assert.equal(four.status, 'critical');
  assert.equal(four.reasons[0].ruleId, 'mains_off_4h');
});

test('a run broken by a good reading restarts the clock', () => {
  const a = assess([...run('mains_power', false, 200, 20).filter((r) => r.ts < ago(40)), rd('mains_power', true, 30), ...run('mains_power', false, 20)]);
  assert.equal(a.status, 'watch');
  assert.equal(a.reasons[0].ruleId, 'mains_off');
});

test('without a clear reading in view the duration is a lower bound', () => {
  const a = assess(run('mains_power', false, 90, 10));
  assert.equal(a.reasons[0].ruleId, 'mains_off_1h');
  assert.match(a.reasons[0].text, /for at least 89 minutes/);
});

test('loader onsets override the few readings in view', () => {
  const a = assess([rd('mains_power', false, 3), rd('mains_power', false, 1)], { onsets: { mains_power: { t: ago(300), bounded: false } } });
  assert.equal(a.status, 'critical');
  assert.match(a.reasons[0].text, /for 4 hours 59 minutes/);
});

test('duration is measured to the last report, so a box that went silent is not stretched', () => {
  const a = assess([rd('mains_power', true, 120), ...run('mains_power', false, 100, 10).filter((r) => r.ts <= ago(50))]);
  // off from 100 to 50 minutes ago: 50 minutes, under the one hour rule, and the report is stale.
  assert.equal(a.reasons.find((r) => r.hazard === 'power').ruleId, 'mains_off');
  assert.equal(a.staleHazard, true);
});

test('water sensor wet for two minutes is critical, a splash is not', () => {
  assert.equal(assess([rd('water_raw', 300, 3), rd('water_raw', 2100, 1)]).status, 'elevated');
  const a = assess([rd('water_raw', 300, 6), rd('water_raw', 1900, 4), rd('water_raw', 2100, 1)]);
  assert.equal(a.status, 'critical');
  assert.equal(a.reasons[0].ruleId, 'water_raw_wet_2m');
});

test('an alarm heard for two minutes is critical', () => {
  assert.equal(assess([rd('sound_hits', 0, 4), rd('sound_hits', 9, 1)]).status, 'elevated');
  assert.equal(assess([rd('sound_hits', 0, 5), rd('sound_hits', 8, 3), rd('sound_hits', 9, 1)]).status, 'critical');
});

test('a box tipped for ten minutes is elevated, a bump is watch', () => {
  assert.equal(assess([rd('tilt', 0, 6), rd('tilt', 1, 1)]).status, 'watch');
  assert.equal(assess([rd('tilt', 0, 14), rd('tilt', 1, 12), rd('tilt', 1, 1)]).status, 'elevated');
});

test('freezing for two hours is elevated; with mains off it is a no-heat warning at once', () => {
  assert.equal(assess([rd('temp_c', 4, 150), rd('temp_c', -1, 130), rd('temp_c', -2, 1)]).status, 'elevated');
  const noHeat = assess([rd('mains_power', false, 1), rd('temp_c', 4, 1)]);
  assert.equal(noHeat.status, 'elevated');
  assert.ok(noHeat.reasons.some((r) => r.ruleId === 'mains_off_cold'));
});

// ---------- configuration consistency ----------
/** Minimal evaluator for the filter shapes used in `sustain.bad`. */
function matchesFilter(filter, value) {
  const f = filter.value;
  if ('$in' in f) return f.$in.includes(value);
  if ('$gte' in f) return typeof value === 'number' && value >= f.$gte;
  if ('$lte' in f) return typeof value === 'number' && value <= f.$lte;
  throw new Error('unsupported filter ' + JSON.stringify(filter));
}

test('every sustained condition and its database filter agree', () => {
  for (const s of SUSTAIN_SENSORS) {
    const c = SENSORS[s];
    const samples = c.kind === 'bool' ? [true, false, 1, 0, 'true', 'false'] : [c.min, c.max, ...[0, 0.25, 0.5, 0.75, 1].map((k) => c.min + (c.max - c.min) * k), ...c.rules.flatMap((r) => { const n = Number(r.test.label?.match(/-?\d+(\.\d+)?/)?.[0]); return Number.isFinite(n) ? [n - 1, n, n + 1] : []; })];
    for (const raw of samples) {
      const n = normalizeValue(c, raw);
      if (!n.ok) continue;
      assert.equal(matchesFilter(c.sustain.bad, raw), c.sustain.test(n.value), `${s} ${JSON.stringify(raw)}`);
    }
    for (const r of c.rules.filter((x) => x.forMin)) assert.ok(r.test.label === c.sustain.test.label, `${s}/${r.id} must use the sustained condition`);
  }
});

test('within a sensor, longer-lasting rules come before the instant rule they extend', () => {
  for (const [s, c] of Object.entries(SENSORS)) {
    c.rules.forEach((r, i) => {
      if (!r.forMin) return;
      const later = c.rules.slice(i + 1).find((x) => x.test.label === r.test.label && !x.forMin);
      if (later) assert.ok(c.rules.indexOf(later) > i, `${s}/${r.id}`);
    });
  }
});

test('the threshold table lists every rule with a readable condition', () => {
  const rows = thresholdTable();
  const total = Object.values(SENSORS).reduce((n, c) => n + c.rules.length, 0) + COMPOUND.length;
  assert.equal(rows.length, total);
  for (const r of rows) {
    assert.ok(r.label && r.when && r.level, JSON.stringify(r));
    assert.doesNotMatch(r.when, /undefined|matches/, r.ruleId);
  }
  assert.ok(rows.some((r) => r.ruleId === 'mains_off_4h' && r.forMin === 240));
});

test('duration text is plain', () => {
  assert.equal(durationText(30000), 'under a minute');
  assert.equal(durationText(61 * 60000), '61 minutes');
  assert.equal(durationText(130 * 60000), '2 hours 10 minutes');
  assert.equal(durationText(10 * 3600000), '10 hours');
  assert.equal(durationText(72 * 3600000), '3 days');
});

// ---------- loader against MongoDB ----------
let mongod, client, db;
before(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db('threshold_test');
});
after(async () => { await client?.close(); await mongod?.stop(); });

async function box(readings) {
  const home = { _id: new ObjectId(), location: { type: 'Point', coordinates: [-96.75, 32.98] } };
  const device = { _id: new ObjectId(), name: 'Box', homeId: home._id, lastSeen: ago(1), meta: {} };
  await db.collection('homes').insertOne(home);
  await db.collection('devices').insertOne(device);
  await db.collection('readings').insertMany(readings.map(([sensor, value, min]) => ({ deviceId: device._id, sensor, value, ts: ago(min), receivedAt: ago(min) })));
  return String(device._id);
}

test('loader finds when a power outage began from the full history', async () => {
  await db.dropDatabase();
  const rows = [['mains_power', true, 400]];
  for (let m = 300; m >= 1; m -= 1) rows.push(['mains_power', false, m]); // one report a minute, only three reach the engine
  const out = await box(rows);
  const ok = await box([['mains_power', true, 2], ['mains_power', true, 1]]);
  const r = await loadRisk(db, { now: NOW, readOnly: true }, { readCachedOverlays: null });
  const a = r.assessments.find((x) => x.deviceId === out);
  assert.equal(a.status, 'critical');
  assert.equal(a.reasons[0].ruleId, 'mains_off_4h');
  assert.equal(a.reasons[0].since, ago(300).toISOString());
  assert.equal(r.assessments.find((x) => x.deviceId === ok).status, 'normal');
});

test('loader onsets skip healthy sensors and respect the lookback edge', async () => {
  await db.dropDatabase();
  const id = await box([['water_raw', 2000, 20], ['water_raw', 2000, 10], ['water_raw', 2000, 1], ['temp_c', 20, 1]]);
  const latest = await db.collection('readings').find({}).toArray();
  const onsets = await loadOnsets(db, latest, ago(15));
  assert.deepEqual(Object.keys(onsets.get(id)), ['water_raw']);
  assert.equal(onsets.get(id).water_raw.bounded, true);
  assert.equal(new Date(onsets.get(id).water_raw.t).toISOString(), ago(10).toISOString());
});
