
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

export default {
  name: 'health',
  summary: 'Ping the API and database several times and report latency',
  usage: 'hb health [--samples 3] [--json]',
  async run(args, ctx) {
    const n = Math.min(10, Math.max(1, Number(ctx.flags.samples) || 3));
    const ready = [];
    for (let i = 0; i < n; i++) ready.push(await ctx.api('/api/ready'));
    const health = await ctx.api('/api/health');
    const times = ready.map((r) => r.ms);
    const okAll = ready.every((r) => r.ok && r.data?.status === 'ready');
    const data = {
      site: ctx.site, ready: okAll, samples: n,
      latencyMs: { min: Math.min(...times), median: median(times), max: Math.max(...times) },
      mongodbConnected: ready.every((r) => r.data?.mongodb?.connected === true),
      health: health.ok ? { status: health.data?.status ?? 'ok', reachable: health.data?.reachable ?? null, dbLatencyMs: health.data?.latencyMs ?? health.data?.latency_ms ?? null } : { status: `HTTP ${health.status}` },
      slow: median(times) > 1500,
    };
    ctx.emit(data, () => {
      const c = ctx.c;
      ctx.out(`${okAll ? c.green('READY') : c.red('NOT READY')}  ${ctx.site}`);
      ctx.out(`  database   ${data.mongodbConnected ? c.green('connected') : c.red('not connected')}`);
      ctx.out(`  latency    min ${data.latencyMs.min} ms, median ${data.latencyMs.median} ms, max ${data.latencyMs.max} ms (${n} samples)`);
      if (data.slow) ctx.out(c.yellow('  slow: median over 1500 ms. Edge to Atlas is usually 100 to 300 ms.'));
      if (health.ok && data.health.dbLatencyMs != null) ctx.out(`  /api/health database ping ${data.health.dbLatencyMs} ms`);
    });
    return okAll ? 0 : 1;
  },
};
