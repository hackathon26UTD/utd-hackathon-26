// Run only in the authorized preview deployment job. Secrets pass through stdin.
import { spawnSync } from 'node:child_process';

const { NVIDIA_API_KEY, NVIDIA_BASE_URL, NVIDIA_MODEL } = process.env;
if (!NVIDIA_API_KEY || !NVIDIA_BASE_URL || !NVIDIA_MODEL) {
  throw new Error('NVIDIA preview settings are incomplete. No settings changed.');
}
const endpoint = new URL(NVIDIA_BASE_URL);
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.pathname.endsWith('/v1')) {
  throw new Error('NVIDIA preview requires an authenticated HTTPS /v1 endpoint.');
}
const result = spawnSync(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'pages', 'secret', 'bulk',
  '--project-name', 'utd-hackathon-26', '--env', 'preview',
], {
  input: JSON.stringify({ NVIDIA_API_KEY, NVIDIA_BASE_URL, NVIDIA_MODEL }),
  encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  timeout: 60_000,
});
// Provider output is deliberately withheld to keep credential-bearing errors private.
if (result.status !== 0) throw new Error('Cloudflare NVIDIA preview configuration failed. Check the Pages token permissions.');
console.log('Configured the three NVIDIA bindings for preview only.');
