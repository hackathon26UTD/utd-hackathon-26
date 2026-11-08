import { readSession,issueSession,passwordHash,equal,sessionCookie,sameOrigin } from '../../src/operator-session.js';
import { withDatabase } from '../../lib/mongodb.js';
const reply=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
export async function onRequest({request,env}){
  if(request.method==='GET'){const user=await readSession(request,env);return reply(user?{authenticated:true,email:user.email,role:user.role}:{authenticated:false},user?200:401);}
  if(!sameOrigin(request))return reply({error:'This request must come from HomeBeacon.'},403);
  if(request.method==='DELETE')return reply({authenticated:false},200,{'Set-Cookie':sessionCookie('',0)});
  if(request.method!=='POST')return reply({error:'Method not allowed.'},405);
  if(!env.SESSION_SECRET||!env.MONGODB_URI||!env.MONGODB_DB)return reply({error:'Operator sign-in is not configured yet.'},503);
  if(Number(request.headers.get('content-length')||0)>4096)return reply({error:'Request is too large.'},413);
  let body;try{const text=await request.text();if(text.length>4096)return reply({error:'Request is too large.'},413);body=JSON.parse(text);}catch{return reply({error:'Enter your email and password.'},400);}
  if(typeof body.email!=='string'||typeof body.password!=='string'||body.password.length>512)return reply({error:'Enter your email and password.'},400);
  try {
    const ip=request.headers.get('CF-Connecting-IP')||'local';
    const rateKey=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip+env.SESSION_SECRET)))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const allowed=await withDatabase(env,async db=>{const coll=db.collection('login_attempts');const window=new Date(Date.now()-900000);await coll.deleteMany({key:rateKey,at:{$lt:window}});if(await coll.countDocuments({key:rateKey,at:{$gte:window}})>=8)return false;await coll.insertOne({key:rateKey,at:new Date()});return true;});
    if(!allowed)return reply({error:'Too many attempts. Try again in 15 minutes.'},429,{'Retry-After':'900'});
    const email=body.email.trim().toLowerCase();
    const account=await withDatabase(env,db=>db.collection('operator_accounts').findOne({_id:email}));
    const isLegacyOperator=email===env.OPERATOR_EMAIL?.toLowerCase();
    const isOperator=account?.role==='operator'||(isLegacyOperator&&!account?.role);
    const isDemo=account?.role==='demo';
    const salt=account?.salt||(isLegacyOperator?env.OPERATOR_PASSWORD_SALT:'invalid')||'invalid';
    const hash=await passwordHash(body.password,salt);
    if(account?.disabled===true||(!isOperator&&!isDemo)||!equal(hash,account?.hash||(isLegacyOperator?env.OPERATOR_PASSWORD_HASH:'')))return reply({error:'Email or password is incorrect.'},401);
    const token=await issueSession(env,email,isDemo?'demo':'operator',{accountBacked:account?.role==='operator'||isDemo});
    return reply({authenticated:true},200,{'Set-Cookie':sessionCookie(token)});
  }catch{return reply({error:'Sign-in is temporarily unavailable. Try again shortly.'},503);}
}
