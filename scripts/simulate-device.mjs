#!/usr/bin/env node
// HomeBeacon device simulator: exercises the whole pipeline without hardware.
//   node scripts/simulate-device.mjs --base http://localhost:8788 --devices 40 --center 32.98,-96.75 \
//        --scenario quiet|flood|fire|outage|storm|aqi|mixed --interval 5 [--ticks 20] [--live --yes-this-is-live]
// Reads API_ADMIN_KEY from the environment by name and never prints it or any device key.
// Writes exercise data by default (device meta.exercise=true). Live mode needs both flags.
import { pathToFileURL } from 'node:url';

export const SCENARIOS = ['quiet', 'flood', 'fire', 'outage', 'storm', 'aqi', 'mixed'];

export function parseArgs(argv) {
  const o = { base: 'http://localhost:8788', devices: 12, center: [32.98, -96.75], scenario: 'quiet', interval: 5, ticks: Infinity, live: false, confirmLive: false, seed: 7 };
  const need = (i, name) => { if (argv[i + 1] === undefined) throw new Error(`${name} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') o.base = need(i++, a).replace(/\/$/, '');
    else if (a === '--devices') o.devices = Number(need(i++, a));
    else if (a === '--center') o.center = need(i++, a).split(',').map(Number);
    else if (a === '--scenario') o.scenario = need(i++, a);
    else if (a === '--interval') o.interval = Number(need(i++, a));
    else if (a === '--ticks') o.ticks = Number(need(i++, a));
    else if (a === '--seed') o.seed = Number(need(i++, a));
    else if (a === '--once') o.ticks = 1;
    else if (a === '--live') o.live = true;
    else if (a === '--yes-this-is-live') o.confirmLive = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!SCENARIOS.includes(o.scenario)) throw new Error(`scenario must be one of ${SCENARIOS.join(', ')}`);
  if (!Number.isInteger(o.devices) || o.devices < 1 || o.devices > 500) throw new Error('devices must be 1 to 500');
  if (o.center.length !== 2 || !o.center.every(Number.isFinite) || Math.abs(o.center[0]) > 90 || Math.abs(o.center[1]) > 180) throw new Error('center must be lat,lng');
  if (!(o.interval >= 0)) throw new Error('interval must be a number of seconds');
  if (o.live && !o.confirmLive) throw new Error('Live mode writes real-looking data to the live map. Add --yes-this-is-live if that is really what you want.');
  if (o.confirmLive && !o.live) throw new Error('--yes-this-is-live only works together with --live');
  return o;
}

function rng(seed) {
  let t = seed >>> 0;
  return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

/** Where device i of n sits. Low indexes are near the centre; mixed splits devices into three sectors. */
export function place(i, n, center, scenario) {
  const r = rng(1000 + i);
  const radiusKm = 0.3 + 4.5 * Math.sqrt((i + 0.5) / n);
  const sector = scenario === 'mixed' ? i % 3 : 0;
  const angle = scenario === 'mixed' ? sector * 2.094 + (r() - 0.5) * 1.6 : r() * 6.283;
  const dLat = (radiusKm * Math.sin(angle)) / 111;
  const dLng = (radiusKm * Math.cos(angle)) / (111 * Math.cos((center[0] * Math.PI) / 180));
  return { lat: +(center[0] + dLat).toFixed(5), lng: +(center[1] + dLng).toFixed(5), sector };
}

/** Which hazard a device is inside for this scenario, or null. */
export function hazardOf(scenario, i, n) {
  const near = i < Math.max(2, Math.round(n * 0.3));
  if (scenario === 'mixed') return ['flood', 'fire', 'outage'][i % 3];
  if (scenario === 'quiet') return null;
  if (scenario === 'storm') return near ? 'storm' : null;
  return near ? scenario : null;
}

/**
 * One reading set. Deterministic for a seed. `core` goes to /api/beacon/ingest, `ext` to /api/ingest.
 * `silent` means the device stops reporting (cluster drops offline in the outage scenario).
 */
export function sample({ scenario, i, n, tick, seed = 7 }) {
  const r = rng(seed * 100003 + i * 1009 + tick);
  const noise = (a) => (r() - 0.5) * 2 * a;
  const hazard = hazardOf(scenario, i, n);
  const ramp = Math.min(1, Math.max(0, (tick - 2) / 6));
  const s = {
    temp: 22 + noise(1.5), humidity: 45 + noise(6), moisture: 25 + noise(5), water: false, level: 0, mains: true,
    battery: Math.max(8, 96 - tick * 0.15 - (i % 7)), smoke: false, flame: false, co: 2 + Math.abs(noise(2)), pm25: 8 + Math.abs(noise(4)), voc: 60 + noise(20),
    wan: true, rssi: -58 + noise(8), tilt: Math.abs(noise(1.5)), shock: Math.abs(noise(0.2)),
  };
  let silent = false;
  if (hazard === 'flood') {
    s.humidity = 70 + 25 * ramp; s.moisture = 40 + 55 * ramp;
    if (tick >= 4) { s.water = true; s.level = Math.round(30 * ramp * 10) / 10; }
  } else if (hazard === 'fire') {
    s.temp = 22 + 38 * ramp; s.co = 5 + 160 * ramp; s.pm25 = 15 + 280 * ramp; s.voc = 80 + 300 * ramp;
    if (tick >= 5) { s.smoke = true; s.flame = ramp > 0.8; }
  } else if (hazard === 'outage') {
    if (tick >= 3) { s.mains = false; s.battery = Math.max(3, s.battery - (tick - 3) * 6); }
    if (tick >= 6) silent = true;
  } else if (hazard === 'storm') {
    s.humidity = 88 + noise(4); s.moisture = 55 + 25 * ramp; s.rssi = -88 + noise(4); s.wan = r() > 0.35 * ramp;
    if (i % 4 === 0 && tick >= 5) { s.mains = false; s.tilt = 12 + noise(3); s.shock = 4.5; }
  }
  if (scenario === 'aqi') {
    const aq = i < n * 0.7 ? 1 : 0.3;
    s.pm25 = 20 + 260 * ramp * aq + Math.abs(noise(6)); s.voc = 100 + 280 * ramp * aq; s.co = 3 + 40 * ramp * aq;
  }
  s.mode = s.battery <= 10 ? 'critical' : s.battery <= 20 || (!s.mains && s.battery <= 60) ? 'saver' : 'normal';
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    silent,
    core: { temperature_c: r1(s.temp), humidity_pct: Math.min(100, Math.max(0, r1(s.humidity))), water_detected: s.water, main_power_available: s.mains, battery_pct: Math.round(s.battery) },
    ext: [
      ['moisture_pct', Math.min(100, Math.max(0, r1(s.moisture))), '%'], ['water_level_mm', s.level, 'mm'], ['smoke_alarm', s.smoke], ['fire_flame', s.flame],
      ['co_ppm', r1(s.co), 'ppm'], ['pm25_ugm3', r1(s.pm25), 'ug/m3'], ['voc_index', Math.round(s.voc)], ['power_mode', s.mode], ['wan_connected', s.wan],
      ['rssi_dbm', Math.round(s.rssi), 'dBm'], ['tilt_deg', r1(s.tilt), 'deg'], ['shock_g', r1(s.shock), 'g'],
    ].map(([sensor, value, unit]) => ({ sensor, value, ...(unit ? { unit } : {}) })),
  };
}

/** Runs the simulation. `fetchFn` and `log` are injectable so tests can run it in-process. */
export async function run(opts, { env = process.env, fetchFn = fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const adminKey = env.API_ADMIN_KEY;
  if (!adminKey) throw new Error('Set API_ADMIN_KEY in your environment (the value is never printed).');
  const exercise = !opts.live;
  const call = async (method, path, { body, key, admin = false } = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${adminKey}` } : {}), ...(key ? { 'X-Device-Key': key } : {}) };
    const res = await fetchFn(opts.base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: data };
  };
  const must = (r, what) => { if (r.status >= 300) throw new Error(`${what} failed (HTTP ${r.status}${r.body?.error ? `: ${r.body.error}` : ''})`); return r.body; };
  log(`Simulating ${opts.devices} devices, scenario "${opts.scenario}", ${exercise ? 'EXERCISE data' : 'LIVE data'}, against ${opts.base}`);
  must(await call('POST', '/api/setup', { admin: true }), 'database setup');
  const runId = Date.now().toString(36);
  const fleet = [];
  for (let i = 0; i < opts.devices; i++) {
    const pos = place(i, opts.devices, opts.center, opts.scenario);
    const home = must(await call('POST', '/api/beacon/homes', { admin: true, body: { label: `Simulated home ${i + 1}`, location: { type: 'Point', coordinates: [pos.lng, pos.lat] } } }), 'home').home;
    const made = must(await call('POST', '/api/devices', { admin: true, body: { name: `SIM-${String(i + 1).padStart(3, '0')}`, type: 'esp32', meta: { simulated: true, scenario: opts.scenario, latitude: pos.lat, longitude: pos.lng, ...(exercise ? { exercise: true } : {}) } } }), 'device');
    must(await call('PATCH', `/api/beacon/devices/${made.device.id}/home`, { admin: true, body: { home_id: home.id } }), 'home link');
    fleet.push({ i, id: made.device.id, key: made.deviceKey, cursor: 0, lastMode: null });
  }
  const pair = await call('POST', '/api/ops/pairing', { admin: true, body: { device_id: fleet[0].id } });
  if (pair.status === 200 || pair.status === 201) log(`Pairing for ${fleet[0].id}: serial ${pair.body.serial}  code ${pair.body.pairingCode}`);
  else log('Pairing endpoint not available yet; skipped.');
  const stats = { ticks: 0, ingests: 0, failed: 0, pulled: 0, acked: 0, logs: 0 };
  for (let tick = 0; tick < opts.ticks; tick++) {
    let silent = 0;
    for (const d of fleet) {
      const s = sample({ scenario: opts.scenario, i: d.i, n: opts.devices, tick, seed: opts.seed });
      if (s.silent) { silent++; continue; }
      const core = await call('POST', '/api/beacon/ingest', { key: d.key, body: { device_id: d.id, event_id: `${runId}-${d.i}-${tick}`, sequence: tick, observed_at: new Date().toISOString(), ...s.core } });
      const ext = await call('POST', '/api/ingest', { key: d.key, body: { readings: s.ext } });
      stats.ingests += 2;
      if (core.status !== 202) { stats.failed++; log(`  ${d.id}: core ingest HTTP ${core.status}`); }
      if (ext.status !== 202) { stats.failed++; log(`  ${d.id}: extended ingest HTTP ${ext.status}`); }
      const mode = s.ext.find((x) => x.sensor === 'power_mode').value;
      const entries = [];
      if (tick === 0) entries.push({ level: 'info', code: 'boot', msg: 'Simulated device started' });
      if (d.lastMode && d.lastMode !== mode) entries.push({ level: mode === 'normal' ? 'info' : 'warn', code: 'power.mode', msg: `Power mode ${d.lastMode} to ${mode}` });
      if (s.ext.find((x) => x.sensor === 'rssi_dbm').value <= -85) entries.push({ level: 'warn', code: 'wifi.weak', msg: 'Weak WiFi signal' });
      d.lastMode = mode;
      if (entries.length) { stats.logs += entries.length; await call('POST', '/api/device/logs', { key: d.key, body: { entries } }); }
      if ((core.body?.messages_pending ?? 0) > 0) {
        const pull = await call('GET', `/api/device/messages?after=${d.cursor}&limit=3`, { key: d.key });
        for (const m of pull.body?.messages || []) {
          stats.pulled++;
          log(`  ${d.id.slice(-6)} shows [${m.severity}] ${m.title}: ${m.body}`);
          await call('POST', '/api/device/messages', { key: d.key, body: { message_id: m.id, state: 'shown' } });
          if (m.requires_ack) { await call('POST', '/api/device/messages', { key: d.key, body: { message_id: m.id, state: 'acked' } }); stats.acked++; }
        }
        if (pull.body?.cursor !== undefined) d.cursor = pull.body.cursor;
      }
    }
    stats.ticks++;
    log(`tick ${tick + 1}: ${opts.devices - silent} reporting, ${silent} silent, failures so far ${stats.failed}, messages shown ${stats.pulled}`);
    if (tick + 1 < opts.ticks) await sleep(opts.interval * 1000);
  }
  return { fleet: fleet.map((d) => d.id), stats };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    await run(opts);
  } catch (e) {
    console.error(e.message);
    process.exit(e.message.startsWith('Live mode') || e.message.includes('needs a value') || e.message.startsWith('Unknown option') ? 2 : 1);
  }
}
