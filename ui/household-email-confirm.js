// Tokens stay in this module's memory. They are never placed in storage or sent in a URL.
const match=/^#household-(email|stop)=([a-f\d]{64})$/.exec(location.hash);
const pending=match?{action:match[1]==='stop'?'unsubscribe':'confirm',token:match[2]}:null;
if(match)history.replaceState(null,'',location.pathname+location.search);
export function emailConfirmation({h,api}) {
  if(!pending||pending.done)return null;
  const status=h('p',{role:'status','aria-live':'polite'});
  const btn=h('button',{type:'button',class:'primary',onclick:async()=>{
    btn.disabled=true;
    const r=await api('/api/customer/household-email','POST',{action:pending.action,token:pending.token});
    status.textContent=r.ok?(pending.action==='unsubscribe'?'Household emails stopped.':'Email verified. Open household settings to choose updates.'):(r.status===401?'Sign in with the invited email, then choose Verify email again.':r.data.error||'This email link could not be used.');
    if(r.ok){pending.done=true;pending.token=null;btn.remove();document.dispatchEvent(new Event('household-email-updated'));}else btn.disabled=false;
  }},pending.action==='unsubscribe'?'Stop household emails':'Verify email');
  return h('section',{class:'card','aria-label':'Household email'},h('h2',null,pending.action==='unsubscribe'?'Stop email updates':'Confirm your email'),h('p',null,pending.action==='unsubscribe'?'This stops device and weather emails for this household.':'Sign in with the email that received this link, then confirm it here.'),btn,status);
}
