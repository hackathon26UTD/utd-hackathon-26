import { completionScript } from '../lib/hb-completion.mjs';

export default {
  name: 'completion',
  summary: 'Print a shell completion script (zsh or bash)',
  usage: 'hb completion zsh|bash   e.g. eval "$(npm run --silent hb -- completion zsh)"',
  async run(args, ctx) {
    const script = completionScript(args[0], [...ctx.commands.keys()]);
    if (!script) { ctx.error('Usage: hb completion zsh|bash'); return 2; }
    ctx.out(script.trimEnd());
    return 0;
  },
};
