import { ObjectId } from 'mongodb';
import { json,readJson,HttpError } from './http.js';
import {requireDevice} from './auth.js';
import {writeAudit} from './live.js';
import { opsAuth } from './live-api.js';
import { withDb, ensureOnce } from './db.js';
import { ensureDataStore,sensorStats } from './data-store.js';
import { ensureSourceRegistry,refreshData } from './data-jobs.js';
const fail=e=>json({error:e instanceof HttpError?e.message:'Data service is unavailable.'},e instanceof HttpError?e.status:503);
export async function loadLiveDevice(db,id){
 if(!/^[a-f\d]{24}$/i.test(id||''))throw new HttpError(400,'A registered device id is required.');
 const d=await db.collection('devices').findOne({_id:new ObjectId(id),'meta.exercise':{$ne:true}},{projection:{keyHash:0}});if(!d)throw new HttpError(404,'Live device not found.');
 const h=d.homeId?await db.collection('homes').findOne({_id:d.homeId}):null;
 const coords=h?.location?.coordinates||[d.meta?.longitude,d.meta?.latitude];
 const location=Array.isArray(coords)&&coords.length===2&&coords.every(Number.isFinite)&&Math.abs(coords[0])<=180&&Math.abs(coords[1])<=90?coords:null;
 return{d,h,location};
}
export async function responsePreview(db,id,{actor='operator',now=new Date(),service='response liaison'}={}){
 const {d,h,location}=await loadLiveDevice(db,id);const incidents=await db.collection('incidents').find({deviceId:d._id,status:{$in:['open','acknowledged']},simulated:{$ne:true}}).limit(20).toArray();
 const recipient=['fire/rescue','medical response','utility restoration','response liaison'].includes(service)?service:'response liaison';
 const evidence=incidents.map(i=>`${i.type} (${i.severity}), observed ${i.lastObservedAt instanceof Date?i.lastObservedAt.toISOString():'time unknown'}`).join('; ')||'No unresolved incident evidence recorded.';
 const mapsUrl=location?`https://www.google.com/maps/search/?api=1&query=${location[1]},${location[0]}`:null;
 const text=['DEMONSTRATION ONLY. NOT SENT. NO TEAM DISPATCHED.',`Suggested recipient type: ${recipient}.`,`Safe Home device: ${id}${h?.label?' / '+String(h.label).slice(0,100):''}.`,`Location: ${location?location[1]+', '+location[0]:'not registered; verify before routing'}.`,`Latest observation: ${d.lastObservedAt instanceof Date?d.lastObservedAt.toISOString():'unknown'}.`,`Evidence: ${evidence}`,`Occupancy and safe entry: unknown; verify directly.`,mapsUrl?`Map: ${mapsUrl}`:'',`Prepared ${now.toISOString()} for operator review.`].filter(Boolean).join('\n');
 const preview={deviceId:id,kind:'responder_routing_demo',recipientType:recipient,message:text,mapsUrl,location,sent:false,dispatchCreated:false,createdAt:now,createdBy:actor,expiresAt:new Date(now.getTime()+30*86400000)};const saved=await db.collection('response_previews').insertOne(preview);return{id:String(saved.insertedId),...preview};
}
export async function dataApi(ctx,kind){try{
 const url=new URL(ctx.request.url),job=kind==='refresh'&&ctx.env.DATA_JOB_TOKEN&&ctx.request.headers.get('X-Data-Job-Key')===ctx.env.DATA_JOB_TOKEN;
 const auth=job?{actor:'scheduled-data-worker',demo:false}:opsAuth(ctx,url);if(auth.demo)throw new HttpError(403,'This endpoint contains live production data.');
 const methods=kind==='settings'?['GET','PATCH']:kind==='refresh'||kind==='response'?['POST']:['GET'];if(!methods.includes(ctx.request.method))throw new HttpError(405,'Method not allowed.');
 return await withDb(ctx.env,ctx.injectedDb,async db=>{
 if(kind==='catalog'){await ensureOnce(db,'data-store+registry',async()=>{await ensureDataStore(db);await ensureSourceRegistry(db,ctx.env);});const [datasets,sources]=await Promise.all([db.collection('dataset_catalog').find({}).toArray(),db.collection('source_registry').find({}).toArray()]);return json({datasets,sources,asOf:new Date(),history:'Compressed hourly source samples retained 90 days; daily device summaries retained 365 days; raw telemetry 30 days.'});}
 if(kind==='refresh'){const b=await readJson(ctx.request);return json(await refreshData(db,ctx.env,{limit:Number.isInteger(b.limit)?b.limit:3,fetcher:ctx.fetcher,now:ctx.now,trigger:job?(ctx.request.headers.get('X-Data-Trigger')==='cron'?'cron_worker':'worker_manual'):'operator'}));}
 if(kind==='settings'){const id=url.searchParams.get('id');const {d}=await loadLiveDevice(db,id);if(ctx.request.method==='PATCH'){const b=await readJson(ctx.request);if(!Number.isInteger(b.pollAfterSeconds)||b.pollAfterSeconds<10||b.pollAfterSeconds>300)throw new HttpError(400,'pollAfterSeconds must be a whole number from 10 to 300.');await db.collection('devices').updateOne({_id:d._id},{$set:{'desiredSettings.pollAfterSeconds':b.pollAfterSeconds,'desiredSettings.updatedAt':new Date(),'desiredSettings.updatedBy':auth.actor},$inc:{'desiredSettings.revision':1}});await writeAudit(db,{action:'device_poll_setting_requested',deviceId:id,actor:{type:'operator',id:auth.actor},details:{pollAfterSeconds:b.pollAfterSeconds}});}const current=await db.collection('devices').findOne({_id:d._id},{projection:{desiredSettings:1,reportedSettings:1}});return json({deviceId:id,desired:current.desiredSettings||null,reported:current.reportedSettings||null,status:current.desiredSettings?.revision&&current.desiredSettings.revision===current.reportedSettings?.revision?'device_reported_applied':current.desiredSettings?'awaiting_device':'not_requested',note:'Changes control message polling only. They do not change sensor sampling or prove physical behavior.'});}
 if(kind==='stats')return json(await sensorStats(db,url.searchParams.get('id'),{days:Number(url.searchParams.get('days')||7),now:ctx.now}));
 if(kind==='history'){const source=url.searchParams.get('source');if(!source||source.length>40)throw new HttpError(400,'Provide a source id.');const samples=await db.collection('source_snapshots').find({sourceId:source},{projection:{payloadGzip:0}}).sort({fetchedAt:-1}).limit(48).toArray();return json({source,samples,kind:'hourly_source_snapshot_metadata',limit:48});}
 if(kind==='response'){await ensureOnce(db,'data-store',()=>ensureDataStore(db));const b=await readJson(ctx.request);return json(await responsePreview(db,b.deviceId,{actor:auth.actor,service:b.service,now:ctx.now}),201);}
 if(kind==='location'||kind==='location-image'){
 const {location}=await loadLiveDevice(db,url.searchParams.get('id'));if(!location)throw new HttpError(409,'This device has no verified registered location.');
 if(kind==='location')return json({coordinates:location,googleImageConfigured:Boolean(ctx.env.GOOGLE_MAPS_API_KEY),mapsUrl:`https://www.google.com/maps/search/?api=1&query=${location[1]},${location[0]}`,note:'Imagery is geographic context, not a current disaster photograph.'});
 if(!ctx.env.GOOGLE_MAPS_API_KEY)throw new HttpError(503,'Google Maps Static API key is not configured.');
 const street=url.searchParams.get('view')==='street';
 const q=new URLSearchParams(street?{location:location[1]+','+location[0],size:'600x360',source:'outdoor',radius:'50',return_error_code:'true',key:ctx.env.GOOGLE_MAPS_API_KEY}:{center:location[1]+','+location[0],zoom:'18',size:'600x360',maptype:'satellite',markers:location[1]+','+location[0],key:ctx.env.GOOGLE_MAPS_API_KEY});
 const r=await (ctx.fetcher||fetch)('https://maps.googleapis.com/maps/api/'+(street?'streetview':'staticmap')+'?'+q,{signal:AbortSignal.timeout(8000),redirect:'error'});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw new HttpError(503,'Google imagery is unavailable. Check server key, API enablement and billing.');
 return new Response(r.body,{headers:{'Content-Type':r.headers.get('content-type'),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 throw new HttpError(404,'Not found.');});
 }catch(e){return fail(e);}}

export async function deviceSettings(ctx){try{if(!['GET','POST'].includes(ctx.request.method))throw new HttpError(405,'Method not allowed.');return await withDb(ctx.env,ctx.injectedDb,async db=>{const d=await requireDevice(ctx.request,db);if(d.meta?.exercise)throw new HttpError(403,'Exercise device not allowed.');if(ctx.request.method==='POST'){const b=await readJson(ctx.request);if(!d.desiredSettings||b.revision!==d.desiredSettings.revision||b.pollAfterSeconds!==d.desiredSettings.pollAfterSeconds)throw new HttpError(409,'Report must match the currently requested revision and interval.');await db.collection('devices').updateOne({_id:d._id,'desiredSettings.revision':b.revision},{$set:{reportedSettings:{revision:b.revision,pollAfterSeconds:b.pollAfterSeconds,reportedAt:new Date()}}});}return json({configuration:d.desiredSettings?{revision:d.desiredSettings.revision,pollAfterSeconds:d.desiredSettings.pollAfterSeconds}:null});});}catch(e){return fail(e);}}
