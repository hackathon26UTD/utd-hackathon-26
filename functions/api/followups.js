import { withDb,oid } from '../../src/db.js';
import { readSession } from '../../src/operator-session.js';
export async function onRequestPost({request,env}){
  const user=await readSession(request,env);if(!user)return Response.json({error:'Operator sign-in required.'},{status:401});
  let b;try{const text=await request.text();if(text.length>4096)return Response.json({error:'Update too large.'},{status:413});b=JSON.parse(text);}catch{return Response.json({error:'Invalid update.'},{status:400});}
  if(!['contact','inspection','resident_reported_evacuated','responder_confirmed','acknowledge'].includes(b.action)||typeof b.note!=='string'||!b.note.trim()||b.note.length>1500)return Response.json({error:'Choose an action and add a note or source.'},{status:400});
  try {const deviceId=oid(b.deviceId);return await withDb(env,null,async db=>{if(!await db.collection('devices').findOne({_id:deviceId}))return Response.json({error:'Box not found.'},{status:404});const doc={deviceId:String(deviceId),action:b.action,note:b.note.trim(),operator:user.email,at:new Date()};await db.collection('followups').insertOne(doc);if(['resident_reported_evacuated','responder_confirmed'].includes(b.action))await db.collection('devices').updateOne({_id:deviceId},{$set:{'meta.evacuation':{status:b.action,source:b.note.trim(),at:doc.at,operator:user.email}}});return Response.json({saved:true,at:doc.at},{status:201,headers:{'Cache-Control':'no-store'}});});}catch{return Response.json({error:'The follow-up could not be saved.'},{status:503});}
}
