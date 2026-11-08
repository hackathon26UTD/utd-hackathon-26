// The fixed, read-only view predicates behind POST /api/layers. This is the one definition:
// functions/api/layers.js imports it, and the harness describes it to the model from it.
// A predicate only reads a recorded observation. It never changes data or priority.

export const WATER_LEVEL_MM = 20;
export const BATTERY_LOW_PCT = 20;
export const VIEW_MAX_FILTERS = 3;
export const VIEW_COMBINE = Object.freeze(['all', 'any']);
export const VIEW_TITLE_MAX = 80;
export const VIEW_SUMMARY_MAX = 600;
export const VIEW_CONTEXT_IDS_MAX = 8;

export const VIEW_PREDICATES = Object.freeze({
  power_lost: p => p.values?.mains_power === false,
  water: p => p.values?.water_detected === true || Number(p.values?.water_level_mm) >= WATER_LEVEL_MM,
  connectivity_lost: p => p.values?.wan_connected === false,
  stale: p => p.stale,
  battery_low: p => typeof p.values?.battery_pct === 'number' && p.values.battery_pct <= BATTERY_LOW_PCT,
  critical: p => p.severity === 'critical',
});

export const VIEW_PREDICATE_NAMES = Object.freeze(Object.keys(VIEW_PREDICATES));

/** Plain meaning of each predicate, used in the grounding pack and docs. Numbers come from the constants above. */
export const VIEW_PREDICATE_INFO = Object.freeze({
  power_lost: { means: 'Boxes whose latest recorded mains_power value is false (external power reported lost).' },
  water: { means: `Boxes with water_detected true, or water_level_mm of ${WATER_LEVEL_MM} or more.` },
  connectivity_lost: { means: 'Boxes whose latest recorded wan_connected value is false (internet reported down).' },
  stale: { means: 'Boxes whose latest observation is too old to count as current (unknown, not safe).' },
  battery_low: { means: `Boxes whose latest battery_pct is ${BATTERY_LOW_PCT} or less.` },
  critical: { means: 'Boxes whose recorded severity is critical.' },
});

/**
 * Checks a model-proposed view. Mirrors the server's acceptance rules in functions/api/layers.js and adds the
 * documented length limits. validContextIds is the set of supplied external-context record ids.
 */
export function validateViewProposal(proposal, validContextIds = new Set()) {
  const errors = [];
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return { ok: false, errors: ['proposal must be a JSON object'] };
  const f = proposal.filters;
  if (!Array.isArray(f) || f.length < 1 || f.length > VIEW_MAX_FILTERS) errors.push(`filters must list 1 to ${VIEW_MAX_FILTERS} names`);
  else if (!f.every(x => typeof x === 'string' && Object.hasOwn(VIEW_PREDICATES, x))) errors.push('filters contains an unsupported name');
  if (!VIEW_COMBINE.includes(proposal.combine)) errors.push('combine must be all or any');
  if (typeof proposal.title !== 'string' || !proposal.title.trim()) errors.push('title must be text');
  else if (proposal.title.length > VIEW_TITLE_MAX) errors.push(`title is over ${VIEW_TITLE_MAX} characters`);
  if (typeof proposal.summary !== 'string' || !proposal.summary.trim()) errors.push('summary must be text');
  else if (proposal.summary.length > VIEW_SUMMARY_MAX) errors.push(`summary is over ${VIEW_SUMMARY_MAX} characters`);
  const c = proposal.contextEvidenceIds;
  if (!Array.isArray(c) || c.length > VIEW_CONTEXT_IDS_MAX) errors.push(`contextEvidenceIds must be a list of up to ${VIEW_CONTEXT_IDS_MAX} ids`);
  else if (!c.every(id => validContextIds.has(id))) errors.push('contextEvidenceIds cites a record that was not supplied');
  return { ok: errors.length === 0, errors };
}
