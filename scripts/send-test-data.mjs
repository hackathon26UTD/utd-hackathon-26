// Send a short, realistic sequence from one registered box to the live API, exactly as the
// firmware would. Use it to check that data reaches the command center / customer page.
//
//   npm run send-test-data                 normal -> water -> power lost -> help -> recovered
//   npm run send-test-data -- --interval 10   seconds between steps (default 8)
//
// Needs in .env (from the /build "Build your own box" page or `npm run provision`):
//   TEST_DEVICE_ID=<24-hex device id>
//   TEST_DEVICE_KEY=dk_...            (never printed)
// Optional: API_BASE (default https://utd-hackathon-26.pages.dev)
import { env } from './env.mjs';

const BASE = (env.API_BASE || 'https://utd-hackathon-26.pages.dev').replace(/\/$/, '');
const id = env.TEST_DEVICE_ID, key = env.TEST_DEVICE_KEY;
const argv = process.argv.slice(2);
const interval = Number(argv[argv.indexOf('--interval') + 1]) || 8;
if (!/^[a-f0-9]{24}$/i.test(id || '') || !/^dk_[a-f0-9]{48}$/i.test(key || '')) {
  console.error('Add TEST_DEVICE_ID and TEST_DEVICE_KEY to .env (from the live site: sign in, open /build, register a box).');
  process.exit(1);
}

const run = `test-${Date.now().toString(36)}`;
let seq = 0;
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': key }, body: JSON.stringify(body) });
  const text = await r.text();
  let msg = ''; try { const j = JSON.parse(text); msg = j.error || (j.incident ? `incident ${j.incident.type || ''}` : ''); } catch {}
  return { status: r.status, msg };
}
function telemetry(fields) {
  seq++;
  return post('/api/beacon/ingest', { device_id: id, event_id: `${run}-${seq}`, sequence: seq, observed_at: new Date().toISOString(), ...fields });
}

const steps = [
  ['Normal: dry, wall power on', { water_detected: false, main_power_available: true, temperature_c: 22.5, humidity_pct: 45, battery_pct: 100 }],
  ['FLOOD: water detected', { water_detected: true, main_power_available: true, temperature_c: 22.1, humidity_pct: 71, battery_pct: 100 }],
  ['OUTAGE: wall power lost (box on battery)', { water_detected: true, main_power_available: false, temperature_c: 21.8, humidity_pct: 74, battery_pct: 96 }],
  ['HELP: button pressed', null],
  ['Recovered: dry, power back', { water_detected: false, main_power_available: true, temperature_c: 22.4, humidity_pct: 52, battery_pct: 95 }],
];

console.log(`Sending ${steps.length} steps to ${BASE} every ${interval} s (run ${run}). Watch the live site now.\n`);
let ok = true;
for (const [i, [label, fields]] of steps.entries()) {
  const r = fields
    ? await telemetry(fields)
    : await post('/api/events', { type: 'help.request', data: { box: 'test', event_id: `${run}-help`, observed_at: new Date().toISOString() } });
  const good = r.status >= 200 && r.status < 300;
  ok &&= good;
  console.log(`${good ? '✔' : '✖'} ${i + 1}. ${label.padEnd(42)} HTTP ${r.status}${r.msg ? `  ${r.msg}` : ''}`);
  if (r.status === 401) { console.log('   Device key rejected: re-copy TEST_DEVICE_KEY, or the box was disabled.'); break; }
  if (r.status === 409) { console.log('   Device has no home yet: register it through /build (it assigns the address).'); break; }
  if (i < steps.length - 1) await new Promise((res) => setTimeout(res, interval * 1000));
}
console.log(ok ? '\nAll steps accepted. The box should show the flood/outage, then recover, on the command center and customer page.' : '\nSome steps failed (see above).');
process.exit(ok ? 0 : 1);
