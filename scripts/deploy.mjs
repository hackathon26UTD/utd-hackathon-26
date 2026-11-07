import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
if (!args.some((arg) => arg === '--branch' || arg.startsWith('--branch='))) {
  const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
  if (branch.status || !branch.stdout.trim()) throw new Error('Pass an explicit deployment branch.');
  args.push('--branch', branch.stdout.trim());
}
const deployment = spawnSync(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'pages', 'deploy', 'public',
  '--project-name=utd-hackathon-26', ...args,
], { encoding: 'utf8', env: process.env });
process.stdout.write(deployment.stdout ?? '');
process.stderr.write(deployment.stderr ?? '');
if (deployment.status !== 0) process.exit(deployment.status || 1);
const url = deployment.stdout.match(/https:\/\/[a-f0-9]+\.utd-hackathon-26\.pages\.dev\b/)?.[0];
if (!url) throw new Error('Deployment URL not returned; live verification cannot run.');

let ready = false;
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    const response = await fetch(`${url}/api/ready`, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (response.ok && data.status === 'ready' && data.mongodb?.connected === true) {
      ready = true;
      break;
    }
  } catch { /* Deployment routes can take a moment to become available. */ }
  if (attempt < 7) await delay(3000);
}
if (!ready) throw new Error('Deployment uploaded, but the live MongoDB readiness check failed.');
const home = await fetch(url, { signal: AbortSignal.timeout(8000) });
if (!home.ok) throw new Error('Live home page check failed.');
console.log(`Verified live site and MongoDB connection: ${url}`);
