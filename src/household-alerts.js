import {sha256Hex} from './auth.js';
import {activeHouseholdMember,householdSnapshots,resolveHousehold} from './households.js';
import {householdContext} from './household-context.js';
import {decryptKey} from './customer-connect-common.js';
import {emailConfigured,sendHouseholdEmail} from './household-mailer.js';
import {ensureHouseholdEmail,eligibleForEmail,makeAlertPayload} from './household-email.js';

const HOUR=3600000;
const validDate=v=>v!=null && v!=='' && Number.isFinite(new Date(v).getTime());
export function deviceAlertFact(d,now) {
  if(d.exercise)return null;
  const status=d.status;
  if(!['normal','urgent','needs_attention','no_recent_signal'].includes(status))return null;
  // A failed risk lookup is not evidence of a lost connection.
  if(status==='no_recent_signal'&&d.lastSeen&&validDate(d.lastSeen)&&now-new Date(d.lastSeen)<15*60000)return null;
  const labels=(d.conditions||[]).map(c=>String(c.label).slice(0,60)).sort();
  return {signature:JSON.stringify([status,labels]),status,observedAt:validDate(d.lastSeen)?new Date(d.lastSeen).toISOString():'Unknown',title:status==='urgent'?'Serious condition reported':status==='needs_attention'?'A device needs attention':status==='normal'?'Device readings returned to normal':'No recent device report',summary:String(d.nickname||'HomeBeacon')+': '+String(d.statusText||'Review the latest device report.').slice(0,300)};
}
async function recordDeviceChange(db,householdId,linkId,fact,now) {
  const _id=await sha256Hex(householdId+':'+linkId),session=db.client.startSession();
  try {await session.withTransaction(async()=>{
    const c=db.collection('household_alert_state'),prior=await c.findOne({_id},{session});
    if(prior?.signature===fact.signature)return;
    await c.updateOne({_id},{$set:{householdId,linkId,signature:fact.signature,status:fact.status,changedAt:now},$inc:{revision:1}},{upsert:true,session});
    if(!prior&&fact.status==='normal')return;
    const revision=(prior?.revision||0)+1;
    await db.collection('household_alert_events').insertOne({_id:_id+':'+revision,householdId,linkId,channel:'device',title:fact.title,summary:fact.summary,observedAt:fact.observedAt,createdAt:now,validUntil:new Date(+now+2*HOUR),expiresAt:new Date(+now+30*24*HOUR),signature:fact.signature},{session});
  });}finally{await session.endSession();}
}
async function recordWeather(db,access,weather,now,linkId) {
  // Official point-query alerts only. Forecasts and local news never generate emergency classifications.
  if(weather.alertsStatus!=='ok'||weather.status==='stale'||!validDate(weather.checkedAt)||now-new Date(weather.checkedAt)>10*60000)return;
  for(const alert of weather.alerts||[]) {
    if(!validDate(alert.expires)||new Date(alert.expires)<=now)continue;
    if(!linkId)continue;
    const id=await sha256Hex(access.household._id+':weather:'+linkId+':'+alert.id+':'+alert.sent);
    await db.collection('household_alert_events').updateOne({_id:id},{$setOnInsert:{householdId:access.household._id,linkId,channel:'weather',title:alert.title,summary:alert.headline||'The National Weather Service has issued an alert for a registered household location. Check the official warning for instructions.',observedAt:alert.sent,createdAt:now,validUntil:new Date(Math.min(+new Date(alert.expires),+now+2*HOUR)),expiresAt:new Date(+now+30*24*HOUR),source:'National Weather Service',sourceUrl:alert.url}},{upsert:true});
  }
}
async function queueEvent(db,env,member,event,now) {
  if(!eligibleForEmail(member,event.channel)||!member.preferencesUpdatedAt||event.createdAt<member.preferencesUpdatedAt)return;
  const _id=await sha256Hex(event._id+':'+member._id+':'+(member.preferencesVersion||0));
  if(await db.collection('household_mail_outbox').findOne({_id},{projection:{_id:1}}))return;
  const payload=await makeAlertPayload(db,env,member,event,now);
  await db.collection('household_mail_outbox').updateOne({_id},{$setOnInsert:{kind:'alert',memberId:member._id,householdId:event.householdId,eventId:event._id,linkId:event.linkId||null,channel:event.channel,email:member.email,generation:member.accountGeneration,preferencesVersion:member.preferencesVersion||0,encryptedPayload:payload,status:'pending',attempts:0,createdAt:now,nextAttemptAt:now,validUntil:event.validUntil,expiresAt:new Date(+now+30*24*HOUR)}},{upsert:true});
}
export async function deliverHouseholdOutbox(db,env,{now=new Date(),fetcher=fetch,limit=5}={}) {
  if(!emailConfigured(env))return {status:'disabled',attempted:0};
  await ensureHouseholdEmail(db);
  let attempted=0,accepted=0;
  for(let i=0;i<Math.min(5,limit);i++) {
    const lease=crypto.randomUUID();
    const job=await db.collection('household_mail_outbox').findOneAndUpdate({kind:'alert',status:{$in:['pending','retry','sending']},nextAttemptAt:{$lte:now},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lte:now}}]},{$set:{status:'sending',lease,leaseUntil:new Date(+now+120000)}},{sort:{nextAttemptAt:1},returnDocument:'after'});
    if(!job)break;
    const finish=async fields=>db.collection('household_mail_outbox').updateOne({_id:job._id,lease},{$set:fields,$unset:{lease:'',leaseUntil:''}});
    const a=await activeHouseholdMember(db,job.memberId),m=a?.member;
    if(!a||!eligibleForEmail(m,job.channel)||m.email!==job.email||m.accountGeneration!==job.generation||(m.preferencesVersion||0)!==job.preferencesVersion||job.linkId&&!a.links.some(l=>l._id===job.linkId)) {await finish({status:'suppressed',finishedAt:now});continue;}
    if(job.validUntil<=now || now-job.createdAt>20*HOUR || job.attempts>=4){await finish({status:'expired',finishedAt:now});continue;}
    // Recheck a queued device change. A newer report supersedes it instead of sending old conditions as current.
    if(job.channel==='device'){
      const event=await db.collection('household_alert_events').findOne({_id:job.eventId});
      const state=await db.collection('household_alert_state').findOne({_id:await sha256Hex(job.householdId+':'+job.linkId)});
      if(!event||state?.signature!==event.signature){await finish({status:'superseded',finishedAt:now});continue;}
    }
    // A per-member lease prevents two workers from bypassing the recipient cooldown.
    const gate=await db.collection('household_members').updateOne({_id:m._id,status:'active',email:m.email,accountGeneration:m.accountGeneration,$and:[{$or:[{mailLeaseUntil:{$exists:false}},{mailLeaseUntil:{$lte:now}}]},{$or:[{lastEmailAttemptAt:{$exists:false}},{lastEmailAttemptAt:{$lte:new Date(+now-60000)}}]}]},{$set:{mailLeaseUntil:new Date(+now+120000)}});
    if(!gate.modifiedCount){await finish({status:'retry',nextAttemptAt:new Date(+now+60000)});continue;}
    try {
      const count=await db.collection('household_mail_outbox').countDocuments({memberId:m._id,kind:'alert',status:'accepted',acceptedAt:{$gte:new Date(+now-HOUR)}});
      if(count>=6){await finish({status:'retry',nextAttemptAt:new Date(+now+10*60000)});continue;}
      const payload=JSON.parse(await decryptKey(env,'household-outbox:'+m._id,job.encryptedPayload));
      // Revocation/preferences may have changed during decryption and source checks.
      const current=await activeHouseholdMember(db,m._id);
      if(!current||!eligibleForEmail(current.member,job.channel)||(current.member.preferencesVersion||0)!==job.preferencesVersion||current.member.email!==job.email||current.member.accountGeneration!==job.generation||job.linkId&&!current.links.some(l=>l._id===job.linkId)){await finish({status:'suppressed',finishedAt:now});continue;}
      await db.collection('household_mail_outbox').updateOne({_id:job._id,lease},{$inc:{attempts:1},$set:{lastAttemptAt:now}});
      await db.collection('household_members').updateOne({_id:m._id},{$set:{lastEmailAttemptAt:now}});
      attempted++;
      const r=await sendHouseholdEmail(env,{to:m.email,id:job._id,payload},{fetcher});
      if(r.status==='accepted'){accepted++;await finish({status:'accepted',providerId:r.providerId,acceptedAt:now});}
      else await finish({status:r.status==='rejected'?'rejected':'retry',nextAttemptAt:new Date(+now+Math.min(30,2**job.attempts)*60000),httpStatus:r.httpStatus||null});
    } catch {await finish({status:'retry',nextAttemptAt:new Date(+now+5*60000)});}
    finally {await db.collection('household_members').updateOne({_id:m._id},{$unset:{mailLeaseUntil:''}});}
  }
  return {status:'ok',attempted,accepted};
}
export async function refreshHouseholdAlerts(db,env,{now=new Date(),fetcher=fetch,deps,contextLoader=householdContext}={}) {
  // Missing sender is not an excuse to claim delivery or silently queue a backlog.
  if(!emailConfigured(env))return {status:'disabled',checked:0};
  await ensureHouseholdEmail(db);
  const houses=await db.collection('households').find({active:true,$or:[{alertCheckedAt:{$exists:false}},{alertCheckedAt:{$lte:new Date(+now-60000)}}]}).sort({alertCheckedAt:1}).limit(2).toArray();
  let checked=0;
  for(const house of houses) {
    const lease=await db.collection('households').updateOne({_id:house._id,active:true,$or:[{alertLeaseUntil:{$exists:false}},{alertLeaseUntil:{$lte:now}}]},{$set:{alertLeaseUntil:new Date(+now+180000),alertCheckedAt:now}});
    if(!lease.modifiedCount)continue;
    try {
      const members=await db.collection('household_members').find({householdId:house._id,status:'active'}).limit(21).toArray();
      const valid=[];
      for(const m of members){const a=await activeHouseholdMember(db,m._id);if(a&&(eligibleForEmail(m,'device')||eligibleForEmail(m,'weather')))valid.push(a);}
      if(!valid.length)continue;
      const access=await resolveHousehold(db,{email:house.ownerEmail,householdId:house._id,requireOwner:true});
      if(valid.some(a=>eligibleForEmail(a.member,'device'))){
        for(const d of await householdSnapshots(db,access,{env,now,deps})){
          const fact=deviceAlertFact(d,now);if(fact)await recordDeviceChange(db,house._id,d.id,fact,now);
        }
      }
      if(valid.some(a=>eligibleForEmail(a.member,'weather'))){
        const context=await contextLoader(db,access,{fetcher,now,includeNews:false,includeLinkIds:true});
        for(const location of context.locations||[])await recordWeather(db,access,location.weather,now,location.linkId);
      }
      const events=await db.collection('household_alert_events').find({householdId:house._id,validUntil:{$gt:now},createdAt:{$gte:new Date(+now-2*HOUR)}}).sort({createdAt:-1}).limit(40).toArray();
      for(const a of valid)for(const event of events)await queueEvent(db,env,a.member,event,now);
      checked++;
    }finally{await db.collection('households').updateOne({_id:house._id},{$unset:{alertLeaseUntil:''}});}
  }
  return {status:'ok',checked,delivery:await deliverHouseholdOutbox(db,env,{now,fetcher})};
}
