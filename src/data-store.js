// Dataset labels and provenance are separate from existing teammate collections.
import { ObjectId, Binary } from 'mongodb';
import { gzipSync } from 'node:zlib';
import { HttpError } from './http.js';
import { HISTORY_METRICS as METRICS, materializeDeviceHistory } from './device-history.js';
export { METRICS };
export const DATASETS = [
 ['homes','Registered locations','registration','Home labels and GeoJSON coordinates','operator'],
 ['devices','Registered boards','registration','Keyed device identity, last receipt and current projection','device'],
 ['telemetry','Original sensor observations','observation','Original observed time and receipt time; 30-day raw retention','device'],
 ['ingestion_receipts','Ingestion receipts','audit','Idempotency and interrupted-ingestion evidence','server'],
 ['readings','Dashboard sensor projection','projection','Legacy board measurements and compatible canonical telemetry projections','server'],
 ['incidents','Unresolved and historical incidents','incident','Latched evidence, not a damage determination','server'],
 ['incident_events','Incident history','audit','Operator and observation transitions','server'],
 ['feed_cache','Latest public-source snapshots','cache','Freshness and coverage are explicit; never assume live on failure','government'],
 ['source_snapshots','Historical public-source snapshots','history','Compressed hourly source samples; 90-day rolling retention','government'],
 ['source_registry','Public-source refresh status','catalog','Cadence, coverage, credentials-required status and latest attempt','server'],
 ['device_daily_stats','Daily sensor summaries','aggregate','Derived only from recorded observations, separate from climate normals','server'],
 ['dataset_catalog','Database labels and data dictionary','catalog','Human-readable purpose, provenance and schema version','server'],
 ['response_previews','Responder routing demonstrations','demo_action','Exact message preview; no contact or dispatch','operator'],
 ['data_job_runs','Scheduled refresh audit','audit','Actual source attempts, results and job time','server'],
 ['events','Board and system event history','event','Timestamped board and application events','mixed'],
 ['alerts','Rule-generated alerts','incident','Rule evidence, status and timestamps','server'],
 ['device_logs','Board diagnostic history','audit','Device and server diagnostic events','mixed'],
 ['audit_log','Operator action history','audit','Authenticated actions and outcomes','operator'],
 ['device_messages','Requested board messages','command','Operator-requested OLED information and instructions','operator'],
 ['message_deliveries','Message delivery history','audit','Queued, delivered and device-acknowledged states','device'],
 ['overlay_zones','Operator map zones','operator_input','Geographic zones with exercise isolation','operator'],
 ['flood_zone_cache','Flood reference point lookups','reference','FEMA flood-hazard context; not current flooding','government'],
 ['flood_polygon_cache','Flood reference polygons','reference','Cached FEMA geometry with source age','government'],
 ['operator_accounts','Operator access records','restricted_identity','Account access and password hashes; never public data','operator'],
 ['customer_accounts','Household access records','restricted_identity','Household authentication records, isolated from operators','customer'],
 ['login_attempts','Sign-in rate control','security','Authentication rate-limit bookkeeping','server'],
 ['beacon_schema','Telemetry schema readiness','schema','Controlled time-series schema version marker','server'],
 ['service_connections','Service connection metadata','administration','Non-secret provider links; credentials stay outside MongoDB','operator'],
 ['site_control_audit','Hosting change history','administration','Requested and completed hosting operations','operator'],
 ['site_deployments','Website deployment history','administration','Cloudflare deployment metadata','provider'],
];
export async function ensureDataStore(db){
 await Promise.all([
 db.collection('source_snapshots').createIndex({expiresAt:1},{expireAfterSeconds:0}),
 db.collection('source_snapshots').createIndex({sourceId:1,scope:1,fetchedAt:-1}),
 db.collection('source_registry').createIndex({nextDueAt:1}),
 db.collection('device_daily_stats').createIndex({deviceId:1,day:-1},{unique:true}),
 db.collection('device_daily_stats').createIndex({expiresAt:1},{expireAfterSeconds:0}),
 db.collection('response_previews').createIndex({expiresAt:1},{expireAfterSeconds:0}),
 db.collection('data_job_runs').createIndex({at:-1}),
 db.collection('data_job_runs').createIndex({expiresAt:1},{expireAfterSeconds:0}),
 ]);
 const now=new Date();const existing=await db.listCollections({},{nameOnly:true}).toArray();for(const c of existing)if(!c.name.startsWith('system.')&&!DATASETS.some(d=>d[0]===c.name))await db.collection('dataset_catalog').updateOne({_id:c.name},{$set:{label:c.name.replace(/_/g,' '),kind:'requires_classification',description:'Existing collection retained. Field-level classification requires review; data was not renamed or moved.',schemaVersion:1,updatedAt:now}},{upsert:true});
 await Promise.all(DATASETS.map(([id,label,kind,description,origin])=>db.collection('dataset_catalog').updateOne({_id:id},{$set:{label,kind,description,origin,schemaVersion:1,updatedAt:now}},{upsert:true})));
}
export async function archiveFeedSnapshot(db,doc){
 const slot=new Date(doc.fetchedAt);slot.setUTCMinutes(0,0,0);const id=doc._id+':'+slot.toISOString();
 if(await db.collection('source_snapshots').findOne({_id:id},{projection:{_id:1}}))return;
 const payload=Buffer.from(JSON.stringify(doc.data));
 await db.collection('source_snapshots').updateOne({_id:id},{$setOnInsert:{sourceId:doc.layer,scope:doc.tileKey,fetchedAt:doc.fetchedAt,freshUntil:doc.freshUntil,payloadGzip:new Binary(gzipSync(payload,{level:1})),encoding:'gzip-json',uncompressedBytes:payload.length,count:doc.count,truncated:doc.truncated,kind:'hourly_public_source_sample',expiresAt:new Date(doc.fetchedAt.getTime()+90*86400000)}},{upsert:true});
}
export async function sensorStats(db,id,{now=new Date(),days=7}={}){
 if(!/^[a-f\d]{24}$/i.test(id))throw new HttpError(400,'A registered device id is required.');
 if(!Number.isInteger(days)||days<1||days>30)throw new HttpError(400,'days must be 1 to 30.');
 const since=new Date(now.getTime()-days*86400000),oid=new ObjectId(id);
 const device=await db.collection('devices').findOne({_id:oid,'meta.exercise':{$ne:true}},{projection:{_id:1}});if(!device)throw new HttpError(404,'Live device not found.');
 // Reject missing/invalid fields in the expression instead of converting them to zero.
 const group={_id:null,observations:{$sum:1},firstObservedAt:{$min:'$observedAt'},lastObservedAt:{$max:'$observedAt'}};
 for(const[key,meta]of Object.entries(METRICS)){
 const value=meta.boolean?{$cond:[{$eq:[{$type:'$'+key},'bool']},{$cond:['$'+key,1,0]},null]}:{$cond:[{$isNumber:'$'+key},'$'+key,null]};
 group[key]={$avg:value};group[key+'_min']={$min:value};group[key+'_max']={$max:value};group[key+'_count']={$sum:{$cond:[{$ne:[value,null]},1,0]}};
 }
 const [row]=await db.collection('telemetry').aggregate([{$match:{'meta.deviceId':oid,observedAt:{$gte:since,$lte:now}}},{$group:group}]).toArray();
 if(!row){const legacy=await db.collection('readings').aggregate([{$match:{deviceId:oid,ts:{$gte:since,$lte:now},value:{$type:['number','bool']}}},{$project:{sensor:1,ts:1,unit:{$cond:[{$eq:[{$type:'$value'},'bool']},'fraction',{$ifNull:['$unit','not supplied']}]},value:{$cond:[{$eq:[{$type:'$value'},'bool']},{$cond:['$value',1,0]},'$value']}}},{$group:{_id:{sensor:'$sensor',unit:'$unit'},mean:{$avg:'$value'},min:{$min:'$value'},max:{$max:'$value'},count:{$sum:1},first:{$min:'$ts'},last:{$max:'$ts'}}}]).toArray();return{deviceId:id,kind:'observed_sample_averages',source:'readings',sampleUnit:'individual_numeric_readings',notClimateNormal:true,window:{from:since,to:now,days},sampleCount:legacy.reduce((n,r)=>n+r.count,0),baselineStatus:legacy.reduce((n,r)=>n+r.count,0)>=30&&Math.max(...legacy.map(r=>r.last?.getTime()||0))-Math.min(...legacy.map(r=>r.first?.getTime()||0))>=172800000?'observed_reference_only':'insufficient_history',note:'Legacy board measurements grouped by sensor and supplied unit. No climate normal or safe limit is inferred.',metrics:Object.fromEntries(legacy.map(r=>[r._id.sensor+' ('+r._id.unit+')',{label:r._id.sensor,unit:r._id.unit,mean:r.mean,min:r.min,max:r.max,count:r.count,firstObservedAt:r.first,lastObservedAt:r.last}]))};}
 const span=row?.firstObservedAt&&row?.lastObservedAt?row.lastObservedAt-row.firstObservedAt:0;
 return {deviceId:id,kind:'observed_sample_averages',notClimateNormal:true,window:{from:since,to:now,days},sampleCount:row?.observations||0,firstObservedAt:row?.firstObservedAt||null,lastObservedAt:row?.lastObservedAt||null,baselineStatus:(row?.observations>=30&&span>=2*86400000)?'observed_reference_only':'insufficient_history',note:'Sample averages include recorded conditions, including incidents. They are not safe limits, calibrated normal values, time-weighted availability, or a climate normal.',metrics:Object.fromEntries(Object.entries(METRICS).map(([key,meta])=>[key,{label:meta.label,unit:meta.unit,mean:row?.[key]??null,min:row?.[key+'_min']??null,max:row?.[key+'_max']??null,count:row?.[key+'_count']||0}]))};
}
// The existing hourly scheduled job calls this same entry point.
export async function materializeDailyStats(db, options = {}) {
 return materializeDeviceHistory(db, options);
}
