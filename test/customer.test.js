// Customer role: pairing, registration, IDOR, help status, session separation, middleware routing.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {MongoClient,ObjectId} from 'mongodb';
import {issueSession,sessionCookie,readSession,issueCustomerSession,readCustomerSession,customerCookie,CUSTOMER_COOKIE} from '../src/operator-session.js';
import {normalizeSerial,normalizeCode,makeSerial,makeCode,customerStatus,FAIL_TEXT,claimDevice} from '../src/customer.js';
import {onRequest as register} from '../functions/api/customer/register.js';
import {onRequest as login} from '../functions/api/customer/login.js';
import {onRequest as logout} from '../functions/api/customer/logout.js';
import {onRequest as me} from '../functions/api/customer/me.js';
import {onRequest as claim} from '../functions/api/customer/claim.js';
import {onRequest as devices} from '../functions/api/customer/devices.js';
import {onRequest as messages} from '../functions/api/customer/messages.js';
import {onRequest as pairing} from '../functions/api/ops/pairing.js';
import {onRequest as helpStatus} from '../functions/api/ops/help-status.js';
import {onRequest as middleware} from '../functions/api/_middleware.js';

const ADMIN='ak_test_admin',ORIGIN='https://home.test';
let server,client,db,env,ipCounter=0;
before(async()=>{if(!process.env.TEST_CUSTOMER_MONGODB_URI)server=await MongoMemoryReplSet.create({replSet:{count:1}});const uri=process.env.TEST_CUSTOMER_MONGODB_URI||server.getUri();client=await MongoClient.connect(uri);env={MONGODB_URI:uri,MONGODB_DB:'customer_test',SESSION_SECRET:'customer-test-secret',API_ADMIN_KEY:ADMIN};db=client.db(env.MONGODB_DB);await db.dropDatabase();});
after(async()=>{await db?.dropDatabase();await client?.close();await server?.stop();});

const newIp=()=>`10.0.${Math.floor(++ipCounter/250)}.${ipCounter%250}`;
async function call(fn,method,path,{body,cookie,admin,ip,origin=ORIGIN,deps,operator}={}){
  const headers={'CF-Connecting-IP':ip||newIp()};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(method!=='GET')headers.Origin=origin;
  if(cookie)headers.Cookie=cookie;
  if(admin)headers.Authorization='Bearer '+ADMIN;
  const res=await fn({env,deps,data:operator?{operator}:{},request:new Request(ORIGIN+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})});
  const text=await res.text();let json=null;try{json=JSON.parse(text)}catch{}
  return {status:res.status,body:json,headers:res.headers,text};
}
const cookieFrom=res=>res.headers.get('Set-Cookie').split(';')[0];
async function addDevice(extra={}){const r=await db.collection('devices').insertOne({name:'Hallway box',type:'beacon',meta:{exercise:true},lastSeen:new Date(),keyHash:'x'+Math.random(),...extra});return String(r.insertedId);}
async function pair(deviceId){const r=await call(pairing,'POST','/api/ops/pairing',{admin:true,body:{device_id:deviceId}});assert.equal(r.status,201,r.text);return r.body;}
const signup=(p,over={})=>call(register,'POST','/api/customer/register',{body:{email:'a@example.test',password:'long-password-1',serial:p.serial,code:p.pairingCode,contactName:'Alex',consent:true,acceptTerms:true,...over},ip:over.ip});

test('serial and code normalizers accept human formatting and reject junk',()=>{
  assert.equal(normalizeSerial('hb-7k3q-9xmd'),'HB-7K3Q-9XMD');assert.equal(normalizeSerial('HB7K3Q9XMD'),'HB-7K3Q-9XMD');
  assert.equal(normalizeSerial('HB-0000-0000'),null);assert.equal(normalizeSerial('nope'),null);assert.equal(normalizeSerial(42),null);
  assert.equal(normalizeCode('482 913'),'482913');assert.equal(normalizeCode('48291'),null);assert.equal(normalizeCode('abcdef'),null);
  for(let i=0;i<50;i++){assert.ok(normalizeSerial(makeSerial()));assert.match(makeCode(),/^\d{6}$/);}
});

test('customer and operator sessions never verify as each other',async()=>{
  const op=await issueSession(env,'op@example.test');const cu=await issueCustomerSession(env,'a@example.test');
  const asReq=(name,token)=>new Request(ORIGIN,{headers:{Cookie:`${name}=${token}`}});
  assert.equal(await readSession(asReq(CUSTOMER_COOKIE,cu),env),null);
  assert.equal(await readSession(asReq('__Host-homebeacon_session',cu),env),null);
  assert.equal(await readCustomerSession(asReq(CUSTOMER_COOKIE,op),env),null);
  // operator key signing a customer-role token must fail in both readers
  const [payload]=op.split('.');const forged=Buffer.from(JSON.stringify({email:'a@example.test',iat:Date.now(),exp:Math.floor(Date.now()/1000)+3600,role:'customer'})).toString('base64url');
  assert.equal(await readCustomerSession(asReq(CUSTOMER_COOKIE,forged+'.'+op.split('.')[1]),env),null);
  assert.equal(await readSession(asReq('__Host-homebeacon_session',forged+'.'+op.split('.')[1]),env),null);
  assert.ok(payload);
  assert.match(customerCookie('t'),/^__Host-homebeacon_customer=t; Path=\/; Secure; HttpOnly; SameSite=Strict/);
});

test('pairing: operator only, code shown once, reissue keeps serial and rotates code',async()=>{
  const id=await addDevice();
  let r=await call(pairing,'POST','/api/ops/pairing',{body:{device_id:id}});assert.equal(r.status,401);
  r=await call(pairing,'POST','/api/ops/pairing',{admin:true,body:{device_id:id},operator:{role:'demo',email:'d@example.test'}});assert.equal(r.status,403);
  r=await call(pairing,'POST','/api/ops/pairing',{admin:true,body:{device_id:'nope'}});assert.equal(r.status,400);
  r=await call(pairing,'POST','/api/ops/pairing',{admin:true,body:{device_id:'a'.repeat(24)}});assert.equal(r.status,404);
  const first=await pair(id);
  assert.match(first.serial,/^HB-[A-Z0-9]{4}-[A-Z0-9]{4}$/);assert.match(first.pairingCode,/^\d{6}$/);
  assert.equal(first.qrPayload,`${ORIGIN}/customer#claim=${first.serial}.${first.pairingCode}`);
  const stored=await db.collection('device_pairing').findOne({_id:id});
  assert.equal(JSON.stringify(stored).includes(first.pairingCode),false);assert.equal(stored.claimed,false);assert.equal(stored.exercise,true);
  const get=await call(pairing,'GET','/api/ops/pairing?device_id='+id,{admin:true});
  assert.equal(get.body.serial,first.serial);assert.equal(get.text.includes(first.pairingCode),false);assert.equal(get.text.includes('codeHash'),false);
  const second=await pair(id);assert.equal(second.serial,first.serial);
  const audit=await db.collection('audit_log').find({deviceId:id,action:'pairing.issue'}).toArray();
  assert.equal(audit.length,2);assert.equal(JSON.stringify(audit).includes(first.pairingCode),false);
});

test('register links a device, sets a customer cookie and the customer sees only allowlisted fields',async()=>{
  const id=await addDevice();const p=await pair(id);
  const r=await signup(p,{email:'Reg1@Example.test'});
  assert.equal(r.status,201,r.text);assert.match(r.headers.get('Set-Cookie'),/^__Host-homebeacon_customer=/);
  const cookie=cookieFrom(r);
  assert.equal((await call(me,'GET','/api/customer/me',{cookie})).body.email,'reg1@example.test');
  const acct=await db.collection('customer_accounts').findOne({_id:'reg1@example.test'});
  assert.ok(acct.hash&&acct.salt);assert.notEqual(acct.hash,'long-password-1');assert.equal(JSON.stringify(acct).includes('long-password-1'),false);
  const link=await db.collection('customer_links').findOne({deviceId:id,active:true});
  assert.equal(link.contactName,'Alex');assert.equal(link.consent,true);assert.equal(link.exercise,true);
  assert.equal((await db.collection('device_pairing').findOne({_id:id})).codeHash,undefined);
  const d=await call(devices,'GET','/api/customer/devices',{cookie});
  assert.equal(d.status,200);assert.equal(d.body.devices.length,1);
  const dev=d.body.devices[0];
  assert.deepEqual(Object.keys(dev).sort(),['conditions','exercise','help','id','lastSeen','messages','nickname','status','statusText']);
  assert.equal(dev.id,link._id);assert.equal(dev.status,'no_recent_signal'); // no risk engine wired: never shown as safe
  assert.equal(d.text.includes(id),false);assert.equal(d.text.includes('keyHash'),false);
  assert.equal(dev.help.status,'none');
  // pairing cannot be reused
  const again=await signup(p,{email:'other1@example.test'});assert.equal(again.status,400);assert.equal(again.body.error,FAIL_TEXT);
});

test('register failures all return the same message and do not reveal accounts',async()=>{
  const id=await addDevice();const p=await pair(id);
  const text=async over=>{const r=await signup(p,over);assert.equal(r.status,400,r.text);return r.body.error;};
  const badSerial=await text({serial:'HB-AAAA-BBBB',email:'f1@example.test'});
  const badCode=await text({code:'000000'===p.pairingCode?'111111':'000000',email:'f2@example.test'});
  // taken email with wrong password
  const other=await pair(await addDevice());
  assert.equal((await signup(other,{email:'taken@example.test'})).status,201);
  const third=await pair(await addDevice());
  const takenWrongPw=await text({...{},email:'taken@example.test',password:'a-different-password',serial:third.serial,code:third.pairingCode});
  assert.equal(badSerial,FAIL_TEXT);assert.equal(badCode,FAIL_TEXT);assert.equal(takenWrongPw,FAIL_TEXT);
  // the device from the wrong-password attempt was not consumed
  const ok=await signup(third,{email:'taken@example.test',password:'long-password-1'});assert.equal(ok.status,201);
  assert.equal(await db.collection('customer_links').countDocuments({customerEmail:'taken@example.test',active:true}),2);
  // field validation
  assert.equal((await signup(p,{email:'bad'})).status,400);
  assert.equal((await signup(p,{email:'v@example.test',password:'short'})).status,400);
  assert.equal((await signup(p,{email:'v@example.test',contactName:''})).status,400);
  assert.equal((await signup(p,{email:'v@example.test',consent:'yes'})).status,400);
  assert.equal((await call(register,'POST','/api/customer/register',{body:{},origin:'https://evil.test'})).status,403);
});

test('wrong codes lock a serial after 10 failures; the right code no longer works until reissued',async()=>{
  const id=await addDevice();const p=await pair(id);const wrong=p.pairingCode==='123456'?'654321':'123456';
  for(let i=0;i<10;i++){await db.collection('login_attempts').deleteMany({});await signup({serial:p.serial,pairingCode:wrong},{email:`lock${i}@example.test`});}
  await db.collection('login_attempts').deleteMany({});
  assert.equal((await signup(p,{email:'lockok@example.test'})).status,400);
  const fresh=await pair(id);assert.equal(fresh.serial,p.serial);
  assert.equal((await signup(fresh,{email:'lockok@example.test'})).status,201);
});

test('rate limits: 5 attempts per serial and 8 per IP in 15 minutes',async()=>{
  await db.collection('login_attempts').deleteMany({});
  const p={serial:'HB-RATE-LIMT'.replace('LIMT','2345'),pairingCode:'111111'};
  const codes=[];for(let i=0;i<5;i++)codes.push((await signup(p,{email:`rl${i}@example.test`,ip:newIp()})).status);
  assert.deepEqual(codes,[400,400,400,400,400]);
  const sixth=await signup(p,{email:'rl6@example.test',ip:newIp()});assert.equal(sixth.status,429);assert.equal(sixth.headers.get('Retry-After'),'900');
  const ip='203.0.113.9';const statuses=[];
  for(let i=0;i<9;i++)statuses.push((await signup({serial:`HB-IPAA-${(2000+i)}`,pairingCode:'111111'},{email:`ip${i}@example.test`,ip})).status);
  assert.equal(statuses.at(-1),429);
});

test('login, logout, and password-change revocation',async()=>{
  const p=await pair(await addDevice());
  const reg=await signup(p,{email:'login1@example.test'});const cookie=cookieFrom(reg);
  assert.equal((await call(login,'POST','/api/customer/login',{body:{email:'login1@example.test',password:'nope-nope-nope'}})).status,401);
  assert.equal((await call(login,'POST','/api/customer/login',{body:{email:'ghost@example.test',password:'nope-nope-nope'}})).status,401);
  const ok=await call(login,'POST','/api/customer/login',{body:{email:'login1@example.test',password:'long-password-1'}});assert.equal(ok.status,200);assert.match(ok.headers.get('Set-Cookie'),/HttpOnly/);
  assert.equal((await call(me,'GET','/api/customer/me',{})).status,401);
  assert.equal((await call(logout,'POST','/api/customer/logout',{cookie})).headers.get('Set-Cookie').includes('Max-Age=0'),true);
  await db.collection('customer_accounts').updateOne({_id:'login1@example.test'},{$set:{passwordChangedAt:new Date(Date.now()+1000)}});
  assert.equal((await call(me,'GET','/api/customer/me',{cookie})).status,401);
  assert.equal((await call(devices,'GET','/api/customer/devices',{cookie})).status,401);
});

test('customers only reach their own devices: foreign link ids return 404',async()=>{
  const pa=await pair(await addDevice());const pb=await pair(await addDevice());
  const a=cookieFrom(await signup(pa,{email:'ida@example.test'}));const b=cookieFrom(await signup(pb,{email:'idb@example.test'}));
  const aId=(await call(devices,'GET','/api/customer/devices',{cookie:a})).body.devices[0].id;
  const bList=(await call(devices,'GET','/api/customer/devices',{cookie:b})).body.devices;
  assert.equal(bList.length,1);assert.notEqual(bList[0].id,aId);
  assert.equal((await call(devices,'DELETE','/api/customer/devices?id='+aId,{cookie:b})).status,404);
  assert.equal((await call(devices,'DELETE','/api/customer/devices?id=zzz',{cookie:b})).status,404);
  assert.equal((await call(messages,'POST','/api/customer/messages?id='+aId,{cookie:b,body:{messageId:'m1'}})).status,404);
  assert.equal((await call(devices,'GET','/api/customer/devices',{})).status,401);
  assert.equal((await call(devices,'DELETE','/api/customer/devices?id='+aId,{cookie:a,origin:'https://evil.test'})).status,403);
  assert.equal((await db.collection('customer_links').findOne({_id:aId})).active,true);
});

test('claim adds a second device; unlink removes the contact name and frees the device',async()=>{
  const p1=await pair(await addDevice());const id2=await addDevice();const p2=await pair(id2);
  const cookie=cookieFrom(await signup(p1,{email:'two@example.test'}));
  assert.equal((await call(claim,'POST','/api/customer/claim',{body:{serial:p2.serial,code:p2.pairingCode,contactName:'Alex',consent:false,nickname:'Garage'}})).status,401);
  const c=await call(claim,'POST','/api/customer/claim',{cookie,body:{serial:p2.serial,code:p2.pairingCode,contactName:'Alex',consent:false,nickname:'Garage'}});assert.equal(c.status,201,c.text);
  const list=(await call(devices,'GET','/api/customer/devices',{cookie})).body.devices;assert.equal(list.length,2);assert.ok(list.some(x=>x.nickname==='Garage'));
  assert.equal((await call(claim,'POST','/api/customer/claim',{cookie,body:{serial:p2.serial,code:p2.pairingCode,contactName:'Alex',consent:true}})).body.error,FAIL_TEXT);
  assert.equal((await call(devices,'DELETE','/api/customer/devices?id='+c.body.id,{cookie})).status,200);
  const gone=await db.collection('customer_links').findOne({_id:c.body.id});
  assert.equal(gone.active,false);assert.equal(gone.contactName,undefined);assert.equal(gone.consent,false);
  assert.equal((await call(devices,'GET','/api/customer/devices',{cookie})).body.devices.length,1);
  assert.equal((await call(devices,'DELETE','/api/customer/devices?id='+c.body.id,{cookie})).status,404);
  assert.ok(await db.collection('audit_log').findOne({deviceId:id2,action:'customer.unlink'}));
  // after unlink the operator can issue a fresh code
  assert.equal((await call(pairing,'POST','/api/ops/pairing',{admin:true,body:{device_id:id2}})).status,201);
});

test('operator can release a linked device and re-pair is blocked while linked',async()=>{
  const id=await addDevice();const p=await pair(id);await signup(p,{email:'rel@example.test'});
  assert.equal((await call(pairing,'POST','/api/ops/pairing',{admin:true,body:{device_id:id}})).status,409);
  assert.equal((await call(pairing,'DELETE','/api/ops/pairing?device_id='+id,{admin:true})).status,200);
  assert.equal((await call(pairing,'DELETE','/api/ops/pairing?device_id='+id,{admin:true})).status,404);
  assert.equal((await call(pairing,'POST','/api/ops/pairing',{admin:true,body:{device_id:id}})).status,201);
  assert.ok(await db.collection('audit_log').findOne({deviceId:id,action:'link.release'}));
});

test('help status: humans set it, history and audit are kept, customer sees it, bad input is refused',async()=>{
  const id=await addDevice();const p=await pair(id);const cookie=cookieFrom(await signup(p,{email:'help@example.test'}));
  const set=(body,extra={})=>call(helpStatus,'POST','/api/ops/help-status',{admin:true,operator:{email:'op@example.test',role:'operator'},body,...extra});
  assert.equal((await call(helpStatus,'POST','/api/ops/help-status',{body:{device_id:id,status:'help_on_the_way'}})).status,401);
  assert.equal((await set({device_id:id,status:'help_on_the_way'},{operator:{role:'demo',email:'d@example.test'}})).status,403);
  assert.equal((await set({device_id:id,status:'dispatched'})).status,400);
  assert.equal((await set({device_id:id,status:'review_queued',note:'x'.repeat(141)})).status,400);
  assert.equal((await set({device_id:id,status:'review_queued',note:'token is dk_abcdef'})).status,400);
  assert.equal((await set({device_id:'b'.repeat(24),status:'review_queued'})).status,404);
  assert.equal((await set({device_id:id,status:'review_queued'},{origin:'https://evil.test'})).status,403);
  assert.equal((await set({device_id:id,status:'review_queued',note:'Reviewing now'})).status,200);
  assert.equal((await set({device_id:id,status:'help_on_the_way',note:'Crew expected by 5 pm'})).status,200);
  const dev=(await call(devices,'GET','/api/customer/devices',{cookie})).body.devices[0];
  assert.equal(dev.help.status,'help_on_the_way');assert.equal(dev.help.note,'Crew expected by 5 pm');assert.match(dev.help.text,/Help is on the way/);
  const doc=await db.collection('device_help').findOne({_id:id});assert.equal(doc.history.length,2);assert.equal(doc.updatedBy,'op@example.test');
  const op=await call(helpStatus,'GET','/api/ops/help-status?device_id='+id,{admin:true});assert.equal(op.body.help.history.length,2);
  assert.equal(await db.collection('audit_log').countDocuments({deviceId:id,action:'help.set'}),2);
  assert.equal(JSON.stringify(await db.collection('audit_log').find({deviceId:id,action:'help.set'}).toArray()).includes('Crew expected'),false);
});

test('customer status comes from the risk view but never turns stale or unknown into safe',async()=>{
  const id=await addDevice();const p=await pair(id);const cookie=cookieFrom(await signup(p,{email:'risk@example.test'}));
  let seen;const base={customerView:a=>({status:a.status==='normal'?'normal':'urgent',statusText:'',conditions:[{label:'Water',text:'Water was reported at the sensor 2 minutes ago'}]}),customerMessages:async()=>[]};
  const mk=assessment=>({...base,loadRisk:async(_db,opts)=>{seen=opts;return {assessments:assessment?[{deviceId:id,...assessment}]:[]};}});
  let dev=(await call(devices,'GET','/api/customer/devices',{cookie,deps:mk({status:'normal',offline:false})})).body.devices[0];
  assert.equal(dev.status,'normal');assert.deepEqual(seen.deviceIds,[id]);assert.equal(seen.exercise,true);
  dev=(await call(devices,'GET','/api/customer/devices',{cookie,deps:mk({status:'critical',offline:false})})).body.devices[0];
  assert.equal(dev.status,'urgent');assert.equal(dev.conditions[0].label,'Water');
  dev=(await call(devices,'GET','/api/customer/devices',{cookie,deps:mk({status:'normal',offline:true})})).body.devices[0];assert.equal(dev.status,'no_recent_signal');
  dev=(await call(devices,'GET','/api/customer/devices',{cookie,deps:mk(null)})).body.devices[0];assert.equal(dev.status,'no_recent_signal');
  await db.collection('devices').updateOne({_id:new ObjectId(id)},{$set:{lastSeen:new Date(Date.now()-3600000)}});
  dev=(await call(devices,'GET','/api/customer/devices',{cookie,deps:mk({status:'normal',offline:false})})).body.devices[0];
  assert.equal(dev.status,'no_recent_signal');assert.match(dev.statusText,/does not mean it is safe/);
  dev=(await call(devices,'GET','/api/customer/devices',{cookie,deps:{...mk({status:'critical'}),loadRisk:async()=>{throw new Error('boom')}}})).body.devices[0];assert.equal(dev.status,'no_recent_signal');
  assert.equal(customerStatus({assessment:{status:'unknown'},view:{status:'normal',conditions:[]},lastSeen:new Date(),now:new Date()}).status,'no_recent_signal');
  assert.equal(customerStatus({assessment:{status:'critical',offline:true},view:{status:'urgent',conditions:[]},lastSeen:new Date(Date.now()-7200000),now:new Date()}).status,'urgent');
  assert.equal(customerStatus({assessment:{status:'watch'},view:null,lastSeen:new Date(),now:new Date()}).status,'needs_attention');
});

test('customer messages: shown from the message module, acknowledgement only for visible ids on own device',async()=>{
  const id=await addDevice();const p=await pair(id);const cookie=cookieFrom(await signup(p,{email:'msg@example.test'}));
  const seen=[];const deps={customerMessages:async(_db,deviceId)=>{assert.equal(deviceId,id);return [{id:'m1',title:'Stay informed',body:'Crew is mapping your street',severity:'info',expiresAt:'2026-11-08T00:00:00Z',secretField:'no'}];},markCustomerSeen:async(_db,d,m)=>seen.push([d,m])};
  const list=(await call(devices,'GET','/api/customer/devices',{cookie,deps})).body.devices[0];
  assert.deepEqual(list.messages,[{id:'m1',title:'Stay informed',body:'Crew is mapping your street',severity:'info',expiresAt:'2026-11-08T00:00:00Z'}]);
  const linkId=list.id;
  assert.equal((await call(messages,'POST','/api/customer/messages?id='+linkId,{cookie,deps,body:{messageId:'other'}})).status,404);
  assert.equal((await call(messages,'POST','/api/customer/messages?id='+linkId,{cookie,deps,body:{messageId:'m1'}})).status,200);
  assert.deepEqual(seen,[[id,'m1']]);
  assert.equal((await call(messages,'POST','/api/customer/messages?id='+linkId,{cookie,deps:{customerMessages:deps.customerMessages,markCustomerSeen:null},body:{messageId:'m1'}})).status,503);
});

test('middleware routes credentials correctly',async()=>{
  const op=await issueSession(env,'op@example.test'),demo=await issueSession(env,'demo@example.test','demo'),cu=await issueCustomerSession(env,'a@example.test');
  const run=async(method,path,{cookie,headers={}}={})=>{let forwarded=null;const h={...headers};if(cookie)h.Cookie=cookie;if(method!=='GET')h.Origin=ORIGIN;
    const res=await middleware({env,data:{},request:new Request(ORIGIN+path,{method,headers:h}),next:async r=>{forwarded=r||'same';return new Response('next');}});
    return {status:res.status,passed:forwarded!==null,forwarded};};
  const opC=sessionCookie(op),demoC=sessionCookie(demo),cuC=customerCookie(cu);
  // public
  for(const [m,p] of [['GET','/api/health'],['POST','/api/customer/register'],['POST','/api/customer/login'],['GET','/api/customer/me']])assert.equal((await run(m,p)).passed,true,p);
  // public customer paths drop an Authorization header
  const stripped=await run('POST','/api/customer/login',{headers:{Authorization:'Bearer '+ADMIN}});assert.equal(stripped.forwarded.headers.has('Authorization'),false);
  // customer cookie reaches only customer paths and never gets admin injected
  const own=await run('GET','/api/customer/devices',{cookie:cuC,headers:{Authorization:'Bearer '+ADMIN}});assert.equal(own.passed,true);assert.equal(own.forwarded.headers.has('Authorization'),false);
  for(const p of ['/api/ops/live','/api/ops/pairing','/api/risk','/api/devices','/api/command-center','/api/overlays'])assert.equal((await run('GET',p,{cookie:cuC})).status,401,p);
  assert.equal((await run('POST','/api/ops/pairing',{cookie:cuC})).status,401);
  // anonymous
  assert.equal((await run('GET','/api/ops/live')).status,401);assert.equal((await run('GET','/api/customer/devices')).passed,true); // handler returns 401 itself
  // device key pass-through, only on the device paths and methods
  const dk={'X-Device-Key':'dk_test'};
  for(const [m,p] of [['POST','/api/beacon/ingest'],['POST','/api/ingest'],['POST','/api/events'],['GET','/api/device/messages'],['POST','/api/device/messages'],['POST','/api/device/logs']])assert.equal((await run(m,p,{headers:dk})).passed,true,m+p);
  for(const [m,p] of [['GET','/api/devices'],['GET','/api/ops/live'],['POST','/api/ops/messages'],['GET','/api/device/logs'],['DELETE','/api/device/messages']])assert.equal((await run(m,p,{headers:dk})).status,401,m+p);
  // admin key
  assert.equal((await run('GET','/api/devices',{headers:{Authorization:'Bearer '+ADMIN}})).passed,true);
  // operator: admin injected, writes need same origin
  const o=await run('POST','/api/ops/pairing',{cookie:opC});assert.equal(o.passed,true);assert.equal(o.forwarded.headers.get('Authorization'),'Bearer '+ADMIN);
  assert.equal((await middleware({env,data:{},request:new Request(ORIGIN+'/api/ops/pairing',{method:'POST',headers:{Cookie:opC,Origin:'https://evil.test'}}),next:async()=>new Response('x')})).status,403);
  // demo: only listed GETs
  for(const p of ['/api/ops/live','/api/ops/device','/api/ops/logs','/api/risk','/api/overlays','/api/feeds','/api/command-center'])assert.equal((await run('GET',p,{cookie:demoC})).passed,true,p);
  for(const [m,p] of [['POST','/api/ops/messages'],['POST','/api/ops/pairing'],['POST','/api/ops/help-status'],['GET','/api/ops/pairing'],['GET','/api/ops/messages'],['POST','/api/overlays'],['DELETE','/api/overlays']])assert.equal((await run(m,p,{cookie:demoC})).status,403,m+p);
  assert.equal((await run('POST','/api/layers',{cookie:demoC})).passed,true);
});


test('registration requires explicit terms acceptance before creating a link', async()=>{
  const id=await addDevice(), p=await pair(id);
  for(const acceptTerms of [undefined,false,'true']){
    const r=await signup(p,{email:'terms@example.test',acceptTerms});
    assert.equal(r.status,400);
    assert.match(r.body.error,/terms/);
  }
  assert.equal(await db.collection('customer_links').countDocuments({deviceId:id,active:true}),0);
  const r=await signup(p,{email:'terms@example.test',acceptTerms:true});
  assert.equal(r.status,201,r.text);
  const account=await db.collection('customer_accounts').findOne({_id:'terms@example.test'});
  assert.equal(account.termsVersion,'2026-11-07');
  assert.ok(account.termsAcceptedAt instanceof Date);
});


test('create profile first, then claim a device and expose the customer link in the next operator poll',async()=>{
  const email='profile-first@example.test';
  const r=await call(register,'POST','/api/customer/register',{body:{email,password:'long-password-profile',contactName:'Alex',consent:false,acceptTerms:true}});
  assert.equal(r.status,201,r.text); assert.equal(r.body.linked,false);
  const cookie=cookieFrom(r);
  assert.equal((await call(devices,'GET','/api/customer/devices',{cookie})).body.devices.length,0);
  const id=await addDevice(), p=await pair(id);
  const {getLive}=await import('../src/live.js');
  const before=await getLive(db,{deviceId:id,exercise:true,env,now:new Date(Date.now()-1000)});
  const linked=await call(claim,'POST','/api/customer/claim',{cookie,body:{serial:p.serial,code:p.pairingCode,contactName:'Alex',consent:false,address:'800 W Campbell Rd, Richardson, TX 75080'},deps:{fetcher:async()=>new Response(JSON.stringify({result:{addressMatches:[{matchedAddress:'800 W CAMPBELL RD, RICHARDSON, TX, 75080',coordinates:{x:-96.75,y:32.98}}]}}),{headers:{'Content-Type':'application/json'}})}});
  assert.equal(linked.status,201,linked.text);
  const snapshot=await getLive(db,{deviceId:id,exercise:true,env,since:before.cursor,now:new Date()});
  assert.equal(snapshot.devices[0].link.linked,true);
  assert.equal(snapshot.devices[0].lng,-96.75); assert.match(snapshot.devices[0].address,/CAMPBELL/);
  assert.equal((await call(devices,'GET','/api/customer/devices',{cookie})).body.devices.length,1);
});

test('address failures leave pairing available and existing home history intact',async()=>{
  const homeId=new ObjectId();
  await db.collection('homes').insertOne({_id:homeId,label:'Existing home',location:{type:'Point',coordinates:[-96.75,32.98]}});
  const id=await addDevice({homeId}), p=await pair(id);
  const input={email:'address-test@example.test',serial:p.serial,code:p.pairingCode,contactName:'Alex',consent:false,address:'800 W Campbell Rd, Richardson, TX 75080'};
  const match=(x,y)=>({fetcher:async()=>Response.json({result:{addressMatches:[{matchedAddress:input.address,coordinates:{x,y}}]}})});
  await assert.rejects(claimDevice(db,input,{fetcher:async()=>Response.json({result:{addressMatches:[]}})}),/could not be matched/);
  await assert.rejects(claimDevice(db,input,match(-82.5,28)),/different registered location/);
  assert.equal((await db.collection('device_pairing').findOne({_id:id})).claimed,false);
  assert.equal(await db.collection('customer_links').countDocuments({deviceId:id}),0);
  assert.equal(String((await db.collection('devices').findOne({_id:new ObjectId(id)})).homeId),String(homeId));
  await claimDevice(db,input,match(-96.75,32.98));
  assert.equal(String((await db.collection('devices').findOne({_id:new ObjectId(id)})).homeId),String(homeId));
});
