// Historical filename; supports the authorized main and preview deployment jobs.
// Secrets pass through stdin. Only these three bindings are patched.
import { spawnSync } from 'node:child_process';

const { NVIDIA_PAGES_ENV, DEPLOY_BRANCH, NVIDIA_BREV_PREVIEW_BRANCH, GITHUB_REF, GITHUB_EVENT_NAME } = process.env;
const authorized = NVIDIA_PAGES_ENV === 'production'
  ? DEPLOY_BRANCH === 'main' && GITHUB_REF === 'refs/heads/main' && ['push', 'workflow_dispatch'].includes(GITHUB_EVENT_NAME)
  : NVIDIA_PAGES_ENV === 'preview' && /^pr-[1-9]\d*$/.test(DEPLOY_BRANCH || '') && DEPLOY_BRANCH === NVIDIA_BREV_PREVIEW_BRANCH;
if (!authorized) throw new Error('NVIDIA deployment target is not authorized. No settings changed.');

const { NVIDIA_API_KEY, NVIDIA_BASE_URL, NVIDIA_MODEL } = process.env;
if (!NVIDIA_API_KEY || !NVIDIA_BASE_URL || !NVIDIA_MODEL) {
  throw new Error('NVIDIA deployment settings are incomplete. No settings changed.');
}
const endpoint = new URL(NVIDIA_BASE_URL);
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.pathname.endsWith('/v1')) {
  throw new Error('NVIDIA deployment requires an authenticated HTTPS /v1 endpoint.');
}
const result = spawnSync(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'pages', 'secret', 'bulk',
  '--project-name', 'utd-hackathon-26', '--env', NVIDIA_PAGES_ENV,
], {
  input: JSON.stringify({ NVIDIA_API_KEY, NVIDIA_BASE_URL, NVIDIA_MODEL }),
  encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  timeout: 60_000,
});
// Provider output is deliberately withheld to keep credential-bearing errors private.
if (result.status !== 0) throw new Error('Cloudflare NVIDIA configuration failed. Check the Pages token permissions.');
console.log(`Configured the three NVIDIA bindings for ${NVIDIA_PAGES_ENV} only.`);
