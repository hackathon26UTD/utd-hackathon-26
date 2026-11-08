import {api} from './api.js';
import {ageText} from './core.js';
import {inConus} from './geo.js';
import {geometryBbox} from '../../src/feed-geo.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const delayed=data=>data?.hb?.stale||data?.hb?.refreshStatus==='error';
const unexpired=rows=>rows.filter(f=>{const ts=[f.properties?.ends,f.properties?.expires].map(Date.parse).filter(Number.isFinite);return ts.length&&Math.min(...ts)>Date.now();});
const EMPTY={type:'FeatureCollection',features:[]};
export function mountNews(ctx,root){
 const {mv,S}=ctx;let national=null,local=null,scope='national',limit=60,busy=false,localToken=0,timer,moveTimer,stopped=false,error='';
 const toolbar=el('div','','news-tools'),status=el('p','Loading official alerts…','news-status'),list=el('div','','news-list'),more=el('button','Show more');
 status.setAttribute('role','status');more.type='button';
 const scopeControl=window.Kit.toolbarDropdown({id:'news-scope',ariaLabel:'News area',options:[{value:'national',label:'United States'},{value:'local',label:'This map area'}],value:scope,onChange:value=>{scope=value;limit=60;render();if(value==='local')refreshLocal();}});
 const refresh=el('button','Refresh');refresh.type='button';refresh.onclick=()=>{refreshAll();refreshLocal();};
 toolbar.append(scopeControl,refresh);root.append(toolbar,status,list,more);more.onclick=()=>{limit+=60;render();};
 const nearby=el('button','','local-alerts');nearby.type='button';nearby.hidden=true;document.querySelector('.map-wrap').append(nearby);
 nearby.onclick=()=>{scope='local';scopeControl.kitSet(scope);render();ctx.openWorkspace('news');};
 function render(){
  const data=scope==='national'?national:local,rows=unexpired(data?.features||[]);
  status.textContent=error||(scope==='local'&&mv.zoom<7?'Zoom into an area to see its alerts.':!data?'Loading official alerts…':`${rows.length} active alerts · ${data.hb?.fetchedAt?'Updated '+ageText(data.hb.fetchedAt):'Update time unavailable'}${delayed(data)?' · Saved data, refresh delayed':''}${data.hb?.truncated?' · Coverage incomplete':''}`);
  const active=document.activeElement?.dataset.newsId,expanded=new Set([...list.querySelectorAll('details[open]')].map(n=>n.dataset.alert));list.replaceChildren();
  for(const f of rows.slice(0,limit)){
   const p=f.properties||{},card=el('article','','news-card');card.dataset.severity=p.severity||'Unknown';
   card.append(el('h3',p.event||'Weather alert'),el('p',p.areaDesc||'Area not supplied','news-area'));
   const times=el('p',`Issued ${p.sent?new Date(p.sent).toLocaleString():'time unknown'} · Until ${p.expires?new Date(p.expires).toLocaleString():'time unknown'}`,'news-time');card.append(times);
   if(p.boundaryUnavailable)card.append(el('p','Area boundary unavailable. This may affect the surrounding state.','news-time'));
   const actions=el('div','','news-actions'),show=el('button','Show on map');show.type='button';show.dataset.newsId=f.id;show.onclick=()=>showAlert(f,show);actions.append(show);
   const details=el('details');details.dataset.alert=f.id;details.open=expanded.has(f.id);const summary=el('summary','Details');details.append(summary,el('p',p.headline||''),el('p',p.description||'No additional description.'));
   if(/^https:\/\/api\.weather\.gov\/alerts\//.test(p.sourceUrl||'')){const source=el('a','Read NWS source');source.href=p.sourceUrl;source.target='_blank';source.rel='noopener noreferrer';details.append(source);}
   card.append(actions,details);list.append(card);
  }
  if(data&&!rows.length)list.append(el('p',delayed(data)||data.hb?.truncated?'Coverage is incomplete. Check the source for updates.':'No active alerts returned for this view.','news-empty'));
  more.hidden=rows.length<=limit;
  if(active)[...list.querySelectorAll('[data-news-id]')].find(n=>n.dataset.newsId===active)?.focus({preventScroll:true});
 }
 async function showAlert(feature,button){
  button.disabled=true;let f=feature;
  try{
   if(!f.geometry){const r=await api('/api/public/news?alert='+encodeURIComponent(f.id));if(r.ok)f=r.data.features.find(row=>row.id===f.id)||f;}
   const box=geometryBbox(f.geometry);if(!box){button.textContent='Boundary unavailable';return;}
   if(!inConus((box[1]+box[3])/2,(box[0]+box[2])/2)){button.textContent='Outside mainland map';return;}
   await ctx.closeWorkspace({focus:false});mv.setExt('publicAlerts',{type:'FeatureCollection',features:[f]});mv.setVisible('publicAlerts',true);mv.fitTo(box,{maxZoom:11});
  }finally{button.disabled=false;}
 }
 async function refreshAll(){
  if(busy||stopped)return;busy=true;refresh.disabled=true;
  const r=await api('/api/public/news');busy=false;refresh.disabled=false;
  if(stopped)return;
  if(r.ok){national=r.data;error='';}else error='Official alerts unavailable.'+(national?' Showing the last received update.':' Try again shortly.');
  render();
 }
 async function refreshLocal(){
  const token=++localToken,box=mv.apiBbox();
  if(stopped||mv.zoom<7||!box||Math.max(box[2]-box[0],box[3]-box[1])>8){local=null;mv.setExt('publicAlerts',EMPTY);nearby.hidden=true;if(scope==='local')render();return;}
  const r=await api('/api/public/news?bbox='+box.map(v=>v.toFixed(3)).join(','));
  if(stopped||token!==localToken)return;
  nearby.hidden=false;
  if(!r.ok){mv.setExt('publicAlerts',EMPTY);local=null;nearby.textContent='Live weather unavailable';if(scope==='local'){render();status.textContent='Live alerts unavailable for this map area.';}return;}
  local={...r.data,features:unexpired(r.data.features)};mv.setExt('publicAlerts',local);mv.setVisible('publicAlerts',true);
  nearby.textContent=`Live weather · ${local.features.length} alerts${delayed(local)?' · delayed':''}${local.hb?.truncated?' · partial coverage':''}${ctx.demo?' · homes simulated':''}`;
  if(scope==='local')render();
 }
 const move=()=>{clearTimeout(moveTimer);localToken++;mv.setExt('publicAlerts',EMPTY);nearby.hidden=true;moveTimer=setTimeout(refreshLocal,650);};
 const visible=()=>{if(!document.hidden){refreshAll();refreshLocal();}};
 const controls={refresh:()=>{refreshAll();if(scope==='local')refreshLocal();},start(){refreshAll();refreshLocal();mv.map.on('moveend',move);document.addEventListener('visibilitychange',visible);timer=setInterval(()=>{if(!document.hidden){refreshAll();refreshLocal();}},60000);},destroy(){stopped=true;localToken++;clearTimeout(moveTimer);clearInterval(timer);mv.map.off('moveend',move);document.removeEventListener('visibilitychange',visible);nearby.remove();}};
 mv.map.once('remove',()=>controls.destroy());return controls;
}
