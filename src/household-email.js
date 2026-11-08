import {sha256Hex} from './auth.js';
import {sameOrigin} from './operator-session.js';
import {activeHouseholdMember,ensureHouseholds} from './households.js';
import {bodyJson,bodyText,customer,guarded,reply,run,fail,limit,encryptKey,audit} from './customer-connect-common.js';
import {CUSTOMER_URL,emailConfigured,plainEmail,sendHouseholdEmail} from './household-mailer.js';
const random=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const validToken=t=>typeof t==='string'&&/^[a-f\d]{64}$/.test(t);
const HOUR=3600000;
const indexed=new WeakSet();
export async function ensureHouseholdEmail(db) {
  await ensureHouseholds(db);
  if(indexed.has(db))return;
  await Promise.all([
    db.collection('household_email_tokens').createIndex({expiresAt:1},{expireAfterSeconds:0}),
    db.collection('household_mail_outbox').createIndex({status:1,nextAttemptAt:1}),
    db.collection('household_mail_outbox').createIndex({expiresAt:1},{expireAfterSeconds:0}),
    db.collection('household_mail_outbox').createIndex({providerId:1},{sparse:true}),
    db.collection('household_mail_webhooks').createIndex({expiresAt:1},{expireAfterSeconds:0}),
    db.collection('household_alert_events').createIndex({expiresAt:1},{expireAfterSeconds:0}),
    db.collection('household_context_cache').createIndex({expiresAt:1},{expireAfterSeconds:0}),
  ]);indexed.add(db);
}
async function selfMember(db,email,id) {
  const access=typeof id==='string'&&await activeHouseholdMember(db,id);
  if(!access||access.member.email!==email)fail(404,'Household membership not found.');
  return access;
}
export function eligibleForEmail(member,channel) {
  return member.status==='active' && !!member.accountGeneration && !!member.emailVerifiedAt && member.verifiedEmail===member.email && !member.emailSuppressedAt && member.preferences?.[channel]===true;
}
export async function unsubscribeHousehold(db,token,now=new Date()) {
  if(!validToken(token))fail(400,'This email link is invalid.');
  const row=await db.collection('household_email_tokens').findOne({_id:await sha256Hex(token),purpose:'unsubscribe',expiresAt:{$gt:now}});
  if(!row)fail(400,'This email link has expired. Use household settings to stop emails.');
  await db.collection('household_members').updateOne({_id:row.memberId,email:row.email,accountGeneration:row.generation},{$set:{preferences:{device:false,weather:false},emailStoppedAt:now},$inc:{preferencesVersion:1}});
  return {stopped:true};
}
export function householdEmailHandler(ctx) {return guarded(()=>run(ctx,async db=>{
  if(!['GET','POST'].includes(ctx.request.method))fail(405,'Method not allowed.');
  await ensureHouseholdEmail(db);
  const now=ctx.now||new Date();
  let body;
  if(ctx.request.method==='POST') {
    if(!sameOrigin(ctx.request))fail(403,'Use this setting on HomeBeacon.');
    body=await bodyJson(ctx.request);
    if(body.action==='unsubscribe')return reply(await unsubscribeHousehold(db,body.token,now));
  }
  const email=await customer(ctx,db);
  if(body?.action==='confirm') {
    if(!validToken(body.token))fail(400,'This email link is invalid.');
    const hash=await sha256Hex(body.token),row=await db.collection('household_email_tokens').findOne({_id:hash,purpose:'verify',expiresAt:{$gt:now},usedAt:{$exists:false}});
    if(!row||row.email!==email)fail(400,'Sign in with the invited email and open a current verification link.');
    const access=await selfMember(db,email,row.memberId);
    if(access.member.accountGeneration!==row.generation)fail(400,'This email link has expired.');
    const session=db.client.startSession();
    try {await session.withTransaction(async()=>{
      const used=await db.collection('household_email_tokens').updateOne({_id:hash,usedAt:{$exists:false},expiresAt:{$gt:now}},{$set:{usedAt:now}},{session});
      if(!used.modifiedCount)fail(409,'This email link has already been used.');
      const updated=await db.collection('household_members').updateOne({_id:row.memberId,status:'active',email,accountGeneration:row.generation},{$set:{emailVerifiedAt:now,verifiedEmail:email}},{session});
      if(!updated.modifiedCount)fail(409,'Membership changed. Open household settings again.');
    });}finally{await session.endSession();}
    await audit(db,email,'household.email.verified');
    return reply({verified:true,message:'Email verified. Choose the updates you want in household settings.'});
  }
  const access=await selfMember(db,email,body?.memberId||new URL(ctx.request.url).searchParams.get('id')),m=access.member;
  if(ctx.request.method==='GET')return reply({memberId:m._id,configured:emailConfigured(ctx.env),verified:m.verifiedEmail===email&&!!m.emailVerifiedAt,suppressed:!!m.emailSuppressedAt,preferences:m.preferences||{device:false,weather:false},message:emailConfigured(ctx.env)?null:'Email delivery is not connected yet. Household access still works.'});
  if(body.action==='preferences') {
    if(typeof body.device!=='boolean'||typeof body.weather!=='boolean')fail(400,'Choose which emails you want.');
    if((body.device||body.weather)&&(!m.emailVerifiedAt||m.verifiedEmail!==email))fail(409,'Verify your email before turning on updates.');
    if((body.device||body.weather)&&m.emailSuppressedAt)fail(409,'Email was stopped after a delivery problem. Contact the team before re-enabling it.');
    const preferences={device:body.device,weather:body.weather};
    await db.collection('household_members').updateOne({_id:m._id,status:'active',email,accountGeneration:m.accountGeneration},{$set:{preferences,preferencesUpdatedAt:now},$inc:{preferencesVersion:1}});
    await audit(db,email,'household.email.preferences',{device:body.device,weather:body.weather});
    return reply({preferences});
  }
  if(body.action!=='verify')fail(400,'Choose a household email action.');
  if(!emailConfigured(ctx.env))fail(503,'Email delivery is not connected yet. No email was sent.');
  if(m.emailSuppressedAt)fail(409,'Email delivery to this address is stopped. Contact the team.');
  await limit(db,ctx.env,'household-verify-email',email,3,86400000);
  const token=random(),id=await sha256Hex(token);
  await db.collection('household_email_tokens').insertOne({_id:id,purpose:'verify',memberId:m._id,email,generation:m.accountGeneration,createdAt:now,expiresAt:new Date(+now+HOUR)});
  const payload=plainEmail('Verify your household email',['Open this link while signed in to HomeBeacon. It expires in one hour.','Verifying your address does not turn on alerts. You choose those next.'],[{label:'Verify email',url:CUSTOMER_URL+'#household-email='+token}]);
  const sent=await sendHouseholdEmail(ctx.env,{to:email,id:'verify-'+id,payload},{fetcher:ctx.fetcher});
  if(sent.status!=='accepted') {
    // No retries for verification mail. A later user request makes a fresh token; this one stays valid if acceptance was ambiguous.
    return reply({accepted:false,message:'Email delivery could not be confirmed. Check your inbox before trying again.'},502);
  }
  await db.collection('household_mail_outbox').insertOne({_id:'verify-'+id,kind:'verification',memberId:m._id,providerId:sent.providerId,status:'accepted',createdAt:now,expiresAt:new Date(+now+30*24*HOUR)});
  return reply({accepted:true,message:'Verification email accepted by the mail service. Check your inbox.'});
}));}

export async function makeAlertPayload(db,env,member,event,now) {
  const token=random();
  await db.collection('household_email_tokens').insertOne({_id:await sha256Hex(token),purpose:'unsubscribe',memberId:member._id,email:member.email,generation:member.accountGeneration,createdAt:now,expiresAt:new Date(+now+365*24*HOUR)});
  const payload=plainEmail(event.title,[event.summary,'Report time: '+event.observedAt,'This update does not confirm that your home is safe or that help has been sent.'],[{label:'View household',url:CUSTOMER_URL},{label:'Stop household emails',url:CUSTOMER_URL+'#household-stop='+token}]);
  return encryptKey(env,'household-outbox:'+member._id,JSON.stringify(payload));
}

async function verifyWebhook(request,secret,now) {
  if(!secret)return null;
  const id=request.headers.get('svix-id'),timestamp=request.headers.get('svix-timestamp'),signature=request.headers.get('svix-signature');
  if(!id||id.length>200||!/^\d{10}$/.test(timestamp||'')||Math.abs(+now-Number(timestamp)*1000)>300000||!signature)return null;
  const body=await bodyText(request,65536);
  try {
    const key=await crypto.subtle.importKey('raw',Buffer.from(secret.replace(/^whsec_/,''),'base64'),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const message=new TextEncoder().encode(id+'.'+timestamp+'.'+body);
    let valid=false;
    for(const s of signature.split(' ').slice(0,5))if(s.startsWith('v1,')&&await crypto.subtle.verify('HMAC',key,Buffer.from(s.slice(3),'base64'),message))valid=true;
    return valid?{id,event:JSON.parse(body)}:null;
  }catch{return null;}
}
export function householdEmailWebhook(ctx){return guarded(()=>run(ctx,async db=>{
  if(ctx.request.method!=='POST')fail(405,'Method not allowed.');
  const now=ctx.now||new Date(),data=await verifyWebhook(ctx.request,ctx.env.RESEND_WEBHOOK_SECRET,now);
  if(!data)fail(401,'Invalid email event.');
  await ensureHouseholdEmail(db);
  const e=data.event;
  if(['email.bounced','email.complained','email.failed','email.delivered'].includes(e.type)&&typeof e.data?.email_id==='string') {
    const receipt=await db.collection('household_mail_outbox').findOne({providerId:e.data.email_id});
    if(receipt){
      const stop=['email.bounced','email.complained'].includes(e.type);
      if(stop)await db.collection('household_members').updateOne({_id:receipt.memberId},{$set:{emailSuppressedAt:now,preferences:{device:false,weather:false}},$inc:{preferencesVersion:1}});
      await db.collection('household_mail_outbox').updateOne({_id:receipt._id},{$set:{deliveryStatus:e.type.slice(6),deliveryEventAt:now}});
    }
  }
  await db.collection('household_mail_webhooks').updateOne({_id:data.id},{$setOnInsert:{receivedAt:now,type:String(e.type).slice(0,60),expiresAt:new Date(+now+30*24*HOUR)}},{upsert:true});
  return reply({received:true});
}));}
