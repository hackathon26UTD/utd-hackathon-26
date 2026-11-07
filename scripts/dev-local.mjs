// Zero-setup local dev: starts a throwaway MongoDB (no Docker needed) and runs the
// real Cloudflare Pages runtime against it. Usage: npm run dev:local
// Uses .dev.vars values for everything except MONGODB_URI/MONGODB_DB.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT || 8788);
const adminKey = process.env.API_ADMIN_KEY || 'ak_local_dev_only';
const mongod = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1', dbName: 'utd_hackathon_26' } });
const uri = mongod.getUri();
console.log(`\nLocal MongoDB: ${uri}\nAdmin key:     ${adminKey}\nAPI:           http://127.0.0.1:${port}/api/health\n`);

const child = spawn(
  'npx',
  ['wrangler', 'pages', 'dev', 'public', '--port', String(port), '--ip', '127.0.0.1',
    '--compatibility-flags=nodejs_compat',
    '--binding', `MONGODB_URI=${uri}`, '--binding', 'MONGODB_DB=utd_hackathon_26',
    '--binding', `API_ADMIN_KEY=${adminKey}`, '--binding', 'API_PUBLIC_READ=true'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
const stop = async () => { child.kill(); await mongod.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', async (code) => { await mongod.stop(); process.exit(code ?? 0); });
