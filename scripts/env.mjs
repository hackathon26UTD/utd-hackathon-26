// Shared credential loader for team scripts. Import it and every key is ready:
//   import { env, atlas, github } from './env.mjs';
// Order: real environment variables win, then .env, then .dev.vars.
// GITHUB_TOKEN falls back to the logged-in GitHub CLI (`gh auth token`).
// Never log values from here.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parse(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (v !== '') out[m[1]] = v;
  }
  return out;
}

for (const file of ['.env', '.dev.vars']) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  for (const [k, v] of Object.entries(parse(readFileSync(path, 'utf8')))) {
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
  }
}

if (!process.env.GITHUB_TOKEN) {
  try {
    const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (token) {
      process.env.GITHUB_TOKEN = token;
      process.env.GITHUB_TOKEN_SOURCE = 'gh-cli';
    }
  } catch { /* gh not installed or not logged in */ }
}
if (process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) process.env.GH_TOKEN = process.env.GITHUB_TOKEN;

export const env = process.env;
export const has = (...keys) => keys.every((k) => Boolean(process.env[k]));

// ── GitHub REST ──────────────────────────────────────────────────────────
export async function github(path, init = {}) {
  if (!has('GITHUB_TOKEN')) throw new Error('No GitHub token: run `gh auth login` or set GITHUB_TOKEN in .env');
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'utd-hackathon-26-scripts', ...init.headers },
  });
  return res;
}

// ── MongoDB Atlas Admin API v2 ───────────────────────────────────────────
const ATLAS = 'https://cloud.mongodb.com';
const ATLAS_ACCEPT = 'application/vnd.atlas.2025-03-12+json';
let cachedToken;

async function serviceAccountToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 30_000) return cachedToken.value;
  const basic = Buffer.from(`${env.MONGODB_ATLAS_CLIENT_ID}:${env.MONGODB_ATLAS_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${ATLAS}/api/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Atlas service account login failed (HTTP ${res.status})`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

// HTTP Digest auth for legacy Atlas API keys.
function digestHeader(challenge, method, uri) {
  const p = Object.fromEntries([...challenge.matchAll(/(\w+)="?([^",]+)"?/g)].map((m) => [m[1], m[2]]));
  const md5 = (s) => createHash('md5').update(s).digest('hex');
  const cnonce = randomBytes(8).toString('hex');
  const nc = '00000001';
  const ha1 = md5(`${env.MONGODB_ATLAS_PUBLIC_KEY}:${p.realm}:${env.MONGODB_ATLAS_PRIVATE_KEY}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:auth:${ha2}`);
  return `Digest username="${env.MONGODB_ATLAS_PUBLIC_KEY}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}", algorithm=MD5${p.opaque ? `, opaque="${p.opaque}"` : ''}`;
}

export function atlasConfigured() {
  return has('MONGODB_ATLAS_CLIENT_ID', 'MONGODB_ATLAS_CLIENT_SECRET') || has('MONGODB_ATLAS_PUBLIC_KEY', 'MONGODB_ATLAS_PRIVATE_KEY');
}

// atlas('GET', '/groups/{project}/clusters') — `{project}` and `{org}` are filled from .env.
export async function atlas(method, path, body) {
  const uri = `/api/atlas/v2${path.replace('{project}', env.MONGODB_ATLAS_PROJECT_ID).replace('{org}', env.MONGODB_ATLAS_ORG_ID)}`;
  const headers = { Accept: ATLAS_ACCEPT, ...(body ? { 'Content-Type': ATLAS_ACCEPT } : {}) };
  const init = { method, headers, body: body ? JSON.stringify(body) : undefined };
  if (has('MONGODB_ATLAS_CLIENT_ID', 'MONGODB_ATLAS_CLIENT_SECRET')) {
    headers.Authorization = `Bearer ${await serviceAccountToken()}`;
    return fetch(ATLAS + uri, init);
  }
  if (has('MONGODB_ATLAS_PUBLIC_KEY', 'MONGODB_ATLAS_PRIVATE_KEY')) {
    const first = await fetch(ATLAS + uri, init);
    if (first.status !== 401) return first;
    headers.Authorization = digestHeader(first.headers.get('www-authenticate') || '', method, uri);
    return fetch(ATLAS + uri, init);
  }
  throw new Error('No Atlas Admin API credentials in .env (MONGODB_ATLAS_CLIENT_ID/SECRET or PUBLIC/PRIVATE_KEY)');
}
