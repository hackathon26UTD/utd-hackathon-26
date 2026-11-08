// Zero-setup local dev: starts a throwaway MongoDB (no Docker needed) and runs the
// real Cloudflare Pages runtime against it. Usage: npm run dev:local
// Uses .dev.vars values for everything except MONGODB_URI/MONGODB_DB.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import {MongoClient} from 'mongodb';
import {setupBeacon} from '../src/beacon.js';
import {ensureIndexes} from '../src/db.js';

const port = Number(process.env.PORT || 8788);
const adminKey = process.env.API_ADMIN_KEY || 'ak_local_dev_only';
const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1', dbName: 'utd_hackathon_26' } });
const uri = mongod.getUri();
const client=await MongoClient.connect(uri);try{const db=client.db('utd_hackathon_26');await ensureIndexes(db);await setupBeacon(db);}finally{await client.close();}
console.log(`\nLocal MongoDB: ${uri}\nAdmin key:     configured (not printed)\nAPI:           http://127.0.0.1:${port}/api/health\n`);

const child = spawn(
  'npx',
  ['wrangler', 'pages', 'dev', 'public', '--port', String(port), '--ip', '127.0.0.1',
    '--compatibility-flags=nodejs_compat',
    '--binding', `MONGODB_URI=${uri}`, '--binding', 'MONGODB_DB=utd_hackathon_26',
    '--binding', `API_ADMIN_KEY=${adminKey}`, '--binding', 'API_PUBLIC_READ=false'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
const stop = async () => { child.kill(); await mongod.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', async (code) => { await mongod.stop(); process.exit(code ?? 0); });
