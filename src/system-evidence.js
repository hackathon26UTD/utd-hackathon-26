import { ObjectId } from 'mongodb';
import { badRequest, notFound } from './http.js';
import { devicePolicy, FRESH_MS } from '../domain/system-policy.js';

// All model-visible fields are allowlisted. No names, addresses, credentials, notes or arbitrary metadata.
export const SENSORS = ['mains_power', 'power.mains', 'water_detected', 'water_raw', 'water_level_mm', 'temp_c',
  'humidity_pct', 'flame', 'flame_raw', 'tilt', 'smoke_alarm', 'sound_hits', 'motion', 'battery_pct', 'battery_mv', 'battery_v',
  'rssi', 'wifi_connected', 'wan_connected', 'api_reachable', 'power_mode', 'queue_depth', 'uptime_s'];
const EVENT_TYPES = ['power.lost', 'power.restored', 'water.detected', 'water.cleared', 'help.request', 'ok.report',
  'alarm.sound', 'flame.detected', 'box.boot', 'box_b.silent', 'power.policy'];
const iso = d => d && Number.isFinite(new Date(d).getTime()) ? new Date(d).toISOString() : null;
const ID = /^[a-f\d]{24}$/i;
const modeMatch = exercise => ({ 'meta.exercise': exercise ? true : { $ne: true } });
const MAX_DEVICES = 8, HISTORY_LIMIT = 200;
const safeValue = r => typeof r.value === 'boolean' || (typeof r.value === 'number' && Number.isFinite(r.value)) ||
  (r.sensor === 'power_mode' && ['normal', 'saver', 'critical'].includes(r.value));

export async function loadSystemEvidence(db, { deviceId, exercise = false, now = new Date(), hours = 6 }) {
  if (!ID.test(deviceId || '')) throw badRequest('deviceId must be a registered device id');
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw badRequest('hours must be 1 to 24');
  const target = await db.collection('devices').findOne({ _id: new ObjectId(deviceId), disabled: { $ne: true }, ...modeMatch(exercise) },
    { projection: { _id: 1, homeId: 1, lastSeen: 1 } });
  if (!target) throw notFound('Device not found in this data mode');
  const siblings = target.homeId ? await db.collection('devices').find({ _id: { $ne: target._id }, homeId: target.homeId,
    disabled: { $ne: true }, ...modeMatch(exercise) }, { projection: { _id: 1, homeId: 1, lastSeen: 1 } }).sort({ _id: 1 }).limit(MAX_DEVICES).toArray() : [];
  const selected = [target, ...siblings.slice(0, MAX_DEVICES - 1)];
  const since = new Date(now.getTime() - hours * 3600_000);
  const observations = [], events = [], incidents = [], devices = [];
  const coverage = [];
  for (const device of selected) {
    const id = String(device._id);
    const match = { deviceId: device._id, sensor: { $in: SENSORS }, ts: { $lte: now } };
    // Latest per sensor is independent of the bounded history, so busy sensors cannot hide a stale one.
    const latestRows = await db.collection('readings').aggregate([
      { $match: match }, { $sort: { ts: -1, _id: -1 } }, { $group: { _id: '$sensor', reading: { $first: '$$ROOT' } } },
    ], { maxTimeMS: 5000 }).toArray();
    // Preserve an opposing critical/power reading at the exact latest timestamp even when
    // the bounded history is full. Do not arbitrarily declare a tied false/true reading authoritative.
    const conflictQueries = latestRows.map(({ reading: r }) => {
      let value;
      if (['mains_power', 'power.mains', 'water_detected', 'flame', 'smoke_alarm'].includes(r.sensor)) {
        value = { $in: r.value === true || r.value === 1 ? [false, 0] : [true, 1] };
      } else if (r.sensor === 'temp_c') value = typeof r.value === 'number' && r.value >= 55 ? { $lt: 55 } : { $gte: 55 };
      else if (r.sensor === 'sound_hits') value = typeof r.value === 'number' && r.value >= 6 ? { $lt: 6 } : { $gte: 6 };
      return value ? { sensor: r.sensor, ts: r.ts, value } : null;
    }).filter(Boolean);
    const conflictingRows = conflictQueries.length ? await db.collection('readings').aggregate([
      { $match: { deviceId: device._id, $or: conflictQueries } }, { $sort: { _id: -1 } },
      { $group: { _id: '$sensor', reading: { $first: '$$ROOT' } } },
    ], { maxTimeMS: 5000 }).toArray() : [];
    const history = await db.collection('readings').find({ ...match, ts: { $gte: since, $lte: now } },
      { projection: { _id: 1, sensor: 1, value: 1, ts: 1, receivedAt: 1 } }).sort({ ts: -1, _id: -1 }).limit(HISTORY_LIMIT + 1).toArray();
    const latest = {};
    const rows = [...latestRows.map(x => x.reading), ...conflictingRows.map(x => x.reading), ...history.slice(0, HISTORY_LIMIT)];
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(String(r._id)) || !safeValue(r) || !iso(r.ts)) continue;
      seen.add(String(r._id));
      const sensor = r.sensor === 'power.mains' ? 'mains_power' : r.sensor;
      const observedAt = iso(r.ts), receivedAt = iso(r.receivedAt);
      const observation = { id: `reading:${r._id}`, deviceId: id, sensor, value: r.value, observedAt, receivedAt,
        stale: now.getTime() - Date.parse(observedAt) > FRESH_MS,
        delayed: receivedAt ? Date.parse(receivedAt) - Date.parse(observedAt) > FRESH_MS : null };
      observations.push(observation);
      if (!latest[sensor] || observedAt > latest[sensor].observedAt) latest[sensor] = observation;
    }
    const active = await db.collection('incidents').find({ deviceId: device._id, status: { $in: ['open', 'acknowledged'] },
      ...(exercise ? { simulated: true } : { simulated: { $ne: true } }) }).sort({ detectedAt: -1 }).limit(21).toArray();
    incidents.push(...active.slice(0, 20).map(i => ({ id: `incident:${i._id}`, deviceId: id,
      type: ['flood', 'power_outage', 'high_temperature'].includes(i.type) ? i.type : 'other',
      severity: ['critical', 'high', 'medium', 'low'].includes(i.severity) ? i.severity : 'unknown',
      status: i.status, detectedAt: iso(i.detectedAt), lastObservedAt: iso(i.lastObservedAt) })));
    const historyEvents = await db.collection('events').find({ deviceId: device._id, type: { $in: EVENT_TYPES }, ts: { $gte: since, $lte: now } })
      .sort({ ts: -1 }).limit(51).toArray();
    events.push(...historyEvents.slice(0, 50).map(e => ({ id: `event:${e._id}`, deviceId: id, type: e.type,
      // Older firmware stores event observation time inside data; ts is receipt time.
      observedAt: iso(e.data?.observed_at), receivedAt: iso(e.ts) })));
    const latchedCritical = await db.collection('incidents').findOne({ deviceId: device._id,
      status: { $in: ['open', 'acknowledged'] }, severity: { $in: ['critical', 'high'] },
      ...(exercise ? { simulated: true } : { simulated: { $ne: true } }) }, { projection: { _id: 1 } });
    // Offline replay can arrive out of order. An old OK upload must not supersede a newer help observation.
    const [latestHelp] = await db.collection('events').aggregate([
      { $match: { deviceId: device._id, type: { $in: ['help.request', 'ok.report'] }, ts: { $lte: now } } },
      { $set: { observationOrder: { $convert: { input: '$data.observed_at', to: 'date', onError: '$ts', onNull: '$ts' } } } },
      { $match: { observationOrder: { $lte: now } } }, { $sort: { observationOrder: -1, ts: -1, _id: -1 } }, { $limit: 1 },
    ], { maxTimeMS: 5000 }).toArray();
    if (latestHelp && !events.some(e => e.id === `event:${latestHelp._id}`)) events.push({ id: `event:${latestHelp._id}`,
      deviceId: id, type: latestHelp.type, observedAt: iso(latestHelp.data?.observed_at), receivedAt: iso(latestHelp.ts) });
    const opposing = observations.filter(o => o.deviceId === id && o.observedAt === latest[o.sensor]?.observedAt && o.value !== latest[o.sensor]?.value);
    const criticalReading = o => ['water_detected', 'flame', 'smoke_alarm'].includes(o.sensor) ? o.value === true || o.value === 1 :
      o.sensor === 'temp_c' ? typeof o.value === 'number' && o.value >= 55 : o.sensor === 'sound_hits' && typeof o.value === 'number' && o.value >= 6;
    const mainsValue = v => v === true || v === 1 ? true : v === false || v === 0 ? false : null;
    const mainsObservationConflict = opposing.some(o => o.sensor === 'mains_power' && mainsValue(o.value) !== null &&
      mainsValue(latest.mains_power.value) !== null && mainsValue(o.value) !== mainsValue(latest.mains_power.value));
    const criticalObservationConflict = opposing.some(o => criticalReading(o) || criticalReading(latest[o.sensor]));
    devices.push({ id, homeId: target.homeId ? String(target.homeId) : null, lastReceivedAt: iso(device.lastSeen), latest,
      ...(mainsObservationConflict ? { mainsObservationConflict: true } : {}),
      ...(criticalObservationConflict ? { criticalObservationConflict: true } : {}),
      helpObservation: latestHelp ? { evidenceId: `event:${latestHelp._id}`, type: latestHelp.type,
        observedAt: iso(latestHelp.data?.observed_at), receivedAt: iso(latestHelp.ts) } : null,
      latchedCritical: Boolean(latchedCritical) || latestHelp?.type === 'help.request' });
    coverage.push({ deviceId: id, historyTruncated: history.length > HISTORY_LIMIT, eventsTruncated: historyEvents.length > 50, incidentsTruncated: active.length > 20 });
  }
  observations.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
  const graph = {
    nodes: [ ...(target.homeId ? [{ id: `home:${target.homeId}`, type: 'home' }] : []),
      ...devices.map(d => ({ id: `device:${d.id}`, type: 'device' })),
      ...observations.map(o => ({ id: o.id, type: 'observation' })), ...incidents.map(i => ({ id: i.id, type: 'incident' })) ],
    edges: [ ...devices.filter(d => d.homeId).map(d => ({ from: `device:${d.id}`, to: `home:${d.homeId}`, relation: 'installed_at' })),
      ...observations.map(o => ({ from: `device:${o.deviceId}`, to: o.id, relation: 'reported' })),
      ...incidents.map(i => ({ from: `device:${i.deviceId}`, to: i.id, relation: 'has_unresolved_incident' })) ],
  };
  return { version: 1, mode: exercise ? 'exercise' : 'live', generatedAt: now.toISOString(), targetDeviceId: deviceId,
    window: { since: since.toISOString(), until: now.toISOString() }, devices, observations, events, incidents, graph,
    policies: devices.map(d => devicePolicy(d, now)), coverage, devicesTruncated: siblings.length >= MAX_DEVICES,
    scope: 'One device and up to seven devices at the same home. Bounded history; co-occurrence does not prove causation. Missing observations are unknown.' };
}

export function correlateSignals(evidence) {
  const relations = [];
  for (const d of evidence.devices) {
    const water = d.latest.water_detected, power = d.latest.mains_power;
    if (water?.value === true && (power?.value === false || power?.value === 0) &&
      Math.abs(Date.parse(water.observedAt) - Date.parse(power.observedAt)) <= FRESH_MS) {
      relations.push({ type: 'water_and_power_loss_observed_together', deviceId: d.id,
        evidenceIds: [water.id, power.id], stale: water.stale || power.stale,
        conclusion: 'Co-occurring observations. They do not establish the cause, flood depth, occupancy or current safety.' });
    }
    if (d.latest.wifi_connected?.value === true && d.latest.api_reachable?.value === false) {
      const a = d.latest.wifi_connected, b = d.latest.api_reachable;
      if (Math.abs(Date.parse(a.observedAt) - Date.parse(b.observedAt)) <= FRESH_MS) relations.push({ type: 'wifi_without_confirmed_api',
        deviceId: d.id, evidenceIds: [a.id, b.id], stale: a.stale || b.stale,
        conclusion: 'Wi-Fi association does not prove internet access; the cause of API failure is unverified.' });
    }
  }
  return { relations, unresolvedIncidents: evidence.incidents, coverage: evidence.coverage };
}
