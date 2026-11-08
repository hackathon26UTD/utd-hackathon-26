import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, Binary, Collection } from 'mongodb';
import { issueCustomerSession as issueCustomerBound, customerCookie, issueSession as issueOperatorBound, sessionCookie, passwordHash, readSession, authenticationAccount, legacyOperatorSnapshot } from '../src/operator-session.js';
import { validateProfilePhoto, MAX_PHOTO_BYTES, migrateProfilePhoto, profilePhotoKey, PHOTO_COLLECTION } from '../src/profile-photo.js';
import { onRequest as customerPhoto } from '../functions/api/customer/photo.js';
import { onRequest as operatorPhoto } from '../functions/api/profile-photo.js';
import { accountHandler } from '../src/customer-self-service.js';
import { onRequest as customerLogin } from '../functions/api/customer/login.js';
import { onRequest as customerRegister } from '../functions/api/customer/register.js';
import { onRequest as operatorLogin } from '../functions/api/session.js';
import { onRequestPost as recover } from '../functions/api/recovery.js';
import { sha256Hex } from '../src/auth.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
// Trusted synthetic fixture issuance supplies explicit snapshots; endpoint race tests below do not use these wrappers for the attacked login.
async function issueCustomerSession(settings,email) {
  if(!settings.MONGODB_URI)return issueCustomerBound(settings,email);
  return issueCustomerBound(settings,email,{verifiedAccount:await authenticationAccount(db,'customer',email),db});
}
async function issueSession(settings,email,role='operator',options={}) {
  if(!settings.MONGODB_URI)return issueOperatorBound(settings,email,role,options);
  let account=await authenticationAccount(db,'operator',email);
  if(!account&&email!==settings.OPERATOR_EMAIL) {
    await db.collection('operator_accounts').insertOne({_id:email,role,sessionGeneration:crypto.randomUUID(),salt:'fixture-salt',hash:'fixture-hash'});
    account=await authenticationAccount(db,'operator',email);
  }
  return issueOperatorBound(settings,email,role,{...options,verifiedAccount:account,verifiedLegacy:legacyOperatorSnapshot(settings),db});
}
function crc(b){let c=0xffffffff;for(const byte of b){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(name,data){const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,checksum]);}
function png(width=1,height=1,raw=Buffer.from([0,255,0,0,255]),extra=[]){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),...extra,chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const photo=png();
let server,client,db,env,a,b,operator,demo;
before(async()=>{
  // Always disposable; never use app/provider credentials or an external DB.
  server=await MongoMemoryReplSet.create({replSet:{count:1}});client=await MongoClient.connect(server.getUri());
  env={MONGODB_URI:server.getUri(),MONGODB_DB:'profile_photo_test',SESSION_SECRET:'synthetic-photo-tests-only',API_ADMIN_KEY:'synthetic-admin-test',OPERATOR_EMAIL:'operator@example.test',OPERATOR_PASSWORD_SALT:'synthetic-salt'};
  db=client.db(env.MONGODB_DB);
  await db.collection('customer_accounts').insertMany([{_id:'a@example.test',createdAt:new Date(1)},{_id:'b@example.test',createdAt:new Date(2)}]);
  await db.collection('operator_accounts').insertOne({_id:env.OPERATOR_EMAIL,name:'Example operator'});
  a=customerCookie(await issueCustomerSession(env,'a@example.test'));b=customerCookie(await issueCustomerSession(env,'b@example.test'));
  operator=sessionCookie(await issueSession(env,env.OPERATOR_EMAIL));demo=sessionCookie(await issueSession(env,'demo@example.test','demo'));
});
after(async()=>{await client?.close();await server?.stop();});
async function call(kind,method='GET',cookie,body,extra={}) {
  const path=kind==='customer'?'/api/customer/photo':'/api/profile-photo';
  const request=new Request('https://home.test'+path+(extra.query||''),{method,headers:{...(cookie?{Cookie:cookie}:{}),Origin:'https://home.test',...(body?{'Content-Type':'image/png'}:{}),...extra.headers},...(body?{body}:{})});
  return (kind==='customer'?customerPhoto:operatorPhoto)({request,env:extra.env||env});
}
test('valid PNG, JPEG and WebP dimensions; reject mismatched MIME and vector payloads',()=>{
  assert.deepEqual(validateProfilePhoto(photo,'image/png'),{width:1,height:1,contentType:'image/png'});
  // Small structural JPEG / WebP fixtures; browser decode is covered separately with real encodings.
  const jpg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217]);
  assert.equal(validateProfilePhoto(jpg,'image/jpeg').width,1);
  const webp=Buffer.alloc(26);webp.write('RIFF');webp.writeUInt32LE(18,4);webp.write('WEBPVP8L',8);webp.writeUInt32LE(5,16);webp[20]=47;
  assert.equal(validateProfilePhoto(webp,'image/webp').height,1);
  for(const [bytes,type] of [[photo,'image/jpeg'],[photo,'image/webp'],[Buffer.from('<svg/>'),'image/png'],[photo,'image/svg+xml'],[photo,'image/png; charset=utf-8']])assert.throws(()=>validateProfilePhoto(bytes,type));
});
test('reject oversized, truncated, animated, CRC-corrupt and decompression-bomb PNGs',()=>{
  const corrupt=Buffer.from(photo);corrupt[corrupt.length-1]^=1;
  for(const bytes of [png(513,1),png(1,513),png(0,1),Buffer.alloc(MAX_PHOTO_BYTES+1),photo.subarray(0,25),corrupt,png(1,1,Buffer.alloc(1024*1024)),png(1,1,Buffer.from([5,1,2,3,4])),png(1,1,undefined,[chunk('acTL',Buffer.alloc(8))]),Buffer.concat([photo,Buffer.from('<script>')])])assert.throws(()=>validateProfilePhoto(bytes,'image/png'));
});
test('JPEG/WebP reject extreme dimensions, mismatched canvases, animation and truncated chunks',()=>{
  const jpeg=Buffer.from([255,216,255,192,0,11,8,255,255,255,255,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217]);
  assert.throws(()=>validateProfilePhoto(jpeg,'image/jpeg'));
  assert.throws(()=>validateProfilePhoto(jpeg.subarray(0,12),'image/jpeg'));
  function webp(flags,width,canvasWidth=1) {
    const b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(36,4);b.write('WEBPVP8X',8);b.writeUInt32LE(10,16);b[20]=flags;b.writeUIntLE(canvasWidth-1,24,3);
    b.write('VP8L',30);b.writeUInt32LE(5,34);b[38]=47;b.writeUInt32LE(width-1,39);return b;
  }
  for(const b of [webp(2,1),webp(0,513,513),webp(0,2,1),webp(0,1).subarray(0,40)])assert.throws(()=>validateProfilePhoto(b,'image/webp'));
});
test('owner upload/get/delete, binary storage, no-cache headers, and query cannot select another account',async()=>{
  assert.equal((await call('customer','PUT',a,photo)).status,200);
  const response=await call('customer','GET',a);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),photo);
  assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Content-Type'),'image/png');
  assert.equal((await call('customer','GET',b,undefined,{query:'?email=a@example.test&id=a@example.test'})).status,404);
  assert.equal((await call('customer','DELETE',b,undefined,{query:'?email=a@example.test'})).status,204);
  assert.equal((await call('customer','GET',a)).status,200);
  const stored=await db.collection(PHOTO_COLLECTION).findOne({});assert.ok(stored.bytes instanceof Binary);assert.ok(!stored.email);
  assert.equal((await call('customer','DELETE',a)).status,204);assert.equal((await call('customer','GET',a)).status,404);
});
test('anonymous, role-crossing, demo and admin-key-only access denied',async()=>{
  for(const kind of ['customer','operator']){
    assert.equal((await call(kind)).status,401);
    assert.equal((await call(kind,'PUT',undefined,photo,{headers:{Authorization:'Bearer '+env.API_ADMIN_KEY}})).status,401);
    for(const method of ['GET','PUT','DELETE'])assert.ok([401,403].includes((await call(kind,method,demo,method==='PUT'?photo:undefined)).status));
  }
  assert.equal((await call('customer','GET',operator)).status,401);assert.equal((await call('operator','GET',a)).status,401);
});
test('same-origin write checks apply directly to both routes and all writes',async()=>{
  for(const [kind,cookie] of [['customer',a],['operator',operator]])for(const method of ['PUT','DELETE'])for(const Origin of ['https://evil.test','null','']){
    assert.equal((await call(kind,method,cookie,method==='PUT'?photo:undefined,{headers:{Origin}})).status,403);
  }
});
test('size limits include streamed body with no Content-Length; unsupported MIME/method fail',async()=>{
  assert.equal((await call('customer','PUT',a,photo,{headers:{'Content-Length':String(MAX_PHOTO_BYTES+1)}})).status,413);
  assert.equal((await call('customer','PUT',a,Buffer.alloc(MAX_PHOTO_BYTES+1))).status,413);
  assert.equal((await call('customer','PUT',a,photo,{headers:{'Content-Type':'image/svg+xml'}})).status,415);
  assert.equal((await call('customer','PUT',a,photo,{headers:{'Content-Type':'image/jpeg'}})).status,400);
  assert.equal((await call('customer','POST',a,photo)).status,405);
  assert.equal((await call('customer','PUT',a)).status,400);
});
test('bootstrap operator gets stable generation, role-isolated photo survives salt change',async()=>{
  assert.equal((await call('operator','PUT',operator,photo)).status,200);
  const account=await db.collection('operator_accounts').findOne({_id:env.OPERATOR_EMAIL});assert.ok(account.sessionGeneration);
  await db.collection('operator_accounts').updateOne({_id:env.OPERATOR_EMAIL},{$set:{salt:'changed'}});
  assert.equal((await call('operator','GET',operator)).status,401);
  operator=sessionCookie(await issueSession(env,env.OPERATOR_EMAIL));
  assert.equal((await call('operator','GET',operator)).status,200);
  assert.equal((await call('customer','GET',a)).status,404);
  assert.equal((await call('operator','DELETE',operator)).status,204);
});
test('migration preserves immutable photo key and rolls back with parent transaction',async()=>{
  await migrateProfilePhoto(db,{oldEmail:'legacy@example.test',newEmail:'other@example.test',account:{}});
  await call('customer','PUT',a,photo);
  const account=await db.collection('customer_accounts').findOne({_id:'a@example.test'});
  const oldKey=await profilePhotoKey('customer',account._id,account);
  assert.equal(oldKey,await profilePhotoKey('customer','new@example.test',account));
  assert.notEqual(oldKey,await profilePhotoKey('customer',account._id,{...account,sessionGeneration:crypto.randomUUID()}));
  const session=client.startSession();
  const move=async()=>{
    await db.collection('customer_accounts').insertOne({...account,_id:'new@example.test'}, {session});
    await migrateProfilePhoto(db,{oldEmail:account._id,newEmail:'new@example.test',account,session});
    await db.collection('customer_accounts').deleteOne({_id:account._id},{session});
  };
  try {
    await assert.rejects(session.withTransaction(async()=>{await move();throw Error('rollback-check');}),/rollback-check/);
    assert.equal((await call('customer','GET',a)).status,200);
    await session.withTransaction(move);
  } finally {await session.endSession();}
  assert.equal((await call('customer','GET',a)).status,401);
  const next=customerCookie(await issueCustomerSession(env,'new@example.test'));
  assert.equal((await call('customer','GET',next)).status,200);
  assert.ok(await db.collection(PHOTO_COLLECTION).findOne({_id:oldKey}));
  await migrateProfilePhoto(db,{oldEmail:account._id,newEmail:'new@example.test',account});
});
test('revoked and deleted customer sessions cannot read a photo',async()=>{
  await db.collection('customer_accounts').updateOne({_id:'b@example.test'},{$set:{passwordChangedAt:new Date(Date.now()+1000)}});
  assert.equal((await call('customer','GET',b)).status,401);
  await db.collection('customer_accounts').deleteOne({_id:'b@example.test'});assert.equal((await call('customer','GET',b)).status,401);
});
test('API middleware forwards customers without authority and refuses demo photo reads',async()=>{
  let forwarded;
  await middleware({env,request:new Request('https://home.test/api/customer/photo',{headers:{Cookie:a,Authorization:'Bearer '+env.API_ADMIN_KEY}}),data:{},next:r=>{forwarded=r;return new Response();}});
  assert.equal(forwarded.headers.has('Authorization'),false);
  const r=await middleware({env,request:new Request('https://home.test/api/profile-photo',{headers:{Cookie:demo}}),data:{},next:()=>{throw Error('must not pass');}});
  assert.equal(r.status,403);
});

test('browser widget uploads resized JPEG, announces errors/removal, cleans up, and real raster encodings validate',async t=>{
  const {chromium}=await import('@playwright/test');
  const {existsSync}=await import('node:fs');
  const {readFile}=await import('node:fs/promises');
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if(!existsSync(chrome)&&!existsSync(chromium.executablePath()))return t.skip('No local Chromium installed.');
  const browser=await chromium.launch(existsSync(chrome)?{executablePath:chrome}:{});
  try {
    const page=await browser.newPage();let saved=null,putCount=0;
    const module=await readFile(new URL('../ui/profile-photo.js',import.meta.url),'utf8');
    await page.route('https://home.test/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==='/widget.js')return route.fulfill({contentType:'text/javascript',body:module});
      if(url.pathname.startsWith('/api/')) {
        if(request.method()==='GET')return route.fulfill(saved?{status:200,contentType:'image/jpeg',body:saved}:{status:404,body:'{}'});
        if(request.method()==='PUT'){saved=request.postDataBuffer();putCount++;validateProfilePhoto(saved,request.headers()['content-type']);return route.fulfill({status:200,body:'{}'});}
        if(request.method()==='DELETE'){saved=null;return route.fulfill({status:204});}
      }
      return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Photo test</title><body><main id="mount"></main><script type="module">import {mountProfilePhoto} from "/widget.js";window.cleanup=mountProfilePhoto(document.querySelector("#mount"),{kind:"customer"});</script></body></html>'});
    });
    await page.goto('https://home.test/');
    await page.getByRole('status').filter({hasText:'No profile photo.'}).waitFor();
    // Chrome produces genuine PNG/JPEG/WebP bytes, not just format headers.
    const encoded=await page.evaluate(async()=>{
      const c=document.createElement('canvas');c.width=512;c.height=300;const x=c.getContext('2d');x.fillStyle='green';x.fillRect(0,0,c.width,c.height);
      const result={};for(const type of ['image/png','image/jpeg','image/webp'])result[type]=c.toDataURL(type).split(',')[1];return result;
    });
    for(const [type,base64] of Object.entries(encoded))assert.equal(validateProfilePhoto(Buffer.from(base64,'base64'),type).width,512);
    const original=Buffer.from(encoded['image/png'],'base64');
    const withMetadata=Buffer.concat([original.subarray(0,33),chunk('tEXt',Buffer.from('Comment\0PRIVATE_LOCATION_SAMPLE')),original.subarray(33)]);
    await page.getByLabel('Upload profile photo').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:withMetadata});
    await page.getByRole('status').filter({hasText:'Profile photo saved.'}).waitFor();
    const meta=validateProfilePhoto(saved,'image/jpeg');assert.equal(meta.width,256);assert.equal(meta.height,150);assert.ok(saved.length<MAX_PHOTO_BYTES);assert.ok(!saved.includes(Buffer.from('PRIVATE_LOCATION_SAMPLE')));
    assert.equal(await page.getByAltText('Your profile photo').isVisible(),true);
    await page.getByLabel('Upload profile photo').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
    await page.getByRole('status').filter({hasText:'Choose a PNG'}).waitFor();assert.equal(putCount,1);
    await page.getByRole('button',{name:'Remove photo'}).click();
    await page.getByRole('status').filter({hasText:'Profile photo removed.'}).waitFor();assert.equal(saved,null);
    assert.equal(await page.getByRole('button',{name:'Remove photo'}).isDisabled(),true);
    await page.evaluate(()=>window.cleanup());assert.equal(await page.locator('#mount').textContent(),'');
  } finally {await browser.close();}
});

const renamePassword='synthetic-rename-password';
async function newCustomer(email, createdAt=new Date(1), password=renamePassword) {
  const salt='synthetic-generation-salt';
  await db.collection('customer_accounts').insertOne({_id:email,createdAt,salt,hash:await passwordHash(password,salt)});
  const cookie=customerCookie(await issueCustomerSession(env,email));
  return {cookie,account:await db.collection('customer_accounts').findOne({_id:email})};
}
async function renameCustomer(cookie,newEmail) {
  const response=await accountHandler({env,db,request:new Request('https://home.test/api/customer/account',{
    method:'PATCH',headers:{Cookie:cookie,Origin:'https://home.test','Content-Type':'application/json'},
    body:JSON.stringify({email:newEmail,confirmEmail:newEmail,password:renamePassword}),
  })});
  assert.equal(response.status,200,await response.clone().text());
  return response.headers.get('Set-Cookie');
}
test('P1: paused customer lookup cannot read, overwrite or delete a renamed-and-reused email generation',async t=>{
  for(const method of ['GET','PUT','DELETE']) {
    const email=`p1-${method.toLowerCase()}@example.test`, renamed=`renamed-${email}`;
    const original=await newCustomer(email), replacementPhoto=png(1,1,Buffer.from([0,0,0,255,255]));
    await call('customer','PUT',original.cookie,photo);
    const find=Collection.prototype.findOne;let intercepted=false,replacement;
    const mock=t.mock.method(Collection.prototype,'findOne',async function(filter,options){
      if(this.collectionName==='customer_accounts'&&filter._id===email&&options?.session&&!intercepted) {
        intercepted=true;
        await renameCustomer(original.cookie,renamed);
        // Same timestamp/credentials intentionally: only the random generation distinguishes owners.
        replacement=await newCustomer(email,original.account.createdAt);
        assert.notEqual(original.account.sessionGeneration,replacement.account.sessionGeneration);
        assert.equal((await call('customer','PUT',replacement.cookie,replacementPhoto)).status,200);
      }
      return find.call(this,filter,options);
    });
    let response;
    try {response=await call('customer',method,original.cookie,method==='PUT'?photo:undefined);}
    finally {mock.mock.restore();}
    assert.ok(intercepted);assert.equal(response.status,401);
    const untouched=await call('customer','GET',replacement.cookie);
    assert.equal(untouched.status,200);assert.deepEqual(Buffer.from(await untouched.arrayBuffer()),replacementPhoto);
    assert.equal((await call('customer','GET',original.cookie)).status,401);
  }
});
test('P1: account-backed and legacy operator email reuse rejects old cookies for GET/PUT/DELETE',async()=>{
  for(const legacy of [false,true]) {
    const email=legacy?env.OPERATOR_EMAIL:'generation-operator@example.test';
    await db.collection('operator_accounts').deleteOne({_id:email});
    const fixture={_id:email,createdAt:new Date(1),...(legacy?{}:{role:'operator'}),salt:'identical-salt',hash:'fixture-hash'};
    await db.collection('operator_accounts').insertOne(fixture);
    const oldCookie=sessionCookie(await issueSession(env,email,'operator',{accountBacked:!legacy}));
    await db.collection('operator_accounts').deleteOne({_id:email});
    await db.collection('operator_accounts').insertOne(fixture);
    const replacementCookie=sessionCookie(await issueSession(env,email,'operator',{accountBacked:!legacy}));
    assert.equal((await call('operator','PUT',replacementCookie,photo)).status,200);
    assert.equal(await readSession(new Request('https://home.test',{headers:{Cookie:oldCookie}}),env),null);
    for(const method of ['GET','PUT','DELETE']) assert.equal((await call('operator',method,oldCookie,method==='PUT'?photo:undefined)).status,401);
    assert.equal((await call('operator','GET',replacementCookie)).status,200);
  }
});
test('P2: first and replacement uploads paused on body reject after actual email rename without orphan writes',async()=>{
  for(const existing of [false,true]) {
    const email=`paused-body-${existing}@example.test`, next=`next-${email}`, original=await newCustomer(email);
    if(existing)assert.equal((await call('customer','PUT',original.cookie,photo)).status,200);
    let reading,release;
    const started=new Promise(resolve=>{reading=resolve;}), resume=new Promise(resolve=>{release=resolve;});
    const replacement=png(1,1,Buffer.from([0,255,255,0,255]));
    const body=new ReadableStream({async pull(controller){reading();await resume;controller.enqueue(replacement);controller.close();}},{highWaterMark:0});
    const request=new Request('https://home.test/api/customer/photo',{method:'PUT',duplex:'half',headers:{Cookie:original.cookie,Origin:'https://home.test','Content-Type':'image/png'},body});
    const pending=customerPhoto({env,request});
    await started;
    let nextCookie;
    try {nextCookie=await renameCustomer(original.cookie,next);}finally{release();}
    assert.equal((await pending).status,401);
    const current=await call('customer','GET',nextCookie);
    assert.equal(current.status,existing?200:404);
    if(existing)assert.deepEqual(Buffer.from(await current.arrayBuffer()),photo);
    const key=await profilePhotoKey('customer',email,original.account);
    assert.equal(await db.collection(PHOTO_COLLECTION).countDocuments({_id:key}),existing?1:0);
    // Retrying after sign-in saves to the same immutable key and is visible at the new email.
    assert.equal((await call('customer','PUT',nextCookie,replacement)).status,200);
    assert.deepEqual(Buffer.from(await (await call('customer','GET',nextCookie)).arrayBuffer()),replacement);
  }
});
test('P2: rename after mutation snapshot conflicts with PUT and DELETE and reauthorizes on retry',async t=>{
  for(const method of ['PUT','DELETE']) {
    const email=`guard-${method.toLowerCase()}@example.test`, original=await newCustomer(email);
    await call('customer','PUT',original.cookie,photo);
    const update=Collection.prototype.updateOne;let intercepted=false,nextCookie;
    const mock=t.mock.method(Collection.prototype,'updateOne',async function(filter,change,options){
      if(this.collectionName==='customer_accounts'&&filter._id===email&&change.$inc?.photoRevision&&options?.session&&!intercepted) {
        intercepted=true;nextCookie=await renameCustomer(original.cookie,`renamed-${email}`);
      }
      return update.call(this,filter,change,options);
    });
    let response;
    try{response=await call('customer',method,original.cookie,method==='PUT'?png(1,1,Buffer.from([0,0,255,0,255])):undefined);}
    finally{mock.mock.restore();}
    assert.ok(intercepted);assert.equal(response.status,401);
    const current=await call('customer','GET',nextCookie);assert.equal(current.status,200);
    assert.deepEqual(Buffer.from(await current.arrayBuffer()),photo);
  }
});
test('P1: revocation or disablement between initial auth and exact snapshot denies photo reads',async t=>{
  for(const kind of ['customer','operator'])for(const change of ['disabled','passwordChangedAt']) {
    const email=`snapshot-${kind}-${change.toLowerCase()}@example.test`;
    const accounts=db.collection(kind==='customer'?'customer_accounts':'operator_accounts');
    let cookie;
    if(kind==='customer')cookie=(await newCustomer(email)).cookie;
    else {await accounts.insertOne({_id:email,role:'operator',salt:'fixture-salt',hash:'fixture-hash'});cookie=sessionCookie(await issueSession(env,email,'operator',{accountBacked:true}));}
    await call(kind,'PUT',cookie,photo);
    const find=Collection.prototype.findOne;let intercepted=false;
    const mock=t.mock.method(Collection.prototype,'findOne',async function(filter,options){
      if(this.collectionName===accounts.collectionName&&filter._id===email&&options?.session&&!intercepted) {
        intercepted=true;await accounts.updateOne({_id:email},{$set:{[change]:change==='disabled'?true:new Date(Date.now()+1000)}});
      }
      return find.call(this,filter,options);
    });
    try{assert.equal((await call(kind,'GET',cookie)).status,401);}finally{mock.mock.restore();}
    assert.ok(intercepted);
  }
});

test('unbound pre-fix cookies cannot adopt a database account or its photos',async()=>{
  const customer=await newCustomer('unbound-photo@example.test');
  await call('customer','PUT',customer.cookie,photo);
  const signatureOnly={SESSION_SECRET:env.SESSION_SECRET};
  const oldCustomer=customerCookie(await issueCustomerSession(signatureOnly,customer.account._id));
  const oldOperator=sessionCookie(await issueSession(signatureOnly,env.OPERATOR_EMAIL));
  for(const [kind,cookie] of [['customer',oldCustomer],['operator',oldOperator]]) {
    for(const method of ['GET','PUT','DELETE'])assert.equal((await call(kind,method,cookie,method==='PUT'?photo:undefined)).status,401);
  }
  assert.equal((await call('customer','GET',customer.cookie)).status,200);
});

let loginSequence=0;
async function endpoint(fn,path,body,settings=env,cookie) {
  return fn({env:settings,db,request:new Request('https://home.test'+path,{method:path.endsWith('/account')?'PATCH':'POST',headers:{Origin:'https://home.test','Content-Type':'application/json','CF-Connecting-IP':`round2-${++loginSequence}`,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)})});
}
const differentPassword='different-synthetic-password-B';
function issuanceFor(filter,update,email) {
  return filter._id===email&&filter.sessionGeneration?.$eq&&update?.$set?.sessionGeneration;
}
async function assertNoAuthority(response,kind,settings=env) {
  assert.equal(response.status,401,await response.clone().text());
  assert.equal(response.headers.get('Set-Cookie'),null);
  assert.equal((await call(kind,'GET',undefined,undefined,{env:settings})).status,401);
}
test('round2: customer login cannot sign a replacement generation after checking the original password',async t=>{
  const email='login-swap-customer@example.test', original=await newCustomer(email);
  const operation=Collection.prototype.findOneAndUpdate;let intercepted=false,replacement;
  const mock=t.mock.method(Collection.prototype,'findOneAndUpdate',async function(filter,update,options){
    if(this.collectionName==='customer_accounts'&&issuanceFor(filter,update,email)&&!intercepted) {
      intercepted=true;
      await renameCustomer(original.cookie,'renamed-login-swap@example.test');
      replacement=await newCustomer(email,new Date(),differentPassword);
      assert.equal((await call('customer','PUT',replacement.cookie,photo)).status,200);
    }
    return operation.call(this,filter,update,options);
  });
  let response;
  try{response=await endpoint(customerLogin,'/api/customer/login',{email,password:renamePassword});}finally{mock.mock.restore();}
  assert.ok(intercepted);await assertNoAuthority(response,'customer');
  assert.deepEqual(Buffer.from(await (await call('customer','GET',replacement.cookie)).arrayBuffer()),photo);
});
test('round2: operator login cannot sign a replacement generation after checking the original password',async t=>{
  const email='login-swap-operator@example.test', salt='operator-race-salt';
  await db.collection('operator_accounts').insertOne({_id:email,role:'operator',salt,hash:await passwordHash(renamePassword,salt),createdAt:new Date(1)});
  const operation=Collection.prototype.findOneAndUpdate;let intercepted=false,replacementCookie;
  const mock=t.mock.method(Collection.prototype,'findOneAndUpdate',async function(filter,update,options){
    if(this.collectionName==='operator_accounts'&&issuanceFor(filter,update,email)&&!intercepted) {
      intercepted=true;
      await this.deleteOne({_id:email});
      await this.insertOne({_id:email,role:'operator',salt,hash:await passwordHash(differentPassword,salt),createdAt:new Date(),sessionGeneration:crypto.randomUUID()});
      const replacement=await endpoint(operatorLogin,'/api/session',{email,password:differentPassword});
      assert.equal(replacement.status,200);replacementCookie=replacement.headers.get('Set-Cookie');
      assert.equal((await call('operator','PUT',replacementCookie,photo)).status,200);
    }
    return operation.call(this,filter,update,options);
  });
  let response;
  try{response=await endpoint(operatorLogin,'/api/session',{email,password:renamePassword});}finally{mock.mock.restore();}
  assert.ok(intercepted);await assertNoAuthority(response,'operator');
  assert.deepEqual(Buffer.from(await (await call('operator','GET',replacementCookie)).arrayBuffer()),photo);
});
test('round2: legacy absent-profile login cannot adopt a concurrent provisioned account',async t=>{
  const email='legacy-absent-race@example.test',salt='legacy-race-salt';
  const settings={...env,OPERATOR_EMAIL:email,OPERATOR_PASSWORD_SALT:salt,OPERATOR_PASSWORD_HASH:await passwordHash(renamePassword,salt)};
  const insert=Collection.prototype.insertOne;let intercepted=false,replacementCookie;
  const mock=t.mock.method(Collection.prototype,'insertOne',async function(doc,options){
    if(this.collectionName==='operator_accounts'&&doc._id===email&&doc.sessionGeneration&&!intercepted){
      intercepted=true;
      await insert.call(this,{_id:email,role:'operator',salt,hash:await passwordHash(differentPassword,salt),sessionGeneration:crypto.randomUUID()});
      const replacement=await endpoint(operatorLogin,'/api/session',{email,password:differentPassword},settings);
      assert.equal(replacement.status,200);replacementCookie=replacement.headers.get('Set-Cookie');
      assert.equal((await call('operator','PUT',replacementCookie,photo,{env:settings})).status,200);
    }
    return insert.call(this,doc,options);
  });
  let response;
  try{response=await endpoint(operatorLogin,'/api/session',{email,password:renamePassword},settings);}finally{mock.mock.restore();}
  assert.ok(intercepted);await assertNoAuthority(response,'operator',settings);
  assert.equal((await call('operator','GET',replacementCookie,undefined,{env:settings})).status,200);
});
test('round2: legacy environment credentials changed after verification are not silently adopted',async t=>{
  const email='legacy-environment-race@example.test',salt='legacy-environment-salt';
  const settings={...env,OPERATOR_EMAIL:email,OPERATOR_PASSWORD_SALT:salt,OPERATOR_PASSWORD_HASH:await passwordHash(renamePassword,salt)};
  await db.collection('operator_accounts').insertOne({_id:email,sessionGeneration:crypto.randomUUID()});
  const changedHash=await passwordHash(differentPassword,salt),operation=Collection.prototype.findOneAndUpdate;
  let intercepted=false;
  const mock=t.mock.method(Collection.prototype,'findOneAndUpdate',async function(filter,update,options){
    if(this.collectionName==='operator_accounts'&&issuanceFor(filter,update,email)&&!intercepted){intercepted=true;settings.OPERATOR_PASSWORD_HASH=changedHash;}
    return operation.call(this,filter,update,options);
  });
  let response;
  try{response=await endpoint(operatorLogin,'/api/session',{email,password:renamePassword},settings);}finally{mock.mock.restore();}
  assert.ok(intercepted);await assertNoAuthority(response,'operator',settings);
});
test('round2: registration binds only the exact inserted profile, never a replacement before issuance',async t=>{
  const email='registration-issuance-race@example.test';
  const operation=Collection.prototype.findOneAndUpdate;let intercepted=false,replacement;
  const mock=t.mock.method(Collection.prototype,'findOneAndUpdate',async function(filter,update,options){
    if(this.collectionName==='customer_accounts'&&issuanceFor(filter,update,email)&&!intercepted){
      intercepted=true;await this.deleteOne({_id:email});replacement=await newCustomer(email,new Date(),differentPassword);
      await call('customer','PUT',replacement.cookie,photo);
    }
    return operation.call(this,filter,update,options);
  });
  let response;
  try{response=await endpoint(customerRegister,'/api/customer/register',{email,password:renamePassword,contactName:'Synthetic owner',consent:false,acceptTerms:true});}finally{mock.mock.restore();}
  assert.ok(intercepted);await assertNoAuthority(response,'customer');
  assert.equal((await call('customer','GET',replacement.cookie)).status,200);
});
test('round2: rename reissue uses the committed destination snapshot, not a new email lookup',async t=>{
  const original=await newCustomer('rename-reissue-original@example.test'),next='rename-reissue-next@example.test';
  const operation=Collection.prototype.findOneAndUpdate;let intercepted=false,replacement;
  const mock=t.mock.method(Collection.prototype,'findOneAndUpdate',async function(filter,update,options){
    if(this.collectionName==='customer_accounts'&&issuanceFor(filter,update,next)&&!intercepted){
      intercepted=true;await this.deleteOne({_id:next});replacement=await newCustomer(next,new Date(),differentPassword);
      await call('customer','PUT',replacement.cookie,photo);
    }
    return operation.call(this,filter,update,options);
  });
  let response;
  try{response=await endpoint(accountHandler,'/api/customer/account',{email:next,confirmEmail:next,password:renamePassword},env,original.cookie);}finally{mock.mock.restore();}
  assert.ok(intercepted);await assertNoAuthority(response,'customer');
  assert.equal((await call('customer','GET',replacement.cookie)).status,200);
});
test('round2: recovery updates only the account snapshot whose code was verified',async t=>{
  const email='recovery-snapshot-race@example.test',salt='recovery-race-salt',code='synthetic-recovery-code';
  const recoveryHash=await sha256Hex(code),replacementHash=await passwordHash(differentPassword,salt);
  await db.collection('operator_accounts').insertOne({_id:email,role:'operator',salt,hash:await passwordHash(renamePassword,salt),recoveryHash});
  const updateOne=Collection.prototype.updateOne;let intercepted=false,replacementGeneration;
  const mock=t.mock.method(Collection.prototype,'updateOne',async function(filter,update,options){
    if(this.collectionName==='operator_accounts'&&filter._id===email&&filter.sessionGeneration?.$eq&&update.$unset?.recoveryHash!==undefined&&!intercepted){
      intercepted=true;await this.deleteOne({_id:email});replacementGeneration=crypto.randomUUID();
      // Even identical recovery-code material must not authorize a different account generation.
      await this.insertOne({_id:email,role:'operator',salt,hash:replacementHash,recoveryHash,sessionGeneration:replacementGeneration});
    }
    return updateOne.call(this,filter,update,options);
  });
  let response;
  try{response=await endpoint(recover,'/api/recovery',{email,recoveryCode:code,password:'synthetic-reset-password'});}finally{mock.mock.restore();}
  assert.ok(intercepted);assert.equal(response.status,400);assert.equal(response.headers.get('Set-Cookie'),null);
  const saved=await db.collection('operator_accounts').findOne({_id:email});assert.equal(saved.hash,replacementHash);assert.equal(saved.sessionGeneration,replacementGeneration);
});
test('round2: database-backed issuers reject missing verified snapshots',async()=>{
  await assert.rejects(issueCustomerBound(env,'a@example.test'),{status:401});
  await assert.rejects(issueOperatorBound(env,env.OPERATOR_EMAIL),{status:401});
});

test('round2: credentials changed after issuance guard invalidate the signed snapshot even without timestamp movement',async t=>{
  const email='post-guard-credentials@example.test',salt='post-guard-salt';
  const replacementHash=await passwordHash(differentPassword,salt);
  await db.collection('operator_accounts').insertOne({_id:email,role:'operator',salt,hash:await passwordHash(renamePassword,salt)});
  const operation=Collection.prototype.findOneAndUpdate;let intercepted=false;
  const mock=t.mock.method(Collection.prototype,'findOneAndUpdate',async function(filter,update,options){
    const bound=await operation.call(this,filter,update,options);
    if(this.collectionName==='operator_accounts'&&issuanceFor(filter,update,email)&&!intercepted){
      intercepted=true;await this.updateOne({_id:email},{$set:{hash:replacementHash}});
    }
    return bound;
  });
  let response;
  try{response=await endpoint(operatorLogin,'/api/session',{email,password:renamePassword});}finally{mock.mock.restore();}
  assert.ok(intercepted);assert.equal(response.status,200);
  // It may have been signed after the concurrent change, but carries only the verified OLD state.
  const staleCookie=response.headers.get('Set-Cookie');
  assert.equal(await readSession(new Request('https://home.test',{headers:{Cookie:staleCookie}}),env),null);
  assert.equal((await call('operator','GET',staleCookie)).status,401);
  const fresh=await endpoint(operatorLogin,'/api/session',{email,password:differentPassword});
  assert.equal(fresh.status,200);assert.ok(await readSession(new Request('https://home.test',{headers:{Cookie:fresh.headers.get('Set-Cookie')}}),env));
});
