import { FRESH_MS } from '../domain/system-policy.js';

export const FLEET_DEVICE_LIMIT = 240;
export const FLEET_HOME_LIMIT = 12;
const SENSORS = ['mains_power', 'power.mains', 'water_detected', 'flame', 'smoke_alarm', 'wifi_connected', 'api_reachable', 'battery_pct'];
const iso = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const modeMatch = exercise => ({ disabled: { $ne: true }, 'meta.exercise': exercise ? true : { $ne: true } });
const ID = /^[a-f\d]{24}$/i;
const CONDITION_SENSORS = new Set(['mains_power', 'water_detected', 'flame', 'smoke_alarm']);
const staleAt = (at, now) => !at || now.getTime() - Date.parse(at) > FRESH_MS;
const truth = value => value === true || value === 1;
const falsehood = value => value === false || value === 0;
const binary = value => truth(value) || falsehood(value);
const valueClass = (sensor, value) => sensor === 'battery_pct' ? 'battery' : truth(value) ? 'positive' : falsehood(value) ? 'negative' : 'invalid';
const rowsOf = d => Object.values(d.latestTies).flat();
const sensorRows = (d, sensor) => d.latestTies[sensor] || [];
const conflicting = rows => new Set(rows.filter(r => binary(r.value)).map(r => truth(r.value))).size > 1;
const PRIORITIES = ['urgent_review', 'observation_review', 'visibility_review', 'routine_review'];
const LABELS = ['Review first', 'Review observation', 'Restore visibility', 'Routine review'];
export const FLEET_POLICY = 'Human review order: unresolved help or high/critical incidents, then recorded alarm/water/power concerns, then missing or stale observations, then other reporting homes. This is not a damage, safety, occupancy or dispatch decision. When the device scan is partial, this is only a shortlist within that scan.';

// Bounded server snapshot. Only allowlisted numeric/boolean readings and fixed event/incident categories leave this module.
export async function loadFleetReview(db, { exercise = false, now = new Date() } = {}) {
  const match = modeMatch(exercise);
  const [totalDevices, devices] = await Promise.all([
    db.collection('devices').countDocuments(match, { maxTimeMS: 5000 }),
    db.collection('devices').find(match, { projection: { _id: 1, homeId: 1, lastSeen: 1 } }).sort({ _id: 1 }).limit(FLEET_DEVICE_LIMIT).toArray(),
  ]);
  if (!devices.length) return buildFleetReview({ devices, readings: [], incidents: [], helps: [], totalDevices, exercise, now });
  const ids = devices.map(d => d._id);
  const [latest, incidents, helps] = await Promise.all([
    db.collection('readings').aggregate([
      { $match: { deviceId: { $in: ids }, sensor: { $in: SENSORS }, ts: { $lte: now } } },
      { $set: { sensor: { $cond: [{ $eq: ['$sensor', 'power.mains'] }, 'mains_power', '$sensor'] } } },
      { $setWindowFields: { partitionBy: { deviceId: '$deviceId', sensor: '$sensor' }, sortBy: { ts: -1 }, output: { latestTs: { $max: '$ts', window: { documents: ['unbounded', 'unbounded'] } } } } },
      { $match: { $expr: { $eq: ['$ts', '$latestTs'] } } },
      { $set: { valueClass: { $cond: [{ $eq: ['$sensor', 'battery_pct'] }, 'battery', { $switch: { branches: [
        { case: { $in: ['$value', [true, 1]] }, then: 'positive' }, { case: { $in: ['$value', [false, 0]] }, then: 'negative' },
      ], default: 'invalid' } }] } } },
      { $sort: { _id: -1 } },
      { $group: { _id: { deviceId: '$deviceId', sensor: '$sensor', valueClass: '$valueClass' }, row: { $first: '$$ROOT' }, count: { $sum: 1 } } },
      { $replaceRoot: { newRoot: { $mergeObjects: ['$row', { latestClassCount: '$count' }] } } },
      { $project: { _id: 1, deviceId: 1, sensor: 1, value: 1, ts: 1, receivedAt: 1, latestClassCount: 1 } },
    ], { maxTimeMS: 5000 }).toArray(),
    db.collection('incidents').aggregate([
      { $match: { deviceId: { $in: ids }, status: { $in: ['open', 'acknowledged'] }, simulated: exercise ? true : { $ne: true } } },
      { $set: { criticalSort: { $cond: [{ $in: ['$severity', ['critical', 'high']] }, 1, 0] } } },
      { $sort: { criticalSort: -1, detectedAt: 1, _id: 1 } },
      { $group: { _id: '$deviceId', count: { $sum: 1 }, row: { $first: '$$ROOT' } } },
      { $project: { _id: 1, count: 1, 'row._id': 1, 'row.deviceId': 1, 'row.type': 1, 'row.severity': 1, 'row.status': 1, 'row.detectedAt': 1, 'row.lastObservedAt': 1 } },
    ], { maxTimeMS: 5000 }).toArray(),
    db.collection('events').aggregate([
      { $match: { deviceId: { $in: ids }, type: { $in: ['help.request', 'ok.report'] }, ts: { $lte: now } } },
      { $set: { observationOrder: { $convert: { input: '$data.observed_at', to: 'date', onError: '$ts', onNull: '$ts' } } } },
      { $match: { observationOrder: { $lte: now } } },
      { $setWindowFields: { partitionBy: '$deviceId', sortBy: { observationOrder: -1 }, output: { latestObservationOrder: { $max: '$observationOrder', window: { documents: ['unbounded', 'unbounded'] } } } } },
      { $match: { $expr: { $eq: ['$observationOrder', '$latestObservationOrder'] } } },
      { $sort: { ts: -1, _id: -1 } },
      { $group: { _id: { deviceId: '$deviceId', type: '$type' }, row: { $first: '$$ROOT' } } }, { $replaceRoot: { newRoot: '$row' } },
      { $project: { _id: 1, deviceId: 1, type: 1, ts: 1, 'data.observed_at': 1 } },
    ], { maxTimeMS: 5000 }).toArray(),
  ]);
  return buildFleetReview({ devices, readings: latest, incidents, helps, totalDevices, exercise, now });
}

export function buildFleetReview({ devices, readings, incidents, helps, totalDevices = devices.length, exercise = false, now = new Date() }) {
  const byDevice = new Map(devices.map(d => [String(d._id), { id: String(d._id), homeId: ID.test(String(d.homeId || '')) ? String(d.homeId) : null, latest: {}, latestTies: {}, latestCounts: {}, incidents: [], help: null, helpTies: [], helpAt: null, incidentCount: 0 }]));
  for (const r of readings) {
    const d = byDevice.get(String(r.deviceId));
    const at = iso(r.ts);
    if (!d || !SENSORS.includes(r.sensor) || !at || Date.parse(at) > now.getTime() || !(typeof r.value === 'boolean' || typeof r.value === 'number' && Number.isFinite(r.value))) continue;
    const sensor = r.sensor === 'power.mains' ? 'mains_power' : r.sensor;
    const row = { id: `reading:${r._id}`, kind: 'reading', deviceId: d.id, sensor, value: r.value, observedAt: at, receivedAt: iso(r.receivedAt), stale: staleAt(at, now) };
    if (!d.latest[sensor] || at > d.latest[sensor].observedAt) { d.latest[sensor] = row; d.latestTies[sensor] = []; d.latestCounts[sensor] = 0; }
    if (at !== d.latest[sensor].observedAt) continue;
    d.latestCounts[sensor] += Number.isSafeInteger(r.latestClassCount) && r.latestClassCount > 0 ? r.latestClassCount : 1;
    const group = d.latestTies[sensor], index = group.findIndex(other => valueClass(sensor, other.value) === valueClass(sensor, row.value));
    if (index === -1) group.push(row); else if (row.id > group[index].id) group[index] = row;
    if (row.id > d.latest[sensor].id) d.latest[sensor] = row;
  }
  for (const group of incidents) {
    const r = group.row, d = byDevice.get(String(group._id));
    if (!d || !r || !['open', 'acknowledged'].includes(r.status)) continue;
    const at = iso(r.lastObservedAt || r.detectedAt);
    d.incidentCount = group.count;
    d.incidents.push({ id: `incident:${r._id}`, kind: 'incident', deviceId: d.id,
      type: ['flood', 'power_outage', 'high_temperature'].includes(r.type) ? r.type : 'other',
      severity: ['critical', 'high', 'medium', 'low'].includes(r.severity) ? r.severity : 'unknown', status: r.status,
      observedAt: at && Date.parse(at) <= now.getTime() ? at : null, stale: staleAt(at, now) || Date.parse(at) > now.getTime() });
  }
  for (const r of helps) {
    const d = byDevice.get(String(r.deviceId));
    if (!d || !['help.request', 'ok.report'].includes(r.type)) continue;
    const observedAt = iso(r.data?.observed_at), receivedAt = iso(r.ts);
    const at = observedAt || receivedAt;
    if (!at || Date.parse(at) > now.getTime()) continue;
    const help = { id: `event:${r._id}`, kind: 'event', deviceId: d.id, type: r.type, observedAt, receivedAt,
      stale: staleAt(at, now), observationTimeKnown: Boolean(observedAt) };
    if (!d.helpAt || at > d.helpAt) { d.helpAt = at; d.helpTies = []; }
    if (at !== d.helpAt) continue;
    const index = d.helpTies.findIndex(other => other.type === help.type);
    if (index === -1) d.helpTies.push(help); else if (help.id > d.helpTies[index].id) d.helpTies[index] = help;
    d.help = d.helpTies.find(h => h.type === 'help.request') || d.helpTies[0];
  }
  const homes = new Map();
  for (const d of byDevice.values()) {
    const id = d.homeId ? `home:${d.homeId}` : `device:${d.id}`;
    if (!homes.has(id)) homes.set(id, []);
    homes.get(id).push(d);
  }
  const all = [...homes.entries()].map(([id, ds]) => {
    const evidence = ds.flatMap(d => [...rowsOf(d), ...d.incidents, ...d.helpTies]);
    const reasons = [];
    const add = (code, label, rows) => { if (rows.length) reasons.push({ code, label, evidenceIds: rows.map(r => r.id) }); };
    add('help_request', 'Latest check-in event requests help; needs human follow-up.', ds.filter(d => d.help?.type === 'help.request').map(d => d.help));
    add('unresolved_critical', 'An unresolved high or critical incident remains open, including when readings are old.', ds.flatMap(d => d.incidents).filter(i => ['high', 'critical'].includes(i.severity)));
    add('unresolved_incident', 'An unresolved incident needs review.', ds.flatMap(d => d.incidents).filter(i => !['high', 'critical'].includes(i.severity)));
    add('water_observation', 'The latest water observation is positive; check its timestamp.', ds.flatMap(d => sensorRows(d, 'water_detected')).filter(r => r && truth(r.value)));
    add('alarm_proxy', 'A flame or smoke-alarm signal was recorded; it does not establish a confirmed fire.', ds.flatMap(d => [...sensorRows(d, 'flame'), ...sensorRows(d, 'smoke_alarm')]).filter(r => r && truth(r.value)));
    add('power_observation', 'The latest external-power observation reports loss; check its timestamp.', ds.flatMap(d => sensorRows(d, 'mains_power')).filter(r => r && falsehood(r.value)));
    add('connectivity_observation', 'The latest API reachability observation reports failure; the cause is unknown.', ds.flatMap(d => sensorRows(d, 'api_reachable')).filter(r => r && falsehood(r.value)));
    const conflicts = ds.flatMap(d => Object.values(d.latestTies).filter(conflicting).flat());
    add('conflicting_latest_readings', 'Different values share the latest observation time. Resolve the conflict; no value silently overrides another.', conflicts);
    const invalid = ds.flatMap(rowsOf).filter(r => r.sensor !== 'battery_pct' && !binary(r.value));
    add('unsupported_binary_value', 'A binary sensor reported a value other than true/false or 0/1. Its condition is unknown.', invalid);
    const helpConflicts = ds.filter(d => d.helpTies.length > 1).flatMap(d => d.helpTies);
    add('conflicting_checkins', 'Help and OK share the latest observation time. Keep the help request for human review.', helpConflicts);
    const fresh = evidence.filter(r => r.kind === 'reading' && CONDITION_SENSORS.has(r.sensor) && binary(r.value) && !r.stale);
    const missingDevices = ds.filter(d => !rowsOf(d).some(r => CONDITION_SENSORS.has(r.sensor) && binary(r.value) && !r.stale));
    if (missingDevices.length) reasons.push({ code: 'missing_fresh_observations', label: 'One or more devices have no fresh condition observations. Current conditions are unknown.', affectedDevices: missingDevices.length, evidenceIds: missingDevices.flatMap(d => rowsOf(d).map(r => r.id)) });
    const unknowns = [];
    if (conflicts.length || helpConflicts.length) unknowns.push('Conflicting latest observations remain unresolved.');
    if (invalid.length) unknowns.push('Unsupported binary values cannot establish sensor conditions.');
    if (missingDevices.length) unknowns.push('Stale or absent readings do not establish current conditions.');
    if (ds.some(d => !d.latest.mains_power || d.latest.mains_power.stale || !binary(d.latest.mains_power.value) || conflicting(sensorRows(d, 'mains_power')))) unknowns.push('Current external power is unknown for one or more devices.');
    if (ds.some(d => !d.latest.api_reachable || d.latest.api_reachable.stale || !binary(d.latest.api_reachable.value) || conflicting(sensorRows(d, 'api_reachable')))) unknowns.push('Current internet/API reachability is unverified for one or more devices.');
    if (ds.some(d => d.help && !d.help.observationTimeKnown)) unknowns.push('A check-in event has receipt time only; its observation time is unknown.');
    unknowns.push('Occupancy, evacuation, damage and safe entry are not established by these records.');
    const urgent = reasons.some(r => ['help_request', 'unresolved_critical'].includes(r.code));
    const concern = reasons.some(r => ['unresolved_incident', 'water_observation', 'alarm_proxy', 'power_observation', 'conflicting_latest_readings', 'unsupported_binary_value'].includes(r.code));
    const priorityIndex = urgent ? 0 : concern ? 1 : missingDevices.length || reasons.some(r => r.code === 'connectivity_observation') ? 2 : 3;
    if (!reasons.length) reasons.push({ code: 'no_current_trigger', label: 'No listed review trigger in the available readings; this is not a safety assessment.', evidenceIds: fresh.map(r => r.id) });
    const sorted = evidence.sort((a, b) => (a.kind === 'incident' || a.type === 'help.request' ? 0 : 1) - (b.kind === 'incident' || b.type === 'help.request' ? 0 : 1) || (a.observedAt || a.receivedAt || '').localeCompare(b.observedAt || b.receivedAt || '') || a.id.localeCompare(b.id));
    const dates = evidence.filter(r => r.kind === 'reading' && r.observedAt).map(r => r.observedAt).sort();
    const conditionDates = evidence.filter(r => r.kind === 'reading' && CONDITION_SENSORS.has(r.sensor) && binary(r.value) && r.observedAt).map(r => r.observedAt).sort();
    return { id, homeId: ds[0].homeId, deviceId: ds[0].id, deviceIds: ds.map(d => d.id), label: `${ds[0].homeId ? 'Home' : 'Device'} ${id.slice(-6)}`,
      priority: PRIORITIES[priorityIndex], priorityLabel: LABELS[priorityIndex], reasons, unknowns, evidence: sorted,
      lastObservedAt: dates.at(-1) || null, lastConditionObservedAt: conditionDates.at(-1) || null, staleEvidenceCount: evidence.filter(r => r.stale).length,
      coverage: { deviceCount: ds.length, evidenceReturned: sorted.length, evidenceOmitted: ds.reduce((n, d) => n + Math.max(0, d.incidentCount - d.incidents.length) + Object.entries(d.latestCounts).reduce((sum, [sensor, count]) => sum + Math.max(0, count - sensorRows(d, sensor).length), 0), 0), incidentCount: ds.reduce((n, d) => n + d.incidentCount, 0) } };
  }).sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.id.localeCompare(b.id));
  const queue = all.slice(0, FLEET_HOME_LIMIT).map((item, i) => ({ ...item, rank: i + 1 }));
  return { version: 1, mode: exercise ? 'exercise' : 'live', generatedAt: now.toISOString(), queue,
    coverage: { devicesExamined: devices.length, totalDevices, homesExamined: homes.size, homesReturned: queue.length, homesOmitted: Math.max(0, homes.size - queue.length), devicesOmitted: Math.max(0, totalDevices - devices.length), partial: totalDevices > devices.length || homes.size > queue.length, scanComplete: totalDevices <= devices.length, shortlistComplete: homes.size <= queue.length,
      deviceScanLimit: FLEET_DEVICE_LIMIT, homeShortlistLimit: FLEET_HOME_LIMIT, scanOrder: 'registered device id; priority order applies only within the examined devices', readingDetail: 'Latest timestamp: one representative per positive, negative or unsupported binary class; one battery value. Duplicate or additional values are counted as omitted.', incidentDetail: 'Highest-priority unresolved incident per device; additional incident counts are included.' }, policy: FLEET_POLICY };
}
