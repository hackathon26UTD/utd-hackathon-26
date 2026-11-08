import {DEFAULT_SIMULATION,PLACES,EVENTS,validateSimulation,simulationFrame} from '../domain/simulation.js';
const h=(tag,attrs={},...children)=>{const el=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else if(k==='class')el.className=v;else el.setAttribute(k,String(v));}for(const c of children.flat())if(c!=null)el.append(c.nodeType?c:document.createTextNode(String(c)));return el;};
const label=s=>s.replaceAll('-',' ').replace(/^./,c=>c.toUpperCase());
export function mountSimulationStudio(root,transport,{onFrame,onExplore,onConfigure}){
 let config=validateSimulation({...DEFAULT_SIMULATION,epoch:new Date().toISOString()}),draft=structuredClone(config),step=0,minute=0,timer=null,speed=1,started=false;
 const steps=['Place','Event','Devices','Normal readings','Review'];
 const error=h('p',{role:'status',class:'simulation-error'}),body=h('div',{class:'simulation-step'}),tabs=window.Kit.mainTabs({label:'Simulation setup',panel:body,tabs:steps.map((x,i)=>({id:String(i),label:(i+1)+'. '+x})),active:'0',onChange:id=>go(Number(id))});
 // Kit versions expose a DOM node or an {el} component.
 const tabEl=tabs.el||tabs;
 const back=h('button',{type:'button',onclick:()=>go(step-1)},'Back'),next=h('button',{type:'button',class:'primary',onclick:()=>{if(step===4){if(commit()){started=true;emit();onExplore();}}else go(step+1);}},'Next');
 const footer=h('div',{class:'simulation-actions'},back,next);
 const intro=h('p',{class:'muted'},'Build a fictional world. Nothing here changes real devices.');
 root.replaceChildren(intro,tabEl,body,error,footer);
 const time=h('input',{type:'range',min:0,max:config.durationMin,value:0,'aria-label':'Simulation minute',oninput:e=>{pause();minute=Number(e.target.value);emit();}}),out=h('output',{'aria-live':'off'}),play=h('button',{type:'button',onclick:()=>timer?pause():run()},'Play');
 const speedSelect=h('select',{id:'simulation-speed','aria-label':'Playback speed',onchange:e=>{speed=Number(e.target.value);if(timer){pause();run();}}},...[1,4,10].map(n=>h('option',{value:n},n+'×')));
 transport.classList.add('simulation-transport');transport.hidden=false;
 transport.replaceChildren(h('button',{type:'button',onclick:()=>{pause();onConfigure();}},'Configure'),play,h('button',{type:'button',onclick:()=>{pause();minute=0;emit();}},'Restart'),time,out,h('label',{},'Speed',speedSelect));
 function field(title,key,min,max,unit='',path=null){const target=path?draft[path]:draft;const input=h('input',{type:'number',id:'simulation-'+(path?path+'-':'')+key,value:target[key],min,max,step:['deviceCount','durationMin','eventStartMin','eventEndMin'].includes(key)?1:'any',oninput:e=>{target[key]=Number(e.target.value);}});return h('label',{class:'simulation-field',for:input.id},title+(unit?' ('+unit+')':''),input);}
 function select(title,key,items){const el=h('select',{id:'simulation-'+key,onchange:e=>{draft[key]=e.target.value;if(key==='place'&&draft.place!=='custom')draft.center=[...PLACES.find(p=>p.id===draft.place).center];if(key==='place'||key==='event')render();}},...items.map(([v,l])=>h('option',{value:v},l)));el.value=draft[key];return h('label',{class:'simulation-field',for:el.id},title,el);}
 function commit(){try{config=validateSimulation(draft);draft=structuredClone(config);error.textContent='';time.max=config.durationMin;minute=Math.min(minute,config.durationMin);return true;}catch(e){error.textContent=e.message;return false;}}
 function go(n){if(n<0||n>4)return;if(!commit()){tabs.setActive(String(step));return;}step=n;render();body.querySelector('h3')?.focus();}
 function render(){
  body.replaceChildren(h('h3',{tabindex:-1},steps[step]));error.textContent='';back.disabled=step===0;next.textContent=step===4?'Start simulation':'Next';
  // Update the actual kit tabs without rebuilding the form or losing entered values.
  if(tabs.set)tabs.set(String(step));else if(tabs.setActive)tabs.setActive(String(step));
  const tabButtons=tabEl.querySelectorAll('[role=tab]');tabButtons.forEach((b,i)=>{b.setAttribute('aria-selected',String(i===step));b.tabIndex=i===step?0:-1;});
  requestAnimationFrame(()=>{const b=tabButtons[step];if(b)tabEl.scrollLeft=Math.max(0,b.offsetLeft-tabEl.offsetLeft-12);});
  const grid=h('div',{class:'simulation-fields'});body.append(grid);
  if(step===0){grid.append(select('Area','place',[...PLACES.map(p=>[p.id,p.label]),['custom','Custom coordinates']]),field('World radius','radiusKm',1,250,'km'),field('Affected radius','affectedRadiusKm',.1,250,'km'));
   if(draft.place==='custom')for(const [i,title,min,max]of [[0,'Longitude',-124.8,-66.9],[1,'Latitude',24.4,49.4]]){const input=h('input',{type:'number',value:draft.center[i],min,max,step:.0001,oninput:e=>{draft.center[i]=Number(e.target.value);}});grid.append(h('label',{class:'simulation-field'},title,input));}
   body.append(h('p',{class:'muted'},'Lower 48 only. Generated points are fictional locations, not registered street addresses.'));
  }else if(step===1){grid.append(select('Situation','event',EVENTS.map(x=>[x,label(x)])));
   const specifics={wind:['Wind speed','windKph',0,300,'km/h'],earthquake:['Earthquake magnitude','earthquakeMagnitude',0,9,'Mw'],flood:['Simulated water depth','floodCm',0,200,'cm'],fire:['Peak sensor temperature','fireTemperatureC',20,150,'°C']};if(specifics[draft.event])grid.append(field(...specifics[draft.event]));
   if(draft.event!=='normal')grid.append(field('Power loss among affected devices','outagePct',0,100,'%'),field('Wi-Fi loss among power-loss devices','offlinePct',0,100,'%'));
   grid.append(field('Event starts','eventStartMin',1,120,'minute'),field('Event ends','eventEndMin',2,239,'minute'),field('Total duration','durationMin',20,240,'minutes'));
   body.append(h('p',{class:'muted'},'Event intensity changes illustrative sensor effects. This is not a physical hazard forecast.'));
  }else if(step===2){grid.append(field('Number of devices','deviceCount',1,500),select('Placement','distribution',[['scattered','Scattered across the area'],['clustered','Concentrated near the center']]));grid.append(h('label',{class:'simulation-field'},'World seed',h('input',{value:draft.seed,maxlength:64,oninput:e=>draft.seed=e.target.value})));body.append(h('p',{class:'muted'},'Use the same seed and settings to reproduce locations and events.'));
  }else if(step===3){grid.append(field('Starting temperature','temperatureC',-30,50,'°C'),field('Starting humidity','humidityPct',0,100,'%'),field('Starting battery','batteryPct',0,100,'%'));body.append(h('p',{class:'muted'},'Power and Wi-Fi begin connected. These are fictional starting readings, not limits for a real home.'));
  }else{const review=h('dl',{class:'simulation-review'});for(const [k,v]of [['Place',PLACES.find(p=>p.id===draft.place)?.label||draft.center.join(', ')],['Event',label(draft.event)],['Devices',draft.deviceCount+' · '+draft.distribution],['Affected area',draft.affectedRadiusKm+' km radius'],['Timeline',draft.eventStartMin+'–'+draft.eventEndMin+' of '+draft.durationMin+' minutes'],['Seed',draft.seed]])review.append(h('div',{},h('dt',{},k),h('dd',{},v)));grid.append(review);
   const advanced=h('details',{class:'simulation-advanced'},h('summary',{},'Advanced limits ',h('span',{'aria-hidden':true},'⌄')),h('p',{},'Simulation only. Real detection rules do not change.'),h('div',{class:'simulation-fields'},field('Critical temperature','temperatureC',35,100,'°C','thresholds'),field('Humidity warning','humidityPct',50,100,'%','thresholds'),field('Low battery','batteryPct',5,50,'%','thresholds'),field('No-report limit','offlineMin',1,60,'minutes','thresholds')));body.append(advanced);
   const upload=h('input',{type:'file',accept:'.json,application/json','aria-label':'Import simulation settings',onchange:async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>16384)throw Error('Settings file must be under 16 KB.');draft=validateSimulation(JSON.parse(await f.text()));config=structuredClone(draft);pause();minute=0;render();error.textContent='Settings imported. Start simulation to apply.';}catch(e){error.textContent=e.message;}}});body.append(h('div',{class:'simulation-actions'},h('button',{type:'button',onclick:()=>{if(commit())download(config,'homebeacon-simulation.json');}},'Export settings'),h('label',{},'Import settings',upload)),h('p',{class:'muted'},'Missing reports stay unknown. Critical reports stay open during recovery until reviewed.'));
  }
 }
 function emit(){const frame=simulationFrame(config,minute);out.textContent=minute+' / '+config.durationMin+' min · '+frame.phase;time.value=minute;onFrame(frame);}
 function pause(){clearInterval(timer);timer=null;play.textContent='Play';play.setAttribute('aria-pressed','false');}
 function run(){if(minute>=config.durationMin)minute=0;play.textContent='Pause';play.setAttribute('aria-pressed','true');timer=setInterval(()=>{minute=Math.min(config.durationMin,minute+1);emit();if(minute===config.durationMin)pause();},1000/speed);}
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
 render();emit();
 return {pause,frame:()=>simulationFrame(config,minute),hasStarted:()=>started};
}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=h('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
