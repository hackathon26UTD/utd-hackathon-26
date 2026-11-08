import {allowsMotion} from '../display-settings.js';
// NOAA MRMS reflectivity frames are observations, never future rain predictions.
const BASE='https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';
export function radarFrames(xml){
 const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('Invalid radar metadata');
 const dimension=[...doc.getElementsByTagNameNS('*','Dimension')].find(d=>d.getAttribute('name')==='time');
 const all=[...new Set((dimension?.textContent||'').split(',').map(s=>s.trim()).filter(s=>/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(s)&&Number.isFinite(Date.parse(s))))].sort();
 if(!all.length)throw Error('Radar unavailable');const end=Date.parse(all.at(-1));return all.filter(s=>end-Date.parse(s)<=7200000).slice(-61);
}
export function mountRadar(mapView,root){
 const button=root.querySelector('#radar-toggle'),panel=root.querySelector('#radar-controls');if(!button||!panel)return;
 const slider=panel.querySelector('input'),play=panel.querySelector('[data-radar-play]'),latest=panel.querySelector('[data-radar-latest]'),label=panel.querySelector('output'),status=panel.querySelector('.radar-status');
 let frames=[],index=0,timer,active=false,playing=false,generation=0,drawToken=0,scrubTimer,refreshTimer;
 const time=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 const stop=()=>{playing=false;clearTimeout(timer);play.textContent='Play';play.setAttribute('aria-pressed','false');};
 function warm(){if(!active||!frames.length)return;for(const n of [1,2])mapView.prepareRadar(frames[(index+n)%frames.length]).catch(()=>false);}
 async function draw(){
  const token=++drawToken,target=index,stamp=frames[target];if(!stamp)return false;
  status.textContent='Loading frame…';const ready=await mapView.setRadar(stamp);if(!active||token!==drawToken)return false;
  if(!ready){status.textContent='Frame unavailable. Keeping the last image.';return false;}
  slider.value=String(target);slider.setAttribute('aria-valuetext',new Date(stamp).toLocaleString());label.textContent=time(stamp);
  status.textContent=Date.now()-Date.parse(frames.at(-1))>1200000?'Latest radar is delayed.':'';warm();return true;
 }
 function start(){
  stop();if(!active||document.hidden||!allowsMotion()||frames.length<2)return;playing=true;play.textContent='Pause';play.setAttribute('aria-pressed','true');
  const step=async()=>{if(!playing||!active||document.hidden)return;if(!allowsMotion()){stop();return;}index=(index+1)%frames.length;const ok=await draw();if(!ok){stop();return;}if(playing&&active)timer=setTimeout(step,650);};
  timer=setTimeout(step,900);
 }
 async function refresh(autoplay=false){
  const request=++generation;try{
   const response=await fetch(BASE+'?service=WMS&version=1.3.0&request=GetCapabilities',{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();
   const next=radarFrames(await response.text());if(!active||request!==generation)return;
   frames=next;index=frames.length-1;slider.max=String(index);slider.disabled=false;play.disabled=frames.length<2||!allowsMotion();
   panel.querySelector('[data-radar-start]').textContent=time(frames[0]);panel.querySelector('[data-radar-end]').textContent=time(frames.at(-1))+' · latest';
   if(await draw()&&autoplay)start();
  }catch{if(active&&request===generation){stop();status.textContent='NOAA radar unavailable. Toggle radar to retry.';}}
 }
 button.addEventListener('click',()=>{active=!active;button.setAttribute('aria-pressed',String(active));panel.hidden=!active;document.querySelector('.map-wrap')?.classList.toggle('radar-open',active);
  if(active){label.textContent='Loading…';refresh(true);}else{generation++;drawToken++;stop();clearTimeout(scrubTimer);mapView.setRadar(null);}});
 slider.step='1';slider.addEventListener('input',()=>{stop();clearTimeout(scrubTimer);index=Math.round(Number(slider.value));scrubTimer=setTimeout(draw,100);});
 play.onclick=()=>playing?stop():start();latest.onclick=()=>{stop();index=frames.length-1;draw();};
 const visibility=()=>{if(document.hidden)stop();};const motion=()=>{if(!allowsMotion())stop();play.disabled=!allowsMotion()||frames.length<2;};
 document.addEventListener('visibilitychange',visibility);document.addEventListener('homebeacon:motion',motion);
 refreshTimer=setInterval(()=>{if(active&&!playing&&!document.hidden&&index===frames.length-1)refresh();},300000);
 mapView.map.once('remove',()=>{active=false;generation++;drawToken++;stop();clearInterval(refreshTimer);clearTimeout(scrubTimer);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('homebeacon:motion',motion);});
}
