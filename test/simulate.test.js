// The device simulator: argument guards, deterministic scenarios, and a full in-process run (module C).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { handle } from '../src/app.js';
import { createMessage } from '../src/messages.js';
import { getLive } from '../src/live.js';
import { deviceLogs, deviceMessages, ingestWithDownlink } from '../src/live-api.js';
import { SCENARIOS, hazardOf, parseArgs, place, run, sample } from '../scripts/simulate-device.mjs';

let server, client, db;
const env = { API_ADMIN_KEY: 'test-admin' };
before(async () => {
  if (!process.env.TEST_MONGODB_URI) server = await MongoMemoryServer.create();
  client = await MongoClient.connect(process.env.TEST_MONGODB_URI || server.getUri());
  db = client.db('simulate_test');
});
after(async () => { await client?.close(); await server?.stop(); });

test('live mode needs both flags and options are validated', () => {
  assert.throws(() => parseArgs(['--live']), /yes-this-is-live/);
  assert.throws(() => parseArgs(['--yes-this-is-live']), /only works together/);
  assert.equal(parseArgs(['--live', '--yes-this-is-live']).live, true);
  assert.equal(parseArgs([]).live, false, 'exercise data by default');
  assert.throws(() => parseArgs(['--scenario', 'zombies']), /scenario/);
  assert.throws(() => parseArgs(['--devices', '0']), /devices/);
  assert.throws(() => parseArgs(['--center', '95,0']), /center/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown option/);
  assert.throws(() => parseArgs(['--base']), /needs a value/);
  const o = parseArgs(['--base', 'http://x:1/', '--devices', '40', '--center', '32.98,-96.75', '--scenario', 'flood', '--interval', '2', '--once']);
  assert.deepEqual([o.base, o.devices, o.center, o.scenario, o.interval, o.ticks], ['http://x:1', 40, [32.98, -96.75], 'flood', 2, 1]);
});

test('scenarios are deterministic and produce the readings they claim', () => {
  const a = sample({ scenario: 'mixed', i: 3, n: 30, tick: 5 });
  assert.deepEqual(a, sample({ scenario: 'mixed', i: 3, n: 30, tick: 5 }));
  const quiet = sample({ scenario: 'quiet', i: 0, n: 10, tick: 9 });
  assert.equal(quiet.core.water_detected, false);
  assert.equal(quiet.core.main_power_available, true);
  const flood = sample({ scenario: 'flood', i: 0, n: 10, tick: 8 });
  assert.equal(flood.core.water_detected, true);
  assert.ok(flood.ext.find((x) => x.sensor === 'water_level_mm').value >= 20);
  const fine = sample({ scenario: 'flood', i: 9, n: 10, tick: 8 });
  assert.equal(fine.core.water_detected, false, 'devices outside the cluster stay normal');
  const fire = sample({ scenario: 'fire', i: 0, n: 10, tick: 8 });
  assert.ok(fire.core.temperature_c >= 55);
  assert.equal(fire.ext.find((x) => x.sensor === 'smoke_alarm').value, true);
  assert.ok(fire.ext.find((x) => x.sensor === 'co_ppm').value >= 150);
  const out3 = sample({ scenario: 'outage', i: 0, n: 10, tick: 4 });
  assert.equal(out3.core.main_power_available, false);
  assert.equal(out3.silent, false);
  assert.equal(sample({ scenario: 'outage', i: 0, n: 10, tick: 7 }).silent, true, 'the cluster drops offline');
  assert.equal(sample({ scenario: 'outage', i: 9, n: 10, tick: 7 }).silent, false);
  assert.ok(sample({ scenario: 'aqi', i: 0, n: 10, tick: 8 }).ext.find((x) => x.sensor === 'pm25_ugm3').value >= 250);
  const modes = new Set();
  for (let t = 0; t < 40; t++) modes.add(sample({ scenario: 'outage', i: 0, n: 10, tick: t }).ext.find((x) => x.sensor === 'power_mode').value);
  assert.ok(modes.has('normal') && modes.has('saver'), 'power save transitions happen');
  assert.deepEqual([0, 1, 2].map((i) => hazardOf('mixed', i, 9)), ['flood', 'fire', 'outage']);
  assert.ok(SCENARIOS.every((s) => parseArgs(['--scenario', s]).scenario === s));
});

test('positions stay near the centre', () => {
  for (let i = 0; i < 40; i++) {
    const p = place(i, 40, [32.98, -96.75], 'mixed');
    assert.ok(Math.abs(p.lat - 32.98) < 0.06 && Math.abs(p.lng + 96.75) < 0.07, JSON.stringify(p));
  }
});

test('a full run registers exercise devices, ingests, pulls an operator message and logs', async () => {
  const route = async (url, init) => {
    const u = new URL(url);
    const request = new Request(url, init);
    const ctx = { request, env, injectedDb: db };
    if (u.pathname === '/api/beacon/ingest' || u.pathname === '/api/ingest') return ingestWithDownlink(ctx);
    if (u.pathname === '/api/device/messages') return deviceMessages(ctx);
    if (u.pathname === '/api/device/logs') return deviceLogs(ctx);
    if (u.pathname === '/api/ops/pairing') return Response.json({ error: 'Not found' }, { status: 404 });
    return handle(request, env, { db });
  };
  const lines = [];
  let sent = false;
  const opts = parseArgs(['--base', 'http://local', '--devices', '4', '--scenario', 'outage', '--interval', '0', '--ticks', '2']);
  const result = await run(opts, {
    env, fetchFn: route, log: (l) => lines.push(l),
    sleep: async () => {
      if (sent) return;
      sent = true;
      await createMessage(db, { scope: { type: 'device', deviceIds: [String((await db.collection('devices').findOne({ name: 'SIM-001' }))._id)] }, kind: 'instruction', severity: 'urgent', title: 'Move upstairs', body: 'Water is rising nearby', requiresAck: true }, { operator: 'test', exercise: true });
    },
  });
  assert.equal(result.stats.failed, 0, lines.join('\n'));
  assert.equal(result.stats.ticks, 2);
  assert.ok(lines.some((l) => /EXERCISE data/.test(l)));
  assert.equal(JSON.stringify(lines).includes('test-admin'), false, 'the admin key is never printed');
  assert.equal(JSON.stringify(lines).includes('dk_'), false, 'device keys are never printed');
  const devices = await db.collection('devices').find({ 'meta.simulated': true }).toArray();
  assert.equal(devices.length, 4);
  assert.ok(devices.every((d) => d.meta.exercise === true && d.homeId));
  const live = await getLive(db, { exercise: true });
  const first = live.devices.find((d) => d.id === result.fleet[0]);
  assert.ok(first.latest.temp_c && first.latest.pm25_ugm3 && first.latest.power_mode, 'core and extended sensors both landed');
  assert.deepEqual((await getLive(db, { exercise: false })).devices.filter((d) => /^SIM-/.test(d.name)), [], 'nothing leaked into live');
  assert.ok(lines.some((l) => /Move upstairs/.test(l)), 'device pulled and showed the message');
  assert.equal(result.stats.acked, 1);
  const row = await db.collection('message_deliveries').findOne({ deviceId: result.fleet[0] });
  assert.equal(row.state, 'acked');
  assert.ok(await db.collection('device_logs').findOne({ deviceId: result.fleet[0], code: 'boot', source: 'device' }));
  assert.ok(lines.some((l) => /Pairing endpoint not available/.test(l)));
});

test('refuses to run without the admin key and surfaces API errors plainly', async () => {
  await assert.rejects(run(parseArgs([]), { env: {}, fetchFn: async () => Response.json({}), log() {} }), /API_ADMIN_KEY/);
  await assert.rejects(run(parseArgs(['--devices', '1']), { env, fetchFn: async () => Response.json({ error: 'nope' }, { status: 401 }), log() {} }), /HTTP 401: nope/);
});
