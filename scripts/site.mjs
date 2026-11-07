// Team-only CLI. Management secrets stay in local env/approved secret stores.
import {env} from './env.mjs';
import {MongoClient} from 'mongodb';
const command=process.argv[2]||'status';
const account=env.CLOUDFLARE_ACCOUNT_ID;
const project=env.CLOUDFLARE_PAGES_PROJECT||'utd-hackathon-26';
const token=env.CLOUDFLARE_SITE_API_TOKEN||env.CLOUDFLARE_API_TOKEN||env.CLOUDFLARE_CI_API_TOKEN;
const auth=token?{Authorization:'Bearer '+token}:env.CLOUDFLARE_API_KEY&&env.CLOUDFLARE_EMAIL?{'X-Auth-Key':env.CLOUDFLARE_API_KEY,'X-Auth-Email':env.CLOUDFLARE_EMAIL}:null;
let client,auditId,db;
const summarize=d=>({id:d.id,environment:d.environment,url:d.url,branch:d.deployment_trigger?.metadata?.branch||null,commit:d.deployment_trigger?.metadata?.commit_hash||null,status:d.latest_stage?.status||null,stage:d.latest_stage?.name||null,createdAt:d.created_on});
async function cf(path='',method='GET'){
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${encodeURIComponent(project)}${path}`,{method,headers:{...auth,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
 let data;try{data=await response.json();}catch{throw Error('Cloudflare returned an unreadable response.');}
 if(!response.ok||!data.success)throw Error('Cloudflare API HTTP '+response.status);
 return data.result;
}
try{
 if(!['status','deployments','retry','rollback'].includes(command))throw Error('Use: npm run site -- status|deployments|retry ID|rollback ID');
 if(!account||!/^[a-f0-9]{32}$/.test(account)||!auth||!env.MONGODB_URI)throw Error('Cloudflare and MongoDB access must be configured privately.');
 const id=process.argv[3];if(['retry','rollback'].includes(command)&&(!id||!/^[a-f0-9-]{36}$/.test(id)))throw Error('Pass a valid deployment UUID.');
 client=await MongoClient.connect(env.MONGODB_URI,{serverSelectionTimeoutMS:6000,maxPoolSize:1});db=client.db(env.MONGODB_DB||'utd_hackathon_26');
 await db.collection('site_control_audit').createIndex({at:-1});
 const info=await cf();
 const config={provider:'cloudflare_pages',accountId:account,projectName:project,siteUrl:`https://${info.subdomain||project+'.pages.dev'}`,credentialStorage:'private environment and provider/GitHub secret stores',credentialReference:token?'CLOUDFLARE_SITE_API_TOKEN (local private store)':'CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL (local only)',verifiedAt:new Date()};
 await db.collection('service_connections').updateOne({_id:'cloudflare_pages'},{$set:config},{upsert:true});
 if(command==='status'){console.log(JSON.stringify({project:info.name,url:config.siteUrl,latest:info.latest_deployment?summarize(info.latest_deployment):null,mongodbLinked:true,credentialsStoredInMongoDB:false},null,2));}
 else if(command==='deployments'){const list=await cf('/deployments?per_page=10');await Promise.all(list.map(d=>db.collection('site_deployments').updateOne({_id:d.id},{$set:{...summarize(d),syncedAt:new Date()}},{upsert:true})));console.log(JSON.stringify(list.map(summarize),null,2));}
 else {
  const target=await cf('/deployments/'+id);
  if(command==='rollback'&&(target.environment!=='production'||target.latest_stage?.status!=='success'))throw Error('Rollback target must be a successful production deployment.');
  auditId=(await db.collection('site_control_audit').insertOne({at:new Date(),action:command,targetId:id,projectName:project,source:'team-cli',outcome:'requested'})).insertedId;
  const result=await cf('/deployments/'+id+'/'+command,'POST');
  await db.collection('site_control_audit').updateOne({_id:auditId},{$set:{outcome:'accepted',completedAt:new Date(),resultId:result.id||null}});
  console.log(JSON.stringify({accepted:true,action:command,deployment:summarize(result),note:'Verify live readiness before declaring this change complete.'},null,2));
 }
}catch(error){if(auditId&&db)await db.collection('site_control_audit').updateOne({_id:auditId},{$set:{outcome:'unconfirmed',completedAt:new Date()}}).catch(()=>{});const safe=error.message.startsWith('Cloudflare API HTTP ')||error.message.startsWith('Use:')||error.message.startsWith('Pass ')||error.message.startsWith('Rollback target')||error.message.startsWith('Cloudflare and MongoDB');console.error(safe?error.message:'Site control is unavailable ('+error.name+'). Check access without printing credentials.');process.exitCode=1;}
finally{await client?.close();}
