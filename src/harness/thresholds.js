// Single source of truth for every threshold a human or the model may be told about.
// Nothing here is typed in a second time: values are imported, or read back by running the real rule
// (risk ladder, command-center card, power policy, email freshness) at its boundary.
import {
  BOOST, COMPOUND, LOOKBACK_DAYS, OFFLINE_MIN, PRIORITY_BASE, REGION, SENSORS, TIERS, TREND, UNKNOWN_STALE_HAZARD, LEVELS,
} from '../risk/config.js';
import { FRESH_MS, POWER_PROFILES, devicePolicy, powerBudget } from '../../domain/system-policy.js';
import { summarizeProperty } from '../../domain/property.js';
import { renderCustomerAlertEmail } from '../customer-alert-email.js';
import { LAYERS, RAIN } from '../feed-layers.js';
import {
  AUDIT_TTL_S, CURSOR_OVERLAP_MS, DEVICE_LOG_TTL_S, OFFLINE_MS, RESET_AFTER_MS,
} from '../live.js';
import {
  BODY_MAX, DEFAULT_EXPIRY_MIN, MAX_EXPIRY_MIN, MAX_FANOUT, MAX_LIVE_PER_DEVICE, SENDS_PER_MIN, TITLE_MAX,
} from '../messages.js';
import {
  BATTERY_LOW_PCT, VIEW_COMBINE, VIEW_CONTEXT_IDS_MAX, VIEW_MAX_FILTERS, VIEW_PREDICATE_INFO, VIEW_PREDICATE_NAMES,
  VIEW_SUMMARY_MAX, VIEW_TITLE_MAX, WATER_LEVEL_MM,
} from './predicates.js';

const MIN = 60_000;

/** First boundary of a monotone rule over a grid. Returns {op, value}. */
export function boundary(test, min, max, step = 0.5) {
  const n = Math.round((max - min) / step);
  const at = i => Math.round((min + i * step) * 1000) / 1000;
  const lo = test(min), hi = test(max);
  if (hi && !lo) { for (let i = 0; i <= n; i++) if (test(at(i))) return { op: '>=', value: at(i) }; }
  if (lo && !hi) { let last = null; for (let i = 0; i <= n; i++) { if (test(at(i))) last = at(i); else if (last !== null) break; } return { op: '<=', value: last }; }
  throw new Error('rule is not a simple threshold');
}

function ruleTrigger(cfg, rule) {
  if (cfg.kind === 'bool') return { op: '=', value: rule.test(true) ? true : false };
  if (cfg.kind === 'enum') return { op: '=', value: cfg.values.find(v => rule.test(v)) };
  return boundary(rule.test, cfg.min, cfg.max);
}

function sensorTable() {
  return Object.entries(SENSORS).map(([sensor, cfg]) => ({
    sensor, kind: cfg.kind, unit: cfg.unit ?? null, min: cfg.min ?? null, max: cfg.max ?? null, values: cfg.values ?? null, staleMin: cfg.staleMin,
    rules: cfg.rules.map(r => ({ id: r.id, level: r.level, hazard: r.hazard, ...ruleTrigger(cfg, r) })),
  }));
}

function compoundTable() {
  return COMPOUND.map(c => {
    const battery = boundary(v => c.test({ mains_power: false, battery_pct: v }), 0, 100, 1);
    return { id: c.id, level: c.level, hazard: c.hazard, needs: c.needs, text: `mains_power false and battery_pct ${battery.op} ${battery.value}` };
  });
}

/** Age in seconds at which the command-center card calls a reading stale. */
function commandCenterStaleSeconds() {
  const now = Date.UTC(2026, 10, 8, 12, 0, 0);
  const staleAt = age => summarizeProperty({ _id: 'p1' }, [{ sensor: 'temp_c', value: 20, ts: new Date(now - age * 1000) }], [], now).stale;
  for (let s = 1; s <= 7200; s++) if (staleAt(s)) return s - 1;
  return null;
}

function commandCenterCard() {
  const now = Date.UTC(2026, 10, 8, 12, 0, 0);
  const sev = (sensor, value) => summarizeProperty({ _id: 'p1' }, [{ sensor, value, ts: new Date(now - 1000) }], [], now).severity;
  const critical = (sensor, min, max, step) => boundary(v => sev(sensor, v) === 'critical', min, max, step);
  const warning = (sensor, min, max, step) => boundary(v => sev(sensor, v) === 'warning', min, max, step);
  return {
    staleAfterSeconds: commandCenterStaleSeconds(),
    criticalWaterLevelMm: critical('water_level_mm', 0, 500, 0.5),
    criticalTempC: critical('temp_c', -40, 85, 0.5),
    warningBatteryPct: warning('battery_pct', 0, 100, 1),
  };
}

function systemPolicyCriticals() {
  const now = new Date('2026-11-08T12:00:00Z');
  const mode = (key, value) => devicePolicy({ id: 'd1', latest: { mains_power: { value: true, observedAt: now.toISOString() }, [key]: { value, observedAt: now.toISOString() } } }, now).mode;
  const temp = boundary(v => mode('temp_c', v) === 'critical', -40, 85, 0.5);
  const sound = boundary(v => mode('sound_hits', v) === 'critical', 0, 100, 1);
  return { criticalTempC: temp, criticalSoundHits: sound };
}

function budgetRules() {
  const ok = hours => { try { powerBudget([], null, hours); return true; } catch { return false; } };
  let minH = null, maxH = null;
  for (let h = 0; h <= 400; h++) if (ok(h)) { if (minH === null) minH = h; maxH = h; }
  return { goalHoursMin: minH, goalHoursMax: maxH, reserveFractionDefault: powerBudget([], null, 24).reserveFraction };
}

/** Customer alert email freshness: minutes after which "Stale / offline" is shown. */
function emailStaleMinutes() {
  const now = '2026-11-08T12:00:00Z';
  const stale = ageS => /Stale \/ offline/.test(renderCustomerAlertEmail({
    event: 'detected-condition', severity: 'critical', now, observedAt: new Date(Date.parse(now) - ageS * 1000).toISOString().replace(/\.\d+Z$/, 'Z'),
  }).text);
  for (let s = 0; s <= 3600; s++) if (stale(s)) return (s - 1) / 60;
  return null;
}

export function buildThresholds() {
  return {
    levels: LEVELS,
    sensors: sensorTable(),
    compound: compoundTable(),
    trend: { windowMin: TREND.windowMin, waterRiseMm: TREND.waterRiseMm },
    freshness: {
      offlineMin: OFFLINE_MIN, lookbackDays: LOOKBACK_DAYS, systemPolicyFreshS: FRESH_MS / 1000,
      commandCenterStaleS: commandCenterCard().staleAfterSeconds, customerEmailStaleMin: emailStaleMinutes(),
      liveOfflineMin: OFFLINE_MS / MIN, liveResetAfterMin: RESET_AFTER_MS / MIN, liveCursorOverlapS: CURSOR_OVERLAP_MS / 1000,
    },
    commandCenter: commandCenterCard(),
    priority: { base: PRIORITY_BASE, unknownWithStaleHazard: UNKNOWN_STALE_HAZARD, boosts: BOOST, tiers: TIERS },
    region: { minDevices: REGION.minDevices, precisions: REGION.precisions, defaultPrecision: REGION.defaultPrecision, outageSpreadMin: REGION.outageSpreadMin, worsenedWindowMin: REGION.worsenedWindowMin },
    power: { profiles: POWER_PROFILES, ...systemPolicyCriticals(), ...budgetRules() },
    messages: { titleMax: TITLE_MAX, bodyMax: BODY_MAX, maxLivePerDevice: MAX_LIVE_PER_DEVICE, maxFanout: MAX_FANOUT, sendsPerMin: SENDS_PER_MIN, defaultExpiryMin: DEFAULT_EXPIRY_MIN, maxExpiryMin: MAX_EXPIRY_MIN },
    retention: { deviceLogDays: DEVICE_LOG_TTL_S / 86400, auditDays: AUDIT_TTL_S / 86400 },
    feeds: Object.values(LAYERS).map(l => ({ id: l.id, name: l.name, ttlS: l.ttlS })),
    rain: { ...RAIN },
    views: {
      predicates: VIEW_PREDICATE_NAMES.map(name => ({ name, means: VIEW_PREDICATE_INFO[name].means })),
      waterLevelMm: WATER_LEVEL_MM, batteryLowPct: BATTERY_LOW_PCT, maxFilters: VIEW_MAX_FILTERS, combine: VIEW_COMBINE,
      titleMax: VIEW_TITLE_MAX, summaryMax: VIEW_SUMMARY_MAX, contextIdsMax: VIEW_CONTEXT_IDS_MAX,
    },
  };
}

// ---------- rendering ----------
const num = n => String(n);
export const trigger = r => r.op === '=' ? `= ${r.value}` : `${r.op} ${r.value}`;
const hours = s => s >= 3600 ? `${s / 3600} hours` : s >= 60 ? `${s / 60} minutes` : `${s} seconds`;

/** docs/THRESHOLDS.md. Generated: do not edit by hand. */
export function renderThresholdsDoc(T = buildThresholds()) {
  const out = [];
  const p = (...lines) => out.push(...lines);
  p('# HomeBeacon thresholds', '',
    '<!-- Generated by `npm run hb -- harness thresholds --write` from the code. Do not edit by hand; test/harness.test.js fails if this file differs. -->', '',
    'Every number below is read from the running code (risk ladder, command-center card, power policy, messages, feeds), not typed again. Advisory only: a threshold flags a reading for a person to review. It never says who is home, whether a building is safe to enter, damage, coverage or dispatch.', '',
    '## Four places decide "how bad", and they use different clocks', '',
    'The same box can look different in each. Use the one that matches the screen you are on.', '',
    '| Where | What it is for | Stale or offline rule |', '| --- | --- | --- |',
    `| Risk ladder (\`/api/risk\`, \`src/risk/config.js\`) | Status, priority tier and reasons per box and per area | Each sensor has its own stale time (table below). A box silent for more than ${T.freshness.offlineMin} minutes is offline. |`,
    `| Command-center card (\`domain/property.js\`) | Quick severity on the map card | A box is stale when its newest reading is more than ${T.commandCenter.staleAfterSeconds} seconds (${hours(T.commandCenter.staleAfterSeconds)}) old. |`,
    `| Power policy (\`domain/system-policy.js\`) | Normal, saver or critical power profile proposals | A reading counts as fresh for ${T.freshness.systemPolicyFreshS} seconds. Older critical evidence still keeps the critical profile. |`,
    `| Live API and email | Offline detection for polling and the customer alert email | Offline after ${T.freshness.liveOfflineMin} minutes of silence. Email says stale or offline after ${T.freshness.customerEmailStaleMin} minutes. |`, '',
    '## Status ladder', '',
    `Order from lowest to highest: ${T.levels.join(' < ')}.`, '',
    '- Missing data is `unknown`, never `normal`.',
    '- A stale critical reading stays `critical` and says "last reported N minutes ago" until a newer reading replaces it.',
    `- A stale watch or elevated reading makes the box \`unknown\` with priority ${T.priority.unknownWithStaleHazard}, never \`normal\`.`,
    `- Offline alone (silent over ${T.freshness.offlineMin} minutes) is never critical and never normal.`,
    '- A reading outside the valid range is discarded and logged, never clamped.',
    `- The highest triggered rule wins. Evidence is searched ${T.freshness.lookbackDays} days back.`, '',
    '## Sensors, units, valid range, stale time and rules', '',
    'A rule fires at its listed value in the listed direction. Rules are listed from highest level to lowest; the first match is the sensor reason.', '',
    '| Sensor | Unit | Valid range | Stale after | Rules (level: condition) |', '| --- | --- | --- | --- | --- |');
  for (const s of T.sensors) {
    const range = s.kind === 'num' ? `${s.min} to ${s.max}` : s.kind === 'enum' ? s.values.join(' / ') : 'true / false';
    const rules = s.rules.map(r => `${r.level}: ${trigger(r)} (${r.id})`).join('; ');
    p(`| \`${s.sensor}\` | ${s.unit ?? (s.kind === 'bool' ? 'boolean' : 'enum')} | ${range} | ${s.staleMin} min | ${rules} |`);
  }
  p('', '### Rules that need two readings', '', '| Rule | Level | Condition |', '| --- | --- | --- |');
  for (const c of T.compound) p(`| \`${c.id}\` | ${c.level} | ${c.text}; replaces the two separate watch reasons |`);
  p(`| \`water_rising\` | elevated | water_level_mm rises ${T.trend.waterRiseMm} mm or more within ${T.trend.windowMin} minutes (fresh reading required) |`);
  p('', '## Priority', '',
    `Base points: ${Object.entries(T.priority.base).map(([k, v]) => `${k} ${v}`).join(', ')}. Unknown with stale hazard evidence: ${T.priority.unknownWithStaleHazard}. Maximum 100.`, '',
    `Boosts: ${Object.entries(T.priority.boosts).map(([k, v]) => `${k} +${v}`).join(', ')}.`, '',
    `Tiers: ${T.priority.tiers.map(t => `${t.tier} at ${t.min} or more (${t.label})`).join('; ')}.`, '',
    '## Areas', '',
    `- Boxes group by geohash cell, precision ${T.region.precisions.join(', ')} (default ${T.region.defaultPrecision}). A cell needs ${T.region.minDevices} or more boxes to be reported.`,
    `- Possible grid or ISP outage: at least half the boxes offline with last-seen times within ${T.region.outageSpreadMin} minutes of each other. Otherwise offline boxes are reported as isolated.`,
    `- "Got worse" looks back ${T.region.worsenedWindowMin} minutes.`, '',
    '## Command-center card', '',
    `- Critical: water_detected true, or water_level_mm ${trigger(T.commandCenter.criticalWaterLevelMm)} mm; temp_c ${trigger(T.commandCenter.criticalTempC)} C; smoke or air alarm true; an unresolved critical alert.`,
    `- Warning: mains_power false, wan_connected false, or battery_pct ${trigger(T.commandCenter.warningBatteryPct)} percent.`,
    `- Stale after ${T.commandCenter.staleAfterSeconds} seconds. A stale card is \`unknown\` unless it is critical.`, '',
    '## Power profiles (proposals, not applied to hardware)', '',
    '| Profile | Sample every | Report every | Wi-Fi retry | Camera | Display |', '| --- | --- | --- | --- | --- | --- |');
  for (const [name, v] of Object.entries(T.power.profiles)) p(`| ${name} | ${v.sampleMs / 1000} s | ${v.reportMs / 1000} s | ${v.wifiRetryMs / 1000} s | ${v.camera ? 'allowed' : 'off'} | ${v.display ? 'allowed' : 'off'} |`);
  p('', `- Critical profile is chosen when temp_c ${trigger(T.power.criticalTempC)} C, sound_hits ${trigger(T.power.criticalSoundHits)}, water, flame or smoke is reported, or a critical incident is latched. Last-known critical evidence counts even when stale.`,
    '- Normal needs fresh external power. Power lost or unknown is saver.',
    `- Runtime projection = remaining Wh x (1 - reserve) / average W. Default reserve ${T.power.reserveFractionDefault}. Goal accepted from ${T.power.goalHoursMin} to ${T.power.goalHoursMax} hours. A projection is not verified endurance; alarms, logging, the help button and peer receive are never shed.`, '',
    '## Operator messages to boxes', '',
    `Title up to ${T.messages.titleMax} characters, body up to ${T.messages.bodyMax}, plain keyboard characters, no links, nothing that looks like a key. At most ${T.messages.maxLivePerDevice} live messages per box, ${T.messages.sendsPerMin} sends per minute per operator, ${T.messages.maxFanout} boxes per send. Default expiry ${T.messages.defaultExpiryMin} minutes, maximum ${T.messages.maxExpiryMin} minutes.`, '',
    `Logs are kept ${T.retention.deviceLogDays} days, the audit trail ${T.retention.auditDays} days. A poll cursor older than ${T.freshness.liveResetAfterMin} minutes returns a full snapshot; cursors overlap by ${T.freshness.liveCursorOverlapS} seconds.`, '',
    '## Observation views (the fixed filter names)', '',
    `A view uses 1 to ${T.views.maxFilters} of these names joined with ${T.views.combine.join(' or ')}. Title up to ${T.views.titleMax} characters, summary up to ${T.views.summaryMax}, up to ${T.views.contextIdsMax} cited context ids. The server computes the matches; the model only chooses names.`, '',
    '| Filter | Matches |', '| --- | --- |');
  for (const v of T.views.predicates) p(`| \`${v.name}\` | ${v.means} |`);
  p('', '## Public feed cache lifetimes', '', 'A cached feed record is context, never a live lookup, and never changes a box status.', '', '| Feed | Fresh for |', '| --- | --- |');
  for (const f of T.feeds) p(`| ${f.name} (\`${f.id}\`) | ${hours(f.ttlS)} |`);
  p('', `Forecast rain level (context only, never a box reading): heavy at a peak of ${T.rain.heavyPeakMmph} mm/h or ${T.rain.heavy24hMm} mm in 24 hours; moderate at ${T.rain.moderatePeakMmph} mm/h or ${T.rain.moderate24hMm} mm in 24 hours. Heavy rain adds priority only when the box also has a water or moisture signal.`);
  p('', '## Not claimed', '',
    '- Flame and sound sensors are proxies, not certified fire or smoke detectors. Water ADC counts are not depth without calibration. PIR does not prove a home is empty.',
    '- Power targets (24 hour design target, 72 hour stretch) are not measured.',
    '- No number here is a damage probability, a safe-entry decision or a coverage decision.', '');
  return out.join('\n');
}

/** Compact thresholds text for the model pack. */
export function renderThresholdsPack(T = buildThresholds()) {
  const lines = [`Status ladder (low to high): ${T.levels.join(' < ')}. Missing data is unknown. Highest triggered rule wins.`,
    `Offline: silent over ${T.freshness.offlineMin} min (never critical, never normal). Command-center card stale after ${T.commandCenter.staleAfterSeconds} s. Power policy fresh for ${T.freshness.systemPolicyFreshS} s. Email says stale after ${T.freshness.customerEmailStaleMin} min.`,
    'Sensors (unit, valid range, stale time, rules level: condition):'];
  for (const s of T.sensors) {
    const shape = s.kind === 'num' ? `${s.unit}, valid ${s.min} to ${s.max}` : s.kind === 'enum' ? `one of ${s.values.join('/')}` : 'true or false';
    lines.push(`- ${s.sensor} (${shape}, stale after ${s.staleMin} min): ${s.rules.map(r => `${r.level} ${trigger(r)}`).join('; ')}`);
  }
  for (const c of T.compound) lines.push(`- Compound ${c.id}: ${c.level} when ${c.text}.`);
  lines.push(`- Trend water_rising: elevated when water_level_mm rises ${T.trend.waterRiseMm} mm or more within ${T.trend.windowMin} min.`,
    `Priority base: ${Object.entries(T.priority.base).map(([k, v]) => `${k} ${v}`).join(', ')}; unknown with stale hazard ${T.priority.unknownWithStaleHazard}; boosts ${Object.entries(T.priority.boosts).map(([k, v]) => `${k} +${v}`).join(', ')}; cap 100. Tiers ${T.priority.tiers.map(t => `${t.tier}>=${t.min} ${t.label}`).join(', ')}.`,
    `Forecast rain context: heavy at ${T.rain.heavyPeakMmph} mm/h peak or ${T.rain.heavy24hMm} mm per 24 h; not an observation at a home.`,
    `Areas: a geohash cell needs ${T.region.minDevices}+ boxes; possible outage when half or more are offline within ${T.region.outageSpreadMin} min of each other.`,
    `Command-center card: critical on water_detected or water_level_mm ${trigger(T.commandCenter.criticalWaterLevelMm)}, temp_c ${trigger(T.commandCenter.criticalTempC)}, smoke or air alarm; warning on mains off, internet down, battery_pct ${trigger(T.commandCenter.warningBatteryPct)}.`,
    `Power profiles (proposals): ${Object.entries(T.power.profiles).map(([k, v]) => `${k} sample ${v.sampleMs / 1000}s report ${v.reportMs / 1000}s wifi retry ${v.wifiRetryMs / 1000}s`).join('; ')}. Alarms, logging, help button and peer receive are never shed.`,
    `Messages: title <= ${T.messages.titleMax}, body <= ${T.messages.bodyMax}, no links, ${T.messages.maxLivePerDevice} live per box, ${T.messages.sendsPerMin} sends/min.`);
  return lines.join('\n');
}
