import {bodyText} from './customer-connect-common.js';

export const CUSTOMER_URL='https://utd-hackathon-26.pages.dev/customer';
export const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function emailConfigured(env) {
  return env.HOME_EMAIL_ENABLED==='true' && !!env.RESEND_API_KEY && !!env.RESEND_WEBHOOK_SECRET && !!env.SESSION_SECRET && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.HOME_EMAIL_FROM||'');
}
export function plainEmail(subject,paragraphs,links=[]) {
  return {subject:'HomeBeacon: '+subject,text:[...paragraphs,...links.map(l=>l.label+': '+l.url)].join('\n\n'),html:'<!doctype html><html lang="en"><meta charset="utf-8"><body style="margin:0;background:#f3f6f3;color:#192d26;font:16px/1.6 Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:28px;background:white;border-radius:16px"><p style="font-weight:bold;color:#146650">HomeBeacon</p><h1 style="font-size:24px">'+escapeHtml(subject)+'</h1>'+paragraphs.map(p=>'<p>'+escapeHtml(p)+'</p>').join('')+links.map(l=>'<p><a style="color:#146650" href="'+escapeHtml(l.url)+'">'+escapeHtml(l.label)+'</a></p>').join('')+'</main></body></html>'};
}
// The same immutable payload and key are retried only within Resend's 24-hour window.
// A successful API response means accepted by the provider, not received by a person.
export async function sendHouseholdEmail(env,{to,id,payload},{fetcher=fetch}={}) {
  if(!emailConfigured(env))return {status:'disabled'};
  try {
    const r=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'homebeacon/'+id},body:JSON.stringify({from:env.HOME_EMAIL_FROM,to:[to],...payload}),signal:AbortSignal.timeout(10000),redirect:'manual'});
    if(!r.ok)return {status:r.status===429||r.status>=500||r.status===409?'retry':'rejected',httpStatus:r.status};
    const body=JSON.parse(await bodyText(r,10000));
    return typeof body.id==='string'&&body.id.length<200?{status:'accepted',providerId:body.id}:{status:'retry'};
  } catch { return {status:'retry'}; }
}
