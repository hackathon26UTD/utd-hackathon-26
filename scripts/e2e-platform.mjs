#!/usr/bin/env node
// End-to-end platform check against a running server (npm run dev:local, default http://127.0.0.1:8788).
//   API_ADMIN_KEY=<key> node scripts/e2e-platform.mjs [--base http://127.0.0.1:8790]
// Everything it writes is exercise data (meta.exercise=true). The key value is never printed.
// Exit code 0 means every step passed.
import { run as simulate, sample } from './simulate-device.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:8788').replace(/\/$/, '');
const adminKey = process.env.API_ADMIN_KEY;
if (!adminKey) { console.error('Set API_ADMIN_KEY in the environment.'); process.exit(2); }
const center = [32.98, -96.75];

let passed = 0, failed = 0;
const step = (name, ok, detail = '') => { (ok ? passed++ : failed++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '  -> ' + detail}`); return ok; };
async function call(method, path, { body, key, admin = false, cookie, origin = true } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(origin ? { Origin: base } : {}), ...(admin ? { Authorization: `Bearer ${adminKey}` } : {}), ...(key ? { 'X-Device-Key': key } : {}), ...(cookie ? { Cookie: cookie } : {}) };
  const res = await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json, setCookie: res.headers.get('set-cookie') };
}
const A = (m, p, body) => call(m, p, { admin: true, body });
const q = (o) => new URLSearchParams(o).toString();
const bbox = `${center[1] - 0.2},${center[0] - 0.2},${center[1] + 0.2},${center[0] + 0.2}`;

// ---- 0. fleet from the simulator (mixed hazards) so regions have something to group
const fleetRun = await simulate({ base, devices: 12, center, scenario: 'mixed', interval: 0, ticks: 9, seed: 11, live: false, confirmLive: false }, { env: process.env, log: () => {} });
step('simulator ran 12 exercise devices for 9 ticks', fleetRun.stats.ticks === 9 && fleetRun.stats.failed === 0, JSON.stringify(fleetRun.stats));

// ---- 1. hero device: register, normal readings, then flood + power loss + power save + smoke
const home = (await A('POST', '/api/beacon/homes', { label: 'E2E home', location: { type: 'Point', coordinates: [center[1], center[0]] } })).body?.home;
const made = (await A('POST', '/api/devices', { name: 'E2E-HERO', type: 'esp32', meta: { latitude: center[0], longitude: center[1], exercise: true } })).body;
const id = made?.device?.id, key = made?.deviceKey;
step('register device', !!(id && key && home?.id));
await A('PATCH', `/api/beacon/devices/${id}/home`, { home_id: home.id });
let seq = 0;
const send = async (tick, scenario, i = 0) => {
  const s = sample({ scenario, i, n: 10, tick });
  const core = await call('POST', '/api/beacon/ingest', { key, body: { device_id: id, event_id: `e2e-${Date.now()}-${seq}`, sequence: seq++, observed_at: new Date().toISOString(), ...s.core } });
  const ext = await call('POST', '/api/ingest', { key, body: { readings: s.ext } });
  return { core, ext };
};
let r;
for (let t = 0; t < 3; t++) r = await send(t, 'quiet');
step('normal readings accepted (202)', r.core.status === 202 && r.ext.status === 202, `${r.core.status}/${r.ext.status}`);
step('ingest reply carries messages_pending and poll_after_s', typeof r.core.body?.messages_pending === 'number' && typeof r.core.body?.poll_after_s === 'number', JSON.stringify(r.core.body));
let d = (await A('GET', `/api/ops/device?id=${id}&mode=exercise`)).body;
const normalStatus = d?.risk?.status ?? d?.assessment?.status ?? d?.device?.risk?.status;
step('live detail for one device returns', !!d && !d.error, JSON.stringify(d).slice(0, 160));

// hazards: i=0 in 'flood' is flooded; 'fire' gives smoke; 'outage' gives power loss and saver mode
for (let t = 4; t < 9; t++) r = await send(t, 'flood', 0);
const flood = (await A('GET', `/api/risk?${q({ level: 'devices', device_id: id, mode: 'exercise' })}`)).body;
const floodAssess = flood?.devices?.[0] ?? flood?.assessments?.[0];
step('flood readings raise risk above normal', !!floodAssess && !['normal', 'unknown'].includes(floodAssess.status), JSON.stringify(floodAssess || flood).slice(0, 200));
for (let t = 5; t < 9; t++) r = await send(t, 'fire', 0);
for (let t = 3; t < 8; t++) r = await send(t, 'outage', 0);
// device enters full power save: battery low, mains gone, mode saver, reported through the extended ingest
await call('POST', '/api/beacon/ingest', { key, body: { device_id: id, event_id: `e2e-save-${Date.now()}`, sequence: seq++, observed_at: new Date().toISOString(), temperature_c: 24, humidity_pct: 60, water_detected: true, main_power_available: false, battery_pct: 9 } });
await call('POST', '/api/ingest', { key, body: { readings: [{ sensor: 'power_mode', value: 'critical' }, { sensor: 'smoke_alarm', value: true }, { sensor: 'wan_connected', value: true }] } });
const sat = await A('GET', `/api/ops/device?id=${id}&mode=exercise`);
const satText = JSON.stringify(sat.body);
step('power loss and power save are visible on the device', /critical/i.test(satText) && /power_mode|powerMode|power/i.test(satText), satText.slice(0, 200));
step('smoke alarm reading is visible', /smoke/i.test(satText));

// ---- 2. live feed with cursor, region, risk
const live = await A('GET', `/api/ops/live?${q({ bbox, mode: 'exercise' })}`);
step('live feed returns devices in the region', live.status === 200 && (live.body.devices?.length ?? 0) >= 12, `status ${live.status} devices ${live.body?.devices?.length}`);
const cursor = live.body?.cursor ?? live.body?.next ?? live.body?.since;
step('live feed returns a cursor', !!cursor, Object.keys(live.body || {}).join(','));
await new Promise((r) => setTimeout(r, 7000)); // the cursor overlaps by 2 s, so wait past it
const overlap = await A('GET', `/api/ops/live?${q({ bbox, mode: 'exercise', since: cursor || '' })}`);
await new Promise(r=>setTimeout(r,2500));
const delta = await A('GET', `/api/ops/live?${q({ bbox, mode: 'exercise', since: overlap.body?.cursor || '' })}`);
step('live feed with cursor returns only changes', delta.status === 200 && (delta.body.devices?.length ?? 99) < (live.body.devices?.length ?? 0), `delta ${delta.body?.devices?.length}`);
const regions = await A('GET', `/api/risk?${q({ level: 'regions', bbox, mode: 'exercise' })}`);
step('region risk groups boxes into areas', regions.status === 200 && Array.isArray(regions.body.regions) && regions.body.regions.length >= 1, JSON.stringify(regions.body).slice(0, 200));
const fu = await A('GET', `/api/risk?${q({ level: 'devices', bbox, mode: 'exercise' })}`);
step('risk gives follow-up priorities', fu.status === 200 && Array.isArray(fu.body.followUps) && fu.body.followUps.length >= 1, JSON.stringify(fu.body).slice(0, 160));
const logs = await A('GET', `/api/ops/logs?${q({ device_id: id, mode: 'exercise' })}`);
step('device logs recorded (power mode change)', logs.status === 200 && logs.body.entries.some((e) => e.code === 'power.mode'), JSON.stringify(logs.body).slice(0, 200));

// ---- 3. overlays: zone CRUD
const poly = { type: 'Polygon', coordinates: [[[center[1] - 0.01, center[0] - 0.01], [center[1] + 0.01, center[0] - 0.01], [center[1] + 0.01, center[0] + 0.01], [center[1] - 0.01, center[0] + 0.01], [center[1] - 0.01, center[0] - 0.01]]] };
const zc = await A('POST', '/api/overlays?layer=zones&exercise=1', { name: 'E2E evacuation zone', type: 'evacuation', geometry: poly, exercise: true });
const zone = zc.body?.zone && { id: zc.body.zone.id, version: zc.body.zone.properties?.version };
step('create operator zone', zc.status === 201 && !!zone?.id, JSON.stringify(zc.body).slice(0, 200));
const zl = await A('GET', `/api/overlays?layer=zones&exercise=1&bbox=${bbox}`);
step('zone appears in the overlay list', JSON.stringify(zl.body).includes('E2E evacuation zone'));
const zu = await A('PATCH', `/api/overlays?layer=zones&id=${zone?.id}`, { name: 'E2E zone renamed', version: zone?.version });
step('edit zone', zu.status === 200, JSON.stringify(zu.body).slice(0, 160));
const stale = await A('PATCH', `/api/overlays?layer=zones&id=${zone?.id}`, { name: 'stale write', version: zone?.version });
step('stale zone edit is refused (409)', stale.status === 409, String(stale.status));
const riskWithZone = await A('GET', `/api/risk?${q({ level: 'devices', device_id: id, mode: 'exercise' })}`);
step('device inside an evacuation zone is correlated', /zone|evacuat/i.test(JSON.stringify(riskWithZone.body)), JSON.stringify(riskWithZone.body).slice(0, 240));
const zd = await A('DELETE', `/api/overlays?layer=zones&id=${zone?.id}`, { version: zu.body?.zone?.properties?.version });
step('delete zone', zd.status === 200, JSON.stringify(zd.body).slice(0, 160));
const feeds = await A('GET', '/api/feeds');
step('feed status lists sources', feeds.status === 200 && Array.isArray(feeds.body.sources) && feeds.body.sources.length >= 5);

// ---- 4. downlink: operator sends, device pulls and acks
const sent = await A('POST', '/api/ops/messages?mode=exercise', { scope: { type: 'device', deviceIds: [id] }, title: 'Evacuate now', body: 'Leave by Elm St. Shelter open at school.', severity: 'urgent', kind: 'instruction', requiresAck: true, customerVisible: true });
const sentOk = sent.status === 201;
step('operator sends a message to the device', sentOk, JSON.stringify(sent.body).slice(0, 240));
const tooLong = await A('POST', '/api/ops/messages?mode=exercise', { scope: { type: 'device', deviceIds: [id] }, title: 'x'.repeat(30), body: 'ok' });
step('over-long title is refused', tooLong.status === 400, String(tooLong.status));
r = await send(10, 'quiet');
step('next ingest reply says a message is waiting', r.core.body?.messages_pending >= 1, JSON.stringify(r.core.body));
const pull = await call('GET', '/api/device/messages?after=0&limit=3', { key });
const msg = pull.body?.messages?.[0];
step('device pulls the message', pull.status === 200 && msg?.title === 'Evacuate now', JSON.stringify(pull.body).slice(0, 200));
const ack = await call('POST', '/api/device/messages', { key, body: { message_id: msg?.id, state: 'acked' } });
step('device acks the message', ack.status === 200, JSON.stringify(ack.body).slice(0, 160));
const ml = await A('GET', `/api/ops/messages?${q({ device_id: id, mode: 'exercise' })}`);
step('operator sees the message as acked', /acked/.test(JSON.stringify(ml.body)), JSON.stringify(ml.body).slice(0, 240));
const badKey = await call('GET', '/api/device/messages?after=0', { key: 'dk_wrong' });
step('wrong device key is refused', badKey.status === 401, String(badKey.status));
const noAuth = await call('GET', '/api/ops/live');
step('operator endpoints refuse anonymous callers', noAuth.status === 401, String(noAuth.status));

// ---- 5. customer: pairing, claim, status
const pair = await A('POST', '/api/ops/pairing', { device_id: id });
step('operator issues pairing serial and code', pair.status === 201 && !!pair.body.serial && !!pair.body.pairingCode && String(pair.body.qrPayload).includes('#claim='), JSON.stringify(Object.keys(pair.body || {})));
const email = `e2e-${Date.now()}@example.test`;
const bad = await call('POST', '/api/customer/register', { body: { email, password: 'correct horse battery', contactName: 'E2E Owner', consent: true, acceptTerms: true, serial: pair.body?.serial, code: '000000' } });
step('wrong pairing code is refused with a uniform message', bad.status === 400, JSON.stringify(bad.body));
const reg = await call('POST', '/api/customer/register', { body: { email, password: 'correct horse battery', contactName: 'E2E Owner', consent: true, acceptTerms: true, serial: pair.body?.serial, code: pair.body?.pairingCode, nickname: 'Hall box' } });
const cookie = (reg.setCookie || '').split(';')[0];
step('customer registers and claims in one step', reg.status === 201 && !!cookie, JSON.stringify(reg.body));
const crossOp = await call('GET', '/api/ops/live?mode=exercise', { cookie });
step('customer session cannot reach operator data', crossOp.status === 401, String(crossOp.status));
const cd = await call('GET', '/api/customer/devices', { cookie });
const mine = cd.body?.devices?.[0];
step('customer sees own device with a plain status', cd.status === 200 && cd.body.devices.length === 1 && !!mine?.status, JSON.stringify(cd.body).slice(0, 300));
step('customer view leaks no keys or hashes', !/keyHash|codeHash|deviceKey|dk_/.test(JSON.stringify(cd.body)));
const h1 = await A('POST', '/api/ops/help-status', { device_id: id, status: 'help_on_the_way', note: 'Crew assigned, about 20 minutes.' });
step('operator sets help status', h1.status === 200, JSON.stringify(h1.body).slice(0, 160));
const cd2 = await call('GET', '/api/customer/devices', { cookie });
step('customer sees the help status the operator set', /help_on_the_way|on the way/i.test(JSON.stringify(cd2.body)), JSON.stringify(cd2.body).slice(0, 400));
step('customer sees the operator message', /Evacuate now/.test(JSON.stringify(cd2.body)));
const other = await call('POST', `/api/customer/messages?id=${'a'.repeat(24)}`, { cookie, body: { messageId: 'x' } });
step('foreign link id returns 404', other.status === 404, String(other.status));
const pi = await A('GET', `/api/ops/pairing?device_id=${id}`);
const live2 = await A('GET', `/api/ops/live?${q({ bbox, mode: 'exercise' })}`);
const heroLive = (live2.body.devices || []).find((x) => String(x.id || x.deviceId || x._id) === id);
step('operator pairing view shows the device is linked', pi.body?.linked === true, JSON.stringify(pi.body));
step('command center live data marks the customer link', !!heroLive && /customer|linked|hasContact|contact/i.test(JSON.stringify(heroLive)), JSON.stringify(heroLive || {}).slice(0, 400));
const dd = await A('GET', `/api/ops/device?id=${id}&mode=exercise`);
step('device detail shows the linked customer', /customer|linked/i.test(JSON.stringify(dd.body)), JSON.stringify(dd.body).slice(0, 200));
const login = await call('POST', '/api/customer/login', { body: { email, password: 'correct horse battery' } });
step('customer can log in again', login.status === 200);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
