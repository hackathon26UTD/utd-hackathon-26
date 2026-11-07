// Hands-off Atlas management using the credentials in .env.
//   npm run atlas -- status          cluster state
//   npm run atlas -- ip              list the IP access list
//   npm run atlas -- ip-add-me       allow this machine's current public IP
//   npm run atlas -- users           list database users (names and roles only)
//   npm run atlas -- get <path>      raw GET, e.g. /groups/{project}/clusters
import { atlas } from './env.mjs';

const [cmd = 'status', arg] = process.argv.slice(2);

async function call(method, path, body) {
  const res = await atlas(method, path, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Atlas ${method} ${path} -> HTTP ${res.status}: ${data.detail || data.reason || ''}`);
  return data;
}

try {
  if (cmd === 'status') {
    const { results } = await call('GET', '/groups/{project}/clusters');
    for (const c of results) console.log(`${c.name}  ${c.stateName}  ${c.mongoDBVersion}  ${c.clusterType}`);
  } else if (cmd === 'ip') {
    const { results } = await call('GET', '/groups/{project}/accessList');
    for (const e of results) console.log(`${e.cidrBlock || e.ipAddress}  ${e.comment || ''}`);
  } else if (cmd === 'ip-add-me') {
    const ip = (await (await fetch('https://api.ipify.org')).text()).trim();
    await call('POST', '/groups/{project}/accessList', [{ ipAddress: ip, comment: `added by scripts/atlas.mjs ${new Date().toISOString().slice(0, 10)}` }]);
    console.log(`Allowed ${ip}`);
  } else if (cmd === 'users') {
    const { results } = await call('GET', '/groups/{project}/databaseUsers');
    for (const u of results) console.log(`${u.username}  ${u.roles.map((r) => `${r.roleName}@${r.databaseName}`).join(', ')}`);
  } else if (cmd === 'get' && arg) {
    console.log(JSON.stringify(await call('GET', arg), null, 2));
  } else {
    console.log('Usage: npm run atlas -- status | ip | ip-add-me | users | get <path>');
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
