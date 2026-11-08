import { table, age } from '../lib/hb-ui.mjs';
import { feedFreshness } from './status.mjs';

export default {
  name: 'feeds',
  summary: 'List data sources with last success age, cadence and state',
  usage: 'hb feeds [sourceId] [--stale] [--json]',
  async run(args, ctx) {
    const r = await ctx.api.ok('/api/ops/data-catalog', { auth: 'admin' });
    const now = ctx.now();
    const raw = r.data?.sources || [];
    let rows = await feedFreshness(raw, now);
    if (args[0]) rows = rows.filter((s) => s.id === args[0]);
    if (args[0] && !rows.length) { ctx.error(`no source "${args[0]}". Run: hb feeds`); return 1; }
    if (ctx.flags.stale) rows = rows.filter((s) => s.state !== 'fresh');
    const view = rows.map((s) => ({ ...s, ageText: s.lastSuccessAt ? age(now - Date.parse(s.lastSuccessAt)) : 'never' }));
    ctx.emit({ asOf: r.data?.asOf, sources: view }, () => {
      const c = ctx.c;
      const color = { fresh: c.green, stale: c.red, needs_key: c.yellow, never: c.yellow, unknown: c.gray };
      ctx.out(table(view, [
        { key: 'id', title: 'SOURCE' },
        { key: 'state', title: 'STATE', fmt: (v) => (color[v] || String)(v) },
        { key: 'ageText', title: 'LAST OK' },
        { key: 'cadenceSeconds', title: 'EVERY', fmt: (v) => age(v * 1000) },
        { key: 'status', title: 'LAST RUN' },
      ]));
    });
    return 0;
  },
};
