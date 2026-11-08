import { Binary } from 'mongodb';
import { inflateSync } from 'node:zlib';
import { withDatabase } from '../lib/mongodb.js';
import { readCustomerSession, readSession, sameOrigin } from './operator-session.js';
import { sha256Hex } from './auth.js';

export const MAX_PHOTO_BYTES = 256 * 1024;
export const MAX_PHOTO_DIMENSION = 512;
export const PHOTO_COLLECTION = 'profile_photos';
const types = ['image/png', 'image/jpeg', 'image/webp'];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const invalid = () => fail(400, 'Choose a valid, still PNG, JPEG or WebP photo up to 512 × 512 pixels.');
const ascii = (b, p, n) => String.fromCharCode(...b.subarray(p, p + n));
function dimensions(width, height) {
  if (!width || !height || width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) invalid();
  return { width, height };
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(b, v) {
  if (b.length < 57 || ![137,80,78,71,13,10,26,10].every((n,i) => b[i] === n)) invalid();
  let p = 8, size, rowBytes, ended = false, dataEnded = false;
  const parts = [];
  while (p + 12 <= b.length) {
    const n = v.getUint32(p), type = ascii(b,p+4,4), end = p + 12 + n;
    if (end > b.length || crc32(b.subarray(p+4,end-4)) !== v.getUint32(end-4)) invalid();
    if (p === 8 && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (p !== 8 || n !== 13) invalid();
      size = dimensions(v.getUint32(p+8),v.getUint32(p+12));
      const depth=b[p+16], color=b[p+17], channels={0:1,2:3,3:1,4:2,6:4}[color];
      const depths = color === 3 ? [1,2,4,8] : color === 0 ? [1,2,4,8,16] : [8,16];
      if (!channels || !depths.includes(depth) || b[p+18] || b[p+19] || b[p+20]) invalid();
      rowBytes = Math.ceil(size.width * channels * depth / 8);
    } else if (type === 'IDAT') {
      if (dataEnded) invalid();
      parts.push(b.subarray(p+8,end-4));
    } else {
      if (parts.length) dataEnded = true;
      if (type === 'IEND') { if(n || !parts.length || end !== b.length) invalid(); ended=true; }
      // Excludes animation and compressed ancillary payloads (text/profiles).
      else if (!['PLTE','tRNS','sRGB','gAMA','cHRM','pHYs'].includes(type)) invalid();
    }
    p = end;
  }
  if (!ended || p !== b.length) invalid();
  const expected = (rowBytes + 1) * size.height;
  let raw;
  try { raw = inflateSync(Buffer.concat(parts), { maxOutputLength: expected }); } catch { invalid(); }
  if (raw.length !== expected) invalid();
  for(let row=0;row<size.height;row++) if(raw[row*(rowBytes+1)]>4) invalid();
  return size;
}
function jpeg(b,v) {
  if(b[0]!==255 || b[1]!==216) invalid();
  let p=2, size, scans=0;
  while(p<b.length) {
    if(b[p++]!==255) invalid();
    while(b[p]===255) p++;
    const marker=b[p++];
    if(marker===217) { if(!size || !scans || p!==b.length) invalid(); return size; }
    if(marker===216 || marker===0 || marker===220 || (marker>=208&&marker<=215) || p+2>b.length) invalid();
    const n=v.getUint16(p), end=p+n;
    if(n<2 || end>b.length) invalid();
    if(marker>=192 && marker<=207 && ![196,200,204].includes(marker)) {
      if(![192,194].includes(marker) || size || n<8 || b[p+2]!==8) invalid();
      size=dimensions(v.getUint16(p+5),v.getUint16(p+3));
      const components=b[p+7];
      if(![1,3].includes(components) || n!==8+3*components) invalid();
    }
    p=end;
    if(marker===218) {
      if(!size || ++scans>16 || n<6) invalid();
      while(p<b.length) {
        if(b[p]!==255) {p++;continue;}
        if(b[p+1]===0 || (b[p+1]>=208&&b[p+1]<=215)) {p+=2;continue;}
        break;
      }
    }
  }
  invalid();
}
function webp(b,v) {
  if(b.length<26 || ascii(b,0,4)!=='RIFF' || ascii(b,8,4)!=='WEBP' || v.getUint32(4,true)!==b.length-8) invalid();
  let p=12, size, canvas, profile=false;
  const u24 = q => b[q] | b[q+1]<<8 | b[q+2]<<16;
  while(p+8<=b.length) {
    const type=ascii(b,p,4), n=v.getUint32(p+4,true), q=p+8, end=q+n;
    if(end>b.length) invalid();
    if(type==='VP8X') {
      if(p!==12 || n!==10 || (b[q]&~48) || b[q+1] || b[q+2] || b[q+3]) invalid();
      canvas=dimensions(1+u24(q+4),1+u24(q+7));
    } else if(type==='VP8 ') {
      if(size || n<10 || b[q]&1 || ascii(b,q+3,3)!=='\x9d\x01\x2a') invalid();
      size=dimensions(v.getUint16(q+6,true)&16383,v.getUint16(q+8,true)&16383);
    } else if(type==='VP8L') {
      if(size || n<5 || b[q]!==47 || b[q+4]>>5) invalid();
      const bits=v.getUint32(q+1,true);
      size=dimensions(1+(bits&16383),1+((bits>>>14)&16383));
    } else if(type==='ICCP') {
      if(!canvas || size || profile || !n || n>16384) invalid();
      profile=true;
    } else if(type!=='ALPH' || !canvas || size || !n) invalid();
    p=end+(n&1);
    if((n&1) && b[end]!==0) invalid();
  }
  if(p!==b.length || !size || (canvas&&(size.width!==canvas.width||size.height!==canvas.height))) invalid();
  return size;
}
export function validateProfilePhoto(bytes, contentType) {
  if(!types.includes(contentType)) fail(415,'Choose a PNG, JPEG or WebP photo.');
  const b = new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  if(!b.length) invalid();
  if(b.length>MAX_PHOTO_BYTES) fail(413,'Photo must be 256 KiB or smaller.');
  const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
  let size;
  try { size=({'image/png':png,'image/jpeg':jpeg,'image/webp':webp}[contentType])(b,view); }
  catch(error) { if(error.status) throw error; invalid(); }
  return {...size,contentType};
}
async function boundedBody(request) {
  const length=request.headers.get('Content-Length');
  if(length && (!/^\d+$/.test(length) || Number(length)>MAX_PHOTO_BYTES)) fail(413,'Photo must be 256 KiB or smaller.');
  if(!request.body) invalid();
  const reader=request.body.getReader(), chunks=[]; let lengthRead=0;
  try {
    while(true) {
      const {done,value}=await reader.read(); if(done) break;
      lengthRead+=value.byteLength;
      if(lengthRead>MAX_PHOTO_BYTES) { await reader.cancel(); fail(413,'Photo must be 256 KiB or smaller.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks,lengthRead);
}
export async function profilePhotoKey(kind,email,account) {
  // Generation prevents a newly registered account inheriting an old email's photo.
  const generation=account?.profilePhotoId || (account?.createdAt ? new Date(account.createdAt).toISOString() : null);
  if(!generation) fail(409,'This account needs a stable profile identity before adding a photo.');
  return sha256Hex(JSON.stringify([kind,email.toLowerCase(),generation]));
}
// Parent calls inside its existing email-change transaction, before deleting old account.
export async function migrateProfilePhoto(db,{kind='customer',oldEmail,newEmail,account,session}) {
  if(!account?.createdAt&&!account?.profilePhotoId) return; // No photo identity has ever been initialized.
  const collection=db.collection(PHOTO_COLLECTION), options=session?{session}:{};
  const oldKey=await profilePhotoKey(kind,oldEmail,account), newKey=await profilePhotoKey(kind,newEmail,account);
  if(oldKey===newKey) return;
  const photo=await collection.findOne({_id:oldKey},options);
  if(!photo) return;
  await collection.insertOne({...photo,_id:newKey},options);
  await collection.deleteOne({_id:oldKey},options);
}
const headers = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
export async function profilePhotoHandler(context,kind) {
  const {request,env}=context;
  try {
    if(!['customer','operator'].includes(kind)) fail(400,'Invalid profile kind.');
    if(!['GET','PUT','DELETE'].includes(request.method)) return Response.json({error:'Method not allowed.'},{status:405,headers:{...headers,Allow:'GET, PUT, DELETE'}});
    if(request.method!=='GET'&&!sameOrigin(request)) fail(403,'Request origin is not allowed.');
    // Real session required even when API middleware accepts an admin key.
    const user=kind==='customer'?await readCustomerSession(request,env):await readSession(request,env);
    if(!user) fail(401,'Sign in required.');
    if(user.role!==kind) fail(403,'Demo accounts cannot use profile photos.');
    return await withDatabase(env,async db=>{
      const account=await db.collection(kind==='customer'?'customer_accounts':'operator_accounts').findOne({_id:user.email.toLowerCase()});
      const upload=request.method==='PUT'?await boundedBody(request):null;
      const meta=upload?validateProfilePhoto(upload,request.headers.get('Content-Type')):null;
      let identity=account || (kind==='operator'&&user.email.toLowerCase()===env.OPERATOR_EMAIL?.toLowerCase()?{salt:env.OPERATOR_PASSWORD_SALT}:null);
      if(!identity) fail(401,'Sign in required.');
      if(!identity.createdAt&&!identity.profilePhotoId) {
        if(request.method==='GET') fail(404,'No profile photo.');
        if(request.method==='DELETE') return new Response(null,{status:204,headers});
        const accounts=db.collection(kind==='customer'?'customer_accounts':'operator_accounts');
        // Existing bootstrap operator profiles may lack createdAt; persist a stable generation.
        await accounts.updateOne({_id:user.email.toLowerCase()},{$setOnInsert:{profilePhotoId:crypto.randomUUID()}},{upsert:true});
        await accounts.updateOne({_id:user.email.toLowerCase(),profilePhotoId:{$exists:false}},{$set:{profilePhotoId:crypto.randomUUID()}});
        identity=await accounts.findOne({_id:user.email.toLowerCase()});
      }
      const _id=await profilePhotoKey(kind,user.email,identity), collection=db.collection(PHOTO_COLLECTION);
      if(request.method==='GET') {
        const photo=await collection.findOne({_id}); if(!photo) fail(404,'No profile photo.');
        const bytes=photo.bytes instanceof Binary?photo.bytes.value():photo.bytes;
        const checked=validateProfilePhoto(bytes,photo.contentType);
        return new Response(bytes,{headers:{...headers,'Content-Type':checked.contentType,'Content-Disposition':'inline; filename="profile-photo"'}});
      }
      if(request.method==='DELETE') {await collection.deleteOne({_id});return new Response(null,{status:204,headers});}
      await collection.updateOne({_id},{$set:{...meta,bytes:new Binary(upload),updatedAt:new Date()}},{upsert:true});
      return Response.json({saved:true,width:meta.width,height:meta.height},{headers});
    });
  } catch(error) {return Response.json({error:error.status?error.message:'Profile photo is unavailable.'},{status:error.status||503,headers});}
}
