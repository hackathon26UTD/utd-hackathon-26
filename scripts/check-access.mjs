// npm run access — checks every credential in .env and prints OK / missing / failed.
// Never prints secret values.
import { MongoClient } from 'mongodb';
import { env, has, github, atlas, atlasConfigured } from './env.mjs';

const rows = [];
const add = (name, status, detail = '') => rows.push({ name, status, detail });
const timeout = (ms) => AbortSignal.timeout(ms);

async function check(name, keys, fn) {
  if (keys.length && !has(...keys)) return add(name, 'missing', `set ${keys.join(', ')} in .env`);
  try {
    add(name, 'ok', (await fn()) || '');
  } catch (e) {
    add(name, 'failed', e.message.replace(/[A-Za-z0-9+/=_-]{24,}/g, '[redacted]'));
  }
}

await check('GitHub', ['GITHUB_TOKEN'], async () => {
  const me = await github('/user');
  if (!me.ok) throw new Error(`HTTP ${me.status}`);
  const repo = await github(`/repos/${env.GITHUB_REPO || 'hackathon26UTD/utd-hackathon-26'}`);
  if (!repo.ok) throw new Error(`repo HTTP ${repo.status}`);
  const r = await repo.json();
  return `${(await me.json()).login}${env.GITHUB_TOKEN_SOURCE === 'gh-cli' ? ' (from gh CLI)' : ''}, repo ${r.permissions?.admin ? 'admin' : r.permissions?.push ? 'write' : 'read'}`;
});

await check('MongoDB connection', ['MONGODB_URI'], async () => {
  const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  try {
    await client.connect();
    await client.db(env.MONGODB_DB || 'utd_hackathon_26').command({ ping: 1 });
    return /mongodb\+srv|mongodb\.net/.test(env.MONGODB_URI) ? 'Atlas' : 'local';
  } finally {
    await client.close().catch(() => {});
  }
});

if (atlasConfigured()) {
  await check('Atlas Admin API', ['MONGODB_ATLAS_PROJECT_ID'], async () => {
    const res = await atlas('GET', '/groups/{project}/clusters');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { results = [] } = await res.json();
    return results.map((c) => `${c.name}: ${c.stateName}`).join(', ') || 'no clusters';
  });
} else add('Atlas Admin API', 'missing', 'set MONGODB_ATLAS_CLIENT_ID/SECRET (or PUBLIC/PRIVATE_KEY) in .env');

await check('Cloudflare', [], async () => {
  if (has('CLOUDFLARE_API_TOKEN')) {
    const r = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, signal: timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return 'API token valid';
  }
  if (has('CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL')) {
    const r = await fetch('https://api.cloudflare.com/client/v4/user', { headers: { 'X-Auth-Key': env.CLOUDFLARE_API_KEY, 'X-Auth-Email': env.CLOUDFLARE_EMAIL }, signal: timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return 'global key valid';
  }
  throw Object.assign(new Error('missing'), { missing: true });
}).then(() => {
  const last = rows[rows.length - 1];
  if (last.detail === 'missing') Object.assign(last, { status: 'missing', detail: 'set CLOUDFLARE_API_TOKEN (Ayan owns the account)' });
});

await check('Team API (live)', [], async () => {
  const base = env.API_BASE || 'https://utd-hackathon-26.pages.dev';
  const h = await (await fetch(`${base}/api/health`, { signal: timeout(15000) })).json();
  if (!h.mongodb?.reachable) throw new Error('database not reachable from Cloudflare');
  if (!has('API_ADMIN_KEY')) return `up, DB ${h.mongodb.latencyMs} ms (no API_ADMIN_KEY yet, get it from Ayan)`;
  const d = await fetch(`${base}/api/devices`, { headers: { Authorization: `Bearer ${env.API_ADMIN_KEY}` }, signal: timeout(15000) });
  if (!d.ok) throw new Error(`admin key rejected (HTTP ${d.status})`);
  return `up, admin key valid, ${(await d.json()).devices?.length ?? 0} devices`;
});

await check('EIA', ['EIA_API_KEY'], async () => {
  const r = await fetch(`https://api.eia.gov/v2/electricity/rto/region-data/?api_key=${encodeURIComponent(env.EIA_API_KEY)}`, { signal: timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
});

await check('AirNow', ['AIRNOW_API_KEY'], async () => {
  const r = await fetch(`https://www.airnowapi.org/aq/observation/current/ziplatLong?format=application/json&zipCode=75080&api_key=${encodeURIComponent(env.AIRNOW_API_KEY)}`, { signal: timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await r.text();
  if (/invalid|error/i.test(t.slice(0, 200)) && !t.startsWith('[')) throw new Error('key rejected');
});

await check('NASA FIRMS', ['FIRMS_MAP_KEY'], async () => {
  const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=${encodeURIComponent(env.FIRMS_MAP_KEY)}`, { signal: timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));
  if (j.error || j.status === 'invalid') throw new Error('key rejected');
});

await check('NVIDIA', ['NVIDIA_API_KEY'], async () => {
  const r = await fetch('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}` }, signal: timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
});

const icon = { ok: 'OK     ', missing: 'MISSING', failed: 'FAILED ' };
for (const r of rows) console.log(`${icon[r.status]}  ${r.name.padEnd(20)} ${r.detail}`);
process.exitCode = rows.some((r) => r.status === 'failed') ? 1 : 0;
