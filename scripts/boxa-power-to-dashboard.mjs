// Box A's measured wall-power state -> live dashboard, through the laptop (until box A has Wi-Fi).
//
//   Box A (XIAO S3, D3 wall-power sense) --USB--> this script --HTTPS--> API as reading `mains_power`
//
//   node scripts/boxa-power-to-dashboard.mjs --port COM6 --key-file firmware/.live-box-a.json [--seconds 60]
//
// Reads box A's `HB {json}` serial lines and forwards only what box A measured ("mains": true/false).
// Nothing is invented: if box A stops reporting mains, nothing is sent and the dashboard goes stale.
// Uploads on change (plus power.lost / power.restored events) and a heartbeat every 15 s.
// The key file is private and git-ignored; the key is never printed.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const port = opt('port') || 'COM6';
if (!/^(COM[0-9]+|\/dev\/[A-Za-z0-9._-]+)$/.test(port)) throw Error('Invalid serial port');
const keyFile = opt('key-file');
if (!keyFile) throw Error('--key-file <private JSON> is required');
const dev = JSON.parse(readFileSync(keyFile, 'utf8'));
if (!/^[a-f0-9]{24}$/.test(dev.deviceId) || !/^dk_[a-f0-9]+$/.test(dev.deviceKey) || !/^https:\/\//.test(dev.site)) throw Error('Key file is incomplete');
const seconds = Number(opt('seconds')) || 0;
const HEARTBEAT_MS = 15000;

let last = null, lastBeat = 0, sent = 0, failed = 0, busy = false;
const run = Date.now().toString(36);

async function post(path, body) {
  try {
    const r = await fetch(dev.site + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'X-Device-Key': dev.deviceKey }, body: JSON.stringify(body) });
    if (r.ok) sent++; else { failed++; console.error(`HTTP ${r.status} on ${path}`); }
    return r.status;
  } catch (e) { failed++; console.error(`network error on ${path}: ${e.name}`); return 0; }
}

async function upload(mains) {
  const changed = last !== mains;
  if (!changed && Date.now() - lastBeat < HEARTBEAT_MS) return;
  lastBeat = Date.now();
  const now = new Date().toISOString();
  const r = await post('/api/ingest', { readings: [{ sensor: 'mains_power', value: mains, ts: now, meta: { source: 'boxa-usb', sensor: 'D3 wall-power sense', timestampBasis: 'host-receipt' } }] });
  let ev = '';
  if (last !== null && changed) {
    const type = mains ? 'power.restored' : 'power.lost';
    ev = `, event ${type} ${await post('/api/events', { type, data: { box: 'A', source: 'boxa-usb', event_id: `pwr-${run}-${Date.now()}`, observed_at: now } })}`;
  }
  console.log(`${changed ? 'CHANGE   ' : 'heartbeat'} wall power ${mains ? 'ON ' : 'OFF'} -> reading ${r}${ev}`);
  last = mains;
}

const reader = process.platform === 'win32'
  ? spawn('powershell', ['-NoProfile', '-Command', `$p=New-Object System.IO.Ports.SerialPort '${port}',115200;$p.DtrEnable=$true;$p.Open();while($true){$l=$p.ReadExisting();if($l){[Console]::Out.Write($l)};Start-Sleep -Milliseconds 100}`])
  : spawn('sh', ['-c', `stty -F ${port} 115200 raw -echo; cat ${port}`]);

console.log(`Reading box A on ${port}; forwarding measured wall power to ${dev.site} as ${dev.deviceId}.\n`);
let buf = '';
reader.stdout.on('data', (d) => {
  buf += d.toString(); if (buf.length > 16384) buf = '';
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line.startsWith('HB ')) continue;
    let m; try { m = JSON.parse(line.slice(3)); } catch { continue; }
    if (m.box !== 'A' || typeof m.mains !== 'boolean') continue;
    if (!busy) { busy = true; upload(m.mains).finally(() => { busy = false; }); }
  }
});
const stop = () => { reader.kill(); console.log(`\nsent ${sent}, failed ${failed}.`); process.exit(sent ? 0 : 1); };
reader.on('exit', () => { console.error('Serial reader closed.'); process.exit(1); });
process.on('SIGINT', stop); process.on('SIGTERM', stop);
if (seconds) setTimeout(stop, seconds * 1000);
