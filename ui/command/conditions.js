// Pure logic for the device drawer: plain-language conditions, the eight checkpoints, and the
// browser-side fallback used when the timeline service has not answered. No DOM, no fetch.
// Safety rules: missing data is unknown, a stale critical reading stays critical (marked last known),
// nothing here infers occupancy, safe entry, damage, insurance coverage or dispatch.
import { displayStatus, STATUS_LABEL, readingRows, latestFromValues, ageText } from './core.js';

export const ADVISORY_LINE = 'Advisory only. A person must review this.';
export const OBSERVATION_FRESH_S = 120;

// The eight checkpoints, in the order a report travels. `what` and `limit` are shown in the node panel.
export const NODE_DEFS = [
  { id: 'observation', label: 'Observation', short: 'Box reading', what: 'The latest sensor reading the box took, such as water, power, battery and temperature.', limit: 'A reading is a moment in time. It says nothing about what happened between reports.' },
  { id: 'local_record', label: 'Local record', short: 'On the box', what: 'The history the box keeps on its own storage.', limit: 'The cloud does not receive this record, so it is shown as not reported.' },
  { id: 'gateway_mesh', label: 'Connection path', short: 'Relay path', what: 'How a report reaches the internet: the home gateway or a nearby box acting as a relay.', limit: 'The relay path is not reported to the cloud unless a box announces it, so it stays unknown.' },
  { id: 'cloud_ingest', label: 'Received by server', short: 'Received', what: 'The cloud received the report, stored it once and stamped the time it arrived.', limit: 'A delay between the reading time and the arrival time can come from the network or the box clock.' },
  { id: 'rules_latch', label: 'Sensor checks', short: 'Checks', what: 'Fixed rules compare readings with limits. A rule that trips latches an incident until a person clears it.', limit: 'Rules look at one home. They do not know about the street or the weather.' },
  { id: 'risk_ladder', label: 'Device status', short: 'Status', what: 'The tier shown on the map. It combines open incidents, the newest readings and nearby context.', limit: 'A tier is an alert level for people to review. It is not a finding about the building.' },
  { id: 'operator_review', label: 'Operator review', short: 'A person', what: 'Where a person looks at the evidence and decides what to do.', limit: 'Nothing here is automatic. A missing record means nobody has recorded a review.' },
  { id: 'message_help', label: 'Customer updates', short: 'Customer', what: 'Messages sent to the box screen and the help status the customer can see.', limit: 'A message is delivered when the box next checks in. Delivery is not the same as being read.' },
];
export const NODE_IDS = NODE_DEFS.map(n => n.id);
export const NODE_LABEL = Object.fromEntries(NODE_DEFS.map(n => [n.id, n.label]));

export const NODE_STATUS_TEXT = { ok: 'Normal', warn: 'Needs attention', critical: 'Critical', stale: 'Out of date', unknown: 'Unknown', not_reported: 'Not reported' };
export const NODE_STATUS_GLYPH = { ok: '✓', warn: '!', critical: '!!', stale: '◷', unknown: '?', not_reported: '–' };
export const SOURCE_TEXT = { recorded: 'Recorded', derived: 'Derived', not_recorded: 'Not recorded' };

const time = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : null; };
const iso = t => new Date(t).toISOString();
const MAX_EVENTS = 400;

function reasonList(p, risk) {
  const rs = risk?.reasons?.length ? risk.reasons.map(r => r.text) : (p?.reasons || []);
  return rs.filter(Boolean);
}

function readingFacts(latest, now) {
  const out = [];
  for (const g of readingRows(latest || {}, now)) for (const r of g.rows) if (r.reported) out.push(`${r.label}: ${r.text}`);
  return out;
}

function notReportedLabels(latest, now) {
  const out = [];
  for (const g of readingRows(latest || {}, now)) for (const r of g.rows) if (!r.reported) out.push(r.label);
  return out;
}

const WHY = {
  critical: 'Critical is the highest tier. It means a rule has tripped on the newest evidence and a person should look soon.',
  elevated: 'Elevated means more than one signal or a stronger signal needs a person to take a look.',
  watch: 'Watch means one signal is outside its normal range. It may clear by itself.',
  normal: 'No rule has tripped on the readings we have. That is the full meaning of this tier.',
  unknown: 'There is not enough recent evidence to place this device on the ladder. Unknown is shown instead of guessing.',
};

// Plain sentences for the Conditions tab. Same shape the timeline service returns in `conditions`.
export function deriveConditions({ p, risk, latest, now = Date.now(), exercise = false } = {}) {
  const shown = displayStatus(p || {}, now);
  const status = shown.status;
  const reasons = reasonList(p, risk);
  const seen = p?.lastSeen || p?.observedAt || null;
  const seenAge = seen ? ageText(seen, now) : null;
  const facts = readingFacts(latest, now);
  const missing = notReportedLabels(latest, now);
  const lead = reasons[0];
  const headline = status === 'unknown'
    ? (seen ? `No recent report. The last report was ${seenAge}.` : 'This device has not reported yet.')
    : status === 'normal'
      ? 'No active alerts in the latest report.'
      : `${STATUS_LABEL[status]}${lead ? ': ' + lead.replace(/\.$/, '') : ''}.`;
  const what = [];
  if (status === 'normal' || status === 'unknown') what.push(status === 'normal' ? 'The latest readings are inside their normal ranges.' : 'There are no fresh readings to describe.');
  for (const r of reasons.slice(0, 4)) what.push(r.replace(/\.$/, '') + '.');
  if (facts.length) what.push('Latest readings: ' + facts.slice(0, 6).join('; ') + '.');
  const corr = (risk?.correlations || []).map(c => c.text).filter(Boolean);
  for (const c of corr.slice(0, 2)) what.push(c.replace(/\.$/, '') + '.');
  const why = [WHY[status] || WHY.unknown];
  if (reasons.some(r => /water/i.test(r))) why.push('Water at the sensor can mean a leak or flooding at that spot. It does not say how much water there is.');
  if (reasons.some(r => /power|mains/i.test(r))) why.push('Lost mains power can be a local fault or an outage on the street. The box keeps running on its battery for a while.');
  if (shown.lastKnown && status !== 'unknown') why.push('The tier shown is the last known condition. It stays until a newer report replaces it, because quiet is not the same as clear.');
  let freshness;
  if (!seen) freshness = 'No report has arrived, so there is no data age to show.';
  else if (shown.silent) freshness = `The last report was ${seenAge}. That is older than 15 minutes, so everything here is last known, not current.`;
  else freshness = `The last report was ${seenAge}. Reports usually arrive every few minutes.`;
  const unknown = ['Whether anyone is at the home. This product does not infer that.', 'What the box recorded on its own storage, and which relay path it used. Neither is reported to the cloud.'];
  if (missing.length) unknown.unshift('Not reported: ' + missing.slice(0, 8).join(', ') + '. Not reported means unknown, not zero.');
  if (status === 'unknown') unknown.unshift('Whether things are fine or not. A missing report is unknown. It does not mean things are fine.');
  const nextSteps = [];
  if (status === 'critical' || status === 'elevated') nextSteps.push('Open the Sensors tab and read the newest values with their times.', 'Decide whether to contact the household. Nothing is sent unless a person sends it.', 'Record the decision as a follow-up so the next person sees it.');
  else if (status === 'watch') nextSteps.push('Check again after the next report. If the signal stays, review the Sensors tab.');
  else if (status === 'unknown') nextSteps.push('Check the Workflow tab to see where reports stop.', 'If the household can be reached by normal means, a person may ask for a check-in.');
  else nextSteps.push('No action is needed from these readings. Keep watching for new reports.');
  if (exercise) nextSteps.push('This is a fictional exercise home. Nothing here is a real event.');
  return { headline, what, why, freshness, unknown, nextSteps, advisory: ADVISORY_LINE };
}

// ---- timeline fallback ----

function nodeStatusFromTier(status, silent) {
  if (status === 'critical') return 'critical';
  if (status === 'elevated' || status === 'watch') return 'warn';
  if (status === 'normal') return silent ? 'unknown' : 'ok';
  return 'unknown';
}

function ev(nodeId, at, text, { kind = 'note', level = 'info', refs = [], simulated = false, receivedAt } = {}) {
  return { id: `${nodeId}:${kind}:${at}:${text.length}:${refs[0] || ''}`, nodeId, at, receivedAt: receivedAt || at, kind, level, text, refs, ...(simulated ? { simulated: true } : {}) };
}

// A history for an exercise home. Clearly simulated: it only restates the scenario the home was built from.
function exerciseLead(p, shown, base) {
  const out = [];
  const water = p?.values?.water_detected === true || p?.sensors?.water === true;
  const mains = p?.values?.mains_power === false || p?.sensors?.mains === false;
  const t = m => iso(base - m * 60000);
  out.push(ev('observation', t(18), 'Reading received: water not detected, mains power connected', { kind: 'reading', simulated: true, refs: ['exercise:baseline'] }));
  out.push(ev('cloud_ingest', t(18), 'Report stored by the cloud', { kind: 'receipt', simulated: true, refs: ['exercise:receipt-1'] }));
  if (water || mains) {
    out.push(ev('observation', t(6), water ? 'Reading received: water detected' : 'Reading received: mains power lost', { kind: 'reading', level: 'warn', simulated: true, refs: ['exercise:change'] }));
    out.push(ev('cloud_ingest', t(6), 'Report stored by the cloud', { kind: 'receipt', simulated: true, refs: ['exercise:receipt-2'] }));
    out.push(ev('rules_latch', t(6), water ? 'Water rule tripped. Incident latched.' : 'Power rule tripped. Incident latched.', { kind: 'incident', level: 'critical', simulated: true, refs: ['exercise:incident'] }));
    out.push(ev('risk_ladder', t(5), `Tier moved to ${STATUS_LABEL[shown.status] || 'Critical'}`, { kind: 'status_change', level: 'critical', simulated: true }));
  }
  return out;
}

// Builds the same document the timeline service returns, from what the browser already has.
// `D` is the /api/ops/device response when it exists. Everything here is labeled derived.
export function deriveTimeline({ p, D = null, now = Date.now(), exercise = false, reason = 'service' } = {}) {
  const dev = D?.data?.device || D?.data || {};
  const risk = dev.risk || D?.data?.risk || p?.risk || null;
  const latest = dev.latest || D?.data?.latest || p?.live?.latest || latestFromValues(p?.values, p?.observedAt);
  const help = D?.data?.help || dev.help || p?.help || null;
  const link = D?.data?.link || dev.link || p?.link || null;
  const shown = displayStatus(p || {}, now);
  const seenAt = time(p?.lastSeen) ?? time(p?.observedAt);
  const events = [];
  const add = e => { if (e && time(e.at) !== null) events.push(e); };

  if (exercise && !D?.data) for (const e of exerciseLead(p, shown, seenAt ?? now)) add(e);
  for (const [sensor, r] of Object.entries(latest || {})) {
    if (r?.value === undefined || r.value === null || !r.ts) continue;
    const row = readingRows({ [sensor]: r }, now).flatMap(g => g.rows).find(x => x.sensor === sensor && x.reported);
    if (row) add(ev('observation', r.ts, `${row.label}: ${row.text}`, { kind: 'reading', refs: [`reading:${sensor}`], simulated: exercise }));
  }
  for (const l of D?.data?.logs || []) add(ev('cloud_ingest', l.at || l.ts, `${l.code ? l.code + ': ' : ''}${l.msg || 'Log entry'}`, { kind: 'log', level: l.level === 'error' ? 'critical' : l.level === 'warn' ? 'warn' : 'info', refs: [`log:${l.id || l.code || ''}`] }));
  for (const i of D?.data?.incidents || []) add(ev('rules_latch', i.updatedAt || i.openedAt || i.createdAt, i.title || i.summary || `Incident ${i.status || 'open'}`, { kind: 'incident', level: i.severity === 'critical' ? 'critical' : 'warn', refs: [`incident:${i.id || i._id || ''}`] }));
  for (const m of D?.data?.messages || []) add(ev('message_help', m.updatedAt || m.createdAt, `Message "${m.title}" ${String(m.state || 'queued').replace(/_/g, ' ')}`, { kind: 'message', refs: [`message:${m.id}`] }));
  for (const h of help?.history || D?.data?.helpHistory || []) add(ev('message_help', h.updatedAt || h.at, `Help status set to ${String(h.status || 'none').replace(/_/g, ' ')}`, { kind: 'help', refs: [`help:${h.updatedAt || h.at}`] }));
  const topReason = reasonList(p, risk)[0];
  if (seenAt !== null && shown.status !== 'unknown') add(ev('risk_ladder', iso(seenAt), `Tier ${STATUS_LABEL[shown.status]}${topReason ? ': ' + topReason.replace(/\.$/, '') : ''}${shown.lastKnown ? ' (last known)' : ''}`, { kind: 'status_change', level: shown.status === 'critical' ? 'critical' : shown.status === 'normal' ? 'info' : 'warn', simulated: exercise }));
  events.sort((a, b) => time(a.at) - time(b.at) || a.id.localeCompare(b.id));
  const truncated = events.length > MAX_EVENTS;
  const kept = truncated ? events.slice(-MAX_EVENTS) : events;

  const byNode = id => kept.filter(e => e.nodeId === id);
  const last = id => { const l = byNode(id).at(-1); return l ? l.at : null; };
  const evidence = id => byNode(id).slice(-6).map(e => ({ id: e.refs[0] || e.id, kind: e.kind, at: e.at }));
  const obsAgeS = seenAt === null ? null : Math.max(0, (now - seenAt) / 1000);
  const wan = p?.values?.wan_connected ?? p?.sensors?.wan;
  const messages = D?.data?.messages || [];
  const helpOn = help?.status && help.status !== 'none';
  const tier = shown.status;
  const open = (D?.data?.incidents || []).length;
  const nodes = [
    { id: 'observation', status: seenAt === null ? 'unknown' : obsAgeS <= OBSERVATION_FRESH_S ? 'ok' : 'stale', lastAt: seenAt === null ? null : iso(seenAt), source: 'derived', note: seenAt === null ? 'No reading received.' : `Newest reading arrived ${ageText(iso(seenAt), now)}.` },
    { id: 'local_record', status: 'not_reported', lastAt: null, source: 'not_recorded', note: 'The box keeps its own record. It is not reported to the cloud.' },
    { id: 'gateway_mesh', status: 'unknown', lastAt: null, source: 'not_recorded', note: wan === false ? 'The box reported its internet link as lost. The relay path is unknown.' : wan === true ? 'The box reported its internet link as connected. The relay path is unknown.' : 'The relay path is not reported.' },
    { id: 'cloud_ingest', status: seenAt === null ? 'unknown' : 'ok', lastAt: seenAt === null ? null : iso(seenAt), source: 'derived', note: reason === 'exercise' ? 'Receipt detail is not part of the exercise data.' : 'Receipt detail comes from the timeline service, which has not answered. Showing what the summary holds.' },
    { id: 'rules_latch', status: open ? (tier === 'critical' ? 'critical' : 'warn') : tier === 'unknown' ? 'unknown' : tier === 'critical' || tier === 'elevated' ? (tier === 'critical' ? 'critical' : 'warn') : 'ok', lastAt: last('rules_latch') || (seenAt === null ? null : iso(seenAt)), source: 'derived', note: open ? `${open} open incident${open === 1 ? '' : 's'}.` : tier === 'critical' || tier === 'elevated' ? 'A rule has tripped on the newest reading.' : tier === 'unknown' ? 'No recent reading to check.' : 'No open incident.' },
    { id: 'risk_ladder', status: shown.lastKnown && tier !== 'unknown' ? nodeStatusFromTier(tier, false) : nodeStatusFromTier(tier, shown.silent), lastAt: seenAt === null ? null : iso(seenAt), source: 'derived', note: shown.lastKnown && tier !== 'unknown' ? `Last known tier: ${STATUS_LABEL[tier]}. It stays until a newer report replaces it.` : `Tier: ${STATUS_LABEL[tier]}.` },
    { id: 'operator_review', status: helpOn ? 'ok' : tier === 'critical' || tier === 'elevated' ? 'warn' : 'unknown', lastAt: help?.updatedAt || null, source: 'derived', note: helpOn ? 'A person has set a help status.' : tier === 'critical' || tier === 'elevated' ? 'Waiting for a person to review. No review is recorded.' : 'No review is recorded.' },
    { id: 'message_help', status: messages.length || helpOn ? 'ok' : 'unknown', lastAt: last('message_help') || help?.updatedAt || null, source: 'derived', note: messages.length ? `${messages.length} message${messages.length === 1 ? '' : 's'} on record.` : helpOn ? 'Help status is set.' : 'No message or help status on record.' },
  ].map((n, i) => ({ ...n, label: NODE_LABEL[n.id], order: i + 1, counts: { events: byNode(n.id).length }, evidence: evidence(n.id) }));
  const edges = NODE_IDS.slice(1).map((id, i) => ({ from: NODE_IDS[i], to: id, kind: 'flow' })).concat([{ from: 'risk_ladder', to: 'message_help', kind: 'human_only' }]);
  const conditions = deriveConditions({ p, risk, latest, now, exercise });
  return {
    version: 1, derived: true, derivedReason: reason, mode: exercise ? 'exercise' : 'live', deviceId: p?.id || null, generatedAt: iso(now),
    window: { since: kept[0]?.at || null, until: iso(now) }, conditions, nodes, edges, events: kept,
    coverage: { truncated, notRecorded: ['local_record', 'gateway_mesh'] }, ai: { configured: false, model: null, lastRunId: null },
  };
}

// Accepts a service response (or null) and returns something the drawer can always render.
export function normalizeTimeline(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) return null;
  const byId = new Map(raw.nodes.map(n => [n.id, n]));
  const nodes = NODE_DEFS.map((d, i) => {
    const n = byId.get(d.id) || {};
    const forced = d.id === 'local_record' ? 'not_reported' : null;
    const status = forced || (Object.keys(NODE_STATUS_TEXT).includes(n.status) ? n.status : 'unknown');
    return { id: d.id, label: n.label || d.label, order: n.order || i + 1, status, lastAt: n.lastAt || null, counts: n.counts || {}, evidence: Array.isArray(n.evidence) ? n.evidence : [], source: n.source || (status === 'not_reported' ? 'not_recorded' : 'derived'), note: n.note || '' };
  });
  const events = (Array.isArray(raw.events) ? raw.events : []).filter(e => e && NODE_IDS.includes(e.nodeId) && time(e.at) !== null)
    .map((e, i) => ({ id: e.id || `e${i}`, nodeId: e.nodeId, at: e.at, receivedAt: e.receivedAt || e.at, kind: e.kind || 'note', level: e.level || 'info', text: String(e.text || ''), refs: Array.isArray(e.refs) ? e.refs : [], ...(e.simulated ? { simulated: true } : {}) }))
    .sort((a, b) => time(a.at) - time(b.at) || a.id.localeCompare(b.id));
  const edges = Array.isArray(raw.edges) && raw.edges.length ? raw.edges : NODE_IDS.slice(1).map((id, i) => ({ from: NODE_IDS[i], to: id, kind: 'flow' })).concat([{ from: 'risk_ladder', to: 'message_help', kind: 'human_only' }]);
  return { ...raw, nodes, edges, events, coverage: raw.coverage || { truncated: false, notRecorded: ['local_record', 'gateway_mesh'] } };
}

// What each checkpoint looked like after the first `k` events (k = events.length means now).
// Live status is kept for the end of the history. Earlier positions show the level of the newest event
// so far; a node with no events yet is Unknown, and the never-reported nodes never turn green.
export function stateAtCursor(nodes, events, k) {
  const n = Math.max(0, Math.min(events.length, Math.floor(k)));
  const live = n >= events.length;
  const upto = events.slice(0, n);
  return nodes.map(node => {
    const mine = upto.filter(e => e.nodeId === node.id);
    const lastEv = mine.at(-1) || null;
    let status = node.status;
    if (!live && node.source !== 'not_recorded') {
      const rank = { info: 0, warn: 1, critical: 2 };
      // The risk ladder and the incident latch never step down on their own: a critical stays critical.
      const sticky = node.id === 'risk_ladder' || node.id === 'rules_latch';
      const level = sticky ? mine.reduce((w, e) => (rank[e.level] ?? 0) > (rank[w] ?? 0) ? e.level : w, 'info') : lastEv?.level;
      status = !lastEv ? 'unknown' : level === 'critical' ? 'critical' : level === 'warn' ? 'warn' : 'ok';
    }
    return { id: node.id, status, lastAt: live ? node.lastAt : lastEv?.at || null, events: live ? Math.max(node.counts?.events ?? 0, mine.length) : mine.length, live };
  });
}
