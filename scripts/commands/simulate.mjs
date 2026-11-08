import { join } from 'node:path';
import { run, flagsToArgv } from '../lib/hb-proc.mjs';
import { adminKeyFor, isLocalSite } from '../lib/hb-http.mjs';
import { usageError } from '../lib/hb-errors.mjs';

export default {
  name: 'simulate',
  summary: 'Run fake devices, offline scenarios or the in-memory system demo',
  usage: 'hb simulate [device] [--scenario quiet|flood|fire|outage|storm|aqi|mixed] [--devices 12] [--once] | scenario [--schema|--minute N] | demo [--nvidia]',
  booleans: ['once', 'schema', 'nvidia', 'live', 'yes-this-is-live'],
  async run(args, ctx) {
    const known = ['device', 'scenario', 'demo'];
    const sub = known.includes(args[0]) ? args[0] : 'device';
    const rest = known.includes(args[0]) ? args.slice(1) : args;
    if (rest.length) throw usageError(`Unexpected argument "${rest[0]}". Options all start with --.`);
    const passthrough = flagsToArgv(ctx.flags, { drop: ['json', 'local', 'site', 'no-color', 'color', 'verbose', 'quiet', 'yes', 'help'] });
    const base = { cwd: ctx.repoRoot, timeoutMs: 24 * 3600 * 1000, inherit: true };
    if (sub === 'scenario') return (await run(process.execPath, [join(ctx.repoRoot, 'scripts/simulations.mjs'), ...passthrough], { ...base, env: process.env })).code;
    if (sub === 'demo') return (await run(process.execPath, [join(ctx.repoRoot, 'scripts/system-demo.mjs'), ...passthrough], { ...base, env: process.env })).code;
    // Device simulator writes exercise data over HTTP. A remote site needs an explicit --yes.
    if (!isLocalSite(ctx.site) && ctx.flags.yes !== true) {
      throw usageError(`This would send simulated devices to ${ctx.site}. Re-run with --yes to confirm, or use --local.`);
    }
    const env = { ...process.env, API_ADMIN_KEY: adminKeyFor(ctx.site, ctx.env) };
    return (await run(process.execPath, [join(ctx.repoRoot, 'scripts/simulate-device.mjs'), '--base', ctx.site, ...passthrough], { ...base, env })).code;
  },
};
