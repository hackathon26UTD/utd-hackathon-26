// npm run hb -- email <list | preview [template|all] [--shots] | send-test <template> [--to sink] [--keychain] [--dry-run]>
import { main } from '../email.mjs';

/**
 * The dispatcher hands over positionals only. Rebuild argv from ctx.flags so --to, --keychain,
 * --dry-run, --out and --shots reach scripts/email.mjs.
 */
export function emailArgv(args = [], flags = {}) {
  const argv = [...args];
  for (const k of ['shots', 'keychain', 'dry-run', 'json', 'dark']) if (flags[k] === true) argv.push(`--${k}`);
  for (const k of ['to', 'out']) if (typeof flags[k] === 'string') argv.push(`--${k}`, flags[k]);
  return argv;
}

export default {
  name: 'email',
  summary: 'Preview email templates and send sink-only test mail through Resend',
  usage: 'email <list | preview [template|all] [--out dir] [--shots] | send-test <template> [--to delivered@resend.dev] [--keychain] [--dry-run]>',
  booleans: ['shots', 'keychain', 'dry-run'],
  async run(args, ctx) {
    return main(emailArgv(args, ctx.flags), ctx.env, ctx.log);
  },
};
