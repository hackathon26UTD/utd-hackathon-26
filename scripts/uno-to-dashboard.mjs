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
// --live --key-file <private JSON> connects a registered real Uno Q over USB.
// Accepts direct JSON and bridge-prefixed UNO lines. No power/Wi-Fi values are invented.
// Uploads on change plus a heartbeat every 10 s (not every second) to stay gentle on the database.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.mjs';
import {readHub} from './lib/uno-hub-input.mjs';
import {parseUnoReport,unoReadings,POSIX_SERIAL_READER} from './lib/uno-sensor-input.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'firmware', '.bench-device.json');
const BASE = (env.API_BASE || 'https://utd-hackathon-26.pages.dev').replace(/\/$/, '');
const target=new URL(BASE);if(target.protocol!=='https:' && !['localhost','127.0.0.1'].includes(target.hostname))throw Error('HTTPS is required');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const seconds = Number(opt('seconds')) || 0;
const HEARTBEAT_MS = 10000;

const live=argv.includes('--live');
if(argv.includes('--help')){console.log('Uno Q USB: --port /dev/cu.usbmodem... --live --key-file <private JSON> [--seconds 60]. Controller mode: --hub-adb --adb <binary> --serial <USB serial> --live --key-file <private JSON>. Default remains exercise. Host stays awake and online.');process.exit(0);}
if(live&&!opt('key-file'))throw Error('--live requires a private --key-file. No key is rotated or inferred.');

async function admin(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${env.API_ADMIN_KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> HTTP ${r.status} ${j.error || ''}`);
  return j;
}

async function ensureDevice() {
  if(live){const s=JSON.parse(readFileSync(opt('key-file'),'utf8'));if(!/^[a-f0-9]{24}$/.test(s.deviceId)||!/^dk_[a-f0-9]+$/.test(s.deviceKey)||s.exercise!==false||s.site!==BASE)throw Error('Key file must match this production site and device');return s;}
  if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, 'utf8'));
  if(!env.API_ADMIN_KEY)throw Error('API_ADMIN_KEY required to register an exercise device');
  const { home } = await admin('POST', '/api/beacon/homes', { label: 'Bench box: Uno Q sensors (exercise)', location: { type: 'Point', coordinates: [-96.7502, 32.9857] } });
  const { device, deviceKey } = await admin('POST', '/api/devices', { name: 'BENCH-UNOQ', type: 'unoq-bench', meta: { exercise: true, bench: true } });
  await admin('PATCH', `/api/beacon/devices/${device.id}/home`, { home_id: home.id || home._id });
  const s = { deviceId: device.id, deviceKey, homeId: home.id || home._id };
  writeFileSync(STATE, JSON.stringify(s, null, 2),{mode:0o600});
  console.log(`registered bench device ${s.deviceId} (key saved to firmware/.bench-device.json)`);
  return s;
}

function findPort() {
  if (opt('port')) {const p=opt('port');if(!/^(?:\/dev\/(?:cu\.|tty)[A-Za-z0-9._-]+|COM[0-9]+)$/.test(p))throw Error('Invalid serial port');return p;}
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
    : spawn('python3', ['-u','-c',POSIX_SERIAL_READER,port]);
}

const hub=argv.includes('--hub-adb');
if(hub&&!live)throw Error('Hub USB mode requires --live and its own key file');
const port = hub ? null : findPort();
const dev = await ensureDevice();
let seq = Date.now() % 1e9, last = null, lastBeat = 0, sent = 0, failed = 0, busy = false;
const run = Date.now().toString(36);

async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', redirect:'error',signal:AbortSignal.timeout(15000),headers: { 'Content-Type': 'application/json', 'X-Device-Key': dev.deviceKey }, body: JSON.stringify(body) });
  if (r.ok) sent++; else failed++;
  return r.status;
}

async function upload(m) {
  const now = new Date().toISOString(); seq++;
  const changed = !last || ['water', 'flame', 'tilt'].some((k) => m[k] !== last[k]);
  if (!changed && Date.now() - lastBeat < HEARTBEAT_MS) return;
  lastBeat = Date.now();
  // Unassigned devices can report through legacy ingest; canonical ingest needs a home.
  const t = dev.homeId ? await post('/api/beacon/ingest', { device_id: dev.deviceId, event_id: `bench-${run}-${seq}`, sequence: seq, observed_at: now, water_detected: m.water }) : null;
  if(t!==null && t!==202)throw Error('Canonical write not confirmed; ingestion stopped for reconciliation');
  const r = await post('/api/ingest', { readings: unoReadings(m,now) });
  if(r!==202)throw Error('Reading write not confirmed; ingestion stopped for review');
  const events = [];
  if (last) {
    if (m.water !== last.water) events.push(m.water ? 'water.detected' : 'water.cleared');
    if (m.flame !== last.flame) events.push(m.flame ? 'flame.detected' : 'flame.cleared');
    if (m.tilt !== last.tilt) events.push(m.tilt ? 'tilt.detected' : 'tilt.cleared');
  }
  for (const type of events) { const status=await post('/api/events', { type, data: { box: live ? 'unoq-live' : 'bench-unoq', event_id: `bench-${run}-${seq}-${type}`, observed_at: now } }); if(status!==202)throw Error('Event write not confirmed; stopped for review'); }
  console.log(`${changed ? 'CHANGE   ' : 'heartbeat'} water=${m.water ? 'WET' : 'dry'}(${m.water_raw}) flame=${m.flame ? 'YES' : 'no'}(${m.flame_raw}) tilt=${m.tilt ? 'YES' : 'no'}  -> telemetry ${t}, readings ${r}${events.length ? `, events ${events.join(' ')}` : ''}`);
  last = m;
}

if(hub){
  const deadline=seconds ? Date.now()+seconds*1000 : Infinity;
  console.log('Uno Q controller USB uplink started; measured system values only.');
  while(Date.now()<deadline){
    const readings=readHub(opt('adb')||'adb',opt('serial'));
    const status=await post('/api/ingest',{readings});
    if(status!==202)throw Error('Write not confirmed; stopped for review');
    console.log(`${new Date().toISOString()} controller readings accepted: ${readings.length}`);
    await new Promise(resolve=>setTimeout(resolve,HEARTBEAT_MS));
  }
  process.exit(0);
}

console.log(`Reading ${port}; uploading to ${BASE} as ${dev.deviceId}. Listening for measured water, flame and tilt reports.\n`);
const p = openSerial(port);
let buf = '', gotAny = false;
p.stdout.on('data', (d) => {
  buf += d.toString();if(buf.length>8192){buf='';return;}
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line.startsWith('[bridge]')) { if (!gotAny) console.log(line); continue; }
    const m=parseUnoReport(line);if(!m)continue;
    gotAny = true;
    if (!busy) { busy = true; upload(m).catch(() => { failed++;console.error('Upload not confirmed. Stopped; inspect ingestion before restarting.');stop(); }).finally(() => { busy = false; }); }
  }
});
p.on('error',()=>{console.error('Serial reader unavailable');process.exit(1);});
p.on('exit',()=>{console.error('Serial connection closed. Reconnect the configured device before restarting.');process.exit(1);});
const stop = () => { p.kill(); console.log(`\nuploaded ${sent} requests, ${failed} failed. Device ${dev.deviceId}; check latest report time in the dashboard.`); process.exit(failed || !sent ? 1 : 0); };
process.on('SIGINT', stop);
if (seconds) setTimeout(stop, seconds * 1000);
process.on('SIGTERM',stop);
