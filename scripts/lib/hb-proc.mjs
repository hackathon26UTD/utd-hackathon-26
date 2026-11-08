// Run child processes with a timeout and capture trimmed output. Used by status, simulate and deploy-check.
import { spawn } from 'node:child_process';

export function run(cmd, args, { cwd, env, timeoutMs = 120000, input, inherit = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    let err = '';
    let timedOut = false;
    const child = spawn(cmd, args, { cwd, env, stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout?.on('data', (d) => { out += d; if (out.length > 2_000_000) out = out.slice(-1_000_000); });
    child.stderr?.on('data', (d) => { err += d; if (err.length > 2_000_000) err = err.slice(-1_000_000); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out, err: String(e.message), timedOut, ms: Date.now() - started }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : code ?? 1, out: out.trim(), err: err.trim(), timedOut, ms: Date.now() - started }); });
    if (input !== undefined) child.stdin?.end(input); else child.stdin?.end();
  });
}

/** Rebuild an argv from parsed flags so wrapper commands can pass options through. */
export function flagsToArgv(flags, { drop = [] } = {}) {
  const out = [];
  for (const [k, v] of Object.entries(flags)) {
    if (drop.includes(k) || v === false || v === undefined) continue;
    out.push(`--${k}`);
    if (v !== true) out.push(String(v));
  }
  return out;
}
