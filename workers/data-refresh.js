// Dedicated narrow scheduler credential; never an operator/admin credential.
export default {
 async scheduled(event,env,ctx){ctx.waitUntil(run(env,'cron'));},
 async fetch(request,env){if(!env.DATA_JOB_TOKEN||request.headers.get('X-Data-Job-Key')!==env.DATA_JOB_TOKEN)return new Response('Unauthorized',{status:401});return run(env,'manual');},
};
async function run(env,trigger){
 const r=await fetch(env.SITE_URL+'/api/ops/data-refresh',{method:'POST',headers:{'Content-Type':'application/json','X-Data-Job-Key':env.DATA_JOB_TOKEN,'X-Data-Trigger':trigger},body:JSON.stringify({limit:3}),signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw new Error('Data refresh returned HTTP '+r.status);
 return new Response(await r.text(),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
