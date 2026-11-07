import {withDatabase} from '../../lib/mongodb.js';
import {readSession,passwordHash,equal,sessionCookie} from '../../src/operator-session.js';
export async function onRequest({request,env}){
 const user=await readSession(request,env);if(!user)return Response.json({error:'Sign in required.'},{status:401});
 try{return await withDatabase(env,async db=>{
 const col=db.collection('operator_accounts');const account=await col.findOne({_id:user.email.toLowerCase()});
 if(request.method==='GET')return Response.json({email:user.email,name:account?.name||'',organization:account?.organization||'',role:'Operator'},{headers:{'Cache-Control':'no-store'}});
 if(request.method!=='PATCH')return Response.json({error:'Method not allowed.'},{status:405});
 const raw=await request.text();if(raw.length>4096)return Response.json({error:'Request too large.'},{status:413});const b=JSON.parse(raw);
 if(b.newPassword!==undefined){if(typeof b.newPassword!=='string'||b.newPassword.length<12||b.newPassword.length>512||typeof b.currentPassword!=='string')return Response.json({error:'Use a password of at least 12 characters.'},{status:400});if(!equal(await passwordHash(b.currentPassword,account?.salt||env.OPERATOR_PASSWORD_SALT),account?.hash||env.OPERATOR_PASSWORD_HASH))return Response.json({error:'Current password is incorrect.'},{status:400});const salt=crypto.randomUUID();await col.updateOne({_id:user.email.toLowerCase()},{$set:{hash:await passwordHash(b.newPassword,salt),salt,passwordChangedAt:new Date()}},{upsert:true});return Response.json({saved:true,signInAgain:true},{headers:{'Set-Cookie':sessionCookie('',0)}});}
 if(typeof b.name!=='string'||typeof b.organization!=='string'||b.name.length>100||b.organization.length>160)return Response.json({error:'Enter a name and organization within the limits.'},{status:400});
 await col.updateOne({_id:user.email.toLowerCase()},{$set:{name:b.name.trim(),organization:b.organization.trim()}},{upsert:true});return Response.json({saved:true});
 });}catch{return Response.json({error:'Account update is unavailable.'},{status:503});}
}
