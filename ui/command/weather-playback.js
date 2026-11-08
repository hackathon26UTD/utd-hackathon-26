import {allowsMotion} from '../display-settings.js';
export function weatherFrame(data,index){
 const frame=data?.extra?.forecastFrames?.[index];if(!frame)return null;
 const byId=new Map(frame.readings.map(r=>[r.id,r]));
 return {type:'FeatureCollection',features:(data.features||[]).map(f=>{const r=byId.get(f.id);return {...f,properties:{...f.properties,wind_kph:r?.wind_kph??null,wind_direction:r?.wind_direction??null,rain_mm:r?.rain_mm??null,validAt:frame.validAt,...(index?{solar_wm2:null,uv_index:null,temperature_c:null}:{})}};})};
}
export function mountWeatherPlayback(ctx,root){
 const panel=document.createElement('section');panel.id='weather-controls';panel.className='radar-controls forecast-controls';panel.hidden=true;panel.setAttribute('aria-label','Weather forecast playback');
 panel.innerHTML='<div class="radar-heading"><strong>Weather forecast</strong><output aria-live="off"></output><button type="button" data-weather-now>First hour</button></div><div class="radar-track"><button type="button" data-weather-play aria-pressed="false">Play</button><input type="range" min="0" max="0" value="0" step="1" aria-label="Weather forecast time" disabled></div><div class="radar-ticks"><span data-weather-start></span><span data-weather-end></span></div><small>Open-Meteo · sampled forecast · device reports unchanged</small><p class="radar-status" role="status"></p>';
 root.append(panel);
 const slider=panel.querySelector('input'),play=panel.querySelector('[data-weather-play]'),label=panel.querySelector('output'),status=panel.querySelector('.radar-status');let data=null,index=0,view='street',timer=null,disposed=false;
 const enabled=()=>!ctx.embed&&['wind','rain'].includes(view);
 const stamp=t=>new Date(t).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'});
 const stop=()=>{clearInterval(timer);timer=null;play.textContent='Play';play.setAttribute('aria-pressed','false');};
 function draw(){
  if(!enabled()||disposed)return;
  const frame=weatherFrame(data,index);slider.disabled=!frame;play.disabled=!frame||!allowsMotion()||(data.extra.forecastFrames.length<2);
  status.textContent=!frame?'Forecast hours unavailable.':ctx.S.ov?.atmosphere?.error||data.hb?.stale?'Saved forecast · update delayed.':data.hb?.truncated?'Some forecast values are unavailable.':'';
  if(!frame){label.textContent='Waiting for forecast';return;}
  ctx.mv.setExt('atmosphere',frame);ctx.mv.setVisible('atmosphere',true);
  const times=data.extra.forecastFrames.map(f=>f.validAt),time=times[index];slider.max=String(times.length-1);slider.value=String(index);slider.setAttribute('aria-valuetext',stamp(time));label.textContent=stamp(time);
  panel.querySelector('strong').textContent=view==='wind'?'Wind forecast':'Rain forecast';panel.querySelector('[data-weather-start]').textContent=stamp(times[0]);panel.querySelector('[data-weather-end]').textContent=stamp(times.at(-1));
  const state=ctx.S.ov?.atmosphere;if(state){state.validAt=time;state.metrics={...state.metrics,...Object.fromEntries(['wind_kph','rain_mm'].map(key=>[key,frame.features.filter(f=>Number.isFinite(f.properties[key])).length]))};}ctx.toolbar?.sync();
 }
 function setView(next){stop();view=next;panel.hidden=!enabled();root.classList.toggle('forecast-open',enabled());if(enabled()){const radar=document.querySelector('#radar-toggle');if(radar?.getAttribute('aria-pressed')==='true')radar.click();draw();}else if(data){ctx.mv.setExt('atmosphere',data);if(ctx.S.ov?.atmosphere)ctx.S.ov.atmosphere.validAt=data.features[0]?.properties?.validAt;}}
 function setData(next){if(next){const stamp=data?.extra?.forecastFrames?.[index]?.validAt;data=next;index=Math.max(0,data.extra?.forecastFrames?.findIndex(f=>f.validAt===stamp)??0);}if(!data?.extra?.forecastFrames?.length)stop();draw();}
 slider.addEventListener('input',()=>{stop();index=Number(slider.value);draw();});panel.querySelector('[data-weather-now]').onclick=()=>{stop();index=0;draw();};
 play.onclick=()=>{if(timer){stop();return;}if(!enabled()||!data?.extra?.forecastFrames?.length||!allowsMotion())return;play.textContent='Pause';play.setAttribute('aria-pressed','true');timer=setInterval(()=>{index=(index+1)%data.extra.forecastFrames.length;draw();},1200);};
 const refresh=()=>{if(enabled()&&!document.hidden&&!disposed)ctx.overlays?.toggle('atmosphere',true);};const refreshTimer=setInterval(refresh,1800000);
 const motion=()=>{if(!allowsMotion())stop();draw();},visibility=()=>{if(document.hidden)stop();else refresh();};document.addEventListener('homebeacon:motion',motion);document.addEventListener('visibilitychange',visibility);
 ctx.mv.map.once('remove',()=>{disposed=true;stop();clearInterval(refreshTimer);panel.remove();document.removeEventListener('homebeacon:motion',motion);document.removeEventListener('visibilitychange',visibility);});
 return {setView,setData,pause:stop};
}
