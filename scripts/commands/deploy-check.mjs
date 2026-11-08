import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run } from '../lib/hb-proc.mjs';
import { PRODUCTION_SITE } from '../lib/hb-http.mjs';

const SYNTAX_DIRS = ['scripts', 'src', 'domain', 'functions', 'lib', 'ui', 'workers', 'test'];

function jsFiles(root, dir, out = []) {
  let entries = [];
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) jsFiles(root, rel, out);
    else if (/\.(m?js)$/.test(e.name)) out.push(rel);
  }
  return out;
}

export default {
  name: 'deploy-check',
  summary: 'Pre-deploy gate: tests, build, syntax, git state, production ready and commit match',
  usage: 'hb deploy-check [--skip-tests] [--skip-build] [--offline] [--json]',
  booleans: ['skip-tests', 'skip-build', 'offline'],
  async run(args, ctx) {
    const root = ctx.repoRoot;
    const checks = [];
    const add = (name, status, detail) => { checks.push({ name, status, detail }); if (!ctx.jsonMode) ctx.out(`${{ pass: ctx.c.green('PASS'), fail: ctx.c.red('FAIL'), skip: ctx.c.yellow('SKIP'), warn: ctx.c.yellow('WARN') }[status]}  ${name}${detail ? ctx.c.dim('  ' + detail) : ''}`); };

    // 1. Git state
    const branch = (await run('git', ['branch', '--show-current'], { cwd: root })).out || '(detached)';
    const dirty = (await run('git', ['status', '--porcelain'], { cwd: root })).out.split('\n').filter(Boolean);
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).out;
    add('git state', dirty.length ? 'warn' : 'pass', `${branch} @ ${head.slice(0, 7)}, ${dirty.length ? dirty.length + ' uncommitted change(s)' : 'clean'}`);

    // 2. Syntax (esbuild parses every JS/MJS file in-process; no files are written)
    let esbuild = null;
    try { esbuild = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')).href); } catch { /* fall back to skip */ }
    if (!esbuild) add('syntax check', 'skip', 'esbuild not installed');
    else {
      const bad = [];
      const list = SYNTAX_DIRS.flatMap((d) => jsFiles(root, d));
      for (const f of list) {
        try { esbuild.transformSync(readFileSync(join(root, f), 'utf8'), { loader: 'js', format: 'esm', logLevel: 'silent' }); } catch (e) { bad.push(`${f}: ${String(e.errors?.[0]?.text || e.message).slice(0, 80)}`); }
      }
      add('syntax check', bad.length ? 'fail' : 'pass', bad.length ? bad.slice(0, 3).join('; ') : `${list.length} files parse`);
    }

    // 3. Tests and build
    if (ctx.flags['skip-tests']) add('tests', 'skip', '--skip-tests');
    else {
      const t = await run('npm', ['test', '--silent'], { cwd: root, timeoutMs: 15 * 60000 });
      const summary = (t.out.match(/# (pass|fail) \d+/g) || []).join(' ');
      add('tests', t.code === 0 ? 'pass' : 'fail', t.timedOut ? 'timed out' : summary || ctx.redact(t.err.split('\n').pop() || ''));
    }
    if (ctx.flags['skip-build']) add('build', 'skip', '--skip-build');
    else {
      const b = await run('npm', ['run', 'build', '--silent'], { cwd: root, timeoutMs: 10 * 60000 });
      add('build', b.code === 0 ? 'pass' : 'fail', b.code === 0 ? `${Math.round(b.ms / 1000)}s` : ctx.redact((b.err || b.out).split('\n').slice(-2).join(' ')));
    }

    // 4. Production readiness and deployed commit vs origin/main
    if (ctx.flags.offline) {
      add('production ready', 'skip', '--offline');
      add('deployed commit = origin/main', 'skip', '--offline');
    } else {
      const site = ctx.flags.site || ctx.flags.local ? ctx.site : PRODUCTION_SITE;
      const r = await ctx.api('/api/ready').catch((e) => ({ ok: false, status: 0, data: null, error: e.message }));
      const probe = r;
      add(`${site}/api/ready`, probe.ok && probe.data?.status === 'ready' ? 'pass' : 'fail', probe.error || `HTTP ${probe.status}, ${probe.ms ?? '?'} ms`);
      const remote = (await run('git', ['ls-remote', 'origin', 'main'], { cwd: root, timeoutMs: 20000 })).out.split(/\s+/)[0];
      let deployed = null;
      if (ctx.env.CLOUDFLARE_ACCOUNT_ID) {
        const s = await run(process.execPath, [join(root, 'scripts/site.mjs'), 'status'], { cwd: root, env: process.env, timeoutMs: 25000 });
        try { deployed = JSON.parse(s.out).latest; } catch { /* unavailable */ }
      }
      if (!remote) add('deployed commit = origin/main', 'skip', 'could not read origin/main');
      else if (!deployed?.commit) add('deployed commit = origin/main', 'skip', 'deployment lookup unavailable (needs Cloudflare access in .env)');
      else add('deployed commit = origin/main', deployed.commit === remote ? 'pass' : 'fail', `deployed ${deployed.commit.slice(0, 7)} (${deployed.environment}, ${deployed.status}), origin/main ${remote.slice(0, 7)}`);
    }

    const failed = checks.filter((c) => c.status === 'fail');
    const result = { ok: failed.length === 0, checks };
    if (ctx.jsonMode) ctx.json(result);
    else ctx.out(failed.length ? ctx.c.red(`\n${failed.length} check(s) failed. Do not deploy.`) : ctx.c.green('\nAll required checks passed.'));
    return failed.length ? 1 : 0;
  },
};
