// hb plug-in: NVIDIA grounding harness. Run as: npm run hb -- harness <subcommand>
import { run } from '../harness.mjs';

export default {
  name: 'harness',
  summary: 'NVIDIA grounding pack, thresholds doc, runbook and golden-case evals',
  usage: 'harness <thresholds|runbook|knowledge|pack|eval|sync|check> [--write|--check] [--live] [--max-calls N] [--max-tokens N] [--json]',
  async run(args = [], ctx = {}) {
    // The dispatcher may hand flags already parsed; rebuild argv so both shapes work.
    const argv = [...args];
    for (const [k, v] of Object.entries(ctx.flags || {})) {
      const present = argv.some(a => a === `--${k}` || a.startsWith(`--${k}=`));
      if (!present && v !== false && v !== undefined) argv.push(v === true ? `--${k}` : `--${k}=${v}`);
    }
    return run(argv, { log: ctx.log, json: ctx.json, env: ctx.env, noFiles: ctx.noFiles });
  },
};
