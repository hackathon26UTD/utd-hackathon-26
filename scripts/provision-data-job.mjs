// Add the narrow scheduler key to existing approved local/provider stores. Never print values.
import{env}from'./env.mjs';import{randomBytes}from'node:crypto';import{appendFileSync,chmodSync}from'node:fs';import{execFileSync}from'node:child_process';
const token=env.DATA_JOB_TOKEN||randomBytes(32).toString('hex');
if(!env.DATA_JOB_TOKEN){appendFileSync('.env','\nDATA_JOB_TOKEN='+token+'\n');chmodSync('.env',0o600);}
const url='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/pages/projects/utd-hackathon-26';const headers={'X-Auth-Key':env.CLOUDFLARE_API_KEY,'X-Auth-Email':env.CLOUDFLARE_EMAIL,'Content-Type':'application/json'};
const got=await fetch(url,{headers});const j=await got.json();if(!j.success)throw Error('Cloudflare project unavailable');
const vars=j.result.deployment_configs.production.env_vars;const update={deployment_configs:{production:{env_vars:{DATA_JOB_TOKEN:{type:'secret_text',value:token},NWS_SCOPE:{type:'plain_text',value:'national'},DATA_REGION_BBOX:{type:'plain_text',value:'-96.80,32.96,-96.76,33.00'}}}}};
const changed=await fetch(url,{method:'PATCH',headers,body:JSON.stringify(update)});if(!(await changed.json()).success)throw Error('Cloudflare settings update failed');
const childEnv={...process.env,...env};delete childEnv.CLOUDFLARE_API_TOKEN;childEnv.WRANGLER_SEND_METRICS='false';
execFileSync('npx',['wrangler','secret','put','DATA_JOB_TOKEN','--config','workers/data-refresh.jsonc'],{env:childEnv,input:token,stdio:['pipe','pipe','pipe']});
console.log('Scheduler key stored locally and encrypted in Cloudflare. Production deployment must activate the new Pages settings.');
