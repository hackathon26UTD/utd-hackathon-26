import { HttpError } from './http.js';
import { correlateSignals } from './system-evidence.js';
import { powerBudget } from '../domain/system-policy.js';

// A conservative transport budget, not an exact tokenizer count. The caller also
// bounds the complete conversation before every model call.
export const MODEL_REQUEST_CHARS = 16000;
export const MODEL_CONVERSATION_RESERVE_CHARS = 2000;
export const MODEL_AGENT_PACK_TOKENS = 1200;

const time = value => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const order = row => time(row.observedAt || row.detectedAt) ?? time(row.receivedAt) ?? 0;
const latestBy = (rows, key) => {
  const result = new Map();
  for (const row of rows) if (!result.has(key(row)) || order(row) > order(result.get(key(row)))) result.set(key(row), row);
  return [...result.values()];
};

/** Model-only projection. Source snapshots and deterministic policy objects are not changed. */
export function prepareModelEvidence({ evidence, externalContext, budget, goalHours = 24, maxChars = 6000 }) {
  evidence = { devices: [], ...evidence };
  const relations = correlateSignals(evidence);
  const policies = { policies: evidence.policies, budget: powerBudget(evidence.policies, budget, goalHours) };
  const devices = evidence.devices.map(d => ({ id: d.id, homeId: d.homeId ?? null,
    lastReceivedAt: d.lastReceivedAt ?? null, latchedCritical: d.latchedCritical === true,
    helpObservation: d.helpObservation ?? null }));
  const indexes = new Map(devices.map((d, i) => [d.id, i]));
  const origin = time(evidence.generatedAt);
  const offset = value => time(value) === null || origin === null ? null : time(value) - origin;
  const byId = new Map(evidence.observations.map(o => [o.id, o]));
  const latest = latestBy(evidence.observations, o => `${o.deviceId}:${o.sensor}`);
  // Prefer the exact latest record chosen by the evidence loader on timestamp ties.
  const mandatory = new Set([...latest, ...evidence.devices.flatMap(d => Object.values(d.latest || {}))].map(o => o.id));
  for (const relation of relations.relations) for (const id of relation.evidenceIds) mandatory.add(id);
  const mandatoryEvents = new Set(latestBy(evidence.events, e => `${e.deviceId}:${e.type}`).map(e => e.id));
  for (const d of evidence.devices) if (d.helpObservation?.evidenceId) mandatoryEvents.add(d.helpObservation.evidenceId);
  const observationIds = new Set(), eventIds = new Set(), contextIds = new Set();
  const observationRow = o => [o.id, indexes.get(o.deviceId), o.sensor, o.value,
    offset(o.observedAt), offset(o.receivedAt), o.stale, o.delayed, mandatory.has(o.id)];
  const eventRow = e => [e.id, indexes.get(e.deviceId), e.type, offset(e.observedAt), offset(e.receivedAt)];
  const incidentRow = i => [i.id, indexes.get(i.deviceId), i.type, i.severity, i.status,
    offset(i.detectedAt), offset(i.lastObservedAt)];
  const context = {
    retrieval: 'cache_only', mode: externalContext.mode, scope: externalContext.scope,
    limitations: 'Selected cached records only. Omitted or empty sources were not supplied as evidence. Regional context does not prove conditions at this home.',
    sources: externalContext.sources.map(s => ({ id: s.id, status: s.status, sourceDataProvided: false,
      ...(s.records.length ? { stale: s.stale, fetchedAt: s.fetchedAt, omittedRecords: s.records.length } : {}) })),
    records: [],
  };
  const coverage = { source: evidence.coverage, devicesTruncated: evidence.devicesTruncated === true,
    modelProjection: true, completeHistory: false, observationsAvailable: evidence.observations.length,
    observationsOmitted: evidence.observations.length, eventsAvailable: evidence.events.length,
    eventsOmitted: evidence.events.length, incidentsOmitted: 0,
    note: 'Required current/latched evidence retained; older history/context may be omitted.' };
  const timeline = {
    generatedAt: evidence.generatedAt, scope: evidence.scope, devices,
    timing: 'All *OffsetMs values are milliseconds relative to generatedAt; negative is earlier; null means unknown. Device indexes refer to devices above.',
    observationColumns: ['id', 'device', 'sensor', 'value', 'observedOffsetMs', 'receivedOffsetMs', 'stale', 'delayed', 'required'], observations: [],
    eventColumns: ['id', 'device', 'type', 'observedOffsetMs', 'receivedOffsetMs'], events: [],
    incidentColumns: ['id', 'device', 'type', 'severity', 'status', 'detectedOffsetMs', 'lastObservedOffsetMs'],
    incidents: evidence.incidents.map(incidentRow), coverage, externalContext: context,
  };
  const correlationOutput = { relations: relations.relations, unresolvedIncidentIds: evidence.incidents.map(i => i.id),
    note: 'Incident details and coverage are in read_sensor_timeline. Co-occurrence is not causation.' };
  const result = { read_sensor_timeline: timeline, correlate_signals: correlationOutput, plan_power_budget: policies };
  const size = () => JSON.stringify(result).length;
  const syncCounts = () => {
    coverage.observationsOmitted = evidence.observations.length - observationIds.size;
    coverage.eventsOmitted = evidence.events.length - eventIds.size;
  };
  for (const id of mandatory) {
    const row = byId.get(id);
    if (!row) throw new HttpError(422, 'Required model evidence is unavailable. Review the recorded timeline.');
    timeline.observations.push(observationRow(row)); observationIds.add(id);
  }
  for (const row of evidence.events) if (mandatoryEvents.has(row.id)) { timeline.events.push(eventRow(row)); eventIds.add(row.id); }
  if ([...mandatoryEvents].some(id => !eventIds.has(id))) throw new HttpError(422, 'Required model event evidence is unavailable. Review the recorded timeline.');
  syncCounts();
  if (size() > maxChars) throw new HttpError(422, 'The required evidence exceeds the model input budget. No model call was made; review the recorded timeline.');
  const tryRow = (list, row, ids, id) => {
    list.push(row); ids.add(id); syncCounts();
    if (size() <= maxChars) return true;
    list.pop(); ids.delete(id); syncCounts(); return false;
  };
  const newestTargetFirst = (a, b) => Number(b.deviceId === evidence.targetDeviceId) - Number(a.deviceId === evidence.targetDeviceId) || order(b) - order(a) || a.id.localeCompare(b.id);
  for (const row of [...evidence.observations].sort(newestTargetFirst)) if (!observationIds.has(row.id)) tryRow(timeline.observations, observationRow(row), observationIds, row.id);
  for (const row of [...evidence.events].sort(newestTargetFirst)) if (!eventIds.has(row.id)) tryRow(timeline.events, eventRow(row), eventIds, row.id);
  for (const [index, source] of externalContext.sources.entries()) {
    if (!source.sourceDataProvided) continue;
    for (const record of source.records) {
      context.records.push({ ...record, source: source.id });
      context.sources[index].sourceDataProvided = true; context.sources[index].omittedRecords--;
      if (size() > maxChars) {
        context.records.pop(); context.sources[index].omittedRecords++;
        context.sources[index].sourceDataProvided = context.sources[index].omittedRecords < source.records.length;
      } else contextIds.add(record.id);
    }
  }
  timeline.observations.sort((a, b) => (a[4] ?? 0) - (b[4] ?? 0) || a[0].localeCompare(b[0]));
  const evidenceIds = new Set([...observationIds, ...eventIds, ...evidence.incidents.map(i => i.id)]);
  return { tools: result, evidenceIds, contextIds, coverage,
    // The persisted checkpoint shows exactly which public records the model saw.
    externalContext: { ...externalContext, sources: externalContext.sources.map(s => {
      const records = s.records.filter(r => contextIds.has(r.id));
      return { ...s, records, sourceDataProvided: records.length > 0, providedRecordCount: records.length,
        modelOmittedRecordCount: s.records.length - records.length, truncated: s.truncated || records.length < s.records.length };
    }), sourceDataProvided: contextIds.size > 0 },
  };
}
