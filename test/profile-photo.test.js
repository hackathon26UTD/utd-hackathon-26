import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, Binary } from 'mongodb';
import { issueCustomerSession, customerCookie, issueSession, sessionCookie } from '../src/operator-session.js';
import { validateProfilePhoto, MAX_PHOTO_BYTES, migrateProfilePhoto, profilePhotoKey, PHOTO_COLLECTION } from '../src/profile-photo.js';
import { onRequest as customerPhoto } from '../functions/api/customer/photo.js';
import { onRequest as operatorPhoto } from '../functions/api/profile-photo.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
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
  return (kind==='customer'?customerPhoto:operatorPhoto)({request,env});
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
  const account=await db.collection('operator_accounts').findOne({_id:env.OPERATOR_EMAIL});assert.ok(account.profilePhotoId);
  await db.collection('operator_accounts').updateOne({_id:env.OPERATOR_EMAIL},{$set:{salt:'changed'}});
  assert.equal((await call('operator','GET',operator)).status,200);
  assert.equal((await call('customer','GET',a)).status,404);
  assert.equal((await call('operator','DELETE',operator)).status,204);
});
test('migration hook moves photo; re-registering old email never inherits image',async()=>{
  await migrateProfilePhoto(db,{oldEmail:'legacy@example.test',newEmail:'other@example.test',account:{}});
  await call('customer','PUT',a,photo);
  const account=await db.collection('customer_accounts').findOne({_id:'a@example.test'});
  const session=client.startSession();
  try {
    await assert.rejects(session.withTransaction(async()=>{
      await migrateProfilePhoto(db,{oldEmail:account._id,newEmail:'new@example.test',account,session});
      throw Error('rollback-check');
    }),/rollback-check/);
    assert.equal((await call('customer','GET',a)).status,200);
    await session.withTransaction(()=>migrateProfilePhoto(db,{oldEmail:account._id,newEmail:'new@example.test',account,session}));
  } finally {await session.endSession();}
  assert.equal((await call('customer','GET',a)).status,404);
  await db.collection('customer_accounts').insertOne({...account,_id:'new@example.test'});
  const next=customerCookie(await issueCustomerSession(env,'new@example.test'));
  assert.equal((await call('customer','GET',next)).status,200);
  assert.notEqual(await profilePhotoKey('customer',account._id,account),await profilePhotoKey('customer',account._id,{createdAt:new Date(100)}));
  await migrateProfilePhoto(db,{oldEmail:account._id,newEmail:'new@example.test',account}); // idempotent after removal
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
