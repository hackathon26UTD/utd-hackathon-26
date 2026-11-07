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
export async function issueSession(env,email,role='operator') {
  const payload=b64(encoder.encode(JSON.stringify({email,iat:Date.now(),exp:Math.floor(Date.now()/1000)+28800,role})));
  const sig=b64(await crypto.subtle.sign('HMAC',await signingKey(env.SESSION_SECRET),encoder.encode(payload)));
  return payload+'.'+sig;
}
export async function readSession(request,env) {
  if(!env.SESSION_SECRET)return null;
  const token=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token)return null;
  try {const [payload,sig,...rest]=token.split('.');if(rest.length||!payload||!sig)return null;const okay=await crypto.subtle.verify('HMAC',await signingKey(env.SESSION_SECRET),unb64(sig),encoder.encode(payload));if(!okay)return null;const data=JSON.parse(new TextDecoder().decode(unb64(payload)));if(!(data.exp>Date.now()/1000 && ['operator','demo'].includes(data.role)))return null;if(env.MONGODB_URI){const account=await withDatabase(env,db=>db.collection('operator_accounts').findOne({_id:data.email}));if(account?.passwordChangedAt && (!data.iat||data.iat<new Date(account.passwordChangedAt).getTime()))return null;}return data;} catch {return null;}
}
export function sessionCookie(token,maxAge=28800){return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;}
export function sameOrigin(request){return request.headers.get('Origin')===new URL(request.url).origin;}
