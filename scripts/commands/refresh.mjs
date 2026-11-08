import { intFlag } from '../lib/hb-args.mjs';
import { usageError } from '../lib/hb-errors.mjs';

export default {
  name: 'refresh',
  summary: 'Ask the server to refresh due data sources now',
  usage: 'hb refresh [sourceId] [--limit 3] [--admin]   (job token by default, --admin uses the operator key)',
  async run(args, ctx) {
    let limit;
    try { limit = intFlag(ctx.flags, 'limit', { min: 1, max: 5, fallback: 3 }); } catch (e) { throw usageError(e.message); }
    const auth = ctx.flags.admin || !ctx.env.DATA_JOB_TOKEN ? 'admin' : 'job';
    const r = await ctx.api.ok('/api/ops/data-refresh', { method: 'POST', auth, body: { limit }, timeoutMs: 60000 });
    const all = Array.isArray(r.data?.outcomes) ? r.data.outcomes : Array.isArray(r.data?.results) ? r.data.results : Array.isArray(r.data) ? r.data : [];
    const shown = args[0] ? all.filter((o) => o.id === args[0]) : all;
    const note = args[0] ? 'The server refreshes whichever sources are due (up to the limit); a specific source cannot be forced.' : undefined;
    ctx.emit({ auth, limit, note, outcomes: shown, raw: all.length ? undefined : r.data }, () => {
      const c = ctx.c;
      if (!all.length) ctx.out(c.dim('No sources were due. Nothing refreshed.'));
      else if (args[0] && !shown.length) ctx.out(c.yellow(`"${args[0]}" was not due, so it was not refreshed this call.`));
      for (const o of shown) ctx.out(`${o.status === 'ok' ? c.green('ok   ') : c.yellow(String(o.status).padEnd(5))} ${o.id}${o.featureCount != null ? c.dim(` ${o.featureCount} features`) : ''}${o.error ? ' ' + o.error : ''}`);
      if (note) ctx.out(c.dim(note));
    });
    return shown.some((o) => o.status === 'error') ? 1 : 0;
  },
};
