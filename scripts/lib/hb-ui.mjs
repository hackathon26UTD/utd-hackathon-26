// Terminal output helpers: colors (TTY only, honors NO_COLOR), tables, ages.
const CODES = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90 };

export function makeColors(enabled) {
  const out = { enabled };
  for (const [name, code] of Object.entries(CODES)) out[name] = (s) => (enabled ? `\u001b[${code}m${s}\u001b[0m` : String(s));
  return out;
}

/** Color is on only for a TTY, never with NO_COLOR or --no-color, and forced by FORCE_COLOR. */
export function colorEnabled({ env = {}, flags = {}, isTTY = false }) {
  if (flags['no-color'] === true || flags.color === false) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (flags.color === true) return true;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  return Boolean(isTTY) && env.TERM !== 'dumb';
}

const strip = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '');
export const visibleLength = (s) => strip(s).length;
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - visibleLength(s)));

export function table(rows, columns, { gap = 2 } = {}) {
  if (!rows.length) return '';
  const cols = columns.map((c) => (typeof c === 'string' ? { key: c, title: c } : c));
  const cell = (r, c) => String(c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? '-');
  const widths = cols.map((c) => Math.max(visibleLength(c.title), ...rows.map((r) => visibleLength(cell(r, c)))));
  const line = (vals) => vals.map((v, i) => (i === vals.length - 1 ? v : pad(v, widths[i]))).join(' '.repeat(gap)).trimEnd();
  return [line(cols.map((c) => c.title)), ...rows.map((r) => line(cols.map((c) => cell(r, c))))].join('\n');
}

export function age(ms) {
  if (!Number.isFinite(ms)) return 'never';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
export const ageOf = (iso, now = Date.now()) => (iso ? age(now - Date.parse(iso)) : 'never');
