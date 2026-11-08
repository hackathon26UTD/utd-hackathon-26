import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { usageError } from '../lib/hb-errors.mjs';

const EXTRA = ['README.md', 'AGENTS.md', 'SECURITY.md', 'CONTRIBUTING.md', 'HANDOFF.md', 'firmware/TESTING.md'];

function files(root) {
  const list = readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).sort().map((f) => `docs/${f}`);
  return [...EXTRA.filter((f) => existsSync(join(root, f))), ...list];
}

export function describe(text) {
  const lines = text.split('\n');
  const title = (lines.find((l) => /^#\s+/.test(l)) || '').replace(/^#\s+/, '').trim();
  let inFence = false;
  const para = lines.find((l) => {
    if (l.startsWith('```')) inFence = !inFence;
    return !inFence && l.trim() && !/^(#|\||>|-\s*\[|```|---)/.test(l.trim());
  }) || '';
  const clean = para.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim();
  return { title, summary: clean.length > 110 ? clean.slice(0, 107) + '...' : clean };
}

export default {
  name: 'docs',
  summary: 'List project docs with one-line descriptions, or search them',
  usage: 'hb docs [list] | search <term> [--limit 30] | path <name>',
  async run(args, ctx) {
    const root = ctx.repoRoot;
    const sub = args[0] || 'list';
    if (sub === 'list') {
      const rows = files(root).map((f) => ({ file: f, ...describe(readFileSync(join(root, f), 'utf8')) }));
      ctx.emit({ docs: rows }, () => {
        const w = Math.max(...rows.map((r) => r.file.length));
        for (const r of rows) ctx.out(`${ctx.c.bold(r.file.padEnd(w))}  ${r.title ? r.title + (r.summary ? ': ' : '') : ''}${r.summary}`.slice(0, 200));
      });
      return 0;
    }
    if (sub === 'search') {
      const term = args.slice(1).join(' ').trim();
      if (!term) throw usageError('Usage: hb docs search <term>');
      const limit = Math.min(200, Math.max(1, Number(ctx.flags.limit) || 30));
      const needle = term.toLowerCase();
      const hits = [];
      for (const f of files(root)) {
        readFileSync(join(root, f), 'utf8').split('\n').forEach((line, i) => {
          if (hits.length < limit && line.toLowerCase().includes(needle)) hits.push({ file: f, line: i + 1, text: line.trim().slice(0, 160) });
        });
      }
      ctx.emit({ term, hits }, () => {
        if (!hits.length) ctx.out(ctx.c.dim(`No matches for "${term}".`));
        for (const h of hits) ctx.out(`${ctx.c.cyan(`${h.file}:${h.line}`)}  ${h.text}`);
      });
      return hits.length ? 0 : 1;
    }
    if (sub === 'path') {
      const name = (args[1] || '').toLowerCase();
      const m = files(root).filter((f) => f.toLowerCase().includes(name));
      if (!name || !m.length) throw usageError('Usage: hb docs path <part of a doc name>');
      ctx.emit({ matches: m.map((f) => join(root, f)) }, () => m.forEach((f) => ctx.out(join(root, f))));
      return 0;
    }
    throw usageError(`Unknown docs subcommand "${sub}". Use list, search or path.`);
  },
};
