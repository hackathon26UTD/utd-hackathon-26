import {exerciseProperties} from '../../domain/exercise.js';
import { withDb } from '../../src/db.js';
import { summarizeProperty,areaSummary } from '../../domain/property.js';
export async function onRequestGet({env,data}){
  if(data?.operator?.role==='demo')return Response.json({mode:'exercise',properties:exerciseProperties()},{headers:{'Cache-Control':'no-store'}});
  try{return await withDb(env,null,async db=>{
    const [devices,latest,alerts,events,followups]=await Promise.all([
      db.collection('devices').find({disabled:{$ne:true},'meta.exercise':{$ne:true}},{projection:{keyHash:0}}).limit(500).toArray(),
      db.collection('readings').aggregate([{$sort:{deviceId:1,sensor:1,ts:-1}},{$group:{_id:{deviceId:'$deviceId',sensor:'$sensor'},sensor:{$first:'$sensor'},value:{$first:'$value'},ts:{$first:'$ts'},deviceId:{$first:'$deviceId'}}},{$limit:10000}]).toArray(),
      db.collection('alerts').find({status:{$ne:'resolved'}}).sort({createdAt:-1}).limit(500).toArray(),
      db.collection('events').find().sort({ts:-1}).limit(200).toArray(),
      db.collection('followups').find().sort({at:-1}).limit(200).toArray(),
    ]);
    const homeIds=devices.map(d=>d.homeId).filter(Boolean);
    const homes=homeIds.length?await db.collection('homes').find({_id:{$in:homeIds}},{projection:{location:1}}).toArray():[];
    const homeMap=new Map(homes.map(h=>[String(h._id),h]));
    // Group once instead of filtering every reading for every box (was quadratic CPU).
    const groupBy=rows=>{const m=new Map();for(const r of rows){const k=String(r.deviceId);(m.get(k)||m.set(k,[]).get(k)).push(r);}return m;};
    const latestBy=groupBy(latest),alertsBy=groupBy(alerts);
    const properties=devices.map(d=>{const c=homeMap.get(String(d.homeId))?.location?.coordinates;const joined=c?.length===2?{...d,meta:{...d.meta,longitude:c[0],latitude:c[1]}}:d;return summarizeProperty(joined,latestBy.get(String(d._id))||[],alertsBy.get(String(d._id))||[]);});
    return Response.json({mode:'live',observedAt:new Date().toISOString(),properties,summary:areaSummary(properties),alerts:alerts.map(a=>({...a,_id:String(a._id),deviceId:String(a.deviceId)})),events:events.map(e=>({...e,_id:String(e._id),deviceId:e.deviceId?String(e.deviceId):null})),followups:followups.map(f=>({...f,_id:String(f._id)})),limited:devices.length>=500},{headers:{'Cache-Control':'no-store'}});
  });}catch{return Response.json({error:'Device data is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
