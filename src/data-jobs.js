import { LAYERS,refreshLayer } from './feeds.js';
import { ensureDataStore,materializeDailyStats } from './data-store.js';
const bboxDefault=[-96.80,32.96,-96.76,33.00];
export async function ensureSourceRegistry(db,env,{now=new Date()}={}){
 for(const [id,s]of Object.entries(LAYERS))await db.collection('source_registry').updateOne({_id:id},{$set:{name:s.name,origin:s.attribution,cadenceSeconds:s.ttlS,scopeType:s.scope,requiresCredential:s.keyEnv||null,configured:!s.keyEnv||Boolean(env[s.keyEnv]),note:s.note||null},$setOnInsert:{nextDueAt:now,createdAt:now,status:'not_fetched'}},{upsert:true});
}
export async function refreshData(db,env,{now=new Date(),limit=3,fetcher,trigger='manual'}={}){
 await ensureDataStore(db);await ensureSourceRegistry(db,env,{now});
 const ids=await db.collection('devices').distinct('homeId',{'meta.exercise':{$ne:true}});
 const homes=await db.collection('homes').find({_id:{$in:ids.filter(Boolean)}},{projection:{location:1}}).limit(26).toArray();
 const areas=homes.slice(0,25).map(h=>h.location?.coordinates).filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)).map(([x,y])=>[x-.02,y-.02,x+.02,y+.02]);
 const rows=await db.collection('source_registry').find({_id:{$in:Object.keys(LAYERS)},nextDueAt:{$lte:now},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:now}}]}).sort({nextDueAt:1}).limit(Math.max(1,Math.min(5,limit))).toArray();
 const outcomes=[];
 for(const row of rows){const id=row._id,def=LAYERS[id];if(!def)continue;const lease=await db.collection('source_registry').updateOne({_id:id,nextDueAt:{$lte:now},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:now}}]},{$set:{leaseUntil:new Date(now.getTime()+120000),lastAttemptAt:now}});if(!lease.modifiedCount)continue;
 const configured=!def.keyEnv||Boolean(env[def.keyEnv]);let result={id,status:configured?'error':'needs_key'};
 try{if(!configured)continue;const configuredBbox=String(env.DATA_REGION_BBOX||'').split(',').map(Number);const bbox=areas.length?areas[(row.coverageCursor||0)%areas.length]:configuredBbox.length===4&&configuredBbox.every(Number.isFinite)?configuredBbox:bboxDefault;result.coverage={type:areas.length?'registered_device_area':'configured_interest_area',bbox,areaCount:areas.length||1,truncated:homes.length>25};
 const fc=await refreshLayer(db,env,id,def.scope==='all'?null:bbox,{now,fetcher});result={...result,id,status:fc.hb.stale?'stale':'ok',featureCount:fc.features.length,fetchedAt:fc.hb.fetchedAt,truncated:fc.hb.truncated};
 }catch(e){result.error='Source could not be refreshed; prior evidence retains its original age.';}
 finally{const next=new Date(now.getTime()+(result.status==='needs_key'?3600:result.status==='error'?Math.min(def.ttlS,300):def.ttlS)*1000);await db.collection('source_registry').updateOne({_id:id},{$set:{...result,lastAttemptAt:now,nextDueAt:next,coverage:def.scope==='all'?'source-defined':result.coverage||{type:'configured_interest_area',bbox:env.DATA_REGION_BBOX||bboxDefault.join(',')},coverageCursor:(row.coverageCursor||0)+1,...(result.status==='ok'?{lastSuccessAt:now}:{})},$unset:{leaseUntil:''}});outcomes.push(result);}
 }
 const aggregate=await db.collection('source_registry').findOne({_id:'device_daily_stats'});
 if(!aggregate?.nextDueAt||aggregate.nextDueAt<=now){await materializeDailyStats(db,{now});await db.collection('source_registry').updateOne({_id:'device_daily_stats'},{$set:{name:'Device daily statistics',status:'ok',lastSuccessAt:now,nextDueAt:new Date(now.getTime()+3600000)}},{upsert:true});}
 await db.collection('data_job_runs').insertOne({at:now,trigger,outcomes,expiresAt:new Date(now.getTime()+30*86400000)});
 return{at:now,trigger,outcomes};
}
