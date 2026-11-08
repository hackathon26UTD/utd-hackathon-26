// Public-source reads only. Never read devices, people, messages, operator zones or credentials.
import {withDb} from './db.js';
import {HttpError} from './http.js';
import {LAYERS,getFeedStatus,refreshLayer,makeGet} from './feeds.js';
import {parseBbox,geometryBbox,bboxIntersects} from './feed-geo.js';
import {alertIntersects} from './public-alert-geo.js';
import {STATE_BOUNDS} from './us-state-bounds.js';
const ZONE=/^https:\/\/api\.weather\.gov\/zones\/(county|forecast|fire)\/([A-Z]{2})[CZ][0-9]{3}$/;
const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':status===200?'public, max-age=30':'no-store'}});
const publicEnv=env=>({...env,NWS_SCOPE:'national'});
function getOnly(request){if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'Read only.');}
function fail(error){return response({error:error instanceof HttpError?error.message:'Public data is temporarily unavailable.'},error instanceof HttpError?error.status:503);}
// Cloudflare supplies this header. Store only a daily digest, never the address.
const budgetIndexes=new WeakSet();
async function publicBudget(request,db,now){
 const ip=request.headers.get('CF-Connecting-IP');if(!ip)return;
 const coll=db.collection('public_context_limits');if(!budgetIndexes.has(db)){await coll.createIndex({expiresAt:1},{expireAfterSeconds:0});budgetIndexes.add(db);}
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(now.toISOString().slice(0,10)+':'+ip));
 const key=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')+':'+Math.floor(+now/60000);
 const row=await coll.findOneAndUpdate({_id:key},{$inc:{count:1},$setOnInsert:{expiresAt:new Date(+now+120000)}},{upsert:true,returnDocument:'after'});
 if(row.count>60)throw new HttpError(429,'Too many weather requests. Try again in a minute.');
}
export async function handlePublicFeeds(request,env,deps={}){
 try{getOnly(request);return await withDb(env,deps.db,async db=>{await publicBudget(request,db,deps.now||new Date());return response({sources:await getFeedStatus(db,{env:publicEnv(env),now:deps.now||new Date(),includeZones:false})});});}catch(e){return fail(e);}
}
export async function handlePublicOverlays(request,env,deps={}){
 try{
  getOnly(request);const u=new URL(request.url),id=u.searchParams.get('layer');
  if(!Object.hasOwn(LAYERS,id))throw new HttpError(400,'Choose a public data layer.');
  const bbox=parseBbox(u.searchParams.get('bbox'),{required:LAYERS[id].scope!=='all'});
  if(bbox&&(bbox[0]<-127||bbox[2]>-64||bbox[1]<23||bbox[3]>51))throw new HttpError(400,'Choose an area in the mainland United States.');
  if(bbox&&LAYERS[id].scope!=='all'&&Math.max(bbox[2]-bbox[0],bbox[3]-bbox[1])>8)throw new HttpError(400,'Zoom closer to load this layer.');
  // Cache misses stay bounded by each existing source's tile/span limits. Force is never forwarded.
  return await withDb(env,deps.db,async db=>{await publicBudget(request,db,deps.now||new Date());return response(await refreshLayer(db,publicEnv(env),id,bbox,{fetcher:deps.fetcher,now:deps.now||new Date()}));});
 }catch(e){return fail(e);}
}
export function activeAlerts(features,now=new Date()){
 return features.filter(f=>{
  const p=f.properties||{},times=[p.ends,p.expires].map(Date.parse).filter(Number.isFinite),end=times.length?Math.min(...times):NaN;
  return (!p.status||p.status==='Actual')&&p.messageType!=='Cancel'&&Number.isFinite(end)&&end>+now;
 }).map(f=>({...f,properties:{...f.properties,source:'National Weather Service',geometryBasis:f.geometry?'Alert polygon':'Area named by NWS'}}))
 .sort((a,b)=>Date.parse(b.properties.sent||0)-Date.parse(a.properties.sent||0));
}
const indexed=new WeakSet();
async function boundaries(db,urls,get,now){
 const coll=db.collection('public_alert_zones');
 if(!indexed.has(db)){await coll.createIndex({expiresAt:1},{expireAfterSeconds:0});indexed.add(db);}
 const keys=[...new Set(urls.filter(u=>ZONE.test(u)))].slice(0,200);
 const saved=await coll.find({_id:{$in:keys},expiresAt:{$gt:now}}).toArray(),out=new Map(saved.map(d=>[d._id,d.geometry]));
 const missing=keys.filter(k=>!out.has(k)).slice(0,16);
 // Four workers; at most sixteen uncached zone requests, each with a 9-second source timeout.
 let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<missing.length){const url=missing[cursor++];try{
  const j=await get(url);const g=j.geometry;
  if(!['Polygon','MultiPolygon'].includes(g?.type)||!geometryBbox(g)||JSON.stringify(g).length>500000)continue;
  out.set(url,g);await coll.updateOne({_id:url},{$set:{geometry:g,expiresAt:new Date(+now+86400000)}},{upsert:true});
 }catch{/* Partial boundary coverage is returned explicitly. */}}}));
 return out;
}
export async function handlePublicNews(request,env,deps={}){
 try{
  getOnly(request);const u=new URL(request.url),bbox=parseBbox(u.searchParams.get('bbox'),{required:false}),alert=u.searchParams.get('alert');
  if(alert&&alert.length>600)throw new HttpError(400,'Invalid alert.');
  if(bbox&&Math.max(bbox[2]-bbox[0],bbox[3]-bbox[1])>8)throw new HttpError(400,'Zoom closer for local alerts.');
  const now=deps.now||new Date();
  return await withDb(env,deps.db,async db=>{
   await publicBudget(request,db,now);
   const data=await refreshLayer(db,publicEnv(env),'nws',null,{fetcher:deps.fetcher,now});
   let features=activeAlerts(data.features,now),partial=!!data.hb?.truncated;
   if(alert)features=features.filter(f=>f.id===alert);
   if(bbox||alert){
    if(features.some(f=>!f.geometry&&!f.properties.affectedZones?.length))partial=true;
    const states=bbox?new Set(Object.entries(STATE_BOUNDS).filter(([,b])=>bboxIntersects(b,bbox)).map(([s])=>s)):null;
    features=features.filter(f=>{const box=geometryBbox(f.geometry);return box?(!bbox||alertIntersects(f.geometry,bbox)):(f.properties.affectedZones||[]).some(url=>ZONE.test(url)&&(!states||states.has(url.match(ZONE)[2])));});
    const urls=features.filter(f=>!f.geometry).flatMap(f=>(f.properties.affectedZones||[]).filter(url=>ZONE.test(url)&&(!states||states.has(url.match(ZONE)[2]))));
    const shapes=await boundaries(db,urls,makeGet(deps.fetcher),now),expanded=[];
    for(const f of features){
     if(f.geometry){expanded.push(f);continue;}
     const wanted=(f.properties.affectedZones||[]).filter(url=>ZONE.test(url)&&(!states||states.has(url.match(ZONE)[2])));
     const found=wanted.filter(url=>shapes.has(url));if(found.length<wanted.length)partial=true;
     const polygons=found.flatMap(url=>{const g=shapes.get(url);return g.type==='Polygon'?[g.coordinates]:g.coordinates;});
     if(polygons.length){const geometry={type:'MultiPolygon',coordinates:polygons};if(!bbox||alertIntersects(geometry,bbox))expanded.push({...f,geometry,properties:{...f.properties,geometryBasis:found.every(url=>url.includes('/county/'))?'NWS county area':'NWS forecast / fire zone',boundaryPartial:found.length<wanted.length}});}
     else expanded.push({...f,properties:{...f.properties,boundaryUnavailable:true}});
    }
    features=expanded;
   }
   return response({type:'FeatureCollection',features,hb:{...data.hb,truncated:partial},scope:bbox?'map-area':'United States',sourceUrl:'https://www.weather.gov/alerts',refreshSeconds:60});
  });
 }catch(e){return fail(e);}
}
