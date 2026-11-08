#!/usr/bin/env node
// HomeBeacon developer CLI. Run: npm run hb -- <command> [args] [--json] [--local | --site <url>]
// Commands are plug-ins: every scripts/commands/*.mjs default-exports { name, summary, usage, run(args, ctx) }.
// ctx = { env, repoRoot, log(msg), json(obj), flags, ... }. run() returns an exit code (0 = ok).
import { readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from './lib/hb-args.mjs';
import { createContext } from './lib/hb-context.mjs';
import { EXIT, HbError } from './lib/hb-errors.mjs';
import { makeRedactor } from './lib/hb-redact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..');
export const VERSION = '1.0.0';
// Commands that never need credentials: skip loading env (and its slow git/gh lookups).
const NO_ENV = new Set(['help', 'completion', 'docs', 'thresholds']);

/** Import every command file. A file that fails to import is reported, never fatal. */
export async function discoverCommands(dir = join(HERE, 'commands')) {
  const commands = new Map();
  const broken = [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort(); } catch { /* no commands dir */ }
  for (const file of files) {
    try {
      const mod = (await import(pathToFileURL(join(dir, file)).href)).default;
      if (!mod || typeof mod.run !== 'function' || typeof mod.name !== 'string') throw new Error('does not default-export { name, summary, usage, run }');
      commands.set(mod.name, { summary: '', usage: mod.name, ...mod, file });
    } catch (e) {
      broken.push({ file, error: String(e?.message || e).split('\n')[0].slice(0, 200) });
    }
  }
  return { commands, broken };
}

export function nearest(name, names) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  return [...names].map((n) => [n, dist(name, n)]).filter(([, d]) => d <= 2).sort((a, b) => a[1] - b[1]).map(([n]) => n)[0];
}

/**
 * Run the CLI. Injectable for tests: { env, stdout, stderr, fetchImpl, commandsDir, repoRoot }.
 * Returns the exit code instead of exiting.
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const { commands, broken } = await discoverCommands(deps.commandsDir);
  // Command-declared boolean flags must be known before the real parse.
  const first = parseArgs(argv);
  const name = first.positionals[0];
  const spec = name ? commands.get(name) : undefined;
  const { positionals, flags } = parseArgs(argv, { booleans: spec?.booleans || [] });
  const args = positionals.slice(1);
  const cmdName = positionals[0];

  const needsEnv = cmdName && !NO_ENV.has(cmdName);
  const env = deps.env || (needsEnv && !flags.help ? (await import('./env.mjs')).env : process.env);
  const redact = makeRedactor(env);
  const ctx = createContext({ env, repoRoot: deps.repoRoot || REPO_ROOT, flags, command: cmdName || 'help', positionals: args, stdout, stderr, fetchImpl: deps.fetchImpl, now: deps.now });
  ctx.commands = commands;
  ctx.broken = broken;
  ctx.version = VERSION;

  try {
    if (flags.version) { ctx.out(`hb ${VERSION}`); return EXIT.OK; }
    if (!cmdName || cmdName === 'help') {
      const help = commands.get('help');
      if (!help) { ctx.out('hb: help command missing'); return EXIT.FAIL; }
      return (await help.run(cmdName ? args : [], ctx)) ?? EXIT.OK;
    }
    if (!spec) {
      const brokenFile = broken.find((b) => b.file === `${cmdName}.mjs`);
      if (brokenFile) { ctx.error(`command "${cmdName}" failed to load: ${brokenFile.error}`); return EXIT.FAIL; }
      const guess = nearest(cmdName, commands.keys());
      ctx.error(`unknown command "${cmdName}".${guess ? ` Did you mean "${guess}"?` : ''} Run: npm run hb -- help`);
      return EXIT.USAGE;
    }
    if (flags.help) {
      ctx.out(`${ctx.c.bold(spec.name)}  ${spec.summary}`);
      ctx.out(`\nUsage: ${spec.usage}`);
      ctx.out('\nGlobal flags: --json  --local  --site <url>  --no-color  --verbose  --quiet');
      return EXIT.OK;
    }
    const code = await spec.run(args, ctx);
    return Number.isInteger(code) ? code : EXIT.OK;
  } catch (e) {
    if (e instanceof HbError) {
      ctx.error(e.message);
      return e.code;
    }
    ctx.error(`unexpected failure: ${redact(e?.message || e)}`);
    if (flags.verbose && e?.stack) stderr.write(redact(e.stack) + '\n');
    return EXIT.FAIL;
  }
}

const entry = process.argv[1] && (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })();
if (entry && entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
