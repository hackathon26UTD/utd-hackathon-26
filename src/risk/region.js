// Region grouping and follow-up lists. Pure: no I/O.
import { ADVISORY, BOOST, LEVELS, REGION, levelIndex } from './config.js';
import { boostPriority, tierFor, toMs } from './device.js';
import { geohashBounds, geohashEncode, validLngLat } from './geo.js';

const MIN = 60000;
const KIND_TEXT = {
  zone: 'inside an operator zone', flood_zone: 'inside a FEMA flood zone', weather_alert: 'inside an active flood or fire weather alert',
  declaration: 'inside a federal disaster declaration area', heavy_rain: 'in an area with heavy rain forecast',
};

export const normalizePrecision = (p) => (REGION.precisions.includes(Number(p)) ? Number(p) : REGION.defaultPrecision);

/** Hazards behind a device's critical reasons, e.g. 'water' or 'fire'. */
const criticalHazards = (a) => new Set(a.reasons.filter((r) => r.level === 'critical').map((r) => r.hazard));

function outageOf(group, nowMs) {
  const offline = group.filter((a) => a.offline);
  const share = offline.length / group.length;
  if (!offline.length) return { share, outage: 'none', text: null };
  const times = offline.map((a) => (a.lastSeen ? toMs(a.lastSeen) : null)).filter((t) => t !== null);
  const together = share >= 0.5 && times.length === offline.length && Math.max(...times) - Math.min(...times) <= REGION.outageSpreadMin * MIN;
  if (!together) return { share, outage: 'isolated_offline', text: `${offline.length} of ${group.length} boxes here are not reporting. This looks isolated, not area wide.` };
  const corroborate = group.filter((a) => !a.offline && a.power.mains === false).length > 0;
  return {
    share, outage: 'possible_grid_or_isp_outage',
    text: `${offline.length} of ${group.length} boxes stopped reporting at about the same time. This may be a power or internet outage${corroborate ? ', and mains reports corroborate' : ''}. Offline alone is not a safety finding.`,
  };
}

/**
 * aggregateRegions(assessments, {precision, now, worsened:Set<deviceId>, minDevices}) -> RegionRisk[]
 * Only cells with at least 3 boxes are reported.
 */
export function aggregateRegions(assessments, { precision = REGION.defaultPrecision, now = new Date(), worsened = new Set(), minDevices = REGION.minDevices } = {}) {
  const p = normalizePrecision(precision), nowMs = toMs(now), cells = new Map();
  for (const a of assessments) {
    if (!validLngLat(a.location)) continue;
    const key = geohashEncode(a.location[0], a.location[1], p);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(a);
  }
  const out = [];
  for (const [hash, group] of cells) {
    if (group.length < minDevices) continue;
    const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
    for (const a of group) counts[a.status]++;
    const bbox = geohashBounds(hash), { share, outage, text: outageText } = outageOf(group, nowMs);
    const worsened30m = group.filter((a) => worsened.has(a.deviceId)).length;
    const rising = group.filter((a) => a.reasons.some((r) => r.ruleId === 'water_rising')).length;
    const elevatedUp = counts.elevated + counts.critical;
    const hazardCounts = {};
    for (const a of group) for (const h of criticalHazards(a)) hazardCounts[h] = (hazardCounts[h] || 0) + 1;
    const sameHazard = Object.entries(hazardCounts).find(([, n]) => n >= 2);
    const hotReasons = [];
    if (elevatedUp >= 3) hotReasons.push(`${elevatedUp} boxes are at elevated or critical.`);
    if (sameHazard) hotReasons.push(`${sameHazard[1]} boxes report a critical ${sameHazard[0]} condition.`);
    if (worsened30m >= 3) hotReasons.push(`${worsened30m} boxes got worse in the last ${REGION.worsenedWindowMin} minutes.`);
    const is = hotReasons.length > 0;
    const score = Math.min(100, elevatedUp * 15 + counts.critical * 15 + worsened30m * 10 + (sameHazard ? 10 : 0));

    const correlations = [];
    for (const [kind, label] of Object.entries(KIND_TEXT)) {
      const n = group.filter((a) => a.correlations.some((c) => c.kind === kind)).length;
      if (n) correlations.push({ kind, sourceId: hash, text: `${n} of ${group.length} boxes are ${label}.` });
    }
    if (outageText) correlations.push({ kind: 'outage', sourceId: hash, text: outageText });
    if (rising) correlations.push({ kind: 'trend', sourceId: hash, text: `${rising} boxes show water depth rising.` });

    const top = Math.max(...group.map((a) => a.priority.score));
    const pscore = Math.min(100, top + (is ? 10 : 0));
    out.push({
      key: `gh${p}:${hash}`, bbox, centroid: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
      deviceCount: group.length, counts, offlineShare: Math.round(share * 100) / 100, outage,
      hotspot: { is, score: is ? Math.max(score, 30) : 0, reasons: hotReasons },
      worsened30m, rising, correlations,
      priority: { score: pscore, ...tierFor(pscore) },
      advisory: ADVISORY,
    });
  }
  return out.sort((a, b) => b.priority.score - a.priority.score);
}

/** Adds the "nearby boxes are offline" points to boxes in a cell with a possible outage. */
export function applyRegionBoosts(assessments, regions, precision = REGION.defaultPrecision) {
  const p = normalizePrecision(precision), hot = new Set(regions.filter((r) => r.outage === 'possible_grid_or_isp_outage').map((r) => r.key));
  if (!hot.size) return assessments;
  return assessments.map((a) => (validLngLat(a.location) && hot.has(`gh${p}:${geohashEncode(a.location[0], a.location[1], p)}`)
    ? boostPriority(a, BOOST.neighborsOffline, 'Neighboring boxes are offline') : a));
}

/** Human follow-up list: P1 and P2 boxes, most urgent first. hasContact only means someone can be called. */
export function followUps(assessments, limit = 20) {
  return assessments.filter((a) => a.priority.tier !== 'P3')
    .sort((a, b) => b.priority.score - a.priority.score || levelIndex(b.status) - levelIndex(a.status))
    .slice(0, limit)
    .map((a) => ({
      deviceId: a.deviceId, tier: a.priority.tier, score: a.priority.score,
      why: a.reasons.find((r) => r.level !== 'unknown')?.text || a.correlations[0]?.text || (a.offline ? a.reasons.find((r) => r.ruleId === 'offline')?.text : null) || 'No recent signal. Condition is unknown.',
      hasContact: a.hasContact,
    }));
}
