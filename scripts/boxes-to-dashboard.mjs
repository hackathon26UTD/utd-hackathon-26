// Everything box A hears -> live dashboard, through the laptop (the gateway until the boxes have Wi-Fi).
//
//   Uno Q sensors --wire D1->D7--> Box A (XIAO S3) <--encrypted ESP-NOW mesh-- Box B (XIAO C3)
//                                   |
//                                   USB --> this script --HTTPS--> API
//
//   node scripts/boxes-to-dashboard.mjs --port COM6 --key-a firmware/.live-box-a.json --key-b firmware/.live-box-b.json
//
// Box A prints one `HB {json}` line for every reading/event it sees: its own (water, flame from the Uno Q,
// wall power on D3) and those relayed over the mesh from box B (with hop count). This script forwards
// each one under the box that produced it, using that box's own device key. Only measured values are sent;
// a missing field stays missing. Keys come from private, git-ignored key files and are never printed.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const port = opt('port') || 'COM6';
if (!/^(COM[0-9]+|\/dev\/[A-Za-z0-9._-]+)$/.test(port)) throw Error('Invalid serial port');
const loadKey = (f) => {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  if (!/^[a-f0-9]{24}$/.test(d.deviceId) || !/^dk_[a-f0-9]+$/.test(d.deviceKey) || !/^https:\/\//.test(d.site)) throw Error(`Key file ${f} is incomplete`);
  return d;
};
const boxes = { A: loadKey(opt('key-a') || 'firmware/.live-box-a.json') };
if (opt('key-b')) boxes.B = loadKey(opt('key-b'));
const seconds = Number(opt('seconds')) || 0;
const HEARTBEAT_MS = 15000;

const run = Date.now().toString(36);
let seq = Date.now() % 1e9, sent = 0, failed = 0;
const seen = new Map();                 // `${box}-${seq}-${type}` -> time, drops mesh re-sends of the same message
const lastState = {}, lastBeat = {};
const queue = [];
let working = false;

// Events and telemetry are retried twice on network errors and 5xx (e.g. Cloudflare 1102 CPU limit); they carry event_ids, so the API dedupes repeats.
async function post(dev, path, body) {
  let status = 0;
  // Legacy /api/ingest is never retried (an unconfirmed write may already be stored; see docs/LIVE_DEVICE_CONNECTION.md).
  for (const wait of path === "/api/ingest" ? [0] : [0, 1000, 3000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await fetch(dev.site + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'X-Device-Key': dev.deviceKey }, body: JSON.stringify(body) });
      status = r.status;
      if (r.ok) { sent++; return status; }
      if (status < 500) break;
    } catch (e) { status = 0; }
  }
  failed++; console.error(`${status ? `HTTP ${status}` : 'network error'} on ${path} (after retries)`);
  return status;
}

async function handle(m) {
  const dev = boxes[m.box];
  if (!dev) return;
  const now = new Date().toISOString();
  const tag = `${m.box}${m.hops ? ` via mesh (${m.hops} hop${m.hops > 1 ? 's' : ''})` : ''}`;
  if (m.type === 'event') {
    if (!m.event) return;
    const s = await post(dev, '/api/events', { type: String(m.event).slice(0, 60), data: { box: m.box, source: 'boxa-usb', mesh_hops: m.hops || 0, event_id: `usb-${run}-${m.box}-${m.seq}`, observed_at: now } });
    console.log(`event     box ${tag}: ${m.event} -> ${s}`);
    return;
  }
  // Reading: forward only fields box A actually reported.
  const state = {};
  if (typeof m.water === 'boolean') state.water_detected = m.water;
  if (typeof m.flame === 'boolean') state.flame = m.flame;
  if (typeof m.mains === 'boolean') state.mains_power = m.mains;
  if (typeof m.motion === 'boolean') state.motion = m.motion;
  if (typeof m.tilt === 'boolean') state.tilt = m.tilt;
  const key = JSON.stringify(state);
  const changed = lastState[m.box] !== key;
  if (!changed && Date.now() - (lastBeat[m.box] || 0) < HEARTBEAT_MS) return;
  lastState[m.box] = key; lastBeat[m.box] = Date.now();
  const readings = Object.entries(state).map(([sensor, value]) => ({ sensor, value, ts: now, meta: { source: 'boxa-usb', timestampBasis: 'host-receipt' } }));
  readings.push({ sensor: 'mesh_hops', value: m.hops || 0, ts: now, meta: { source: 'boxa-usb' } });
  const r = await post(dev, '/api/ingest', { readings });
  let t = '';
  if (typeof state.water_detected === 'boolean' || typeof state.mains_power === 'boolean') {
    seq++;
    const telemetry = { device_id: dev.deviceId, event_id: `usb-${run}-${m.box}-${seq}`, sequence: seq, observed_at: now };
    if (typeof state.water_detected === 'boolean') telemetry.water_detected = state.water_detected;
    if (typeof state.mains_power === 'boolean') telemetry.main_power_available = state.mains_power;
    t = `, telemetry ${await post(dev, '/api/beacon/ingest', telemetry)}`;
  }
  const show = Object.entries(state).map(([k, v]) => `${k}=${v}`).join(' ') || 'heartbeat (no sensors)';
  console.log(`${changed ? 'CHANGE   ' : 'heartbeat'} box ${tag}: ${show} -> readings ${r}${t}`);
}

async function pump() {
  if (working) return;
  working = true;
  while (queue.length) await handle(queue.shift());
  working = false;
}

const reader = process.platform === 'win32'
  ? spawn('powershell', ['-NoProfile', '-Command', `$p=New-Object System.IO.Ports.SerialPort '${port}',115200;$p.DtrEnable=$true;$p.Open();while($true){$l=$p.ReadExisting();if($l){[Console]::Out.Write($l)};Start-Sleep -Milliseconds 100}`])
  : spawn('sh', ['-c', `stty -F ${port} 115200 raw -echo; cat ${port}`]);

console.log(`Reading box A on ${port}; forwarding boxes ${Object.keys(boxes).join(', ')} to ${boxes.A.site}.\n`);
let buf = '';
reader.stdout.on('data', (d) => {
  buf += d.toString(); if (buf.length > 32768) buf = '';
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line.startsWith('HB ')) continue;
    let m; try { m = JSON.parse(line.slice(3)); } catch { continue; }
    if (typeof m.box !== 'string') continue;
    const id = `${m.box}-${m.seq}-${m.type}`;
    // Mesh re-sends of the same message arrive within seconds; after a reboot seq numbers start over, so only drop recent repeats.
    if (m.box !== 'A' && Date.now() - (seen.get(id) || 0) < 60000) continue;
    seen.set(id, Date.now()); if (seen.size > 2000) seen.clear();
    queue.push(m); if (queue.length > 200) queue.shift();
    pump();
  }
});
const stop = () => { reader.kill(); console.log(`\nsent ${sent}, failed ${failed}.`); process.exit(sent ? 0 : 1); };
reader.on('exit', () => { console.error('Serial reader closed.'); process.exit(1); });
process.on('SIGINT', stop); process.on('SIGTERM', stop);
if (seconds) setTimeout(stop, seconds * 1000);
