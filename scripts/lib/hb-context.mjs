// Shared context for every command: { env, repoRoot, log, json, flags, ... }. Injectable for tests.
import { makeRedactor, redactDeep } from './hb-redact.mjs';
import { colorEnabled, makeColors } from './hb-ui.mjs';
import { createApi, siteFromFlags } from './hb-http.mjs';

/**
 * log() goes to stdout in text mode and to stderr in --json mode so stdout stays machine-readable.
 * Every line passes through the redactor.
 */
export function createContext({ env, repoRoot, flags = {}, command = '', positionals = [], stdout = process.stdout, stderr = process.stderr, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const redact = makeRedactor(env);
  // A closed pipe (for example `| head`) should end quietly, not crash.
  for (const s of [stdout, stderr]) s.on?.('error', (e) => { if (e?.code !== 'EPIPE') throw e; });
  const jsonMode = flags.json === true;
  const c = makeColors(colorEnabled({ env, flags, isTTY: stdout.isTTY }));
  const write = (stream, s) => stream.write(redact(String(s)) + '\n');
  const site = siteFromFlags(flags, env);
  const ctx = {
    env, repoRoot, flags, command, positionals, c, redact, now, site, jsonMode,
    quiet: flags.quiet === true,
    log: (msg = '') => { if (!ctx.quiet || jsonMode) write(jsonMode ? stderr : stdout, msg); },
    out: (msg = '') => write(stdout, msg),
    warn: (msg) => write(stderr, c.yellow(`warning: ${msg}`)),
    error: (msg) => write(stderr, c.red(`error: ${msg}`)),
    json: (obj) => { stdout.write(JSON.stringify(redactDeep(obj, redact), null, 2) + '\n'); },
    /** Print structured data: JSON in --json mode, otherwise run the text renderer. */
    emit: (obj, render) => { if (jsonMode) ctx.json(obj); else render(obj); },
  };
  ctx.api = createApi({ site, env, fetchImpl, redact });
  return ctx;
}
