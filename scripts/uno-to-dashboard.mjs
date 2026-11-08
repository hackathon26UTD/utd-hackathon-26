// Real sensors -> live dashboard, through the laptop (bench test before the boxes have Wi-Fi).
//
//   Uno Q (sensors) --D1->D7--> XIAO S3 running firmware/uno_bridge --USB--> this script --HTTPS--> API
//
//   npm run uno-to-dashboard                  auto-detect the XIAO's port, run until Ctrl+C
//   npm run uno-to-dashboard -- --port COM6 --seconds 120
//
// Needs API_ADMIN_KEY in .env (registers the bench device once). The device and its key are kept in
// firmware/.bench-device.json (git-ignored); the key is never printed. Data is marked as exercise data,
// so it is visible to the demo operator account and never mistaken for a real household.
// Uploads on change plus a heartbeat every 10 s (not every second) to stay gentle on the database.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'firmware', '.bench-device.json');
const BASE = (env.API_BASE || 'https://utd-hackathon-26.pages.dev').replace(/\/$/, '');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const seconds = Number(opt('seconds')) || 0;
const HEARTBEAT_MS = 10000;

if (!env.API_ADMIN_KEY) { console.error('API_ADMIN_KEY missing in .env'); process.exit(1); }

async function admin(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${env.API_ADMIN_KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> HTTP ${r.status} ${j.error || ''}`);
  return j;
}

async function ensureDevice() {
  if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, 'utf8'));
  const { home } = await admin('POST', '/api/beacon/homes', { label: 'Bench box: Uno Q sensors (exercise)', location: { type: 'Point', coordinates: [-96.7502, 32.9857] } });
  const { device, deviceKey } = await admin('POST', '/api/devices', { name: 'BENCH-UNOQ', type: 'unoq-bench', meta: { exercise: true, bench: true } });
  await admin('PATCH', `/api/beacon/devices/${device.id}/home`, { home_id: home.id || home._id });
  const s = { deviceId: device.id, deviceKey, homeId: home.id || home._id };
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  console.log(`registered bench device ${s.deviceId} (key saved to firmware/.bench-device.json)`);
  return s;
}

function findPort() {
  if (opt('port')) return opt('port');
  const cli = existsSync('C:/Program Files/Arduino CLI/arduino-cli.exe') ? 'C:/Program Files/Arduino CLI/arduino-cli.exe' : 'arduino-cli';
  try {
    const j = JSON.parse(spawnSync(cli, ['board', 'list', '--format', 'json'], { encoding: 'utf8' }).stdout);
    const ports = (j.detected_ports || []).filter((d) => d.port?.protocol === 'serial' && (d.matching_boards || []).some((b) => /esp32/i.test(b.fqbn || '')));
    if (ports[0]) return ports[0].port.address;
  } catch {}
  throw new Error('No ESP32 serial port found. Plug the XIAO S3 (running uno_bridge) in, or pass --port COMx.');
}

function openSerial(port) {
  return process.platform === 'win32'
    ? spawn('powershell', ['-NoProfile', '-Command', `$p=New-Object System.IO.Ports.SerialPort '${port}',115200;$p.DtrEnable=$true;$p.Open();while($true){$l=$p.ReadExisting();if($l){[Console]::Out.Write($l)};Start-Sleep -Milliseconds 100}`])
    : spawn('sh', ['-c', `stty -F ${port} 115200 raw -echo; cat ${port}`]);
}

const dev = await ensureDevice();
const port = findPort();
let seq = Date.now() % 1e9, last = null, lastBeat = 0, sent = 0, failed = 0, busy = false;
const run = Date.now().toString(36);

async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': dev.deviceKey }, body: JSON.stringify(body) });
  if (r.ok) sent++; else failed++;
  return r.status;
}

async function upload(m) {
  const now = new Date().toISOString(); seq++;
  const changed = !last || ['water', 'flame', 'tilt'].some((k) => m[k] !== last[k]);
  if (!changed && Date.now() - lastBeat < HEARTBEAT_MS) return;
  lastBeat = Date.now();
  const t = await post('/api/beacon/ingest', { device_id: dev.deviceId, event_id: `bench-${run}-${seq}`, sequence: seq, observed_at: now, water_detected: !!m.water });
  const r = await post('/api/ingest', { readings: [
    { sensor: 'water_raw', value: m.water_raw, ts: now }, { sensor: 'flame', value: m.flame ? 1 : 0, ts: now },
    { sensor: 'flame_raw', value: m.flame_raw, ts: now }, { sensor: 'tilt', value: m.tilt ? 1 : 0, ts: now },
  ] });
  const events = [];
  if (last) {
    if (m.water !== last.water) events.push(m.water ? 'water.detected' : 'water.cleared');
    if (m.flame !== last.flame) events.push(m.flame ? 'flame.detected' : 'flame.cleared');
    if (m.tilt !== last.tilt) events.push(m.tilt ? 'tilt.detected' : 'tilt.cleared');
  }
  for (const type of events) await post('/api/events', { type, data: { box: 'bench-unoq', event_id: `bench-${run}-${seq}-${type}`, observed_at: now } });
  console.log(`${changed ? 'CHANGE   ' : 'heartbeat'} water=${m.water ? 'WET' : 'dry'}(${m.water_raw}) flame=${m.flame ? 'YES' : 'no'}(${m.flame_raw}) tilt=${m.tilt ? 'YES' : 'no'}  -> telemetry ${t}, readings ${r}${events.length ? `, events ${events.join(' ')}` : ''}`);
  last = m;
}

console.log(`Reading ${port}; uploading to ${BASE} as ${dev.deviceId}. Change a sensor (water, lighter, tilt) to see it land.\n`);
const p = openSerial(port);
let buf = '', gotAny = false;
p.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line.startsWith('[bridge]')) { if (!gotAny) console.log(line); continue; }
    if (!line.startsWith('UNO ')) continue;
    let m; try { m = JSON.parse(line.slice(4)); } catch { continue; }
    gotAny = true;
    if (!busy) { busy = true; upload(m).catch((e) => { failed++; console.log('upload error', e.message); }).finally(() => { busy = false; }); }
  }
});
const stop = () => { p.kill(); console.log(`\nuploaded ${sent} requests, ${failed} failed. Device ${dev.deviceId} ("BENCH-UNOQ") on the dashboard.`); process.exit(failed && !sent ? 1 : 0); };
process.on('SIGINT', stop);
if (seconds) setTimeout(stop, seconds * 1000);
