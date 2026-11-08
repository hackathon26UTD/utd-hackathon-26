import { randomUUID } from 'node:crypto';
import provision, { privatePath, reservePrivateFile, privateRequest } from './provision.mjs';
import { DEVICE_KEY_RE } from '../lib/labels.mjs';
import { table, ageOf } from '../lib/hb-ui.mjs';
import { usageError } from '../lib/hb-errors.mjs';

const ID = /^[a-f0-9]{24}$/i;

export default {
  name: 'devices',
  summary: 'List, inspect, register and provision devices',
  booleans: ['exercise', ...provision.booleans],
  usage: 'hb devices [list] [--exercise] | show <id> | register <name> [--type esp32] [--key-file path] | provision [batch|add|rotate] (see hb provision --help)',
  async run(args, ctx) {
    if (args[0] === 'provision') return provision.run(args.slice(1), ctx);
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
      if (ctx.flags['key-file'] !== undefined && (typeof ctx.flags['key-file'] !== 'string' || !ctx.flags['key-file'])) throw usageError('--key-file requires a private filename.');
      const file = privatePath(ctx.repoRoot, ctx.flags['key-file'] ?? `.secrets/device-${randomUUID()}.key`);
      if (ctx.flags['dry-run']) { ctx.emit({ dryRun: true, body, keyFile: file }, () => ctx.out(`Would register: ${JSON.stringify(body)}`)); return 0; }
      const output = reservePrivateFile(ctx.repoRoot, file);
      try {
        const r = await privateRequest(ctx, '/api/devices', { method: 'POST', auth: 'admin', body });
        const key = r.data?.deviceKey;
        const id = r.data?.device?.id || r.data?.device?._id;
        if (!DEVICE_KEY_RE.test(key)) throw usageError('Registration returned no usable key. Inspect the fleet before retrying.');
        output.write(key + '\n');
        if (!ID.test(id)) throw usageError('Registration returned no usable device id. The key was saved privately; inspect the fleet before retrying.');
        ctx.emit({ id, name, type: body.type, keyFile: file }, () => {
          ctx.out(`${ctx.c.green('registered')} ${name} (${id})`);
          ctx.out(`Device key saved to ${file} (mode 600, not printed).`);
        });
        return 0;
      } finally { output.close(); }
    }
    throw usageError(`Unknown devices subcommand "${sub}". Use list, show, register or provision.`);
  },
};
