import {brandNode} from './brand.js';
const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child.nodeType ? child : String(child));
  return node;
};

export function accessView({mode = 'signup', onCustomer, navigate = url => location.assign(url)} = {}) {
  const wrap = h('section', {class:'account-entry', 'aria-label':'Safe Home account'});
  const title = h('h1'), intro = h('p', {class:'account-intro'});
  const status = h('p', {class:'error',role:'status','aria-live':'polite'});
  const form = h('form', {'aria-label':'Account details'});
  const input = (label, name, type, autocomplete, max) => {
    const control = h('input', {name,type,autocomplete,maxlength:max,required:true});
    return {control, label:h('label', {}, label, control)};
  };
  const name = input('Your name','contactName','text','name',60);
  const email = input('Email','email','email','username',254);
  const password = input('Password','password','password','current-password',512);
  const termsInput = h('input', {type:'checkbox',name:'acceptTerms'});
  const terms = h('label',{class:'account-check'},termsInput,h('span',{},'I agree to the ',h('a',{href:'/terms',target:'_blank',rel:'noopener'},'terms'),' and have read the ',h('a',{href:'/privacy',target:'_blank',rel:'noopener'},'privacy policy'),'.'));
  const submit = h('button',{class:'primary',type:'submit'});
  const tabs = h('div',{class:'kit-sub-tabs',role:'tablist','aria-label':'Account access'});
  const tabButtons = ['signup','login'].map(value => h('button',{type:'button',class:'kit-sub-tabs__tab',role:'tab','aria-controls':'account-fields',onclick:()=>setMode(value)},value==='signup'?'Sign up':'Sign in'));
  tabs.append(...tabButtons);
  const fields = h('div',{id:'account-fields',role:'tabpanel'},name.label,email.label,password.label,terms,submit,status);
  form.append(fields);
  const help = h('p',{class:'account-note'});
  const forgot = h('a',{href:'/reset-password',class:'account-recovery'},'Operator password recovery');
  wrap.append(title,intro,tabs,form,help,forgot);
  function setMode(next) {
    mode=next;const signup=mode==='signup';
    title.textContent=signup?'Your home, connected.':'Welcome back.';
    intro.textContent=signup?'Create an account, then add your box.':'Use your email and password. We’ll open your dashboard.';
    tabButtons.forEach((button,i)=>{const selected=(i===0)===signup;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
    name.label.hidden=!signup;name.control.disabled=!signup;terms.hidden=!signup;termsInput.required=signup;termsInput.disabled=!signup;
    password.control.autocomplete=signup?'new-password':'current-password';password.control.minLength=signup?10:1;
    submit.textContent=signup?'Create account':'Open dashboard';status.textContent='';
    help.textContent=signup?'Already on the response team? Sign in with your team account.':'Customer and operator accounts use this same sign-in.';
    forgot.hidden=signup;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();submit.disabled=true;tabButtons.forEach(b=>b.disabled=true);status.textContent='';
    try {
      const data=Object.fromEntries(new FormData(form));
      const response=await fetch('/api/access',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,action:mode,acceptTerms:termsInput.checked,next:new URLSearchParams(location.search).get('next')})});
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'Could not sign in. Try again.');
      form.reset();
      if(result.role==='customer'&&onCustomer)await onCustomer();
      else navigate(result.destination);
    } catch(error){status.textContent=error.message || 'Could not connect. Try again.';}
    finally{submit.disabled=false;tabButtons.forEach(b=>b.disabled=false);}
  });
  setMode(mode);return wrap;
}

export async function mountAccess(root, {mode='signup',switchAccount=false}={}) {
  const brand=h('a',{class:'access-brand',href:'/'},brandNode());
  const main=h('main',{id:'main',class:'account-page'},brand,h('p',{role:'status'},'Opening your dashboard…'));
  root.replaceChildren(main);
  try{
    const response=await fetch('/api/access',{credentials:'same-origin'});
    if(response.ok&&!switchAccount){const result=await response.json();if(result.authenticated){location.replace(result.destination);return;}}
  }catch{/* An explicit form lets the user retry without a redirect loop. */}
  main.replaceChildren(brand,accessView({mode}),h('a',{href:'/simulations',class:'account-simulation'},'Explore simulations'));
}
