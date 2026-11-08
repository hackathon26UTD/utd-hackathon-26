// Device-local retained snapshots. Separate from hazard ingest; never changes live status or alarms.
import {withDb} from './db.js';
import {requireDevice,sha256Hex} from './auth.js';
import {HttpError,json} from './http.js';
const DAY=86400000, MAX_BYTES=16384;
export const LOCAL_METRICS={water_raw:{label:'Water sensor',unit:'ADC',min:0,max:65535},flame_raw:{label:'Flame sensor',unit:'ADC',min:0,max:65535},accel_dev_mg:{label:'Acceleration change',unit:'mg',min:-32768,max:32767},battery_mv:{label:'Battery voltage',unit:'mV',min:0,max:65535}};
function object(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw new HttpError(400,'Invalid history fields.');}
function integer(v,min,max){if(!Number.isSafeInteger(v)||v<min||v>max)throw new HttpError(400,'Invalid history value.');return v;}
function epoch(v,now,unknown=false){integer(v,unknown?0:1700000000,Math.floor(+now/1000)+300);if(v!==0&&v<1700000000)throw new HttpError(400,'Invalid observation time.');return v?new Date(v*1000):null;}
export function validateHistorySync(body,now=new Date()){
 object(body,['version','samples','metrics','overwritten']);if(body.version!==1||!Array.isArray(body.samples)||body.samples.length<1||body.samples.length>8)throw new HttpError(400,'Send 1 to 8 history samples.');
 const seen=new Set();const samples=body.samples.map(s=>{
  object(s,['boot','seq','epoch','uptimeMs','flags','waterRaw','flameRaw','accelMilliG','batteryMv','soundHits']);
  for(const k of ['boot','seq'])integer(s[k],1,4294967295);
  integer(s.uptimeMs,0,4294967295);integer(s.flags,0,0x17f1f);if(s.flags&~0x17f1f)throw new HttpError(400,'Unsupported history flags.');
  const observedAt=epoch(s.epoch,now,true);if(Boolean(s.flags&65536)!==Boolean(observedAt))throw new HttpError(400,'Observation time and validity flag disagree.');
  for(const k of ['waterRaw','flameRaw','batteryMv','soundHits'])integer(s[k],0,65535);integer(s.accelMilliG,-32768,32767);
  const key=s.boot+':'+s.seq;if(seen.has(key))throw new HttpError(400,'Duplicate sample in batch.');seen.add(key);
  return {key,raw:{boot:s.boot,seq:s.seq,epoch:s.epoch,uptimeMs:s.uptimeMs,flags:s.flags,waterRaw:s.waterRaw,flameRaw:s.flameRaw,accelMilliG:s.accelMilliG,batteryMv:s.batteryMv,soundHits:s.soundHits},observedAt};
 });
 const metrics={};if(body.metrics!==undefined){object(body.metrics,Object.keys(LOCAL_METRICS));for(const [key,m]of Object.entries(body.metrics)){
  object(m,['count','sum','min','max','firstEpoch','lastEpoch']);const meta=LOCAL_METRICS[key];integer(m.count,1,4294967295);integer(m.sum,meta.min*m.count,meta.max*m.count);integer(m.min,meta.min,meta.max);integer(m.max,m.min,meta.max);const first=epoch(m.firstEpoch,now),last=epoch(m.lastEpoch,now);if(last<first||m.sum/m.count<m.min||m.sum/m.count>m.max)throw new HttpError(400,'Invalid learned range.');
  metrics[key]={...m,mean:m.sum/m.count,label:meta.label,unit:meta.unit,status:m.count>=30&&+last-+first>=2*DAY?'device_reported_reference':'insufficient_history'};
 }}
 const overwritten=integer(body.overwritten??0,0,4294967295);return {samples,metrics,overwritten};
}
async function bodyJson(request){
 if(Number(request.headers.get('Content-Length')||0)>MAX_BYTES)throw new HttpError(413,'History batch too large.');
 if(!request.body)throw new HttpError(400,'History batch required.');const reader=request.body.getReader(),chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES){await reader.cancel();throw new HttpError(413,'History batch too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'Invalid history JSON.');}
}
export async function syncDeviceHistory(ctx){
 try{
  if(ctx.request.method!=='POST')throw new HttpError(405,'Use POST.');
  if(!ctx.request.headers.get('X-Device-Key'))throw new HttpError(401,'Device key required.');
  const now=ctx.now||new Date(),batch=validateHistorySync(await bodyJson(ctx.request),now);
  return await withDb(ctx.env,ctx.db||ctx.injectedDb,async db=>{
   const device=await requireDevice(ctx.request,db);if(device.exercise||device.simulated||device.meta?.exercise||device.meta?.simulated)throw new HttpError(403,'Simulated devices cannot sync live history.');
   const rows=db.collection('device_local_samples');await rows.createIndex({expiresAt:1},{expireAfterSeconds:0});await rows.createIndex({deviceId:1,receivedAt:-1});
   const accepted=[];
   for(const sample of batch.samples){
    const _id=String(device._id)+':'+sample.key,digest=await sha256Hex(JSON.stringify(sample.raw));
    try{await rows.updateOne({_id,digest},{$setOnInsert:{_id,digest,deviceId:device._id,...sample.raw,observedAt:sample.observedAt,clockSource:sample.observedAt?'device':'unknown',receivedAt:now,expiresAt:new Date(+(sample.observedAt||now)+365*DAY)}},{upsert:true});}catch(e){if(e.code===11000)throw new HttpError(409,'A retained sample conflicts with its earlier copy. Sync is paused for review.');throw e;}
    accepted.push(sample.key);
   }
   // Only advance the reported aggregate with a newer original (boot,sequence), not request arrival order.
   const latest=batch.samples.at(-1).raw, reports=db.collection('device_local_reports');
   await reports.createIndex({expiresAt:1},{expireAfterSeconds:0});
   const id=String(device._id),revision={boot:latest.boot,seq:latest.seq};
   try{await reports.updateOne({_id:id,$or:[{boot:{$lt:revision.boot}},{boot:revision.boot,seq:{$lte:revision.seq}},{boot:{$exists:false}}]},{$set:{deviceId:device._id,...revision,metrics:batch.metrics,overwritten:batch.overwritten,updatedAt:now,expiresAt:new Date(+now+365*DAY)}},{upsert:true});}catch(e){if(e.code!==11000)throw e;}
   return json({version:1,accepted,stored:accepted.length},200);
  });
 }catch(e){return json({error:e instanceof HttpError?e.message:'History sync unavailable. Retry the same batch.'},e instanceof HttpError?e.status:503);}
}
export async function localDeviceHistory(db,deviceId){
 const samples=await db.collection('device_local_samples').find({deviceId},{projection:{_id:0,digest:0,deviceId:0,expiresAt:0}}).sort({boot:-1,seq:-1}).limit(64).toArray();
 const report=await db.collection('device_local_reports').findOne({_id:String(deviceId)},{projection:{_id:0,deviceId:0,expiresAt:0}});
 return {samples,metrics:report?.metrics||{},overwritten:report?.overwritten??null,updatedAt:report?.updatedAt||null,note:'Retained box samples and device-reported averages. Unknown observation times stay unknown. This finite record is separate from live hazard checks.'};
}
