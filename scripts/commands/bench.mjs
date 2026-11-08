// hb bench: API latency, Atlas connection timing and (optionally) page weight.
//   npm run hb -- bench [--target live|local|both] [--runs 15] [--url ...] [--no-db] [--site] [--json]
// The dispatcher parses flags and hands over only positionals, so rebuild argv from ctx.flags here.
// Without this, --url, --target, --runs and --no-db were dropped and a "local" bench hit production.

/** Rebuild the argv that scripts/bench-api.mjs and scripts/bench-site.mjs read. */
export function benchArgv(args = [], flags = {}) {
  const argv = [...args];
  const val = (k, v) => { if (typeof v === 'string' || typeof v === 'number') argv.push(`--${k}`, String(v)); };
  val('target', flags.target ?? (flags.local ? 'local' : undefined));
  val('runs', flags.runs);
  // --site is the page-weight switch here. Given a value it is also the URL to measure.
  val('url', flags.url ?? (typeof flags.site === 'string' ? flags.site : undefined));
  val('paths', flags.paths);
  val('profile', flags.profile);
  if (flags['no-db'] === true || flags.db === false) argv.push('--no-db');
  if (flags.json) argv.push('--json');
  return argv;
}

export default {
  name: 'bench',
  summary: 'Time the API, the database connection and (with --site) page load',
  usage: 'bench [--target live|local|both] [--runs N] [--url URL] [--no-db] [--site] [--profile mobile|desktop] [--json]',
  booleans: ['no-db'],
  async run(args, ctx) {
    const flags = ctx.flags || {};
    const argv = benchArgv(args, flags);
    const { main } = await import('../bench-api.mjs');
    const code = await main(argv, (msg) => ctx.log(msg));
    if (code || !flags.site) return code;
    // Page metrics: a bare local bench must measure the local server, never production.
    const siteArgv = [...argv];
    if (!siteArgv.includes('--url') && (flags.local || flags.target === 'local')) siteArgv.push('--url', 'http://127.0.0.1:8788');
    const { main: site } = await import('../bench-site.mjs');
    return site(siteArgv, (msg) => ctx.log(msg));
  },
};
