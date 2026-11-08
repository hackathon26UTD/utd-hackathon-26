import { FRESH_MS } from '../domain/system-policy.js';

const when = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const active = value => value === true || value === 1;
const SENSOR_LABELS = {
  mains_power: 'External power', water_detected: 'Water detection', water_raw: 'Raw water reading',
  water_level_mm: 'Water level (mm)', temp_c: 'Temperature (°C)', humidity_pct: 'Humidity (%)',
  flame: 'Flame sensor', flame_raw: 'Raw flame reading', tilt: 'Tilt switch', smoke_alarm: 'Smoke-alarm signal', sound_hits: 'Sound hits', motion: 'Motion sensor',
  battery_pct: 'Reported battery (%)', battery_mv: 'Battery voltage (mV)', battery_v: 'Battery voltage (V)',
  rssi: 'Wi-Fi signal (dBm)', wifi_connected: 'Wi-Fi association', wan_connected: 'Internet connection report',
  api_reachable: 'API reachability', power_mode: 'Reported power mode', queue_depth: 'Queued records', uptime_s: 'Uptime (seconds)',
};
const ACTION_LABELS = {
  review_water_observation: 'Review the water observation', review_power_outage: 'Review the power-loss observation',
  check_connectivity: 'Check device connectivity', check_device_health: 'Check device health',
  request_household_checkin: 'Request a household check-in',
};
const hazardOrder = row => ['flame', 'smoke_alarm', 'water_detected', 'mains_power'].indexOf(row.sensor);
const importantFirst = (a, b) => (hazardOrder(a) < 0 ? 10 : hazardOrder(a)) - (hazardOrder(b) < 0 ? 10 : hazardOrder(b)) || a.sensor.localeCompare(b.sensor);
const criticalReading = row => ['water_detected', 'flame', 'smoke_alarm'].includes(row.sensor) ? active(row.value) :
  row.sensor === 'temp_c' ? typeof row.value === 'number' && row.value >= 55 : row.sensor === 'sound_hits' && typeof row.value === 'number' && row.value >= 6;
const equivalentValue = row => ['water_detected', 'flame', 'smoke_alarm', 'mains_power'].includes(row.sensor) && [true, false, 0, 1].includes(row.value)
  ? active(row.value) : row.value;

/** Evidence-supported action choices. Always internal suggestions, never dispatch or device commands. */
export function reviewActionSupport(evidence, allowedIds = null) {
  const canUse = row => !allowedIds || allowedIds.has(row.id);
  const observations = (evidence.observations || []).filter(canUse);
  const incidents = (evidence.incidents || []).filter(canUse);
  const events = (evidence.events || []).filter(canUse);
  const water = [...observations.filter(row => row.sensor === 'water_detected' && active(row.value)),
    ...incidents.filter(row => row.type === 'flood'), ...events.filter(row => row.type === 'water.detected')].map(row => row.id);
  const power = [...observations.filter(row => row.sensor === 'mains_power' && [false, 0].includes(row.value)),
    ...incidents.filter(row => row.type === 'power_outage'), ...events.filter(row => row.type === 'power.lost')].map(row => row.id);
  return { ...(water.length ? { review_water_observation: water } : {}), ...(power.length ? { review_power_outage: power } : {}),
    check_device_health: [], check_connectivity: [], request_household_checkin: [] };
}

/** Deterministic data-quality checks, not a hazard classifier or a claim of sensor accuracy. */
export function sensorChecks(evidence, { maxItems = 12 } = {}) {
  const now = when(evidence.generatedAt), all = [];
  const fresh = row => row && when(row.observedAt) !== null && now !== null &&
    now - when(row.observedAt) >= 0 && now - when(row.observedAt) <= FRESH_MS;
  for (const device of evidence.devices || []) {
    const latest = device.latest || {}, rows = Object.values(latest).sort(importantFirst);
    const add = (code, status, title, detail, sources = []) => all.push({
      id: `check:${device.id}:${code}`, code, deviceId: device.id, status, title, detail,
      evidenceIds: [...new Set(sources.map(row => row.id))],
      observedAt: sources.map(row => row.observedAt).filter(value => when(value) !== null).sort().at(-1) || null,
      stale: sources.some(row => !fresh(row)),
    });
    // A repeated timestamp with different values is ambiguous; old history does not override the latest reading.
    for (const row of rows) {
      if (when(row.observedAt) === null) continue;
      const other = (evidence.observations || []).filter(candidate => candidate.id !== row.id &&
        candidate.deviceId === device.id && candidate.sensor === row.sensor && candidate.observedAt === row.observedAt &&
        equivalentValue(candidate) !== equivalentValue(row))
        .sort((a, b) => Number(criticalReading(b) !== criticalReading(row)) - Number(criticalReading(a) !== criticalReading(row)))[0];
      if (other) add(`conflicting_${row.sensor}`, 'review', 'Reports disagree at one timestamp',
        `${SENSOR_LABELS[row.sensor] || 'Sensor'} reports contain different values at the latest observation time. Check the source records; neither value resolves the conflict.`, [row, other]);
    }
    const flame = latest.flame, smoke = latest.smoke_alarm;
    if (flame && active(flame.value)) {
      const paired = smoke && when(flame.observedAt) !== null && when(smoke.observedAt) !== null &&
        Math.abs(when(flame.observedAt) - when(smoke.observedAt)) <= FRESH_MS;
      if (paired && active(smoke.value)) add('flame_and_smoke_signals', 'review', 'Two fire-related signals were recorded',
        'Flame and smoke-alarm signals were recorded near the same time. Sensor calibration, current conditions and a fire are not confirmed.', [flame, smoke]);
      else add('flame_needs_corroboration', 'review', 'Flame reading needs a separate check',
        'No contemporaneous positive smoke-alarm signal is recorded here. Missing or negative corroboration does not rule out fire, and a flame module can respond to other infrared sources.', [flame, ...(paired ? [smoke] : [])]);
    }
    const stale = rows.filter(row => !fresh(row));
    if (stale.length) add('stale_latest_readings', 'unknown', 'Latest readings are not current',
      `${stale.length} latest sensor reading(s) are outside the two-minute freshness window or have an invalid observation time. Old alerts remain for review; current conditions are unknown.`, stale.slice(0, 6));
    const delayed = rows.filter(row => when(row.observedAt) !== null && when(row.receivedAt) !== null &&
      when(row.receivedAt) - when(row.observedAt) > FRESH_MS);
    if (delayed.length) add('delayed_delivery', 'context', 'Some readings arrived late',
      `${delayed.length} latest reading(s) arrived more than two minutes after observation. Use observation time to reconstruct the incident.`, delayed.slice(0, 6));
    for (const [sensor, label] of [['mains_power', 'External power'], ['water_detected', 'Water detection']]) {
      if (!latest[sensor]) add(`missing_${sensor}`, 'unknown', `${label} is unverified`,
        `No ${label.toLowerCase()} observation is present in this snapshot. Missing data is not a negative reading.`);
    }
    const wifi = latest.wifi_connected, api = latest.api_reachable, wan = latest.wan_connected;
    if (wifi && active(wifi.value) && (!fresh(api) || !active(api.value)) && (!fresh(wan) || !active(wan.value))) {
      add('wifi_without_verified_uplink', 'unknown', 'Wi-Fi does not confirm internet delivery',
        'A Wi-Fi association reading is present, but neither a fresh successful API nor internet connection report is present. The failure cause is unknown.', [wifi, ...[api, wan].filter(Boolean)]);
    }
  }
  const limit = Math.max(1, Math.min(24, Number.isInteger(maxItems) ? maxItems : 12));
  // Prioritize conflicts/proxy alerts, then freshness gaps, while keeping the target ahead of peers.
  const rank = { review: 0, unknown: 1, context: 2 };
  all.sort((a, b) => rank[a.status] - rank[b.status] || Number(b.deviceId === evidence.targetDeviceId) - Number(a.deviceId === evidence.targetDeviceId) || a.id.localeCompare(b.id));
  return { source: 'deterministic_rules', items: all.slice(0, limit), omittedCount: Math.max(0, all.length - limit),
    note: 'Data-quality checks only. Missing corroboration never clears an alert or proves a home safe.' };
}

const plainValue = value => typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
const limitText = (value, n) => typeof value === 'string' ? value.slice(0, n) : '';

/** An unsent brief built from a validated checkpoint and its immutable allowlisted snapshot. */
export function responderBrief({ evidence, checkpoint, allowedIds = null }) {
  const cited = new Set(checkpoint.evidenceIds || []);
  const ids = new Set([...cited, ...(checkpoint.sensorChecks?.items || []).flatMap(check => check.evidenceIds),
    ...(evidence.incidents || []).map(row => row.id)]);
  const allowed = id => ids.has(id) && (!allowedIds || allowedIds.has(id));
  const facts = [];
  const push = fact => { if (allowed(fact.id)) facts.push({ ...fact, citedByModel: cited.has(fact.id) }); };
  for (const row of evidence.incidents || []) push({ id: row.id, kind: 'incident', deviceId: row.deviceId,
    label: `Unresolved ${row.type} incident`, value: `${row.severity}; ${row.status}`,
    observedAt: row.lastObservedAt || row.detectedAt || null, receivedAt: null,
    stale: when(row.lastObservedAt || row.detectedAt) === null || when(evidence.generatedAt) - when(row.lastObservedAt || row.detectedAt) > FRESH_MS });
  for (const row of evidence.observations || []) push({ id: row.id, kind: 'reading', deviceId: row.deviceId,
    label: SENSOR_LABELS[row.sensor] || 'Recorded sensor', value: row.value,
    observedAt: row.observedAt, receivedAt: row.receivedAt || null, stale: row.stale === true, delayed: row.delayed === true });
  for (const row of evidence.events || []) push({ id: row.id, kind: 'event', deviceId: row.deviceId,
    label: row.type, observedAt: row.observedAt || null, receivedAt: row.receivedAt || null,
    stale: when(row.observedAt) === null || when(evidence.generatedAt) - when(row.observedAt) > FRESH_MS });
  for (const source of checkpoint.externalContext?.sources || []) for (const record of source.records || []) {
    push({ id: record.id, kind: 'context', deviceId: null, label: `Cached public context: ${source.id}`,
      observedAt: null, receivedAt: source.fetchedAt || null, stale: source.stale === true });
  }
  facts.sort((a, b) => Number(b.kind === 'incident') - Number(a.kind === 'incident') ||
    Number(b.citedByModel) - Number(a.citedByModel) || Number(b.deviceId === evidence.targetDeviceId) - Number(a.deviceId === evidence.targetDeviceId) ||
    (when(b.observedAt) || 0) - (when(a.observedAt) || 0));
  const unknowns = [...new Set((checkpoint.sensorChecks?.items || []).filter(item => item.status === 'unknown').map(item => item.detail))];
  if (checkpoint.budget?.basis === 'unknown') unknowns.push('Battery runtime is unknown: usable energy and profile power draw have not been supplied.');
  unknowns.push('Occupancy, safe entry and damage extent are not established by these records.');
  const limitations = [
    'Draft for human review. No responder was dispatched, no message was sent and no hardware setting was changed.',
    'Model interpretation is unverified. Sensor proxy alerts and co-occurrence do not establish a fire, flood depth or cause.',
    'This is a bounded snapshot. Regional weather is context, not proof of conditions at this home.',
  ];
  if (checkpoint.modelCoverage?.observationsOmitted || checkpoint.modelCoverage?.eventsOmitted || evidence.devicesTruncated) {
    limitations.push('Some older records or peer devices were omitted from model input; review the full recorded timeline when needed.');
  }
  const maxFacts = 24;
  if (facts.length > maxFacts) limitations.push(`${facts.length - maxFacts} additional cited/check records are not repeated in this brief.`);
  const brief = { version: 1, title: 'Home review brief', deviceId: evidence.targetDeviceId, mode: evidence.mode,
    sourceGeneratedAt: evidence.generatedAt, status: 'pending_review', facts: facts.slice(0, maxFacts), unknowns,
    interpretation: { source: checkpoint.interpretationSource || 'model_unverified', text: limitText(checkpoint.interpretation, 1200) },
    nextAction: { code: checkpoint.nextAction, label: ACTION_LABELS[checkpoint.nextAction] || 'Review recorded evidence' },
    limitations, messagesSent: false, hardwareApplied: false };
  brief.text = [
    'SAFE HOME — HOME REVIEW BRIEF', 'Pending human review', `Device: ${brief.deviceId}`, `Data mode: ${brief.mode}`,
    `Snapshot: ${brief.sourceGeneratedAt}`, '', 'RECORDED FACTS',
    ...brief.facts.map(fact => `- ${fact.label}${fact.value !== undefined ? ': ' + plainValue(fact.value) : ''}; observed ${fact.observedAt || 'unknown'}; received ${fact.receivedAt || 'unknown'}${fact.stale ? '; stale/unknown observation time' : ''}${fact.delayed ? '; delayed delivery' : ''} [${fact.id}]`),
    '', brief.interpretation.source === 'simulator_not_ai' ? 'SIMULATOR OUTPUT — NOT AI' : 'NEMOTRON INTERPRETATION — UNVERIFIED', brief.interpretation.text,
    '', 'UNKNOWNS', ...unknowns.map(line => '- ' + line), '', 'PROPOSED NEXT ACTION', brief.nextAction.label,
    '', 'LIMITATIONS', ...limitations.map(line => '- ' + line),
  ].join('\n');
  return brief;
}
