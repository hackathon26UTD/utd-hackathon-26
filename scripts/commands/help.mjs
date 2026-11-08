const GROUPS = [
  ['Monitor', ['status', 'health', 'devices', 'feeds']],
  ['Act', ['send-message', 'refresh', 'simulate']],
  ['Hardware and agent', ['agent', 'bench']],
  ['Email and harness', ['email', 'harness']],
  ['Reference', ['thresholds', 'docs']],
  ['Release', ['deploy-check']],
  ['Shell', ['help', 'completion']],
];

export default {
  name: 'help',
  summary: 'List every command, grouped, with a one-line summary',
  usage: 'hb help [command]',
  async run(args, ctx) {
    const cmds = ctx.commands;
    if (args[0]) {
      const c = cmds.get(args[0]);
      if (!c) { ctx.error(`unknown command "${args[0]}"`); return 2; }
      ctx.emit({ name: c.name, summary: c.summary, usage: c.usage }, () => {
        ctx.out(`${ctx.c.bold(c.name)}  ${c.summary}\n\nUsage: ${c.usage}`);
      });
      return 0;
    }
    const placed = new Set();
    const groups = [];
    for (const [title, names] of GROUPS) {
      const items = names.filter((n) => cmds.has(n)).map((n) => cmds.get(n));
      items.forEach((i) => placed.add(i.name));
      if (items.length) groups.push({ title, items });
    }
    // Commands added later by other modules land in their declared group, or "More".
    const extra = [...cmds.values()].filter((c) => !placed.has(c.name));
    for (const c of extra) {
      const title = c.group || 'More';
      const g = groups.find((x) => x.title === title) || groups[groups.push({ title, items: [] }) - 1];
      g.items.push(c);
    }
    const data = {
      version: ctx.version,
      commands: groups.flatMap((g) => g.items.map((c) => ({ name: c.name, group: g.title, summary: c.summary, usage: c.usage }))),
      unavailable: ctx.broken,
    };
    ctx.emit(data, () => {
      const c = ctx.c;
      ctx.out(`${c.bold('HomeBeacon dev CLI')} ${c.dim(`v${ctx.version}`)}   ${c.dim('npm run hb -- <command> [flags]')}\n`);
      const width = Math.max(...data.commands.map((x) => x.name.length));
      for (const g of groups) {
        ctx.out(c.cyan(g.title));
        for (const i of g.items) ctx.out(`  ${c.bold(i.name.padEnd(width))}  ${i.summary}`);
        ctx.out('');
      }
      if (ctx.broken.length) {
        ctx.out(c.yellow('Unavailable (failed to load):'));
        for (const b of ctx.broken) ctx.out(`  ${b.file}: ${b.error}`);
        ctx.out('');
      }
      ctx.out(c.dim('Global flags: --json  --local (127.0.0.1:8788)  --site <url>  --no-color  --verbose  --quiet  --help'));
      ctx.out(c.dim('Exit codes: 0 ok, 1 failed, 2 usage, 3 network/server, 4 auth or missing credential'));
    });
    return 0;
  },
};
