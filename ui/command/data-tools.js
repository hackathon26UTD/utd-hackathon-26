import {api} from './api.js';
const element=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export async function showDataTool(ctx,action,p){
 const body=element('div');body.className='data-tool-body';
 const title={location:'Registered location',stats:'Observed averages',response:'Responder message preview',settings:'Board message polling'}[action];
 const popup=window.Kit.popUpWindow({title,body,close:true});
 body.append(element('p','Loading registered data…'));
 const endpoint={location:'/api/ops/location?id=',stats:'/api/ops/sensor-stats?id=',response:'/api/ops/response-preview',settings:'/api/ops/device-settings?id='}[action];
 const r=await api(endpoint+(action==='response'?'':encodeURIComponent(p.id)),action==='response'?{method:'POST',body:{deviceId:p.id,service:'response liaison'}}:{});
 body.replaceChildren();
 if(!r.ok){body.append(element('p',r.error||'Registered data is unavailable.'));return;}
 const d=r.data;
 if(action==='settings'){body.append(element('p',d.note),element('p','Current state: '+d.status));const select=window.Kit.select({value:String(d.desired?.pollAfterSeconds||30),options:[10,15,30,60,120,300].map(n=>({value:String(n),label:n+' seconds'}))});select.querySelector('button').setAttribute('aria-label','Message polling interval');const save=element('button','Request polling interval');save.className='kit-btn';const status=element('p');status.setAttribute('role','status');save.onclick=async()=>{save.disabled=true;const out=await api(endpoint+encodeURIComponent(p.id),{method:'PATCH',body:{pollAfterSeconds:Number(select.kitValue())}});status.textContent=out.ok?'Requested. Waiting for the device to report it applied this revision.':out.error;save.disabled=false;};body.append(select,save,status);}
 if(action==='location'){
 const a=element('a','Open this registered location in Google Maps');a.href=d.mapsUrl;a.target='_blank';a.rel='noopener';body.append(a,element('p',d.note));
 if(d.googleImageConfigured){const img=element('img');img.alt='Google satellite map of the registered device location';img.src='/api/ops/location-image?id='+encodeURIComponent(p.id);img.width=600;img.height=360;img.style.maxWidth='100%';img.style.height='auto';img.onerror=()=>{img.replaceWith(element('p','Google imagery could not load. The location link remains available.'));};body.append(img);}else body.append(element('p','Google satellite images require the project’s Maps Static API key. No substitute image is presented as Google imagery.'));
 }
 if(action==='stats'){
 body.append(element('p',d.sampleCount+' recorded samples in the last '+d.window.days+' days.'),element('p',d.note));
 if(!d.sampleCount)body.append(element('p','No observations yet. Connect the board to start building history.'));
 else body.append(window.Kit.details({items:Object.values(d.metrics).filter(m=>m.count).map(m=>({label:m.label,value:Math.round(m.mean*100)/100+' '+m.unit,sub:m.count+' samples · range '+m.min+' to '+m.max}))}));
 }
 if(action==='response'){
 const pre=element('pre',d.message);pre.className='response-print';pre.style.whiteSpace='pre-wrap';body.append(element('p','Demonstration only. Nothing has been sent and no team has been dispatched.'),pre);
 const print=element('button','Print exact message');print.className='kit-btn';print.onclick=()=>{const sheet=document.createElement('section');sheet.className='response-print-sheet';sheet.append(element('h1','HomeBeacon responder preview'),element('pre',d.message));document.body.append(sheet);document.body.classList.add('printing-response');const clean=()=>{sheet.remove();document.body.classList.remove('printing-response');};window.addEventListener('afterprint',clean,{once:true});window.print();};body.append(print);
 }
}
