// Disposable accounts and device records only. No production settings are loaded.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {MongoClient} from 'mongodb';
import {dashboardAccess} from '../src/dashboard-access.js';
import {passwordHash,readSession,readCustomerSession,COOKIE,CUSTOMER_COOKIE} from '../src/operator-session.js';
import {onRequest as middleware} from '../functions/api/_middleware.js';
import {customerHandler} from '../src/customer.js';
import {createFleetBatch,listFleet} from '../src/fleet.js';
import {ingestWithDownlink} from '../src/live-api.js';
import {getLive} from '../src/live.js';
const origin='https://access.example.test',password='test-only-password-123';
let replica,client,db,env,ip=0;
before(async()=>{replica=await MongoMemoryReplSet.create({replSet:{count:1}});client=await MongoClient.connect(replica.getUri());env={MONGODB_URI:replica.getUri(),MONGODB_DB:'dashboard_access',SESSION_SECRET:'local-access-test-secret',API_ADMIN_KEY:'local-admin-key'};db=client.db(env.MONGODB_DB);});
after(async()=>{await client?.close();await replica?.stop();});
beforeEach(async()=>{await db.dropDatabase();});
const request=(body,extra={})=>new Request(origin+'/api/access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':String(++ip),...extra},body:JSON.stringify(body)});
const call=body=>dashboardAccess({env,db,request:request(body)});
const cookie=r=>r.headers.getSetCookie().filter(v=>!v.includes('Max-Age=0')).map(v=>v.split(';')[0]).join('; ');
const authed=(path,cookieValue)=>new Request(origin+path,{headers:{Cookie:cookieValue}});
async function account(kind,email,role=kind){const salt=crypto.randomUUID();await db.collection(kind==='customer'?'customer_accounts':'operator_accounts').insertOne({_id:email,salt,hash:await passwordHash(password,salt),role,createdAt:new Date(Date.now()-1000),sessionGeneration:crypto.randomUUID()});}

test('one sign-in derives customer, operator and demo destinations from verified credentials',async()=>{
 for(const [kind,role,target] of [['customer','customer','/customer'],['operator','operator','/command-center'],['operator','demo','/simulations']]){
  const email=role+'@example.test';await account(kind,email,role);
  const response=await call({action:'login',email,password,role:'operator',destination:'https://evil.example'});
  assert.equal(response.status,200);assert.deepEqual(await response.clone().json(),{authenticated:true,role,destination:target});
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.getSetCookie().length,2);
  assert.ok(response.headers.getSetCookie().some(v=>v.startsWith((kind==='customer'?COOKIE:CUSTOMER_COOKIE)+'=;')&&v.includes('Max-Age=0')));
  const user=kind==='customer'?await readCustomerSession(authed('/api/access',cookie(response)),env,db):await readSession(authed('/api/access',cookie(response)),env);
  assert.equal(user.role,role);
  const current=await dashboardAccess({env,db,request:authed('/api/access',cookie(response))});assert.equal((await current.json()).destination,target);
 }
});
test('public signup never grants an operator role and lands at Add device',async()=>{
 const response=await call({action:'signup',email:'new@example.test',password,contactName:'Test Owner',acceptTerms:true,role:'operator',serial:'injected',code:'123456'});
 assert.equal(response.status,201);assert.deepEqual(await response.json(),{authenticated:true,role:'customer',destination:'/customer#add-device'});
 assert.equal(await db.collection('operator_accounts').countDocuments({}),0);assert.equal(await db.collection('customer_links').countDocuments({}),0);
 assert.equal(await readSession(authed('/api/access',cookie(response)),env),null);
});
test('unknown, wrong and disabled credentials fail without revealing role',async()=>{
 await account('operator','op@example.test');await account('customer','owner@example.test');
 for(const email of ['op@example.test','owner@example.test','absent@example.test']){const r=await call({action:'login',email,password:'wrong'});assert.equal(r.status,401);assert.equal((await r.json()).error,'Email or password is incorrect.');assert.equal(r.headers.getSetCookie().length,0);}
 await db.collection('operator_accounts').updateOne({_id:'op@example.test'},{$set:{disabled:true}});assert.equal((await call({action:'login',email:'op@example.test',password})).status,401);
});
test('review return is allowlisted and shared-email customer credentials still work',async()=>{
 await account('operator','both@example.test');await account('customer','both@example.test');
 const salt='different-salt';await db.collection('customer_accounts').updateOne({_id:'both@example.test'},{$set:{salt,hash:await passwordHash('different-customer-password',salt)}});
 assert.equal((await (await call({action:'login',email:'both@example.test',password,next:'review'})).json()).destination,'/command-center?view=review');
 assert.equal((await (await call({action:'login',email:'both@example.test',password,next:'//evil.example'})).json()).destination,'/command-center');
 assert.equal((await (await call({action:'login',email:'both@example.test',password:'different-customer-password'})).json()).role,'customer');
});
test('origin, body size, throttling, and public middleware keep the existing boundaries',async()=>{
 assert.equal((await dashboardAccess({env,request:request({action:'login'},{Origin:'https://other.test'})})).status,403);
 assert.equal((await call({action:'login',password:'x'.repeat(5000)})).status,413);
 for(let i=0;i<9;i++){const r=await dashboardAccess({env,db,request:request({action:'login',email:'absent@example.test',password},{'CF-Connecting-IP':'same-client'})});assert.equal(r.status,i<8?401:429);}
 let forwarded;const r=await middleware({env,data:{},request:request({action:'signup'},{Authorization:'Bearer '+env.API_ADMIN_KEY}),next:async req=>{forwarded=req;return new Response(null,{status:204});}});assert.equal(r.status,204);assert.equal(forwarded.headers.has('Authorization'),false);
});
test('repeatable batch to signup to claim to first live report works for two independent households',async()=>{
 const batch=await createFleetBatch(db,{count:2,prefix:'test'},{env,origin,actor:{type:'test',id:'local'}});
 let cursor=(await getLive(db,{env})).cursor;
 for(let i=0;i<2;i++){
  const d=batch.devices[i];const reg=await call({action:'signup',email:`owner${i}@example.test`,password,contactName:'Fixture Owner',acceptTerms:true});assert.equal(reg.status,201);
  const ownCookie=cookie(reg);
  const claim=await customerHandler('claim',{env,db,request:new Request(origin+'/api/customer/claim',{method:'POST',headers:{Origin:origin,Cookie:ownCookie,'CF-Connecting-IP':String(++ip),'Content-Type':'application/json'},body:JSON.stringify({serial:d.serial,code:d.pairingCode,nickname:`Box ${i}`,consent:false})})});assert.equal(claim.status,201);
  let fleet=await listFleet(db);assert.equal(fleet.devices.find(x=>x.id===d.deviceId).fleetStatus.reason,'awaiting_first_report');
  const ingest=await ingestWithDownlink({env,injectedDb:db,request:new Request(origin+'/api/ingest',{method:'POST',headers:{'X-Device-Key':d.deviceKey,'Content-Type':'application/json'},body:JSON.stringify({readings:[{sensor:'wifi_connected',value:true},{sensor:'main_power_available',value:true},{sensor:'temp_c',value:22}]})})});assert.equal(ingest.status,202);
  const live=await getLive(db,{env,since:cursor});const box=live.devices.find(x=>x.id===d.deviceId);assert.equal(box.link.linked,true);assert.equal(box.latest.wifi_connected.value,true);assert.equal(box.latest.temp_c.value,22);assert.equal(box.lng,null);assert.equal(box.lat,null);cursor=live.cursor;
  fleet=await listFleet(db);assert.equal(fleet.devices.find(x=>x.id===d.deviceId).fleetStatus.state,'active');
  const own=await customerHandler('devices',{env,db,request:authed('/api/customer/devices',ownCookie)});const data=await own.json();assert.equal(data.devices.length,1);assert.equal(data.devices[0].nickname,`Box ${i}`);
 }
 assert.equal(await db.collection('homes').countDocuments({}),2);
});
