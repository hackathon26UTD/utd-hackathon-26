// GET /api/ops/device-timeline: one device's checkpoints, plain-language conditions and event history.
// Eight checkpoints follow a reading from the box to the people who act on it. Where the cloud has no record
// (the box's own copy, the mesh link) the node says so instead of guessing. Nothing here infers occupancy,
// entry, damage, coverage or dispatch, and stale critical evidence is never shown as safe.
import { HttpError, json } from './http.js';
import { withDb } from './db.js';
import { opsAuth } from './live-api.js';
import { isHex24, loadScopeDevices, modeFilter } from './live.js';
import { loadRisk } from './risk/load.js';
import { nvidiaConfig } from './nemotron.js';
import { FRESH_MS } from '../domain/system-policy.js';
import { ObjectId } from 'mongodb';

export const ADVISORY = 'Advisory only. A person must review this.';
export const NODE_DEFS = [
  ['observation', 'Box observation', 'recorded'], ['local_record', 'Local record', 'not_recorded'], ['gateway_mesh', 'Connection path', 'derived'],
  ['cloud_ingest', 'Received by server', 'recorded'], ['rules_latch', 'Sensor checks', 'derived'], ['risk_ladder', 'Device status', 'derived'],
  ['operator_review', 'Operator review', 'recorded'], ['message_help', 'Customer updates', 'recorded'],
];
export const NODE_IDS = NODE_DEFS.map((n) => n[0]);
export const EDGES = [
  ...NODE_IDS.slice(0, -1).map((id, i) => ({ from: id, to: NODE_IDS[i + 1], kind: 'flow' })),
  { from: 'risk_ladder', to: 'message_help', kind: 'human_only' },
];
export const LIMITS = { readings: 1500, receipts: 400, events: 300, logs: 300, maxEvents: 600, maxHours: 72, defaultHours: 24 };
const OFFLINE_MS = 15 * 60_000;
const iso = (d) => (d ? new Date(d).toISOString() : null);
const t = (d) => (d ? new Date(d).getTime() : NaN);
const withBoth = (id) => ({ $in: [id, ...(isHex24(id) ? [new ObjectId(id)] : [])] });

export function agoPhrase(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 90) return `${s} seconds ago`;
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const spanPhrase = (ms) => agoPhrase(ms).replace(' ago', '');

// ---------- readings in plain words ----------
const truthy = (v) => v === true || v === 1 || v === 'true';
const READ_TEXT = {
  mains_power: (v) => `Mains power reported ${truthy(v) ? 'on' : 'off'}`,
  water_detected: (v) => (truthy(v) ? 'Water reported at the sensor' : 'No water reported at the sensor'),
  water_level_mm: (v) => `Water depth at the sensor ${v} mm`,
  temp_c: (v) => `Temperature ${v} C`,
  humidity_pct: (v) => `Humidity ${v} percent`,
  battery_pct: (v) => `Backup battery ${v} percent`,
  power_mode: (v) => `Power mode ${v}`,
  flame: (v) => (truthy(v) || Number(v) > 0 ? 'Flame sensor triggered' : 'Flame sensor quiet'),
  smoke_alarm: (v) => (truthy(v) ? 'Smoke alarm input active' : 'Smoke alarm input quiet'),
  wifi_connected: (v) => `Wi-Fi ${truthy(v) ? 'connected' : 'not connected'}`,
  api_reachable: (v) => `Cloud ${truthy(v) ? 'reachable' : 'not reachable'} from the box`,
};
READ_TEXT['power.mains'] = READ_TEXT.mains_power; READ_TEXT.main_power_available = READ_TEXT.mains_power; READ_TEXT.temperature_c = READ_TEXT.temp_c;
export function readingText(sensor, value) {
  const f = READ_TEXT[sensor];
  const text = f ? f(value) : `${String(sensor).replace(/[._]/g, ' ')} ${typeof value === 'object' ? 'reported' : String(value).slice(0, 40)}`;
  return text.replace(/[–—]/g, '-');
}
function readingLevel(sensor, v) {
  if (['water_detected', 'flame', 'smoke_alarm'].includes(sensor)) return truthy(v) || Number(v) > 0 ? 'critical' : 'info';
  if (['temp_c', 'temperature_c'].includes(sensor) && Number(v) >= 55) return 'critical';
  if (['mains_power', 'power.mains', 'main_power_available'].includes(sensor) && !truthy(v)) return 'warn';
  if (sensor === 'battery_pct' && Number(v) <= 40) return 'warn';
  return 'info';
}
const LOG_LEVEL = { debug: 'info', info: 'info', warn: 'warn', error: 'critical' };
const HELP_TEXT = { none: 'none', review_queued: 'review queued', follow_up_assigned: 'follow-up assigned', help_on_the_way: 'help on the way', resolved: 'resolved' };
const EVENT_TEXT = {
  'power.lost': 'Power loss reported', 'power.restored': 'Power restored', 'water.detected': 'Water reported at the sensor', 'water.cleared': 'Water report cleared',
  'help.request': 'A help request was sent from the box', 'ok.report': 'An OK report was sent from the box', 'alarm.sound': 'Alarm sound heard by the box',
  'flame.detected': 'Flame sensor triggered', 'box.boot': 'The box restarted', 'box_b.silent': 'A paired box stopped reporting', 'power.policy': 'Power policy changed',
};
const EVENT_LEVEL = { 'power.lost': 'warn', 'water.detected': 'critical', 'help.request': 'critical', 'alarm.sound': 'warn', 'flame.detected': 'critical', 'box_b.silent': 'warn' };

// ---------- events ----------
function buildEvents({ readings, receipts, evs, incidents, incidentEvents, logs, deliveries, help, audit, run, sid }) {
  const out = [];
  const push = (e) => { if (Number.isFinite(t(e.at))) out.push({ level: 'info', refs: [], ...e, at: iso(e.at), receivedAt: iso(e.receivedAt) }); };

  // Readings are listed when a sensor's value changes, so a steady stream stays readable.
  const lastValue = new Map();
  for (const r of [...readings].reverse()) {
    const key = r.sensor;
    const same = lastValue.has(key) && JSON.stringify(lastValue.get(key)) === JSON.stringify(r.value);
    lastValue.set(key, r.value);
    const rid = `reading:${r._id}`;
    if (!same) push({ id: rid, nodeId: 'observation', at: r.ts, receivedAt: r.receivedAt, kind: 'reading', level: readingLevel(r.sensor, r.value), text: readingText(r.sensor, r.value), refs: [rid] });
    if (r.receivedAt && t(r.receivedAt) - t(r.ts) > FRESH_MS) {
      push({ id: `delay:${r._id}`, nodeId: 'cloud_ingest', at: r.receivedAt, receivedAt: r.receivedAt, kind: 'delayed', level: 'warn', text: `A reading arrived ${spanPhrase(t(r.receivedAt) - t(r.ts))} after the box recorded it`, refs: [rid] });
    }
  }
  for (const rc of receipts) {
    const done = rc.state === 'complete';
    const fallback = rc.telemetry?.clockSource === 'server_fallback';
    push({
      id: `receipt:${rc._id}`, nodeId: 'cloud_ingest', at: rc.createdAt, kind: 'receipt', level: done && !fallback ? 'info' : 'warn',
      text: `${done ? 'Report stored' : `Report received but not finished (${rc.state})`}${fallback ? '. The box sent no clock time, so server time was used' : ''}`, refs: [`receipt:${rc._id}`],
    });
  }
  for (const e of evs) {
    const gateway = ['box_b.silent', 'box.boot'].includes(e.type);
    push({ id: `event:${e._id}`, nodeId: gateway ? 'gateway_mesh' : 'observation', at: e.data?.observed_at && Number.isFinite(t(e.data.observed_at)) ? e.data.observed_at : e.ts, receivedAt: e.ts, kind: 'event', level: EVENT_LEVEL[e.type] || 'info', text: EVENT_TEXT[e.type] || `Event ${String(e.type).slice(0, 40)}`, refs: [`event:${e._id}`] });
  }
  const typeOf = new Map(incidents.map((i) => [String(i._id), i.type]));
  const created = new Set(incidentEvents.filter((x) => x.eventType === 'created').map((x) => String(x.incidentId)));
  for (const i of incidents) {
    if (!created.has(String(i._id))) push({ id: `incident:${i._id}`, nodeId: 'rules_latch', at: i.createdAt || i.detectedAt, kind: 'incident', level: ['critical', 'high'].includes(i.severity) ? 'critical' : 'warn', text: `An incident for ${String(i.type).replace(/_/g, ' ')} was latched`, refs: [`incident:${i._id}`] });
  }
  for (const x of incidentEvents) {
    const type = String(typeOf.get(String(x.incidentId)) || 'hazard').replace(/_/g, ' ');
    const ref = [`incident_event:${x._id}`, `incident:${x.incidentId}`];
    if (x.eventType === 'created') push({ id: ref[0], nodeId: 'rules_latch', at: x.timestamp, kind: 'incident', level: 'critical', text: `An incident for ${type} was latched`, refs: ref });
    else if (x.eventType === 'observation') push({ id: ref[0], nodeId: 'rules_latch', at: x.timestamp, kind: 'incident', level: 'warn', text: `The ${type} rule matched again`, refs: ref });
    else if (x.eventType === 'status_change') push({ id: ref[0], nodeId: 'operator_review', at: x.timestamp, kind: 'review', level: 'info', text: `A person set the ${type} incident to ${String(x.details?.status || 'a new status').slice(0, 20)}`, refs: ref });
    else if (x.eventType === 'status_change_result' && x.outcome === 'not_applied') push({ id: ref[0], nodeId: 'operator_review', at: x.timestamp, kind: 'review', level: 'warn', text: 'A status change was not applied', refs: ref });
  }
  for (const l of logs) push({ id: `log:${l._id}`, nodeId: 'cloud_ingest', at: l.at, kind: 'log', level: LOG_LEVEL[l.level] || 'info', text: String(l.msg || l.code).slice(0, 120).replace(/[–—]/g, '-'), refs: [`log:${l._id}`] });
  for (const m of deliveries) {
    const title = String(m.title || 'Message').slice(0, 20);
    const ref = [`delivery:${m._id}`];
    if (t(m.createdAt) && t(m.updatedAt) !== t(m.createdAt)) push({ id: `${ref[0]}:queued`, nodeId: 'message_help', at: m.createdAt, kind: 'message', level: 'info', text: `Message "${title}" was queued for the box`, refs: ref });
    push({ id: ref[0], nodeId: 'message_help', at: m.updatedAt || m.createdAt, kind: 'message', level: m.state === 'failed' ? 'warn' : 'info', text: `Message "${title}" is ${String(m.effective || m.state)}`, refs: ref });
  }
  for (const [i, h] of (help?.history || []).entries()) push({ id: `help:${sid}:${i}:${t(h.at)}`, nodeId: 'message_help', at: h.at, kind: 'help', level: 'info', text: `Help status set to ${HELP_TEXT[h.status] || 'a new value'}`, refs: [`help:${sid}`] });
  for (const a of audit) push({ id: `audit:${a._id}`, nodeId: String(a.action).startsWith('message.') || String(a.action).startsWith('help') ? 'message_help' : 'operator_review', at: a.at, kind: 'audit', level: 'info', text: `A person did: ${String(a.action).replace(/[._]/g, ' ').slice(0, 50)}`, refs: [`audit:${a._id}`] });
  if (run) push({ id: `agent:${run._id}`, nodeId: 'operator_review', at: run.completedAt || run.createdAt, kind: 'agent', level: 'info', text: run.state === 'completed' ? 'A model-assisted review was saved and is waiting for a person' : `A model-assisted review ${String(run.state).slice(0, 20)}`, refs: [`agent:${run._id}`] });
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}

// ---------- nodes ----------
function buildNodes(x) {
  const { now, lastReading, readings, receipts, events, incidents, assessment, help, deliveries, run, siblings, link } = x;
  const nowMs = now.getTime();
  const byNode = Object.fromEntries(NODE_IDS.map((id) => [id, events.filter((e) => e.nodeId === id)]));
  const evidenceOf = (id) => byNode[id].slice(-5).reverse().map((e) => ({ id: e.refs?.[0] || e.id, kind: e.kind, at: e.at }));
  const lastOf = (id) => byNode[id].at(-1)?.at || null;
  const nodes = {};
  const mk = (id, status, extra = {}) => {
    const def = NODE_DEFS.find((n) => n[0] === id);
    nodes[id] = { id, label: def[1], order: NODE_IDS.indexOf(id) + 1, status, lastAt: extra.lastAt ?? lastOf(id), counts: { events: byNode[id].length, ...(extra.counts || {}) }, evidence: extra.evidence ?? evidenceOf(id), source: def[2], note: extra.note || '' };
  };

  // 1 Box observation
  const readAge = lastReading ? nowMs - t(lastReading.ts) : null;
  mk('observation', !lastReading ? 'unknown' : readAge <= FRESH_MS ? 'ok' : 'stale', {
    lastAt: iso(lastReading?.ts), counts: { readings: readings.length, sensors: new Set(readings.map((r) => r.sensor)).size },
    evidence: lastReading ? [{ id: `reading:${lastReading._id}`, kind: 'reading', at: iso(lastReading.ts) }] : [],
    note: !lastReading ? 'No reading has ever reached the cloud from this box.' : readAge <= FRESH_MS ? 'The newest reading is fresh.' : `The newest reading is ${spanPhrase(readAge)} old. It is the last known state, not a current one.`,
  });
  // 2 Local record: the cloud is never told what the box holds on its own.
  mk('local_record', 'not_reported', { lastAt: null, evidence: [], note: 'The box keeps its own copy. The cloud is not told what it holds.' });
  // 3 Connection path
  const silent = events.filter((e) => e.nodeId === 'gateway_mesh' && e.text.startsWith('A paired box stopped'));
  const lastSilent = silent.at(-1);
  const siblingSeen = siblings.map((s) => t(s.lastSeen)).filter(Number.isFinite);
  const newestSibling = siblingSeen.length ? Math.max(...siblingSeen) : null;
  const silentNow = lastSilent && !(newestSibling && newestSibling > t(lastSilent.at));
  mk('gateway_mesh', silentNow ? 'warn' : 'unknown', {
    counts: { pairedBoxes: siblings.length, restarts: byNode.gateway_mesh.filter((e) => e.text.startsWith('The box restarted')).length },
    note: silentNow ? 'A paired box stopped reporting and has not been heard from since.' : siblings.length ? 'A paired box exists at this home. The cloud has no direct record of the mesh link.' : 'The cloud has no direct record of the mesh link.',
  });
  // 4 Received by server
  const stuck = receipts.filter((r) => ['reserved', 'persisted'].includes(r.state) && nowMs - t(r.createdAt) > FRESH_MS);
  const fallback = receipts.filter((r) => r.telemetry?.clockSource === 'server_fallback');
  const delayed = byNode.cloud_ingest.filter((e) => e.kind === 'delayed').length;
  const receivedMs = [lastReading?.receivedAt, ...receipts.map((r) => r.createdAt)].map(t).filter(Number.isFinite);
  const lastReceived = receivedMs.length ? Math.max(...receivedMs) : null;
  const latestDelayed = lastReading?.receivedAt && t(lastReading.receivedAt) - t(lastReading.ts) > FRESH_MS;
  const ingestStatus = lastReceived === null ? 'unknown' : stuck.length || fallback.length || latestDelayed ? 'warn' : nowMs - lastReceived > OFFLINE_MS ? 'stale' : 'ok';
  mk('cloud_ingest', ingestStatus, {
    lastAt: lastReceived === null ? null : iso(lastReceived), counts: { receipts: receipts.length, delayed, stuck: stuck.length, serverClock: fallback.length },
    note: stuck.length ? `${stuck.length} report${stuck.length === 1 ? ' is' : 's are'} stored but not finished.` : fallback.length ? 'Some reports had no device clock, so server time was used.' : lastReceived === null ? 'Nothing has been received in this window.' : '',
  });
  // 5 Sensor checks
  const open = incidents.filter((i) => ['open', 'acknowledged'].includes(i.status));
  const hot = open.some((i) => ['critical', 'high'].includes(i.severity));
  const latchStatus = open.length ? (hot ? 'critical' : 'warn') : incidents.length ? 'ok' : !lastReading ? 'unknown' : readAge > FRESH_MS ? 'stale' : 'ok';
  mk('rules_latch', latchStatus, {
    counts: { open: open.length, resolved: incidents.length - open.length },
    note: open.length ? 'An incident stays open until a person reviews it, however old the readings are.' : incidents.length ? 'Incidents in this window were closed by a person.' : readAge > FRESH_MS || !lastReading ? 'No incident is latched, but the readings are not current.' : 'No incident is latched.',
    evidence: [...open, ...incidents.filter((i) => !open.includes(i))].slice(0, 5).map((i) => ({ id: `incident:${i._id}`, kind: 'incident', at: iso(i.createdAt || i.detectedAt) })),
  });
  // 6 Device status: a stale critical reading stays critical and is marked last known.
  const level = assessment?.status;
  const lastKnown = Boolean(assessment?.reasons?.some((r) => r.evidence?.some((e) => e.stale)));
  const riskStatus = !assessment ? 'unknown' : level === 'critical' ? 'critical' : ['elevated', 'watch'].includes(level) ? 'warn' : level === 'normal' ? 'ok' : 'unknown';
  mk('risk_ladder', riskStatus, {
    lastAt: assessment?.observedAt || null, counts: { reasons: assessment?.reasons?.filter((r) => r.ruleId !== 'offline').length || 0 }, evidence: (assessment?.reasons || []).flatMap((r) => (r.evidence || []).map((e) => ({ id: e.id || `sensor:${e.sensor}`, kind: 'reading', at: iso(e.observedAt || e.t) }))).filter((e) => e.at).slice(0, 5),
    note: !assessment ? 'The risk level could not be read.' : `Risk level: ${level}${lastKnown ? ', from the last known readings' : ''}${assessment.offline ? '. The box is not reporting now' : ''}.`,
  });
  nodes.risk_ladder.level = level || 'unknown'; nodes.risk_ladder.lastKnown = lastKnown;
  // 7 Operator review
  const acted = byNode.operator_review.filter((e) => e.kind === 'review' || e.kind === 'audit');
  const needs = open.length > 0 || run?.state === 'completed' || ['elevated', 'critical'].includes(level);
  const lastAct = acted.length ? t(acted.at(-1).at) : null;
  const waiting = needs && !(lastAct && lastAct >= Math.max(...open.map((i) => t(i.createdAt || i.detectedAt)), run ? t(run.completedAt || run.createdAt) : 0, 0));
  mk('operator_review', waiting ? 'warn' : acted.length ? 'ok' : 'unknown', {
    counts: { actions: acted.length, modelReviews: run ? 1 : 0 },
    note: waiting ? 'Waiting for a person to review.' : acted.length ? 'A person has acted on this device in this window.' : 'No review is recorded.',
  });
  // 8 Customer updates
  const helpOpen = help && ['review_queued', 'follow_up_assigned', 'help_on_the_way'].includes(help.status);
  const pendingAck = deliveries.filter((m) => m.requiresAck && !['acked', 'expired', 'cancelled'].includes(m.effective));
  const msgStatus = helpOpen || pendingAck.length ? 'warn' : help?.status === 'resolved' || deliveries.some((m) => m.effective === 'acked') ? 'ok' : 'unknown';
  mk('message_help', msgStatus, {
    lastAt: lastOf('message_help') || iso(help?.updatedAt), counts: { messages: deliveries.length, awaitingAck: pendingAck.length, linkedContact: link?.consent === true ? 1 : 0 },
    note: helpOpen ? `Help status: ${HELP_TEXT[help.status]}. A person decides what happens next.` : pendingAck.length ? 'A message is waiting for the household to confirm it.' : deliveries.length || help ? '' : 'No message or help request is recorded.',
  });
  return NODE_IDS.map((id) => nodes[id]);
}

// ---------- conditions ----------
const WHY = {
  water: 'Water at the sensor can mean a leak or flooding nearby. The sensor cannot show how deep it is or where it came from.',
  fire: 'A hot or flame reading can come from the room or a nearby heat source. The sensors do not confirm a fire.',
  power: 'When mains power is off, the box runs on its battery. How long the battery lasts is not known.',
  connectivity: 'A silent box can be offline for many reasons. Silence alone does not show a problem at the home.',
  cold: 'A freezing reading can mean the space is unheated. The sensor does not show what is happening to pipes.',
};
const KEY_SENSORS = ['water_detected', 'water_level_mm', 'temp_c', 'humidity_pct', 'mains_power', 'battery_pct', 'power_mode', 'flame', 'smoke_alarm'];
const SENSOR_ALIAS = { 'power.mains': 'mains_power', main_power_available: 'mains_power', temperature_c: 'temp_c' };

export function buildConditions({ now, latest, assessment, incidents, nodes, siblings, link, help }) {
  const nowMs = now.getTime();
  const level = assessment?.status || 'unknown';
  const open = incidents.filter((i) => ['open', 'acknowledged'].includes(i.status));
  const stale = (r) => nowMs - t(r.ts) > FRESH_MS;
  const newest = Object.values(latest).sort((a, b) => t(b.ts) - t(a.ts))[0];
  const lastKnown = Boolean(assessment?.reasons?.some((r) => r.evidence?.some((e) => e.stale)));
  const kind = { critical: 'A critical condition is on record for this box', elevated: 'This box reported elevated readings', watch: 'This box reported readings worth watching', normal: 'Recent readings from this box are within normal ranges', unknown: 'There is not enough current information about this box' }[level];
  const headline = `${kind}${level === 'critical' && lastKnown ? ' (last known, not confirmed since)' : ''}.`;

  const what = [];
  for (const r of (assessment?.reasons || []).filter((x) => x.ruleId !== 'offline').slice(0, 4)) what.push(r.text.endsWith('.') ? r.text : `${r.text}.`);
  const seenSensors = new Set();
  for (const s of KEY_SENSORS) {
    const r = latest[s]; if (!r) continue;
    seenSensors.add(s);
    if (what.length >= 8) break;
    what.push(`${readingText(s, r.value)}, reported ${agoPhrase(nowMs - t(r.ts))}${stale(r) ? ' (last known)' : ''}.`);
  }
  for (const i of open.slice(0, 3)) what.push(`An incident for ${String(i.type).replace(/_/g, ' ')} has been open since ${iso(i.detectedAt || i.createdAt)?.slice(0, 16).replace('T', ' ')} UTC.`);
  if (!what.length) what.push('No readings have been received from this box.');

  const hazards = new Set((assessment?.reasons || []).map((r) => r.hazard));
  if (open.length) hazards.add('water');
  const why = [...hazards].filter((h) => WHY[h]).map((h) => WHY[h]);
  if (open.length) why.push('An open incident stays open until a person reviews it, however old the readings are.');
  if (!why.length) why.push('No reading on record points to a hazard. That depends on the sensors the box has and what they last reported.');

  const reportAge = newest ? nowMs - t(newest.ts) : null;
  const seen = assessment?.lastSeen ? nowMs - t(assessment.lastSeen) : null;
  const freshness = !newest ? 'No readings have been received.' : `The newest reading arrived ${agoPhrase(reportAge)}${reportAge > FRESH_MS ? ' and is out of date. The state above is the last known one' : ''}.${seen !== null ? ` The box was last heard from ${agoPhrase(seen)}.` : ''}`;

  const unknown = [];
  for (const [s, label] of [['water_detected', 'water'], ['temp_c', 'temperature'], ['mains_power', 'mains power']]) if (!latest[s] && !(s === 'water_detected' && latest.water_level_mm)) unknown.push(`No ${label} reading has been received.`);
  unknown.push('What the box recorded on its own and has not sent.');
  if (nodes.find((n) => n.id === 'gateway_mesh')?.status !== 'warn') unknown.push('Whether the box can reach nearby boxes.');
  unknown.push('What caused these readings.');
  unknown.push('Anything the sensors do not measure, including who is at the home.');

  const next = [];
  if (open.length || ['critical', 'elevated'].includes(level)) next.push('A person should review this box now and decide on a follow-up.');
  if (open.length) next.push('Review the open incident and record the outcome.');
  if (level === 'critical' && lastKnown) next.push('The last known state has not been confirmed. Try to reach the household before relying on it.');
  if (link?.consent === true) next.push('A contact with consent is on file. A person may call them.');
  else if (open.length || ['critical', 'elevated'].includes(level)) next.push('No contact with consent is on file for this box.');
  if (assessment?.offline) next.push('The box is not reporting. Check whether power or internet is out. This is not confirmed.');
  if (help && ['review_queued', 'follow_up_assigned', 'help_on_the_way'].includes(help.status)) next.push(`Help status is ${HELP_TEXT[help.status]}. Keep it up to date.`);
  if (!next.length) next.push(level === 'normal' ? 'These readings suggest no action. Keep watching for new reports.' : 'Wait for the next report, or ask the household to check the box.');

  return { headline, what, why, freshness, unknown, nextSteps: next, advisory: ADVISORY };
}

// ---------- assembly ----------
export async function buildDeviceTimeline(db, { id, exercise = false, hours = LIMITS.defaultHours, now = new Date(), env = {}, demo = false } = {}) {
  if (!isHex24(id)) throw new HttpError(400, 'Invalid device id');
  const scope = await loadScopeDevices(db, { exercise, deviceId: id });
  const d = scope.devices[0];
  if (!d) throw new HttpError(404, 'Device not found');
  const oid = d._id, sid = String(oid), since = new Date(now.getTime() - hours * 3_600_000);
  const inWin = { $gte: since, $lte: now };
  const simulated = exercise ? { simulated: true } : { simulated: { $ne: true } };
  const [readings, lastReading, latestRows, receipts, evs, incidents, logs, deliveries, helpDoc, link, audit, run, siblings, risk] = await Promise.all([
    db.collection('readings').find({ deviceId: oid, ts: inWin }).sort({ ts: -1, _id: -1 }).limit(LIMITS.readings).toArray(),
    db.collection('readings').find({ deviceId: oid, ts: { $lte: now } }).sort({ ts: -1, _id: -1 }).limit(1).toArray(),
    db.collection('readings').aggregate([{ $match: { deviceId: oid, ts: { $lte: now } } }, { $sort: { ts: -1, _id: -1 } }, { $group: { _id: '$sensor', r: { $first: '$$ROOT' } } }, { $limit: 60 }]).toArray(),
    db.collection('ingestion_receipts').find({ deviceId: oid, createdAt: inWin }, { projection: { state: 1, createdAt: 1, 'telemetry.clockSource': 1 } }).sort({ createdAt: -1 }).limit(LIMITS.receipts).toArray(),
    db.collection('events').find({ deviceId: oid, ts: inWin }).sort({ ts: -1 }).limit(LIMITS.events).toArray(),
    db.collection('incidents').find({ deviceId: oid, ...simulated, $or: [{ status: { $in: ['open', 'acknowledged'] } }, { createdAt: { $gte: since } }, { updatedAt: { $gte: since } }] }).sort({ createdAt: -1 }).limit(50).toArray(),
    db.collection('device_logs').find({ ...modeFilter(exercise), deviceId: sid, at: inWin }).sort({ at: -1 }).limit(LIMITS.logs).toArray(),
    db.collection('message_deliveries').find({ deviceId: sid, $or: [{ createdAt: { $gte: since } }, { updatedAt: { $gte: since } }] }).sort({ updatedAt: -1 }).limit(100).toArray(),
    db.collection('device_help').findOne({ _id: withBoth(sid) }),
    db.collection('customer_links').findOne({ deviceId: withBoth(sid), active: true }, { projection: { consent: 1 } }),
    db.collection('audit_log').find({ ...modeFilter(exercise), deviceId: sid, at: inWin }).sort({ at: -1 }).limit(100).toArray(),
    db.collection('system_agent_runs').find({ deviceId: sid, mode: exercise ? 'exercise' : 'live' }, { projection: { state: 1, createdAt: 1, completedAt: 1 } }).sort({ createdAt: -1 }).limit(1).toArray(),
    d.homeId ? db.collection('devices').find({ homeId: d.homeId, _id: { $ne: oid }, disabled: { $ne: true }, 'meta.exercise': exercise ? true : { $ne: true } }, { projection: { lastSeen: 1 } }).limit(8).toArray() : [],
    loadRisk(db, { deviceIds: [sid], exercise, now, env, readOnly: true }).catch(() => null),
  ]);
  const incidentEvents = incidents.length ? await db.collection('incident_events').find({ incidentId: { $in: incidents.map((i) => i._id) }, timestamp: inWin }).sort({ timestamp: -1 }).limit(300).toArray() : [];
  const now2 = now;
  const effective = (m) => (['queued', 'delivered'].includes(m.state) && m.expiresAt && new Date(m.expiresAt) <= now2 ? 'expired' : m.state);
  const dels = deliveries.map((m) => ({ ...m, effective: effective(m) }));
  const assessment = risk?.assessments?.[0] || null;
  const latest = {};
  for (const row of latestRows) { const s = SENSOR_ALIAS[row._id] || row._id; if (!latest[s] || t(row.r.ts) > t(latest[s].ts)) latest[s] = row.r; }

  const all = buildEvents({ readings, receipts, evs, incidents, incidentEvents, logs, deliveries: dels, help: helpDoc, audit, run: run[0] || null, sid });
  const truncated = readings.length >= LIMITS.readings || receipts.length >= LIMITS.receipts || evs.length >= LIMITS.events || logs.length >= LIMITS.logs || all.length > LIMITS.maxEvents;
  const events = all.slice(-LIMITS.maxEvents);
  const nodes = buildNodes({ now, lastReading: lastReading[0] || null, readings, receipts, events: all, incidents, assessment, help: helpDoc, deliveries: dels, run: run[0] || null, siblings, link });
  const conditions = buildConditions({ now, latest, assessment, incidents, nodes, siblings, link, help: helpDoc });
  const ai = nvidiaConfig(env);
  return {
    version: 1, mode: exercise ? 'exercise' : 'live', simulated: exercise, deviceId: sid, generatedAt: now.toISOString(),
    window: { since: since.toISOString(), until: now.toISOString() },
    conditions, nodes, edges: EDGES, events,
    coverage: { truncated, shown: events.length, notRecorded: ['local_record', 'gateway_mesh'] },
    ai: { configured: !demo && ai.configured, model: !demo && ai.configured ? ai.model : null, lastRunId: !demo && run[0] ? String(run[0]._id) : null },
  };
}

// ---------- HTTP ----------
function fail(err) {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  const down = /Mongo|ECONNREFUSED|ETIMEDOUT|Server selection/i.test(`${err?.name} ${err?.message}`);
  console.error('Device timeline failed', err?.name);
  return json({ error: down ? 'Database unavailable' : 'Internal error' }, down ? 503 : 500);
}

export async function opsDeviceTimeline(ctx) {
  try {
    if (ctx.request.method !== 'GET') throw new HttpError(405, `Method ${ctx.request.method} not allowed`);
    const url = new URL(ctx.request.url);
    const auth = opsAuth(ctx, url);
    const id = url.searchParams.get('id');
    let hours = LIMITS.defaultHours;
    if (url.searchParams.has('hours')) {
      const raw = url.searchParams.get('hours');
      if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) throw new HttpError(400, 'hours must be a whole number from 1 to 72');
      hours = Math.min(Number(raw), LIMITS.maxHours);
    }
    return await withDb(ctx.env || {}, ctx.injectedDb, async (db) => {
      let exercise = auth.exercise;
      // An operator who does not say which data set may open either kind of device; a demo account never sees live ones.
      if (!auth.demo && !url.searchParams.has('mode') && isHex24(id)) {
        const live = await loadScopeDevices(db, { exercise: false, deviceId: id });
        exercise = live.devices.length === 0;
      }
      return json(await buildDeviceTimeline(db, { id, exercise, hours, now: ctx.now || new Date(), env: ctx.env || {}, demo: auth.demo }));
    });
  } catch (e) { return fail(e); }
}
