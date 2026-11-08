// Per-device risk assessment. Pure: no I/O, no clock reads other than the `now` argument.
// Rules of the ladder: missing data is unknown, stale critical evidence never turns safe,
// offline alone is never critical, and output is advisory only.
import {
  ADVISORY, BOOST, COMPOUND, NWS_EVENT, OFFLINE_MIN, PRIORITY_BASE, SENSORS, SERIES_SENSORS, TIERS, TREND,
  UNKNOWN_STALE_HAZARD, levelIndex, ZONE_TYPES_EVAC,
} from './config.js';
import { geohashEncode, pointInGeometry, validLngLat } from './geo.js';

const MIN = 60000;
export const toMs = (d) => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d));
const iso = (t) => new Date(t).toISOString();
const props = (f) => (f && f.properties) || f || {};

export function agoText(diffMs) {
  const m = Math.floor(Math.max(0, diffMs) / MIN);
  if (m < 1) return 'just now';
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** Returns {ok:true,value} or {ok:false,reason}. Out of range is rejected, never clamped. */
export function normalizeValue(cfg, raw) {
  if (cfg.kind === 'bool') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    if (raw === 1 || raw === 0) return { ok: true, value: raw === 1 };
    if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' };
    return { ok: false, reason: 'wrong_type' };
  }
  if (cfg.kind === 'enum') {
    const v = typeof raw === 'string' ? raw.toLowerCase() : null;
    return cfg.values.includes(v) ? { ok: true, value: v } : { ok: false, reason: 'wrong_type' };
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return { ok: false, reason: 'wrong_type' };
  if (n < cfg.min || n > cfg.max) return { ok: false, reason: 'out_of_range' };
  return { ok: true, value: n };
}

/** Newest valid reading per known sensor, plus the readings that were discarded. */
function latestReadings(readings, nowMs) {
  const latest = new Map(), discarded = [];
  for (const r of readings || []) {
    const cfg = SENSORS[r?.sensor];
    if (!cfg) continue;
    const t = Math.min(toMs(r.ts), nowMs);
    if (!Number.isFinite(t)) continue;
    const n = normalizeValue(cfg, r.value);
    if (!n.ok) { discarded.push({ sensor: r.sensor, observedAt: iso(t), reason: n.reason }); continue; }
    const cur = latest.get(r.sensor);
    if (cur && cur.t >= t) continue;
    latest.set(r.sensor, {
      t, sensor: r.sensor, value: n.value, unit: r.unit || cfg.unit,
      evidenceId: r._id != null ? String(r._id) : `${r.sensor}:${t}`,
      stale: nowMs - t > cfg.staleMin * MIN,
      receivedAt: r.receivedAt ? Math.min(toMs(r.receivedAt), nowMs) : t,
    });
  }
  return { latest, discarded: discarded.slice(0, 20) };
}

const evidenceOf = (e) => ({ sensor: e.sensor, value: e.value, unit: e.unit ?? null, observedAt: iso(e.t), evidenceId: e.evidenceId, stale: e.stale });

function sentence(say, stale, nowMs, t) {
  const ago = agoText(nowMs - t);
  return stale ? `${say} ${ago}. This is the last report and may be out of date.` : `${say} ${ago}.`;
}

function singleSensorReasons(latest, nowMs) {
  const out = [];
  for (const [sensor, e] of latest) {
    const rule = SENSORS[sensor].rules.find((r) => r.test(e.value));
    if (!rule) continue;
    out.push({ ruleId: rule.id, level: rule.level, hazard: rule.hazard, text: sentence(rule.say(e.value, e.unit), e.stale, nowMs, e.t), evidence: [evidenceOf(e)], cust: rule.cust, t: e.t });
  }
  return out;
}

function compoundReasons(latest, nowMs) {
  const out = [];
  for (const c of COMPOUND) {
    const es = c.needs.map((s) => latest.get(s));
    if (es.some((e) => !e)) continue;
    const vals = Object.fromEntries(es.map((e) => [e.sensor, e.value]));
    if (!c.test(vals)) continue;
    const stale = es.some((e) => e.stale), t = Math.min(...es.map((e) => e.t));
    out.push({ ruleId: c.id, level: c.level, hazard: c.hazard, text: sentence(c.say(vals), stale, nowMs, t), evidence: es.map(evidenceOf), cust: c.cust, t, needs: c.needs });
  }
  return out;
}

/** Water depth rising 5 mm or more inside 10 minutes. Uses series, else the readings themselves. */
function trendReasons(latest, series, readings, nowMs) {
  const out = [];
  for (const sensor of SERIES_SENSORS) {
    const cur = latest.get(sensor);
    if (!cur || cur.stale) continue;
    const raw = series?.[sensor] || (readings || []).filter((r) => r?.sensor === sensor);
    const pts = raw.map((p) => ({ t: Math.min(toMs(p.ts), nowMs), n: normalizeValue(SENSORS[sensor], p.value) })).filter((p) => Number.isFinite(p.t) && p.n.ok)
      .map((p) => ({ t: p.t, v: p.n.value })).filter((p) => p.t >= cur.t - TREND.windowMin * MIN && p.t < cur.t).sort((a, b) => a.t - b.t);
    if (!pts.length) continue;
    const delta = cur.value - pts[0].v;
    if (delta < TREND.waterRiseMm) continue;
    out.push({
      ruleId: 'water_rising', level: 'elevated', hazard: 'water', t: cur.t,
      text: `Water depth at the sensor rose ${Math.round(delta * 10) / 10} mm in ${TREND.windowMin} minutes and is now ${cur.value} mm, reported ${agoText(nowMs - cur.t)}.`,
      evidence: [evidenceOf(cur)], cust: 'Your box reported water depth rising at its sensor',
    });
  }
  return out;
}

export function tierFor(score) {
  const t = TIERS.find((x) => score >= x.min);
  return { tier: t.tier, label: t.label };
}

function makePriority(status, staleHazard, boosts) {
  const base = status === 'unknown' && staleHazard ? UNKNOWN_STALE_HAZARD : PRIORITY_BASE[status] ?? 0;
  const score = Math.min(100, base + boosts.reduce((s, b) => s + b.points, 0));
  return { score, ...tierFor(score), base, boosts };
}

/** Adds extra priority points (used by the region step for nearby offline boxes). Returns a new assessment. */
export function boostPriority(a, points, label) {
  if (a.priority.boosts.some((b) => b.label === label)) return a;
  const boosts = [...a.priority.boosts, { label, points }];
  return { ...a, priority: makePriority(a.status, a.staleHazard, boosts) };
}

const zoneActive = (z, nowMs) => {
  const p = props(z);
  if (p.active === false) return false;
  if (p.startsAt && toMs(p.startsAt) > nowMs) return false;
  if (p.endsAt && toMs(p.endsAt) < nowMs) return false;
  return true;
};
const idOf = (f) => String(f?.id ?? f?._id ?? props(f).id ?? props(f).FLD_AR_ID ?? props(f).event ?? 'unknown');

function overlayCorrelations(loc, ctx, nowMs, hasWaterSignal) {
  const correlations = [], boosts = [];
  if (!validLngLat(loc) || !ctx) return { correlations, boosts };
  const inside = (f) => pointInGeometry(loc, f?.geometry);
  let evac = false;
  for (const z of (ctx.zones || []).filter((z) => zoneActive(z, nowMs) && inside(z))) {
    const p = props(z), type = p.type || 'custom';
    correlations.push({ kind: 'zone', sourceId: idOf(z), text: `Inside an operator ${type.replace('_', ' ')} zone${p.name ? ` named ${p.name}` : ''}.` });
    if (!evac && ZONE_TYPES_EVAC.includes(type)) { evac = true; boosts.push({ label: 'Inside an active evacuation zone', points: BOOST.evacuationZone }); }
  }
  let sfha = false;
  for (const f of (ctx.nfhl || []).filter(inside).slice(0, 3)) {
    const p = props(f), isSfha = p.SFHA_TF === 'T' || p.SFHA_TF === true;
    correlations.push({ kind: 'flood_zone', sourceId: idOf(f), text: `Inside FEMA flood zone ${p.FLD_ZONE || 'unknown'}${isSfha ? ', a special flood hazard area' : ''}.` });
    if (!sfha && isSfha) { sfha = true; boosts.push({ label: 'Inside a FEMA special flood hazard area', points: BOOST.floodZone }); }
  }
  let nws = false;
  for (const f of (ctx.nws || []).filter((f) => NWS_EVENT.test(String(props(f).event || '')) && inside(f)).slice(0, 3)) {
    correlations.push({ kind: 'weather_alert', sourceId: idOf(f), text: `Inside an active ${props(f).event} area.` });
    if (!nws) { nws = true; boosts.push({ label: 'Inside an active flood or fire weather alert', points: BOOST.weatherAlert }); }
  }
  for (const f of (ctx.declarations || []).filter(inside).slice(0, 2)) {
    const p = props(f);
    correlations.push({ kind: 'declaration', sourceId: idOf(f), text: `Inside an area with a federal disaster declaration${p.declarationTitle || p.incidentType ? ` (${p.declarationTitle || p.incidentType})` : ''}.` });
  }
  const cell = geohashEncode(loc[0], loc[1], 5), w = ctx.weather?.[cell];
  if (w?.level === 'heavy') {
    correlations.push({ kind: 'heavy_rain', sourceId: cell, text: 'Heavy rain is forecast here in the next 24 hours.' });
    if (hasWaterSignal) boosts.push({ label: 'Heavy rain forecast with a water or moisture signal', points: BOOST.heavyRain });
  }
  return { correlations, boosts };
}

/**
 * assessDevice({device, readings, series, location, link, help}, ctx, now) -> DeviceRisk
 * readings: recent raw reading docs {sensor,value,unit,ts,receivedAt,_id}. ctx: OverlayContext (may be empty).
 */
export function assessDevice(input, ctx = {}, now = new Date()) {
  const { device = {}, readings = [], series, location = null, link } = input;
  const nowMs = toMs(now);
  const { latest, discarded } = latestReadings(readings, nowMs);

  let reasons = [...singleSensorReasons(latest, nowMs), ...trendReasons(latest, series, readings, nowMs)];
  const compound = compoundReasons(latest, nowMs);
  reasons = reasons.filter((r) => !compound.some((c) => levelIndex(r.level) <= levelIndex(c.level) && r.evidence.every((e) => c.needs.includes(e.sensor))));
  reasons = [...reasons, ...compound];

  const counted = reasons.filter((r) => !r.evidence.some((e) => e.stale) || r.level === 'critical');
  const staleHazard = reasons.some((r) => !counted.includes(r) && levelIndex(r.level) >= levelIndex('watch'));
  const fresh = [...latest.values()].filter((e) => !e.stale);

  const seenMs = Math.max(0, device.lastSeen ? Math.min(toMs(device.lastSeen), nowMs) : 0, ...[...latest.values()].map((e) => e.receivedAt));
  const offline = !seenMs || nowMs - seenMs > OFFLINE_MIN * MIN;

  let status = counted.reduce((s, r) => (levelIndex(r.level) > levelIndex(s) ? r.level : s), 'unknown');
  if (!counted.length) status = fresh.length && !offline && !staleHazard ? 'normal' : 'unknown';
  if (offline) reasons.push({ ruleId: 'offline', level: 'unknown', hazard: 'connectivity', text: seenMs ? `No signal from this box for ${agoText(nowMs - seenMs).replace(' ago', '')}.` : 'This box has never reported.', evidence: [], cust: 'We have not heard from your box recently', t: seenMs });
  reasons.sort((a, b) => levelIndex(b.level) - levelIndex(a.level) || a.evidence.some((e) => e.stale) - b.evidence.some((e) => e.stale));

  const hasWaterSignal = reasons.some((r) => r.hazard === 'water' && levelIndex(r.level) >= levelIndex('watch'));
  const { correlations, boosts } = overlayCorrelations(location, ctx, nowMs, hasWaterSignal);
  const priority = makePriority(status, staleHazard, boosts);

  const v = (s) => (latest.has(s) ? latest.get(s).value : null);
  const observedMs = latest.size ? Math.max(...[...latest.values()].map((e) => e.t)) : 0;
  return {
    deviceId: String(device._id ?? device.id ?? ''),
    name: device.name ?? null,
    status,
    offline,
    staleHazard,
    lastSeen: seenMs ? iso(seenMs) : null,
    observedAt: observedMs ? iso(observedMs) : null,
    reasons: reasons.map(({ ruleId, level, text, evidence, hazard, cust, t }) => ({ ruleId, level, text, evidence, hazard, cust, observedAt: t ? iso(t) : null })),
    correlations,
    priority,
    power: { mains: v('mains_power'), battery_pct: v('battery_pct'), mode: v('power_mode'), stale: ['mains_power', 'battery_pct', 'power_mode'].some((s) => latest.get(s)?.stale) },
    location: validLngLat(location) ? location : null,
    hasContact: Boolean(link?.linked && link?.consent),
    discarded,
    advisory: ADVISORY,
  };
}
