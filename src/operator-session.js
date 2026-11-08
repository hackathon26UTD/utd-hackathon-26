import { withDatabase } from '../lib/mongodb.js';
import { HttpError } from './http.js';
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
const AUTH_FIELDS = ['sessionGeneration','createdAt','salt','hash','passwordChangedAt','role','disabled','recoveryHash'];
const changedAccount = () => new HttpError(401, 'Account changed. Sign in again.');
export function credentialSnapshotFilter(account) {
  if (!account || typeof account._id !== 'string') throw changedAccount();
  const filter = {_id: account._id};
  for (const key of AUTH_FIELDS) filter[key] = account[key] === undefined ? {$exists:false} : {$eq:account[key]};
  return filter;
}
// Capture a generation BEFORE checking a password/code. The returned record is the
// only snapshot a verified flow may pass to issuance; signing never reloads by email.
export async function authenticationAccount(db, kind, email) {
  return db.collection(kind==='customer'?'customer_accounts':'operator_accounts').findOneAndUpdate(
    {_id:email}, [{$set:{sessionGeneration:{$ifNull:['$sessionGeneration',{$literal:crypto.randomUUID()}]}}}],
    {returnDocument:'after'},
  );
}
export function legacyOperatorSnapshot(env) {
  return {email:env.OPERATOR_EMAIL?.toLowerCase(),salt:env.OPERATOR_PASSWORD_SALT,hash:env.OPERATOR_PASSWORD_HASH};
}
async function credentialBinding(account,kind,env) {
  const legacy=kind==='operator'&&account._id===env.OPERATOR_EMAIL?.toLowerCase();
  const values=AUTH_FIELDS.map(key=>account[key]??null);
  // Effective environment credentials are part of legacy authentication, even with a DB profile.
  if(legacy) values.push(account.salt||env.OPERATOR_PASSWORD_SALT||null,account.hash||env.OPERATOR_PASSWORD_HASH||null);
  return b64(await crypto.subtle.sign('HMAC',await signingKey(env.SESSION_SECRET),encoder.encode('homebeacon:credential-binding:v1:'+JSON.stringify(values))));
}
async function issueBinding(env,email,kind,options) {
  if(!env.MONGODB_URI&&!options.db) return {}; // Existing signature-only test helpers have no DB authority.
  if(!Object.hasOwn(options,'verifiedAccount')) throw changedAccount();
  const verified=options.verifiedAccount;
  if(verified && (verified._id!==email || verified.disabled===true || !verified.sessionGeneration)) throw changedAccount();
  const legacy=options.verifiedLegacy;
  const needsLegacy=kind==='operator'&&(!verified||!verified.hash||!verified.salt);
  const checkLegacy=()=>{if(needsLegacy){
    const current=legacyOperatorSnapshot(env);
    if(!legacy || legacy.email!==email || current.email!==legacy.email || current.salt!==legacy.salt || current.hash!==legacy.hash) throw changedAccount();
  }};
  checkLegacy();
  const run=options.db?fn=>fn(options.db):fn=>withDatabase(env,fn);
  return run(async db=>{
    const accounts=db.collection(kind==='customer'?'customer_accounts':'operator_accounts');
    let bound;
    if(!verified) {
      if(kind!=='operator'||!needsLegacy) throw changedAccount();
      // Only the verified absence is accepted. A concurrent insert must fail, not be adopted.
      bound={_id:email,sessionGeneration:crypto.randomUUID()};
      try {await accounts.insertOne(bound);} catch(error) {if(error.code===11000)throw changedAccount();throw error;}
    } else {
      // Always guard, including accounts that already have a generation.
      bound=await accounts.findOneAndUpdate(credentialSnapshotFilter(verified),
        {$set:{sessionGeneration:verified.sessionGeneration}},{returnDocument:'after'});
      if(!bound) throw changedAccount();
    }
    checkLegacy();
    return {accountGeneration:bound.sessionGeneration,credentialBinding:await credentialBinding(bound,kind,env)};
  });
}
export async function sessionMatchesAccount(data, account, kind, {requireGeneration = false, env = {}} = {}) {
  if (!account || account.disabled === true || !Number.isFinite(data.iat) || !(data.exp > Date.now()/1000)) return false;
  if (account._id !== data.email.toLowerCase()) return false;
  if (account.createdAt && data.iat < new Date(account.createdAt).getTime()) return false;
  if (account.passwordChangedAt && data.iat < new Date(account.passwordChangedAt).getTime()) return false;
  if (kind === 'operator' && ((data.accountBacked && account.role !== data.role) || (account.role && account.role !== data.role))) return false;
  if (requireGeneration || data.accountGeneration || account.sessionGeneration) {
    if (typeof data.accountGeneration !== 'string' || !data.accountGeneration || data.accountGeneration !== account.sessionGeneration) return false;
    if (!equal(data.credentialBinding,await credentialBinding(account,kind,env))) return false;
  }
  return true;
}
export async function issueSession(env,email,role='operator',options={}) {
  const {accountBacked=false}=options, iat=Date.now();
  const binding = await issueBinding(env, email, 'operator',options);
  const payload=b64(encoder.encode(JSON.stringify({email,iat,exp:Math.floor(iat/1000)+28800,role,...(accountBacked?{accountBacked:true}:{}),...binding})));
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
      if (account ? !await sessionMatchesAccount(data, account, 'operator', {requireGeneration:true,env}) : (data.accountBacked || data.accountGeneration)) return null;
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
export async function issueCustomerSession(env,email,options={}) {
  const iat=Date.now(), binding = await issueBinding(env, email, 'customer',options);
  const payload=b64(encoder.encode(JSON.stringify({email,iat,exp:Math.floor(iat/1000)+28800,role:'customer',...binding})));
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
      return sessionMatchesAccount(data,account,'customer',{requireGeneration:Boolean(env.MONGODB_URI),env});};
    if(db)return await check(db)?data:null;
    if(env.MONGODB_URI)return await withDatabase(env,check)?data:null;
    return data;} catch {return null;}
}
export function customerCookie(token,maxAge=28800){return `${CUSTOMER_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;}
