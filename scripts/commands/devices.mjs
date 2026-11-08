import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { table, ageOf } from '../lib/hb-ui.mjs';
import { usageError } from '../lib/hb-errors.mjs';

const ID = /^[a-f0-9]{24}$/i;

export default {
  name: 'devices',
  summary: 'List, inspect and register devices',
  usage: 'hb devices [list] [--exercise] | show <id> | register <name> [--type esp32] [--key-file path]',
  async run(args, ctx) {
    const sub = args[0] && !ID.test(args[0]) ? args[0] : 'list';
    const rest = sub === 'list' && args[0] !== 'list' ? args : args.slice(1);
    if (sub === 'list') {
      const r = await ctx.api.ok('/api/ops/live', { auth: 'admin', query: { mode: ctx.flags.exercise ? 'exercise' : undefined } });
      const now = ctx.now();
      const rows = (r.data?.devices || []).map((d) => ({ id: d.id, name: d.name, offline: d.offline, lastSeen: d.lastSeen, tier: d.risk?.tier || d.risk?.level || null, exercise: d.exercise === true }));
      ctx.emit({ mode: r.data?.mode, devices: rows }, () => {
        const c = ctx.c;
        if (!rows.length) { ctx.out(c.dim('No devices registered in this mode.')); return; }
        ctx.out(table(rows, [
          { key: 'id', title: 'ID' }, { key: 'name', title: 'NAME' },
          { key: 'offline', title: 'STATE', fmt: (v) => (v ? c.yellow('offline') : c.green('online')) },
          { key: 'lastSeen', title: 'LAST SEEN', fmt: (v) => (v ? ageOf(v, now) + ' ago' : 'never') },
          { key: 'tier', title: 'RISK' },
        ]));
        ctx.out(c.dim(`${rows.length} device(s), mode ${r.data?.mode}`));
      });
      return 0;
    }
    if (sub === 'show') {
      const id = rest[0];
      if (!id || !ID.test(id)) throw usageError('Usage: hb devices show <24-hex device id>');
      const r = await ctx.api.ok('/api/ops/device', { auth: 'admin', query: { id } });
      ctx.emit(r.data, (d) => {
        const dev = d.device || {};
        ctx.out(`${ctx.c.bold(dev.name || id)}  ${dev.offline ? ctx.c.yellow('offline') : ctx.c.green('online')}  last seen ${dev.lastSeen ? ageOf(dev.lastSeen, ctx.now()) + ' ago' : 'never'}`);
        const latest = d.latest || {};
        const keys = Object.keys(latest).sort();
        if (keys.length) ctx.out(table(keys.map((k) => ({ sensor: k, value: latest[k]?.value ?? latest[k], seen: latest[k]?.observedAt ? ageOf(latest[k].observedAt, ctx.now()) + ' ago' : '-' })), [{ key: 'sensor', title: 'SENSOR' }, { key: 'value', title: 'VALUE' }, { key: 'seen', title: 'SEEN' }]));
        else ctx.out(ctx.c.dim('No readings. Missing data is unknown, not safe.'));
        if (d.risk) ctx.out(`risk: ${d.risk.level || d.risk.tier || JSON.stringify(d.risk).slice(0, 80)}`);
      });
      return 0;
    }
    if (sub === 'register') {
      const name = rest.join(' ').trim();
      if (!name || name.length > 80) throw usageError('Usage: hb devices register <name> [--type esp32] [--key-file path] (name 1 to 80 chars)');
      const body = { name, type: typeof ctx.flags.type === 'string' ? ctx.flags.type : 'esp32' };
      if (ctx.flags['dry-run']) { ctx.emit({ dryRun: true, body }, () => ctx.out(`Would register: ${JSON.stringify(body)}`)); return 0; }
      const r = await ctx.api.ok('/api/devices', { method: 'POST', auth: 'admin', body });
      const key = r.data?.deviceKey;
      const id = r.data?.device?.id || r.data?.device?._id;
      // The device key is shown once by the server. Save it to a private file instead of the terminal.
      const file = resolve(ctx.repoRoot, typeof ctx.flags['key-file'] === 'string' ? ctx.flags['key-file'] : `.secrets/device-${id}.key`);
      let saved = null;
      if (key) {
        if (existsSync(file)) throw usageError(`Refusing to overwrite ${file}`);
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(file, key + '\n', { mode: 0o600 });
        saved = file;
      }
      ctx.emit({ id, name, type: body.type, keyFile: saved }, () => {
        ctx.out(`${ctx.c.green('registered')} ${name} (${id})`);
        ctx.out(`device key saved to ${saved} (mode 600, not printed). Put it in the board secrets header, then record it in the credentials registry.`);
      });
      return 0;
    }
    throw usageError(`Unknown devices subcommand "${sub}". Use list, show or register.`);
  },
};
