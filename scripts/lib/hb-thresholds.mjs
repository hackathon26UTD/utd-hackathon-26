// Collects every alert, risk and power threshold by IMPORTING the real constants and probing the real predicates.
// Nothing is copied: if a constant or rule changes in src/ or domain/, this output changes with it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const item = (name, value, note) => ({ name, value, ...(note ? { note } : {}) });

/** Find the numeric boundary of a ge/le style predicate by scanning its real range. */
function boundary(test, min, max, step = 0.5) {
  const hit = [];
  for (let v = min; v <= max; v = Math.round((v + step) * 1000) / 1000) { let t = false; try { t = test(v); } catch { /* ignore */ } if (t) hit.push(v); }
  if (!hit.length) return null;
  if (hit[0] === min && hit[hit.length - 1] < max) return `<= ${hit[hit.length - 1]}`;
  if (hit[hit.length - 1] === max && hit[0] > min) return `>= ${hit[0]}`;
  if (hit.length === Math.round((max - min) / step) + 1) return 'always';
  return `${hit[0]} to ${hit[hit.length - 1]}`;
}

function riskRules(cfg) {
  const items = [];
  for (const [sensor, def] of Object.entries(cfg.SENSORS)) {
    for (const rule of def.rules) {
      let cond;
      if (def.kind === 'bool') cond = [true, false].filter((v) => rule.test(v)).map(String).join('/');
      else if (def.kind === 'enum') cond = `= ${def.values.filter((v) => rule.test(v)).join('/')}`;
      else cond = boundary(rule.test, def.min, def.max);
      items.push(item(`${sensor} -> ${rule.level}`, `${def.kind === 'bool' ? '= ' : ''}${cond}${def.unit ? ' ' + def.unit : ''}`, `${rule.hazard}; rule ${rule.id}; stale after ${def.staleMin} min`));
    }
  }
  for (const c of cfg.COMPOUND) {
    const v = { mains_power: false, battery_pct: 0 };
    const b = boundary((n) => c.test({ ...v, battery_pct: n }), 0, 100);
    items.push(item(`${c.id} -> ${c.level}`, `mains_power = false and battery_pct ${b}`, 'needs both sensors'));
  }
  return items;
}

function plain(v) {
  if (v instanceof RegExp) return String(v);
  if (typeof v === 'function') return null;
  if (Array.isArray(v)) return v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x)) ? v.join(', ') : JSON.stringify(v);
  if (v && typeof v === 'object') return JSON.stringify(v);
  return v;
}

function constants(mod, names) {
  return names.filter((n) => n in mod).map((n) => item(n, plain(mod[n])));
}

function firmwareDefines(root) {
  const groups = [];
  const fw = join(root, 'firmware');
  if (!existsSync(fw)) return groups;
  const files = [];
  for (const d of readdirSync(fw, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(fw, d.name))) if (/^(config|power_policy|.*policy.*)\.h$/.test(f)) files.push(`firmware/${d.name}/${f}`);
  }
  for (const rel of files.sort()) {
    const items = [];
    for (const line of readFileSync(join(root, rel), 'utf8').split('\n')) {
      const m = /^\s*#define\s+([A-Z][A-Z0-9_]*)\s+(-?[0-9][0-9A-Fa-fx_.UL]*)\s*(?:\/\/\s*(.*))?$/.exec(line);
      if (m && !/^PIN_/.test(m[1])) items.push(item(m[1], m[2], m[3]));
    }
    if (items.length) groups.push({ name: `Firmware ${rel.split('/')[1]}/${rel.split('/')[2]}`, source: rel, items });
  }
  return groups;
}

const KNOWN_DOMAIN = new Set(['system-policy.js', 'simulation.js', 'demo-addresses.js', 'demo-scenarios.js', 'exercise.js', 'property.js']);

export async function collectThresholds(root) {
  const imp = (rel) => import(pathToFileURL(join(root, rel)).href);
  const groups = [];
  const cfg = await imp('src/risk/config.js');
  groups.push({ name: 'Risk levels and timing', source: 'src/risk/config.js', items: constants(cfg, ['LEVELS', 'OFFLINE_MIN', 'TREND', 'REGION', 'LOOKBACK_DAYS', 'UNKNOWN_STALE_HAZARD', 'PRIORITY_BASE', 'BOOST', 'TIERS']).map((i) => (i.name === 'TIERS' ? item('TIERS', cfg.TIERS.map((t) => `${t.tier} >= ${t.min} (${t.label})`).join('; ')) : i)) });
  groups.push({ name: 'Sensor alert rules (level, hazard, staleness)', source: 'src/risk/config.js', items: riskRules(cfg) });

  const pol = await imp('domain/system-policy.js');
  const polItems = [item('FRESH_MS', pol.FRESH_MS, 'evidence older than this is not fresh; stale critical evidence never turns safe')];
  for (const [mode, p] of Object.entries(pol.POWER_PROFILES)) polItems.push(item(`POWER_PROFILES.${mode}`, JSON.stringify(p)));
  // Inline literals inside devicePolicy: probe the real function to find them.
  const now = new Date();
  const fresh = (k, v) => ({ id: 'x', latest: { [k]: { value: v, observedAt: now.toISOString() } } });
  const flips = (k, lo, hi, step) => { for (let v = lo; v <= hi; v += step) if (pol.devicePolicy(fresh(k, v), now).mode === 'critical') return v; return null; };
  polItems.push(item('critical temp_c', `>= ${flips('temp_c', 0, 100, 1)} C`, 'devicePolicy enters critical power mode'));
  polItems.push(item('critical sound_hits', `>= ${flips('sound_hits', 0, 30, 1)}`, 'devicePolicy enters critical power mode'));
  let low = null; let high = null;
  for (let g = 0; g <= 200; g++) { try { pol.powerBudget([], {}, g); if (low === null) low = g; high = g; } catch { /* out of range */ } }
  polItems.push(item('goalHours', `${low} to ${high}`, 'accepted by powerBudget'));
  polItems.push(item('reserveFraction (default)', pol.powerBudget([], {}, 24).reserveFraction, 'share of battery held back in projections'));
  groups.push({ name: 'Power policy (software)', source: 'domain/system-policy.js', items: polItems });

  const sim = await imp('domain/simulation.js');
  groups.push({ name: 'Simulation defaults', source: 'domain/simulation.js', items: [item('thresholds', JSON.stringify(sim.DEFAULT_SIMULATION.thresholds), 'illustrative; do not reuse as safety limits')] });

  const live = await imp('src/live.js');
  const msg = await imp('src/messages.js');
  groups.push({ name: 'Device link and messaging', source: 'src/live.js, src/messages.js', items: [
    item('OFFLINE_MS', live.OFFLINE_MS, 'silent longer than this shows offline (never critical alone)'),
    ...constants(msg, ['TITLE_MAX', 'BODY_MAX', 'MAX_LIVE_PER_DEVICE', 'MAX_FANOUT', 'SENDS_PER_MIN', 'DEFAULT_EXPIRY_MIN', 'MAX_EXPIRY_MIN']),
  ] });

  // Any other domain/*.js module (for example a new power policy) is picked up automatically.
  const dir = join(root, 'domain');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js') && !KNOWN_DOMAIN.has(x)).sort()) {
    try {
      const mod = await imp(`domain/${f}`);
      const items = Object.keys(mod).filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k) && plain(mod[k]) !== null).map((k) => item(k, plain(mod[k])));
      if (items.length) groups.push({ name: `Domain ${f}`, source: `domain/${f}`, items });
    } catch { /* module needs unavailable deps; skip */ }
  }
  groups.push(...firmwareDefines(root));
  return groups;
}
