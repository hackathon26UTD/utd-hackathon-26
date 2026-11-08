import { intFlag } from '../lib/hb-args.mjs';
import { usageError } from '../lib/hb-errors.mjs';

const ID = /^[a-f0-9]{24}$/i;
export const SEVERITIES = ['info', 'advisory', 'urgent'];

/** "30", "30m", "2h", "1d" to whole minutes. */
export function parseTtl(v) {
  const m = /^(\d+)\s*([mhd]?)$/i.exec(String(v));
  if (!m) throw usageError('--ttl must look like 30, 30m, 2h or 1d');
  const mins = Number(m[1]) * ({ '': 1, m: 1, h: 60, d: 1440 }[m[2].toLowerCase()]);
  if (mins < 1 || mins > 10080) throw usageError('--ttl must be between 1 minute and 7 days');
  return mins;
}

export default {
  name: 'send-message',
  summary: 'Send a short text box to one device (shown on its screen)',
  usage: 'hb send-message <deviceId> <text> [--title "Operator note"] [--severity info|advisory|urgent] [--ttl 6h] [--ack] [--dry-run]',
  booleans: ['ack'],
  async run(args, ctx) {
    const [deviceId, ...words] = args;
    const text = words.join(' ').trim();
    if (!deviceId || !ID.test(deviceId) || !text) throw usageError('Usage: hb send-message <24-hex deviceId> <text> [--severity ..] [--ttl ..]');
    const severity = ctx.flags.severity || 'info';
    if (!SEVERITIES.includes(severity)) throw usageError(`--severity must be one of ${SEVERITIES.join(', ')}`);
    const title = typeof ctx.flags.title === 'string' ? ctx.flags.title : 'Operator note';
    if (title.length > 20) throw usageError('--title can be at most 20 characters (small screen)');
    if (text.length > 80) throw usageError(`Message is ${text.length} characters; the small screen allows 80.`);
    if (!/^[\x20-\x7E]*$/.test(text)) throw usageError('Use plain keyboard characters only.');
    const body = { scope: { type: 'device', deviceIds: [deviceId.toLowerCase()] }, kind: 'info', severity, title, body: text, expiresInMin: ctx.flags.ttl ? parseTtl(ctx.flags.ttl) : 360, requiresAck: ctx.flags.ack === true };
    if (ctx.flags['dry-run']) { ctx.emit({ dryRun: true, request: body }, () => ctx.out(`Would send to ${deviceId}: [${severity}] ${title}: ${text}`)); return 0; }
    const r = await ctx.api.ok('/api/ops/messages', { method: 'POST', auth: 'admin', body });
    ctx.emit({ message: r.data?.message, deliveries: r.data?.deliveries }, () => {
      ctx.out(`${ctx.c.green('queued')} for ${deviceId} (${r.data?.deliveries ?? 0} delivery). The device picks it up on its next poll; delivered is not acknowledged.`);
    });
    return 0;
  },
};
