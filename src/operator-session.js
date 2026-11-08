import { withDatabase } from '../lib/mongodb.js';
const encoder = new TextEncoder();
export const COOKIE = '__Host-homebeacon_session';
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function signingKey(secret) { return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']); }
export async function passwordHash(password,salt) {
  const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},material,256));
}
export function equal(a,b) {if(typeof a!=='string'||typeof b!=='string')return false;let x=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)x|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return x===0;}
// Persisted random generation distinguishes accounts even when email/timestamps are reused.
// Only trusted session issuance initializes it; reads never bind an old cookie to a new row.
async function issueGeneration(env, email, kind) {
  if (!env.MONGODB_URI) return undefined; // Signature-only environments have no account authority.
  return withDatabase(env, async db => {
    const accounts = db.collection(kind === 'customer' ? 'customer_accounts' : 'operator_accounts');
    const account = await accounts.findOne({_id: email});
    if (!account) {
      if (kind !== 'operator' || email !== env.OPERATOR_EMAIL?.toLowerCase()) return undefined;
      // Materialize the configured legacy operator so deletion revokes its cookies too.
      const created = await accounts.findOneAndUpdate({_id: email}, {$setOnInsert: {
        sessionGeneration: crypto.randomUUID(),
      }}, {upsert: true, returnDocument: 'after'});
      return created.sessionGeneration;
    }
    if (account.sessionGeneration) return account.sessionGeneration;
    // Match the observed credential/lifecycle snapshot, not just its reusable email.
    const filter = {_id: email};
    for (const key of ['createdAt', 'salt', 'hash', 'passwordChangedAt', 'role', 'disabled']) {
      filter[key] = account[key] === undefined ? {$exists: false} : account[key];
    }
    const bound = await accounts.findOneAndUpdate(filter, [{$set: {
      sessionGeneration: {$ifNull: ['$sessionGeneration', {$literal: crypto.randomUUID()}]},
    }}], {returnDocument: 'after'});
    if (!bound) throw new Error('Account changed during sign-in.');
    return bound.sessionGeneration;
  });
}
export function sessionMatchesAccount(data, account, kind, {requireGeneration = false} = {}) {
  if (!account || account.disabled === true || !Number.isFinite(data.iat) || !(data.exp > Date.now()/1000)) return false;
  if (account._id !== data.email.toLowerCase()) return false;
  if (account.createdAt && data.iat < new Date(account.createdAt).getTime()) return false;
  if (account.passwordChangedAt && data.iat < new Date(account.passwordChangedAt).getTime()) return false;
  if (kind === 'operator' && ((data.accountBacked && account.role !== data.role) || (account.role && account.role !== data.role))) return false;
  if (requireGeneration || data.accountGeneration || account.sessionGeneration) {
    if (typeof data.accountGeneration !== 'string' || !data.accountGeneration || data.accountGeneration !== account.sessionGeneration) return false;
  }
  return true;
}
export async function issueSession(env,email,role='operator',{accountBacked=false}={}) {
  const accountGeneration = await issueGeneration(env, email, 'operator');
  const payload=b64(encoder.encode(JSON.stringify({email,iat:Date.now(),exp:Math.floor(Date.now()/1000)+28800,role,...(accountBacked?{accountBacked:true}:{}),...(accountGeneration?{accountGeneration}:{})})));
  const sig=b64(await crypto.subtle.sign('HMAC',await signingKey(env.SESSION_SECRET),encoder.encode(payload)));
  return payload+'.'+sig;
}
export async function readSession(request,env) {
  if(!env.SESSION_SECRET)return null;
  const token=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token)return null;
  try {
    const [payload,sig,...rest]=token.split('.');
    if(rest.length||!payload||!sig)return null;
    const okay=await crypto.subtle.verify('HMAC',await signingKey(env.SESSION_SECRET),unb64(sig),encoder.encode(payload));
    if(!okay)return null;
    const data=JSON.parse(new TextDecoder().decode(unb64(payload)));
    if(!(data.exp>Date.now()/1000&&typeof data.email==='string'&&['operator','demo'].includes(data.role)))return null;
    if(data.accountBacked&&!env.MONGODB_URI)return null;
    if(env.MONGODB_URI){
      const account=await withDatabase(env,db=>db.collection('operator_accounts').findOne({_id:data.email}));
      if (account ? !sessionMatchesAccount(data, account, 'operator', {requireGeneration:true}) : (data.accountBacked || data.accountGeneration)) return null;
    }
    return data;
  } catch {return null;}
}
export function sessionCookie(token,maxAge=28800){return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;}
export function sameOrigin(request){return request.headers.get('Origin')===new URL(request.url).origin;}
// Customer sessions: separate cookie, separate derived signing key, role strictly "customer".
// A customer token never verifies as an operator token and the reverse, and readSession() above
// still accepts only operator or demo.
export const CUSTOMER_COOKIE = '__Host-homebeacon_customer';
async function customerKey(secret) {
  const root=await signingKey(secret);
  const derived=await crypto.subtle.sign('HMAC',root,encoder.encode('homebeacon:customer-session:v1'));
  return crypto.subtle.importKey('raw',derived,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function issueCustomerSession(env,email) {
  const accountGeneration = await issueGeneration(env, email, 'customer');
  const payload=b64(encoder.encode(JSON.stringify({email,iat:Date.now(),exp:Math.floor(Date.now()/1000)+28800,role:'customer',...(accountGeneration?{accountGeneration}:{})})));
  const sig=b64(await crypto.subtle.sign('HMAC',await customerKey(env.SESSION_SECRET),encoder.encode(payload)));
  return payload+'.'+sig;
}
// `db` is optional: when given it is used for the password-change revocation check instead of opening a second connection.
export async function readCustomerSession(request,env,db) {
  if(!env.SESSION_SECRET)return null;
  const token=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(CUSTOMER_COOKIE+'='))?.slice(CUSTOMER_COOKIE.length+1);
  if(!token)return null;
  try {const [payload,sig,...rest]=token.split('.');if(rest.length||!payload||!sig)return null;const okay=await crypto.subtle.verify('HMAC',await customerKey(env.SESSION_SECRET),unb64(sig),encoder.encode(payload));if(!okay)return null;const data=JSON.parse(new TextDecoder().decode(unb64(payload)));if(!(data.exp>Date.now()/1000&&data.role==='customer'&&typeof data.email==='string'))return null;
    const check=async d=>{const account=await d.collection('customer_accounts').findOne({_id:data.email});
      // Preserve PR37's creation-time revocation in addition to immutable generation binding.
      if(!account||!data.iat||(account.createdAt&&data.iat<new Date(account.createdAt).getTime()))return false;
      return sessionMatchesAccount(data,account,'customer',{requireGeneration:Boolean(env.MONGODB_URI)});};
    if(db)return await check(db)?data:null;
    if(env.MONGODB_URI)return await withDatabase(env,check)?data:null;
    return data;} catch {return null;}
}
export function customerCookie(token,maxAge=28800){return `${CUSTOMER_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;}
