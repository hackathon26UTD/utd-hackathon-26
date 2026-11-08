// Tiny argument parser. Flags: --k v, --k=v, --flag, --no-flag, -h. Everything else is positional.
// Value flags never swallow the next token if it starts with "--". Boolean flags never take a value.
export const GLOBAL_BOOLEANS = ['json', 'local', 'help', 'h', 'version', 'verbose', 'quiet', 'no-color', 'color', 'yes', 'all', 'once', 'live', 'dry-run', 'full', 'no-deployment', 'skip-tests', 'skip-build', 'offline', 'list', 'admin'];

export function parseArgs(argv, { booleans = [] } = {}) {
  const bool = new Set([...GLOBAL_BOOLEANS, ...booleans]);
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      const inline = eq > 0 ? a.slice(eq + 1) : undefined;
      if (name.startsWith('no-') && !bool.has(name) && inline === undefined) { flags[name.slice(3)] = false; continue; }
      if (inline !== undefined) { flags[name] = bool.has(name) ? !/^(false|0|no)$/i.test(inline) : inline; continue; }
      if (bool.has(name)) { flags[name] = true; continue; }
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && next.length > 2)) flags[name] = true;
      else { flags[name] = next; i++; }
      continue;
    }
    positionals.push(a);
  }
  return { positionals, flags };
}

/** Integer flag with bounds. Throws a plain message on bad input. */
export function intFlag(flags, name, { min = -Infinity, max = Infinity, fallback } = {}) {
  const v = flags[name];
  if (v === undefined || v === false) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be a whole number from ${min} to ${max}`);
  return n;
}
