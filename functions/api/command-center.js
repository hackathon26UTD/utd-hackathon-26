import {exerciseProperties} from '../../domain/exercise.js';
import { withDb } from '../../src/db.js';
import { summarizeProperty,areaSummary } from '../../domain/property.js';
export async function onRequestGet({env,data}){
  if(data?.operator?.role==='demo')return Response.json({mode:'exercise',properties:exerciseProperties()},{headers:{'Cache-Control':'no-store'}});
  try{return await withDb(env,null,async db=>{
    const [devices,latest,alerts,events,followups]=await Promise.all([
      db.collection('devices').find({disabled:{$ne:true},'meta.exercise':{$ne:true}},{projection:{keyHash:0}}).limit(500).toArray(),
      db.collection('readings').aggregate([{$sort:{ts:-1,_id:-1}},{$group:{_id:{deviceId:'$deviceId',sensor:'$sensor'},sensor:{$first:'$sensor'},value:{$first:'$value'},ts:{$first:'$ts'},deviceId:{$first:'$deviceId'}}},{$limit:10000}]).toArray(),
      db.collection('alerts').find({status:{$ne:'resolved'}}).sort({createdAt:-1}).limit(500).toArray(),
      db.collection('events').find().sort({ts:-1}).limit(200).toArray(),
      db.collection('followups').find().sort({at:-1}).limit(200).toArray(),
    ]);
    const properties=devices.map(d=>summarizeProperty(d,latest.filter(r=>String(r.deviceId)===String(d._id)),alerts.filter(a=>String(a.deviceId)===String(d._id))));
    return Response.json({mode:'live',observedAt:new Date().toISOString(),properties,summary:areaSummary(properties),alerts:alerts.map(a=>({...a,_id:String(a._id),deviceId:String(a.deviceId)})),events:events.map(e=>({...e,_id:String(e._id),deviceId:e.deviceId?String(e.deviceId):null})),followups:followups.map(f=>({...f,_id:String(f._id)})),limited:devices.length>=500},{headers:{'Cache-Control':'no-store'}});
  });}catch{return Response.json({error:'Device data is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
