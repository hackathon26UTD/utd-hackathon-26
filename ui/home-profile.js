// Public navigation uses the existing account/photo endpoints; no account data is stored here.
export function mountHomeProfile(root) {
  const menu=root.querySelector('#home-profile'), image=root.querySelector('#home-avatar');
  const link=root.querySelector('#home-profile-link'), choices=[...root.querySelectorAll('[data-avatar]')];
  const key='homebeacon-default-avatar';
  let photo=false, objectUrl=null, selected='01';
  try {const saved=localStorage.getItem(key);if(choices.some(b=>b.dataset.avatar===saved))selected=saved;} catch { /* optional preference */ }
  function paint(){
    if(!photo)image.src=`/assets/avatars/face-${selected}.svg`;
    choices.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.avatar===selected)));
  }
  for(const button of choices)button.addEventListener('click',()=>{selected=button.dataset.avatar;try{localStorage.setItem(key,selected);}catch{}paint();});
  paint();
  document.addEventListener('click',event=>{
    if(menu.open&&!menu.contains(event.target)&&!event.target.closest('.kit-pop-out,.kit-select-pop,.kit-select-menu,[role=listbox]'))menu.open=false;
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!event.defaultPrevented&&menu.open){menu.open=false;menu.querySelector('summary').focus();}
  });
  (async()=>{
    try {
      let kind=null;
      const customer=await fetch('/api/customer/me',{credentials:'same-origin',cache:'no-store'});
      if(customer.ok&&(await customer.json()).authenticated)kind='customer';
      if(!kind){const operator=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});if(operator.ok&&(await operator.json()).authenticated)kind='operator';}
      if(!kind)return;
      link.href=kind==='customer'?'/customer#profile':'/profile';
      const response=await fetch(kind==='customer'?'/api/customer/photo':'/api/profile-photo',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok||!/^image\/(png|jpeg|webp)(;|$)/i.test(response.headers.get('content-type')||''))return;
      const blob=await response.blob();if(blob.size>256*1024)return;
      photo=true;objectUrl=URL.createObjectURL(blob);image.src=objectUrl;
    } catch { /* The local avatar and sign-in route work offline. */ }
  })();
  window.addEventListener('pagehide',event=>{if(objectUrl&&!event.persisted)URL.revokeObjectURL(objectUrl);},{once:true});
}
