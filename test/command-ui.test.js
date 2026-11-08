import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../ui/command/core.js';

const NOW = Date.parse('2026-11-07T18:00:00Z');
const ago = min => new Date(NOW - min * 60000).toISOString();

test('a quiet device is never shown as normal', () => {
  assert.equal(c.displayStatus({ risk: { status: 'normal' }, lastSeen: ago(1) }, NOW).status, 'normal');
  const quiet = c.displayStatus({ risk: { status: 'normal' }, lastSeen: ago(40) }, NOW);
  assert.equal(quiet.status, 'unknown');
  assert.equal(quiet.lastKnown, true);
  assert.equal(c.displayStatus({ risk: { status: 'normal' } }, NOW).status, 'unknown');
  assert.equal(c.displayStatus({ severity: 'normal', observedAt: ago(1), stale: true }, NOW).status, 'unknown');
  assert.equal(c.displayStatus({ risk: { status: 'normal' }, lastSeen: ago(1), offline: true }, NOW).status, 'unknown');
});

test('a stale critical or elevated reading stays as it was', () => {
  const d = c.displayStatus({ risk: { status: 'critical' }, lastSeen: ago(90), offline: true }, NOW);
  assert.equal(d.status, 'critical');
  assert.equal(d.lastKnown, true);
  assert.equal(c.displayStatus({ risk: { status: 'elevated' }, lastSeen: ago(60) }, NOW).status, 'elevated');
});

test('legacy and unrecognised severities map onto the ladder', () => {
  assert.equal(c.normalizeStatus('warning'), 'elevated');
  assert.equal(c.normalizeStatus('nonsense'), 'unknown');
  assert.equal(c.normalizeStatus(undefined), 'unknown');
  assert.equal(c.displayStatus({ severity: 'warning', observedAt: ago(1) }, NOW).status, 'elevated');
});

test('age text', () => {
  assert.equal(c.ageText(ago(0), NOW), 'just now');
  assert.equal(c.ageText(ago(1), NOW), '1 minute ago');
  assert.equal(c.ageText(ago(12), NOW), '12 minutes ago');
  assert.equal(c.ageText(ago(180), NOW), '3 hours ago');
  assert.equal(c.ageText(null, NOW), 'never');
  assert.equal(c.ageText('garbage', NOW), 'never');
});

test('worst status: unknown beats normal, never reports green for empty or unknown cells', () => {
  assert.equal(c.worstStatus({ critical: 0, elevated: 1, normal: 9 }), 'elevated');
  assert.equal(c.worstStatus({ normal: 5, unknown: 1 }), 'unknown');
  assert.equal(c.worstStatus({ normal: 5 }), 'normal');
  assert.equal(c.worstStatus({}), 'unknown');
});

test('poll url and delay', () => {
  assert.equal(c.liveUrl(), '/api/ops/live');
  assert.equal(c.liveUrl({ since: 'v1.17' }), '/api/ops/live?since=v1.17');
  assert.equal(c.liveUrl({ since: 'v1.1', bbox: [1, 2, 3, 4] }), '/api/ops/live?since=v1.1&bbox=1%2C2%2C3%2C4');
  assert.equal(c.liveUrl({ region: 'gh5:9vgm0', bbox: [1, 2, 3, 4], deviceId: 'abc' }), '/api/ops/live?region=gh5%3A9vgm0&device_id=abc');
  assert.equal(c.pollDelay(0, () => 0.5), 4000);
  assert.equal(c.pollDelay(0, () => 0), 3000);
  assert.equal(c.pollDelay(0, () => 1), 5000);
  assert.equal(c.pollDelay(1), 8000);
  assert.equal(c.pollDelay(2), 16000);
  assert.equal(c.pollDelay(9), 30000);
});

const dev = (id, over = {}) => ({ id, name: 'Box ' + id, lng: -96.75, lat: 32.98, lastSeen: ago(1), offline: false, latest: {}, risk: { status: 'normal', reasons: [] }, link: { linked: false }, help: { status: 'none' }, ...over });

test('mergeLive: snapshot, then incremental, dedupes by key', () => {
  const st = c.newLiveState();
  let r = c.mergeLive(st, { reset: true, cursor: 'v1.1', mode: 'exercise', devices: [dev('a'), dev('b')], logs: [{ deviceId: 'a', at: ago(2), level: 'info', code: 'BOOT', msg: 'started' }] });
  assert.equal(st.devices.size, 2);
  assert.equal(st.cursor, 'v1.1');
  assert.equal(st.mode, 'exercise');
  assert.equal(r.fresh.length, 1);
  // overlap: same log again plus an unchanged device
  r = c.mergeLive(st, { reset: false, cursor: 'v1.2', devices: [dev('a')], logs: [{ deviceId: 'a', at: ago(2), level: 'info', code: 'BOOT', msg: 'started' }] });
  assert.equal(r.fresh.length, 0);
  assert.deepEqual(r.changedIds, []);
  assert.equal(st.feed.length, 1);
  assert.equal(st.cursor, 'v1.2');
});

test('mergeLive: status change is reported and a move to critical is flagged', () => {
  const st = c.newLiveState();
  c.mergeLive(st, { reset: true, devices: [dev('a')] });
  const r = c.mergeLive(st, { devices: [dev('a', { risk: { status: 'critical', reasons: [] }, lastSeen: ago(0) })] });
  assert.deepEqual(r.changedIds, ['a']);
  assert.deepEqual(r.becameCritical, ['a']);
  const again = c.mergeLive(st, { devices: [dev('a', { risk: { status: 'critical', reasons: [] }, lastSeen: ago(0) })] });
  assert.deepEqual(again.becameCritical, []);
});

test('mergeLive: first snapshot never claims "became critical"', () => {
  const st = c.newLiveState();
  const r = c.mergeLive(st, { reset: true, devices: [dev('a', { risk: { status: 'critical', reasons: [] } })] });
  assert.deepEqual(r.becameCritical, []);
});

test('mergeLive: reset replaces the device set, keeps the feed', () => {
  const st = c.newLiveState();
  c.mergeLive(st, { reset: true, devices: [dev('a'), dev('b')], helpChanged: [{ deviceId: 'a', status: 'help_on_the_way', updatedAt: ago(1) }] });
  c.mergeLive(st, { reset: true, devices: [dev('c')] });
  assert.deepEqual([...st.devices.keys()], ['c']);
  assert.equal(st.feed.length, 1);
  assert.match(st.feed[0].text, /Help is on the way/);
});

test('mergeLive: feed is newest first, bounded, and tolerates junk', () => {
  const st = c.newLiveState();
  const logs = Array.from({ length: 20 }, (_, i) => ({ id: 'l' + i, deviceId: 'a', at: ago(30 - i), msg: 'm' + i }));
  c.mergeLive(st, { logs }, { feedMax: 5 });
  assert.equal(st.feed.length, 5);
  assert.equal(st.feed[0].key, 'log:l19');
  assert.doesNotThrow(() => c.mergeLive(st, null));
  assert.doesNotThrow(() => c.mergeLive(st, { devices: [null, {}], logs: [{}] }));
});

test('mergeLive: message, audit and incident items', () => {
  const st = c.newLiveState();
  const r = c.mergeLive(st, { messages: [{ id: 'm1', deviceId: 'a', state: 'acked', updatedAt: ago(1) }], audit: [{ at: ago(1), actor: { type: 'operator' }, action: 'send_message', deviceId: 'a' }], incidents: [{ id: 'i1', deviceId: 'a', updatedAt: ago(1), title: 'Water at sensor' }] });
  assert.equal(r.fresh.length, 3);
  assert.ok(st.feed.some(f => f.text === 'Message acked'));
  assert.ok(st.feed.some(f => f.text === 'operator send message'));
});

test('combineProperties: live data enriches base and adds new devices', () => {
  const base = [{ id: 'a', name: 'A', severity: 'normal', observedAt: ago(1), coordinates: [-96.7, 32.9], reasons: ['No active sensor alerts'] }];
  const live = [dev('a', { risk: { status: 'elevated', reasons: [{ text: 'Humidity is high' }], observedAt: ago(1) }, link: { linked: true, contactName: 'Sam', consent: true } }), dev('z', { lng: -96.8, lat: 33 })];
  const props = c.combineProperties(base, live, NOW);
  assert.equal(props.length, 2);
  const a = props.find(p => p.id === 'a');
  assert.equal(a.severity, 'elevated');
  assert.deepEqual(a.reasons, ['Humidity is high']);
  assert.equal(a.link.linked, true);
  assert.deepEqual(a.coordinates, [-96.75, 32.98]);
  assert.deepEqual(props.find(p => p.id === 'z').coordinates, [-96.8, 33]);
});

test('combineProperties: base only keeps reasons and never shows stale normal as normal', () => {
  const props = c.combineProperties([{ id: 'a', severity: 'normal', observedAt: ago(60), reasons: [] }, { id: 'b', severity: 'normal', observedAt: ago(1), reasons: [] }], [], NOW);
  assert.equal(props[0].severity, 'unknown');
  assert.equal(props[1].severity, 'normal');
});

test('combineProperties: device without coordinates stays listed, no map point', () => {
  const props = c.combineProperties([{ id: 'a', severity: 'unknown', coordinates: null }], [], NOW);
  assert.equal(props.length, 1);
  assert.equal(c.deviceFeatures(props, NOW).features.length, 0);
});

test('filters', () => {
  const props = c.combineProperties([{ id: 'a', name: 'Oak', severity: 'critical', observedAt: ago(1) }, { id: 'b', name: 'Elm', severity: 'normal', observedAt: ago(90), area: 'Creek' }], [dev('a', { risk: { status: 'critical', reasons: [] }, link: { linked: true, contactName: null } })], NOW);
  const f = o => props.filter(p => c.matchesFilter(p, o)).map(p => p.id);
  assert.deepEqual(f({}), ['a', 'b']);
  assert.deepEqual(f({ filter: 'critical' }), ['a']);
  assert.deepEqual(f({ filter: 'unknown' }), ['b']);
  assert.deepEqual(f({ filter: 'offline' }), ['b']);
  assert.deepEqual(f({ filter: 'linked' }), ['a']);
  assert.deepEqual(f({ search: 'creek' }), ['b']);
  assert.deepEqual(f({ layerIds: new Set(['b']) }), ['b']);
});

test('countStatuses', () => {
  const props = c.combineProperties([{ id: 'a', severity: 'critical', observedAt: ago(1) }, { id: 'b', severity: 'normal', observedAt: ago(60) }, { id: 'c', severity: 'normal', observedAt: ago(1) }], [], NOW);
  const n = c.countStatuses(props, NOW);
  assert.equal(n.critical, 1);
  assert.equal(n.unknown, 1);
  assert.equal(n.normal, 1);
  assert.equal(n.offline, 1);
});

test('failure text distinguishes not-built-yet from down', () => {
  assert.equal(c.failText(404, 'Live updates'), 'Live updates is not available yet.');
  assert.equal(c.failText(503, 'Overlays'), 'Overlays is temporarily unavailable.');
  assert.match(c.failText(0, 'x'), /Network/);
  assert.equal(c.failText(400, 'x', 'Title is required.'), 'Title is required.');
  assert.match(c.failText(403, 'x'), /cannot/);
  assert.match(c.failText(429, 'x'), /Too many/);
});

test('region map features', () => {
  const fc = c.regionFeatures([{ key: 'gh5:9vgm0', bbox: [-97, 32, -96.9, 32.1], counts: { normal: 2, elevated: 1 }, deviceCount: 3, hotspot: { is: true }, outage: 'possible_grid_or_isp_outage', priority: { tier: 'P2' } }, { key: 'bad', bbox: null }]);
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0].properties.worst, 'elevated');
  assert.equal(fc.features[0].properties.hotspot, true);
  assert.equal(fc.features[0].geometry.coordinates[0].length, 5);
  assert.equal(c.precisionForZoom(8), 4);
  assert.equal(c.precisionForZoom(11), 5);
  assert.equal(c.precisionForZoom(15), 6);
});

test('exercise regions need three homes and flag hot spots', () => {
  const mk = (id, severity, x) => ({ id, severity, observedAt: ago(1), coordinates: [-96.74 + x * 0.001, 32.98] });
  const regions = c.localRegions([mk('1', 'critical', 0), mk('2', 'elevated', 1), mk('3', 'elevated', 2), mk('4', 'normal', 3), { id: '5', severity: 'normal', observedAt: ago(1), coordinates: [-96.1, 32.1] }], { now: NOW });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].deviceCount, 4);
  assert.equal(regions[0].hotspot.is, true);
  assert.equal(regions[0].counts.critical, 1);
  assert.equal(c.devicesInBbox([mk('1', 'normal', 0), mk('2', 'normal', 5000)], regions[0].bbox).length, 1);
});

test('device map features carry display status, link and power mode', () => {
  const props = c.combineProperties([], [dev('a', { risk: { status: 'normal', reasons: [], power: { mode: 'saver' } }, link: { linked: true } }), dev('b', { lastSeen: ago(60) })], NOW);
  const fc = c.deviceFeatures(props, NOW, 'a');
  const a = fc.features.find(f => f.properties.id === 'a').properties;
  const b = fc.features.find(f => f.properties.id === 'b').properties;
  assert.equal(a.selected, true);
  assert.equal(a.linked, true);
  assert.equal(a.power, 'saver');
  assert.equal(b.status, 'unknown');
  assert.equal(b.lastKnown, true);
});

const goodMsg = { scope: { type: 'device', deviceIds: ['a'] }, title: 'Boil water', body: 'Boil tap water for 1 minute.', kind: 'instruction', severity: 'urgent' };

test('message validation: good message', () => {
  const v = c.validateMessage(goodMsg);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(c.messageBody({ ...goodMsg, requiresAck: true, customerVisible: true, expiresInMin: '60' }).expiresInMin, 60);
});

test('message validation: limits, characters, links, secrets', () => {
  const bad = (over, key) => assert.ok(c.validateMessage({ ...goodMsg, ...over }).errors[key], key + ' ' + JSON.stringify(over));
  bad({ title: '' }, 'title');
  bad({ title: 'x'.repeat(21) }, 'title');
  bad({ body: 'x'.repeat(81) }, 'body');
  bad({ body: 'café' }, 'body');
  bad({ body: 'emoji \u{1F600}' }, 'body');
  bad({ body: 'see https://x.test' }, 'body');
  bad({ body: 'visit example.com now' }, 'body');
  bad({ body: 'the password is up' }, 'body');
  bad({ body: 'dk_abcdef' }, 'body');
  bad({ body: 'a'.repeat(32).replace(/a/g, 'f') }, 'body');
  bad({ expiresInMin: 0 }, 'expiresInMin');
  bad({ expiresInMin: 10081 }, 'expiresInMin');
  bad({ kind: 'alarm' }, 'kind');
  bad({ severity: 'panic' }, 'severity');
  bad({ scope: null }, 'scope');
  bad({ scope: { type: 'device', deviceIds: [] } }, 'scope');
  bad({ scope: { type: 'region' } }, 'scope');
  bad({ scope: { type: 'bbox', bbox: [1, 2, 3] } }, 'scope');
  bad({ scope: { type: 'device', deviceIds: Array.from({ length: 201 }, (_, i) => 'd' + i) } }, 'scope');
  assert.equal(c.validateMessage({ ...goodMsg, body: '' }).ok, true);
  assert.equal(c.validateMessage({ ...goodMsg, title: 'x'.repeat(20), body: 'y'.repeat(80) }).ok, true);
  assert.equal(c.validateMessage({ ...goodMsg, scope: { type: 'region', region: 'gh5:9vgm0' } }).ok, true);
  assert.equal(c.validateMessage({ ...goodMsg, scope: { type: 'bbox', bbox: [-97, 32, -96, 33] } }).ok, true);
});

test('oled preview wraps to 21 columns and 8 rows', () => {
  const lines = c.oledPreview('Boil water notice for everyone', 'Boil tap water for one full minute before drinking or cooking. Bottled water is fine.');
  assert.equal(lines.length <= 8, true);
  assert.equal(lines[0].length <= 21, true);
  assert.ok(lines.every(l => l.length <= 21));
  assert.equal(lines[0], lines[0].toUpperCase());
  assert.deepEqual(c.oledPreview('Hi', ''), ['HI', '']);
  assert.ok(c.oledPreview('t', 'x'.repeat(50)).every(l => l.length <= 21));
});

const square = [[-96.8, 32.9], [-96.7, 32.9], [-96.7, 33], [-96.8, 33]];

test('zone validation', () => {
  const ok = c.validateZoneDraft({ type: 'evacuation', name: 'North creek', note: '', points: square });
  assert.equal(ok.ok, true);
  assert.equal(ok.geometry.type, 'Polygon');
  assert.deepEqual(ok.geometry.coordinates[0][0], ok.geometry.coordinates[0][4]);
  assert.equal(c.validateZoneDraft({ type: 'evacuation', name: 'x', points: square.slice(0, 2) }).errors.shape.includes('three'), true);
  assert.ok(c.validateZoneDraft({ type: 'nope', name: 'x', points: square }).errors.type);
  assert.ok(c.validateZoneDraft({ type: 'custom', name: '  ', points: square }).errors.name);
  assert.ok(c.validateZoneDraft({ type: 'custom', name: 'x'.repeat(81), points: square }).errors.name);
  assert.ok(c.validateZoneDraft({ type: 'custom', name: 'x', note: 'n'.repeat(301), points: square }).errors.note);
  assert.ok(c.validateZoneDraft({ type: 'custom', name: 'x', points: [[0, 0], [0, 91], [1, 1]] }).errors.shape);
  assert.ok(c.validateZoneDraft({ type: 'custom', name: 'x', points: Array.from({ length: 201 }, (_, i) => [i / 1000, (i % 2) / 1000]) }).errors.shape);
  // bow tie crosses itself
  assert.match(c.validateZoneDraft({ type: 'custom', name: 'x', points: [[0, 0], [1, 1], [1, 0], [0, 1]] }).errors.shape, /crosses/);
  assert.ok(c.validateZoneDraft({ type: 'custom', name: 'x', points: square, startsAt: '2026-11-08T00:00', endsAt: '2026-11-07T00:00' }).errors.endsAt);
});

test('zone pins', () => {
  const pin = c.validateZoneDraft({ type: 'shelter', name: 'Rec center', points: [[-96.75, 32.98]], pin: true });
  assert.equal(pin.ok, true);
  assert.equal(pin.geometry.type, 'Point');
  assert.equal(c.validateZoneDraft({ type: 'shelter', name: 'x', points: [], pin: true }).ok, false);
});

test('self intersection check accepts convex and concave simple shapes', () => {
  assert.equal(c.selfIntersects(square), false);
  assert.equal(c.selfIntersects([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]]), false);
  assert.equal(c.selfIntersects([[0, 0], [1, 1], [1, 0], [0, 1]]), true);
});

test('draw preview', () => {
  assert.equal(c.drawPreview([]).features.length, 0);
  assert.equal(c.drawPreview([[0, 0]]).features.length, 1);
  assert.equal(c.drawPreview([[0, 0], [1, 1]]).features.at(-1).geometry.type, 'LineString');
  assert.equal(c.drawPreview(square).features.at(-1).geometry.type, 'Polygon');
  assert.equal(c.drawPreview(square, true).features.length, 4);
});

test('overlay urls and freshness text', () => {
  assert.equal(c.overlayUrl('nws'), '/api/overlays?layer=nws');
  assert.equal(c.overlayUrl('nfhl', [-96.81234, 32.9, -96.7, 33.0]), '/api/overlays?layer=nfhl&bbox=-96.8123%2C32.9000%2C-96.7000%2C33.0000');
  assert.equal(c.overlayNote('nws', null), '');
  assert.equal(c.overlayNote('nws', { fetchedAt: ago(3), stale: false }, NOW), 'Updated 3 minutes ago');
  assert.match(c.overlayNote('nws', { ageS: 600, stale: true, truncated: true }, NOW), /Updated 10 minutes ago · Out of date.*· Too many shapes/);
  assert.ok(c.OVERLAYS.find(o => o.id === 'nfhl').minZoom === 11);
});

test('reading formatting is plain language and never invents values', () => {
  assert.equal(c.formatReading('mains_power', false), 'Lost');
  assert.equal(c.formatReading('water_detected', true), 'Detected');
  assert.equal(c.formatReading('power_mode', 'saver'), 'Power save mode');
  assert.equal(c.formatReading('battery_pct', 42), '42%');
  assert.equal(c.formatReading('temp_c', 21.456), '21.46°C');
  assert.equal(c.formatReading('co_ppm', 40), '40 ppm');
  assert.equal(c.formatReading('humidity_pct', null), 'Not reported');
  assert.equal(c.formatReading('humidity_pct', undefined), 'Not reported');
  assert.equal(c.formatReading('humidity_pct', 0), '0%');
});

test('reading rows list every sensor, missing ones as not reported', () => {
  const groups = c.readingRows({ mains_power: { value: false, ts: ago(1) }, co_ppm: { value: 12, unit: 'ppm', ts: ago(90) }, custom_x: { value: 3, ts: ago(1) } }, NOW);
  const rows = groups.flatMap(g => g.rows);
  assert.equal(rows.find(r => r.sensor === 'mains_power').text, 'Lost');
  assert.equal(rows.find(r => r.sensor === 'humidity_pct').reported, false);
  assert.equal(rows.find(r => r.sensor === 'humidity_pct').text, 'Not reported');
  assert.equal(rows.find(r => r.sensor === 'co_ppm').old, true);
  assert.equal(rows.find(r => r.sensor === 'mains_power').old, false);
  assert.equal(groups.at(-1).title, 'Other');
  assert.equal(groups.at(-1).rows[0].label, 'custom x');
  assert.equal(c.readingRows({}, NOW).length, c.SENSOR_GROUPS.length);
});

test('legacy values become latest readings', () => {
  const l = c.latestFromValues({ mains_power: true, temp_c: 21, skip: undefined }, ago(1));
  assert.deepEqual(Object.keys(l), ['mains_power', 'temp_c']);
  assert.equal(l.temp_c.value, 21);
});

test('sparkline', () => {
  assert.equal(c.sparkline([]), '');
  assert.equal(c.sparkline([{ ts: ago(5), value: 1 }]), '');
  const d = c.sparkline([{ ts: ago(10), value: 1 }, { ts: ago(5), value: 3 }, { ts: ago(0), value: 2 }]);
  assert.match(d, /^M0\.0 \d/);
  assert.equal((d.match(/L/g) || []).length, 2);
  assert.ok(c.sparkline([{ ts: ago(10), value: false }, { ts: ago(0), value: true }]).startsWith('M'));
  assert.equal(c.sparkline([{ ts: 'bad', value: 1 }, { ts: 'bad', value: 2 }]), '');
});

test('help and link text', () => {
  assert.equal(c.HELP_LABEL.help_on_the_way, 'Help is on the way');
  assert.deepEqual(c.HELP_STATUSES, ['none', 'review_queued', 'follow_up_assigned', 'help_on_the_way', 'resolved']);
  assert.equal(c.linkText({ linked: false }), 'No customer linked');
  assert.equal(c.linkText(undefined), 'No customer linked');
  assert.equal(c.linkText({ linked: true, contactName: 'Sam' }), 'Customer linked: Sam');
  assert.equal(c.linkText({ linked: true }), 'Customer linked');
});

test('logs url', () => {
  assert.equal(c.logsUrl({}, NOW), '/api/ops/logs?kind=all&limit=200');
  const u = new URL('http://x' + c.logsUrl({ kind: 'device', deviceId: 'abc', region: 'gh5:9vgm0', level: 'error', sinceMin: 60, limit: 900 }, NOW));
  assert.equal(u.searchParams.get('device_id'), 'abc');
  assert.equal(u.searchParams.get('region'), 'gh5:9vgm0');
  assert.equal(u.searchParams.get('level'), 'error');
  assert.equal(u.searchParams.get('limit'), '500');
  assert.equal(u.searchParams.get('since'), ago(60));
  assert.equal(new URL('http://x' + c.logsUrl({ level: 'all' }, NOW)).searchParams.has('level'), false);
});

test('feed scope', () => {
  const ids = new Set(['a']);
  assert.equal(c.inScope({ deviceId: 'a' }, 'device', ids), true);
  assert.equal(c.inScope({ deviceId: 'b' }, 'device', ids), false);
  assert.equal(c.inScope({ deviceId: null }, 'device', ids), false);
  assert.equal(c.inScope({ deviceId: 'b' }, 'all', ids), true);
});

test('exercise follow-ups order by seriousness and skip normal homes', () => {
  const props = c.combineProperties([
    { id: 'n', severity: 'normal', observedAt: ago(1), reasons: [] },
    { id: 'u', severity: 'unknown', observedAt: ago(90), reasons: ['No recent observations'] },
    { id: 'e', severity: 'warning', observedAt: ago(1), reasons: [] },
    { id: 'c', severity: 'critical', observedAt: ago(1), reasons: ['Water detected'] },
  ], [], NOW);
  const f = c.localFollowUps(props, NOW);
  assert.deepEqual(f.map(x => x.deviceId), ['c', 'e', 'u']);
  assert.equal(f[0].tier, 'P1');
  assert.equal(f[0].why, 'Water detected');
  assert.equal(f[1].tier, 'P2');
  assert.equal(f[2].tier, 'P3');
  assert.equal(f[0].hasContact, false);
  assert.equal(c.localFollowUps(props, NOW, 1).length, 1);
});

test('point text entry parses latitude, longitude lines', () => {
  const ok = c.parsePoints('32.98, -96.75\n 33.0 -96.7 \n\n32.9,-96.8');
  assert.deepEqual(ok.points, [[-96.75, 32.98], [-96.7, 33], [-96.8, 32.9]]);
  assert.deepEqual(ok.errors, []);
  const bad = c.parsePoints('abc\n91, 0\n10, 181\n1,2');
  assert.equal(bad.points.length, 1);
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /Line 1/);
  assert.deepEqual(c.parsePoints('').points, []);
  assert.equal(c.formatPoints([[-96.75, 32.98]]), '32.98000, -96.75000');
  // round trip
  assert.deepEqual(c.parsePoints(c.formatPoints(ok.points)).points, ok.points);
});

test('message state reads flat or per-device delivery', () => {
  assert.equal(c.messageState({ state: 'acked' }, 'a'), 'acked');
  assert.equal(c.messageState({ deliveries: [{ deviceId: 'b', state: 'queued' }, { deviceId: 'a', state: 'delivered' }] }, 'a'), 'delivered');
  assert.equal(c.messageState({}, 'a'), 'queued');
  assert.equal(c.MSG_STATE_TEXT.acked, 'Confirmed');
});
