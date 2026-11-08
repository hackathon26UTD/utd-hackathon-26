import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {MongoClient,ObjectId} from 'mongodb';
import {createHmac} from 'node:crypto';
import {sha256Hex} from '../src/auth.js';
import {issueCustomerSession} from '../src/operator-session.js';
import {encryptKey} from '../src/customer-connect-common.js';
import {emailConfigured,sendHouseholdEmail,plainEmail} from '../src/household-mailer.js';
import {householdEmailHandler,householdEmailWebhook,eligibleForEmail,ensureHouseholdEmail} from '../src/household-email.js';
import {deliverHouseholdOutbox,refreshHouseholdAlerts,deviceAlertFact} from '../src/household-alerts.js';
let mongo,client,db,env,now,cookie,member,deviceId;
before(async()=>{mongo=await MongoMemoryReplSet.create({replSet:{count:1}});client=await MongoClient.connect(mongo.getUri());db=client.db('household_email_tests');});
after(async()=>{await client?.close();await mongo?.stop();});
beforeEach(async()=>{
  for(const c of await db.collections())await c.deleteMany({});
  now=new Date();env={SESSION_SECRET:'test-only-household-secret',MONGODB_URI:mongo.getUri(),HOME_EMAIL_ENABLED:'true',HOME_EMAIL_FROM:'alerts@example.test',RESEND_API_KEY:'test-only',RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('test-webhook-secret').toString('base64')};
  const account={_id:'owner@example.test',sessionGeneration:'generation-1',createdAt:new Date(+now-10000)};await db.collection('customer_accounts').insertOne(account);
  cookie='__Host-homebeacon_customer='+await issueCustomerSession(env,account._id,{verifiedAccount:account,db});
  deviceId=new ObjectId();await db.collection('devices').insertOne({_id:deviceId,meta:{},lastSeen:new Date(+now-1000)});
  await db.collection('customer_links').insertOne({_id:'link-1',deviceId:String(deviceId),customerEmail:account._id,active:true,nickname:'Kitchen'});
  await db.collection('households').insertOne({_id:'house-1',ownerEmail:account._id,ownerGeneration:account.sessionGeneration,active:true,linkIds:['link-1']});
  member={_id:'member-1',householdId:'house-1',email:account._id,accountGeneration:account.sessionGeneration,status:'active',role:'owner',preferences:{device:true,weather:true},preferencesVersion:1,preferencesUpdatedAt:new Date(+now-10000),emailVerifiedAt:new Date(+now-9000),verifiedEmail:account._id};
  await db.collection('household_members').insertOne(member);await ensureHouseholdEmail(db);
});
function req(body,method='POST',headers={}){return new Request('https://home.test/api/customer/household-email'+(method==='GET'?'?id=member-1':''),{method,headers:{Origin:'https://home.test',Cookie:cookie,'Content-Type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});}
async function call(body,options={}){return householdEmailHandler({db,env,now,request:req(body),...options});}
async function queued(overrides={}){
  const id=crypto.randomUUID();await db.collection('household_mail_outbox').insertOne({_id:id,kind:'alert',memberId:member._id,householdId:'house-1',channel:'weather',email:member.email,generation:member.accountGeneration,preferencesVersion:1,encryptedPayload:await encryptKey(env,'household-outbox:'+member._id,JSON.stringify(plainEmail('Weather warning',['Official watch']))),status:'pending',attempts:0,createdAt:now,nextAttemptAt:now,validUntil:new Date(+now+3600000),expiresAt:new Date(+now+86400000),...overrides});return id;
}
test('email defaults off; no sender means no network or token created',async()=>{
  let calls=0;assert.equal(emailConfigured({}),false);const r=await call({memberId:member._id,action:'verify'},{env:{...env,HOME_EMAIL_ENABLED:'false'},fetcher:async()=>{calls++;}});assert.equal(r.status,503);assert.equal(calls,0);assert.equal(await db.collection('household_email_tokens').countDocuments(),0);
  assert.equal((await refreshHouseholdAlerts(db,{},{fetcher:async()=>{calls++;}})).status,'disabled');assert.equal(calls,0);
});
test('email verification needs delivered token plus signed account; it never opts in',async()=>{
  await db.collection('household_members').updateOne({_id:member._id},{$set:{emailVerifiedAt:null,verifiedEmail:null,preferences:{device:false,weather:false}}});
  let outgoing;const r=await call({memberId:member._id,action:'verify'},{fetcher:async(u,o)=>{outgoing=JSON.parse(o.body);return Response.json({id:'provider-test'});}});assert.equal(r.status,200);
  const token=/#household-email=([a-f\d]{64})/.exec(outgoing.text)[1];assert.equal((await call({action:'confirm',token})).status,200);
  const m=await db.collection('household_members').findOne({_id:member._id});assert.ok(m.emailVerifiedAt);assert.deepEqual(m.preferences,{device:false,weather:false});assert.equal((await call({action:'confirm',token})).status,400);
});
test('manual invitation acceptance cannot turn on email without mailbox verification',async()=>{
  await db.collection('household_members').updateOne({_id:member._id},{$set:{emailVerifiedAt:null,verifiedEmail:null}});
  assert.equal((await call({memberId:member._id,action:'preferences',device:true,weather:false})).status,409);assert.equal(eligibleForEmail({...member,verifiedEmail:'changed@example.test'},'device'),false);
});
test('preferences are self only, require same origin and boolean choices',async()=>{
  assert.equal((await call({memberId:'other-member',action:'preferences',device:false,weather:false})).status,404);
  assert.equal((await call({memberId:member._id,action:'preferences',device:'true',weather:false})).status,400);
  assert.equal((await call({}, {request:req({},'POST',{Origin:'https://other.test'})})).status,403);
});
test('account generation replacement invalidates verification link',async()=>{
  const token='a'.repeat(64);await db.collection('household_email_tokens').insertOne({_id:await sha256Hex(token),purpose:'verify',memberId:member._id,email:member.email,generation:'old-generation',expiresAt:new Date(+now+10000)});
  assert.equal((await call({action:'confirm',token})).status,400);
});
test('unsubscribe token stops only its household preferences without login',async()=>{
  const token='b'.repeat(64);await db.collection('household_email_tokens').insertOne({_id:await sha256Hex(token),purpose:'unsubscribe',memberId:member._id,email:member.email,generation:member.accountGeneration,expiresAt:new Date(+now+10000)});
  const r=await call({action:'unsubscribe',token},{request:req({action:'unsubscribe',token},'POST',{Cookie:''})});assert.equal(r.status,200);const m=await db.collection('household_members').findOne({_id:member._id});assert.deepEqual(m.preferences,{device:false,weather:false});assert.equal(m.preferencesVersion,2);
});
test('revoked, unverified or changed preferences suppress queued emails',async()=>{
  for(const change of [{status:'revoked'},{emailVerifiedAt:null},{preferencesVersion:2}]){
    await db.collection('household_members').replaceOne({_id:member._id},{...member,...change});const id=await queued();let calls=0;await deliverHouseholdOutbox(db,env,{now,fetcher:async()=>{calls++;}});assert.equal(calls,0);assert.equal((await db.collection('household_mail_outbox').findOne({_id:id})).status,'suppressed');
  }
});
test('device unlink and recreated account suppress queued emails',async()=>{
  const id=await queued({linkId:'link-1'});await db.collection('customer_links').updateOne({_id:'link-1'},{$set:{active:false}});let calls=0;await deliverHouseholdOutbox(db,env,{now,fetcher:async()=>{calls++;}});assert.equal(calls,0);assert.equal((await db.collection('household_mail_outbox').findOne({_id:id})).status,'suppressed');
  await db.collection('customer_accounts').updateOne({_id:member.email},{$set:{sessionGeneration:'replacement'}});await queued();await deliverHouseholdOutbox(db,env,{now,fetcher:async()=>{calls++;}});assert.equal(calls,0);
});
test('timeout retry keeps provider key and payload identical, never claims delivered',async()=>{
  const id=await queued(),sent=[];const fetcher=async(u,o)=>{sent.push({key:o.headers['Idempotency-Key'],body:o.body});if(sent.length===1)throw Error('network timeout');return Response.json({id:'accepted-1'});};
  await deliverHouseholdOutbox(db,env,{now,fetcher});await deliverHouseholdOutbox(db,env,{now:new Date(+now+121000),fetcher});assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);const row=await db.collection('household_mail_outbox').findOne({_id:id});assert.equal(row.status,'accepted');assert.equal(row.deliveryStatus,undefined);
});
test('parallel workers cannot send the same outbox item twice',async()=>{
  await queued();let calls=0;const fetcher=async()=>{calls++;await new Promise(r=>setTimeout(r,30));return Response.json({id:'one'});};await Promise.all([deliverHouseholdOutbox(db,env,{now,fetcher}),deliverHouseholdOutbox(db,env,{now,fetcher})]);assert.equal(calls,1);
});
test('expired or exhausted jobs never retry outside bounded window',async()=>{
  await queued({validUntil:new Date(+now-1000)});await queued({attempts:4});let calls=0;await deliverHouseholdOutbox(db,env,{now,fetcher:async()=>{calls++;}});assert.equal(calls,0);assert.equal(await db.collection('household_mail_outbox').countDocuments({status:'expired'}),2);
});
test('signed bounce suppresses recipient; forged callback cannot change preferences',async()=>{
  const id=await queued({status:'accepted',providerId:'email-1'}),body=JSON.stringify({type:'email.bounced',data:{email_id:'email-1'}}),timestamp=String(Math.floor(+now/1000)),sid='msg-1';
  const request=(signature)=>new Request('https://home.test/api/customer/household-email-events',{method:'POST',headers:{'svix-id':sid,'svix-timestamp':timestamp,'svix-signature':signature},body});
  assert.equal((await householdEmailWebhook({db,env,now,request:request('v1,invalid')})).status,401);
  const signature='v1,'+createHmac('sha256','test-webhook-secret').update(sid+'.'+timestamp+'.'+body).digest('base64');assert.equal((await householdEmailWebhook({db,env,now,request:request(signature)})).status,200);
  assert.ok((await db.collection('household_members').findOne({_id:member._id})).emailSuppressedAt);assert.equal((await db.collection('household_mail_outbox').findOne({_id:id})).deliveryStatus,'bounced');
});
test('risk service failure is not treated as observed outage; stale critical stays urgent',()=>{
  assert.equal(deviceAlertFact({status:'no_recent_signal',lastSeen:now.toISOString()},now),null);
  assert.equal(deviceAlertFact({status:'urgent',lastSeen:new Date(+now-3600000).toISOString()},now).status,'urgent');
});
test('templates escape dynamic content and rejected mail does not claim success',async()=>{
  assert.ok(plainEmail('<script>', ['<img onerror=x>']).html.includes('&lt;img'));assert.equal((await sendHouseholdEmail(env,{to:member.email,id:'x',payload:plainEmail('Test',[])},{fetcher:async()=>new Response('',{status:401})})).status,'rejected');
});
test('scheduled device changes create one email, repeats dedupe, and return to normal is a new event',async()=>{
  let level='critical',calls=0;
  const deps={loadRisk:async()=>[{deviceId:String(deviceId),status:level}],customerView:a=>({status:a.status==='critical'?'urgent':'normal',statusText:a.status==='critical'?'Water reported.':'Latest readings are normal.',conditions:[]}),customerMessages:async()=>[]};
  await db.collection('household_members').updateOne({_id:member._id},{$set:{'preferences.weather':false}});
  const options={now,deps,fetcher:async()=>{calls++;return Response.json({id:'accepted-'+calls});}};
  const first=await refreshHouseholdAlerts(db,env,options);assert.equal(first.checked,1);assert.equal(calls,1);
  await refreshHouseholdAlerts(db,env,{...options,now:new Date(+now+61000)});assert.equal(calls,1);
  level='normal';await refreshHouseholdAlerts(db,env,{...options,now:new Date(+now+122000)});assert.equal(calls,2);assert.equal(await db.collection('household_alert_events').countDocuments(),2);
});
