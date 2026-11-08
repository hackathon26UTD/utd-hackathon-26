// Adds public-feed keys to Cloudflare Pages production secrets. Merge-only: sends just the keys present,
// never resends existing secrets. Values come from the local env or an optional env file path. Names only are printed.
import {readFileSync} from 'node:fs';
import {env as base} from './env.mjs';
const file=process.argv[2];
const extra={};
if(file)for(const line of readFileSync(file,'utf8').split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)extra[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const env={...base,...extra};
const names=['EIA_API_KEY','AIRNOW_API_KEY','FIRMS_MAP_KEY'];
const present=names.filter(n=>env[n]);
if(!present.length){console.log('No feed keys found. Missing:',names.join(', '));process.exit(1);}
const token=env.CLOUDFLARE_SITE_API_TOKEN||env.CLOUDFLARE_API_TOKEN;
const url=`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/utd-hackathon-26`;
const ev=Object.fromEntries(present.map(n=>[n,{type:'secret_text',value:env[n]}]));
const res=await fetch(url,{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({deployment_configs:{production:{env_vars:ev},preview:{env_vars:ev}}})}).then(r=>r.json());
if(!res.success){console.error('Cloudflare update failed.');process.exit(1);}
console.log('Set on production and preview:',present.join(', '));
console.log('Missing:',names.filter(n=>!env[n]).join(', ')||'none');
console.log('Redeploy main for the keys to take effect.');
