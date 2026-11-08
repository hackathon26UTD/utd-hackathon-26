// Latency benchmark for the API and the database path.
//   node scripts/bench-api.mjs [--target live|local|both] [--runs 15] [--url https://...] [--json] [--no-db]
// Secrets come from .env / .dev.vars via scripts/env.mjs and are never printed.
import { performance } from 'node:perf_hooks';
import dns from 'node:dns/promises';
import { env } from './env.mjs';

const LIVE = 'https://utd-hackathon-26.pages.dev';
const LOCAL = 'http://127.0.0.1:8788';

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
export function summarize(samples) {
  const ok = samples.filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
  if (!ok.length) return { n: 0, failed: samples.length };
  const sum = ok.reduce((a, b) => a + b, 0);
  return {
    n: ok.length,
    failed: samples.length - ok.length,
    min: round(ok[0]),
    p50: round(percentile(ok, 50)),
    p95: round(percentile(ok, 95)),
    max: round(ok[ok.length - 1]),
    mean: round(sum / ok.length),
  };
}
const round = (n) => Math.round(n * 10) / 10;

export const ENDPOINTS = [
  { name: 'static (no db)', path: '/robots.txt', auth: false },
  { name: 'ready', path: '/api/ready', auth: false },
  { name: 'health', path: '/api/health', auth: false },
  { name: 'command-center', path: '/api/command-center', auth: true },
  { name: 'ops/live', path: '/api/ops/live', auth: true },
  { name: 'ops/data-catalog', path: '/api/ops/data-catalog', auth: true },
  { name: 'layers (feeds)', path: '/api/feeds', auth: true },
];

async function timeRequest(base, ep, key) {
  const headers = { 'User-Agent': 'hb-bench/1' };
  if (ep.auth && key) headers.Authorization = `Bearer ${key}`;
  const t0 = performance.now();
  try {
    const res = await fetch(base + ep.path, { headers, redirect: 'manual' });
    const buf = await res.arrayBuffer();
    return { ms: performance.now() - t0, status: res.status, bytes: buf.byteLength, cache: res.headers.get('cf-cache-status') || '' };
  } catch (e) {
    return { ms: NaN, status: 0, bytes: 0, error: e.name };
  }
}

export async function benchHttp(base, { runs = 15, key = env.API_ADMIN_KEY, endpoints = ENDPOINTS } = {}) {
  const out = [];
  for (const ep of endpoints) {
    if (ep.auth && !key) { out.push({ endpoint: ep.name, skipped: 'no admin key in env' }); continue; }
    // first request is reported separately: it pays isolate cold start and index setup.
    const first = await timeRequest(base, ep, key);
    const samples = [];
    let last = first;
    for (let i = 0; i < runs; i++) { last = await timeRequest(base, ep, key); samples.push(last.ms); }
    out.push({ endpoint: ep.name, status: last.status, bytes: last.bytes, first: round(first.ms), ...summarize(samples) });
  }
  return out;
}

/** Raw Atlas timing, split into phases so the slow part is visible. */
export async function benchAtlas({ runs = 8, uri = env.MONGODB_URI, dbName = env.MONGODB_DB || 'utd_hackathon_26', options = {}, label = 'current options' } = {}) {
  if (!uri) return { skipped: 'MONGODB_URI not set' };
  const { MongoClient } = await import('mongodb');
  const phases = { dns: [], connect: [], ping: [], query: [], close: [], total: [] };
  if (uri.startsWith('mongodb+srv://')) {
    const host = new URL(uri.replace('mongodb+srv://', 'https://')).hostname;
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      try { await dns.resolveSrv('_mongodb._tcp.' + host); await dns.resolveTxt(host); phases.dns.push(performance.now() - t); } catch { phases.dns.push(NaN); }
    }
  }
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 1, appName: 'hb-bench', ...options });
    try {
      await client.connect();
      const t1 = performance.now();
      await client.db(dbName).command({ ping: 1 });
      const t2 = performance.now();
      await client.db(dbName).collection('devices').findOne({}, { projection: { _id: 1 } });
      const t3 = performance.now();
      await client.close();
      const t4 = performance.now();
      phases.connect.push(t1 - t0); phases.ping.push(t2 - t1); phases.query.push(t3 - t2); phases.close.push(t4 - t3); phases.total.push(t4 - t0);
    } catch (e) {
      phases.total.push(NaN);
      await client.close().catch(() => {});
    }
  }
  const result = { label };
  for (const [k, v] of Object.entries(phases)) if (v.length) result[k] = summarize(v);
  return result;
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  console.log('endpoint'.padEnd(20), 'status', 'bytes'.padStart(8), 'first'.padStart(8), 'p50'.padStart(8), 'p95'.padStart(8), 'max'.padStart(8));
  for (const r of rows) {
    if (r.skipped) { console.log(r.endpoint.padEnd(20), 'skipped:', r.skipped); continue; }
    console.log(r.endpoint.padEnd(20), String(r.status).padEnd(6), String(r.bytes).padStart(8), String(r.first).padStart(8), String(r.p50 ?? '-').padStart(8), String(r.p95 ?? '-').padStart(8), String(r.max ?? '-').padStart(8));
  }
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
  const target = flag('target', 'live');
  const runs = Number(flag('runs', 15)) || 15;
  const asJson = argv.includes('--json');
  const result = {};
  const targets = target === 'both' ? ['live', 'local'] : [target];
  for (const t of targets) {
    const base = flag('url', t === 'local' ? LOCAL : LIVE);
    result[t] = { base, endpoints: await benchHttp(base, { runs }) };
  }
  if (!argv.includes('--no-db')) result.atlas = await benchAtlas({ runs: Math.min(runs, 10) });
  if (asJson) { log(JSON.stringify(result, null, 2)); return 0; }
  for (const t of targets) printTable(`${t}: ${result[t].base} (${runs} runs, ms)`, result[t].endpoints);
  if (result.atlas && !result.atlas.skipped) {
    console.log('\nAtlas from this machine (ms)');
    for (const [k, v] of Object.entries(result.atlas)) if (k !== 'label') console.log(k.padEnd(10), `p50 ${v.p50}  p95 ${v.p95}  max ${v.max}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
