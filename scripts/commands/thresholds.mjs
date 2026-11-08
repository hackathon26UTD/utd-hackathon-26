import { collectThresholds } from '../lib/hb-thresholds.mjs';

export default {
  name: 'thresholds',
  summary: 'Print every alert, risk and power threshold from the real source files',
  usage: 'hb thresholds [filter] [--json]   (filter matches group, name or file)',
  async run(args, ctx) {
    const all = await collectThresholds(ctx.repoRoot);
    const q = (args[0] || '').toLowerCase();
    const groups = all.map((g) => {
      const groupHit = `${g.name} ${g.source}`.toLowerCase().includes(q);
      return { ...g, items: groupHit ? g.items : g.items.filter((i) => `${i.name} ${i.value} ${i.note || ''}`.toLowerCase().includes(q)) };
    }).filter((g) => g.items.length);
    if (!groups.length) { ctx.error(`nothing matches "${args[0]}"`); return 1; }
    ctx.emit({ groups }, () => {
      const c = ctx.c;
      for (const g of groups) {
        ctx.out(`${c.cyan(c.bold(g.name))}  ${c.dim(g.source)}`);
        const w = Math.max(...g.items.map((i) => i.name.length));
        for (const i of g.items) ctx.out(`  ${i.name.padEnd(w)}  ${c.bold(String(i.value))}${i.note ? c.dim('  ' + i.note) : ''}`);
        ctx.out('');
      }
      ctx.out(c.dim('Advisory only. Missing data is unknown; stale critical evidence never turns safe.'));
    });
    return 0;
  },
};
