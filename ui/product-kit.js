// Uses the owner's real vendored kit; only layout/token glue lives here.
import './kit/runtime.js';
const selects=new WeakMap();
function labelFor(control){const explicit=control.getAttribute('aria-label');if(explicit)return explicit;const label=control.labels?.[0];if(!label)return control.name||control.id||'Choose an option';const copy=label.cloneNode(true);copy.querySelectorAll('input,select,textarea,button,.kit-select').forEach(n=>n.remove());return copy.textContent.trim()||control.name||'Choose an option';}
function dress(root){
 const K=window.Kit;
 root.querySelectorAll('dialog,.consent').forEach(n=>n.classList.add('kit','hb-dialog'));
 root.querySelectorAll('button,a.button,a.mb').forEach(n=>{if(n.className.includes('kit-')||n.closest('.maplibregl-ctrl')||n.classList.contains('property'))return;n.classList.add('kit-btn');if(n.classList.contains('primary')||n.classList.contains('mb-primary'))n.classList.add('kit-btn--primary');});
 root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea').forEach(n=>n.classList.add('kit-text-box'));
 root.querySelectorAll('.tag,.status-tag,.live-pill').forEach(n=>{n.classList.add('kit-pill');const tone=n.classList.contains('critical')?'bad':n.classList.contains('watch')||n.classList.contains('elevated')?'warn':n.classList.contains('normal')?'ok':'mut';for(const t of ['bad','warn','ok','mut'])n.classList.toggle('kit-pill--'+t,t===tone);});
 root.querySelectorAll('[role=tablist]').forEach(n=>{n.classList.add('kit-sub-tabs');const tabs=[...n.querySelectorAll('[role=tab]')];tabs.forEach(t=>t.tabIndex=t.getAttribute('aria-selected')==='true'?0:-1);if(!n.dataset.hbKeys){n.dataset.hbKeys='1';n.addEventListener('keydown',e=>{const all=[...n.querySelectorAll('[role=tab]')];const i=all.indexOf(document.activeElement);if(i<0)return;const next=e.key==='ArrowRight'?(i+1)%all.length:e.key==='ArrowLeft'?(i+all.length-1)%all.length:e.key==='Home'?0:e.key==='End'?all.length-1:null;if(next===null)return;e.preventDefault();all[next].focus();all[next].click();});}});
 root.querySelectorAll('select').forEach(n=>{
  const signature=JSON.stringify([...n.options].map(o=>[o.value,o.textContent,o.disabled]));let entry=selects.get(n);
  if(entry&&entry.signature===signature){if(entry.widget.kitValue()!==n.value)entry.widget.kitSet(n.value);entry.widget.querySelector('button').disabled=n.disabled;return;}
  entry?.widget.remove();
  const widget=K.select({id:(n.id||n.name||'choice')+'-kit',value:n.value,options:[...n.options].filter(o=>!o.disabled).map(o=>({value:o.value,label:o.textContent})),onChange:value=>{n.value=value;n.dispatchEvent(new Event('change',{bubbles:true}));}});
  widget.dataset.productControl='select';const trigger=widget.querySelector('button');trigger.setAttribute('aria-label',labelFor(n));trigger.disabled=n.disabled;
  n.hidden=true;n.tabIndex=-1;n.after(widget);selects.set(n,{widget,signature});
  n.addEventListener('change',()=>widget.kitSet(n.value));
 });
}
export function startProductKit(){
 document.body.classList.add('kit-body','hb-product');
 for(const id of ['app','customer'])document.getElementById(id)?.classList.add('kit');
 const options={childList:true,subtree:true};
 const pending=new Set();let scheduled=false;
 const refresh=(root=document.body)=>{pending.add(root);if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{
  scheduled=false;observer.disconnect();
  const roots=[...pending].filter(n=>n.isConnected);pending.clear();
  roots.filter(n=>!roots.some(other=>other!==n&&other.contains(n))).forEach(dress);
  observer.observe(document.body,options);
 });};
 const observer=new MutationObserver(records=>{
  for(const record of records){
   const target=record.target;
   if(!(target instanceof Element)||target.closest('.maplibregl-map,.kit-select'))continue;
   if([...record.addedNodes].some(n=>n.nodeType===1)||target.matches('select'))refresh(target);
  }
 });observer.observe(document.body,options);refresh();
 const top=document.createElement('button');top.className='kit-btn hb-theme-toggle';top.type='button';top.setAttribute('aria-label','Switch color theme');top.textContent='◐';top.onclick=()=>window.HomeBeaconKit.toggleTheme();document.body.append(top);
 return {refresh,stop:()=>observer.disconnect()};
}
