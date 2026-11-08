// Pure, bounded synthetic world. Shared by browser, HTTP, CLI and MCP. No I/O.
export const SIMULATION_VERSION = 1;
export const PLACES = [
  {id:'dallas',label:'Dallas, Texas',center:[-96.797,32.777]},
  {id:'tampa',label:'Tampa, Florida',center:[-82.458,27.951]},
  {id:'los-angeles',label:'Los Angeles, California',center:[-118.244,34.052]},
  {id:'chicago',label:'Chicago, Illinois',center:[-87.63,41.878]},
  {id:'new-york',label:'New York, New York',center:[-74.006,40.713]},
];
export const EVENTS = ['normal','power-outage','wind','earthquake','flood','fire'];
export const DEFAULT_SIMULATION = Object.freeze({version:1,seed:'homebeacon',place:'dallas',center:[-96.797,32.777],radiusKm:20,affectedRadiusKm:8,event:'power-outage',windKph:120,earthquakeMagnitude:5,floodCm:15,fireTemperatureC:65,outagePct:70,offlinePct:20,deviceCount:100,distribution:'scattered',temperatureC:23,humidityPct:45,batteryPct:100,durationMin:60,eventStartMin:10,eventEndMin:35,thresholds:{temperatureC:50,humidityPct:85,batteryPct:20,offlineMin:15},epoch:'2026-11-08T00:00:00.000Z'});
const clone = x => JSON.parse(JSON.stringify(x));
const object = (x,name) => {if(!x||typeof x!=='object'||Array.isArray(x))throw new RangeError(name+' must be an object.');};
function number(x,key,min,max,integer=false){if(typeof x[key]!=='number'||!Number.isFinite(x[key])||x[key]<min||x[key]>max||(integer&&!Number.isInteger(x[key])))throw new RangeError(key+' must be '+(integer?'a whole number ':'')+'between '+min+' and '+max+'.');}
export function validateSimulation(input={}) {
  object(input,'Settings');
  for(const key of Object.keys(input))if(!Object.hasOwn(DEFAULT_SIMULATION,key))throw new RangeError('Unknown setting: '+key);
  const c={...clone(DEFAULT_SIMULATION),...input,thresholds:{...DEFAULT_SIMULATION.thresholds,...input.thresholds}};
  if(c.version!==1)throw new RangeError('Unsupported simulation version.');
  if(typeof c.seed!=='string'||!c.seed.length||c.seed.length>64||/[^a-zA-Z0-9 _-]/.test(c.seed))throw new RangeError('Seed must be 1–64 letters, numbers, spaces or hyphens.');
  if(input.center&&!Object.hasOwn(input,'place'))c.place='custom';
  if(!PLACES.some(p=>p.id===c.place)&&c.place!=='custom')throw new RangeError('Choose a supported place.');
  const preset=PLACES.find(p=>p.id===c.place);
  if(preset){if(input.center&&JSON.stringify(input.center)!==JSON.stringify(preset.center))throw new RangeError('Use custom place for custom coordinates.');c.center=[...preset.center];}
  if(!Array.isArray(c.center)||c.center.length!==2||!c.center.every(Number.isFinite)||c.center[0]<-124.8||c.center[0]>-66.9||c.center[1]<24.4||c.center[1]>49.4)throw new RangeError('Choose coordinates in the lower-48 map extent.');
  if(!EVENTS.includes(c.event)||!['scattered','clustered'].includes(c.distribution))throw new RangeError('Choose a supported event and distribution.');
  for(const [k,min,max,int] of [['radiusKm',1,250],['affectedRadiusKm',.1,250],['windKph',0,300],['earthquakeMagnitude',0,9],['floodCm',0,200],['fireTemperatureC',20,150],['outagePct',0,100],['offlinePct',0,100],['deviceCount',1,500,true],['temperatureC',-30,50],['humidityPct',0,100],['batteryPct',0,100],['durationMin',20,240,true],['eventStartMin',1,120,true],['eventEndMin',2,239,true]])number(c,k,min,max,int);
  if(c.affectedRadiusKm>c.radiusKm)throw new RangeError('Affected radius cannot exceed the world radius.');
  const x=c.radiusKm/(111.32*Math.cos(c.center[1]*Math.PI/180)),y=c.radiusKm/111.32;
  if(c.center[0]-x < -124.8 || c.center[0]+x > -66.9 || c.center[1]-y < 24.4 || c.center[1]+y > 49.4)throw new RangeError('Reduce the radius or move the center inside the lower-48 map extent.');
  if(c.eventEndMin<=c.eventStartMin||c.eventEndMin>=c.durationMin)throw new RangeError('The event must end after it starts and before the simulation ends.');
  if(input.thresholds!==undefined)object(input.thresholds,'Thresholds');
  for(const k of Object.keys(c.thresholds))if(!Object.hasOwn(DEFAULT_SIMULATION.thresholds,k))throw new RangeError('Unknown threshold: '+k);
  for(const [k,min,max] of [['temperatureC',35,100],['humidityPct',50,100],['batteryPct',5,50],['offlineMin',1,60]])number(c.thresholds,k,min,max);
  const stamp=typeof c.epoch==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(c.epoch);
  if(!stamp||+stamp[2]<1||+stamp[2]>12||+stamp[3]<1||+stamp[3]>new Date(Date.UTC(+stamp[1],+stamp[2],0)).getUTCDate()||+stamp[4]>23||+stamp[5]>59||+stamp[6]>59||+stamp[8]>14||+stamp[9]>59||(+stamp[8]===14&&+stamp[9]!==0)||!Number.isFinite(Date.parse(c.epoch)))throw new RangeError('Use a valid ISO start time with Z or a UTC offset.');
  c.epoch=new Date(c.epoch).toISOString();return c;
}
function random(seed){let h=2166136261;for(const ch of seed){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const round=x=>Math.round(x*100)/100;
function point(center,km,angle){return [center[0]+km*Math.cos(angle)/(111.32*Math.cos(center[1]*Math.PI/180)),center[1]+km*Math.sin(angle)/111.32];}
function circle(center,km,properties){const ring=Array.from({length:65},(_,i)=>point(center,km,i/64*Math.PI*2));return {type:'Feature',properties,geometry:{type:'Polygon',coordinates:[ring]}};}
export function simulationFrame(input={},minute=0) {
 const c=validateSimulation(input);number({minute},'minute',0,c.durationMin,true);
 const clock=Date.parse(c.epoch)+minute*60000,issuedAt=new Date(clock).toISOString(),started=minute>=c.eventStartMin&&c.event!=='normal',active=started&&minute<c.eventEndMin;
 const properties=Array.from({length:c.deviceCount},(_,i)=>{
  const rng=random(c.seed+':'+i),r=c.radiusKm*(c.distribution==='clustered'?Math.pow(rng(),2.5):Math.sqrt(rng())),angle=rng()*Math.PI*2;
  const coordinates=point(c.center,r,angle).map(roundCoordinate),within=r<=c.affectedRadiusKm,exposure=within?1-r/c.affectedRadiusKm:0;
  const powerSample=rng()*100,offlineSample=rng()*100,waterSample=rng(),noise=rng()-.5;
  const strength=c.event==='wind'?c.windKph/150:c.event==='earthquake'?c.earthquakeMagnitude/6:1;
  const impacted=within&&c.event!=='normal';
  const losesPower=impacted&&powerSample<Math.min(100,c.outagePct*Math.max(0,strength));
  const disconnects=losesPower&&offlineSample<c.offlinePct;
  // A device reports the first five event minutes before this scenario's Wi-Fi loss.
  const disconnected=active&&disconnects&&minute>=c.eventStartMin+5;
  const observedMinute=disconnected?c.eventStartMin+4:minute;
  const observedAt=new Date(Date.parse(c.epoch)+observedMinute*60000).toISOString();
  const observedActive=observedMinute>=c.eventStartMin&&observedMinute<c.eventEndMin&&c.event!=='normal';
  const wetPeak=impacted&&c.event==='flood'&&c.floodCm>0&&waterSample<Math.min(1,c.floodCm/30*(.4+exposure));
  const baselineTemperature=round(Math.max(-30,Math.min(50,c.temperatureC+noise)));
  const baselineHot=baselineTemperature>=c.thresholds.temperatureC;
  const heatPeak=round(impacted&&c.event==='fire'?c.fireTemperatureC:baselineTemperature);
  const hotPeak=heatPeak>=c.thresholds.temperatureC;
  const latched=baselineHot||(started&&(wetPeak||hotPeak));
  const lost=observedActive&&losesPower;
  const elapsed=Math.max(0,Math.min(observedMinute,c.eventEndMin)-c.eventStartMin);
  const battery=round(Math.max(0,c.batteryPct-(lost?elapsed*1.2:0)));
  const temperature=round(observedActive?heatPeak:baselineTemperature);
  const humidity=round(Math.max(0,Math.min(100,c.humidityPct+(observedActive&&wetPeak?25:0)+noise)));
  const stale=minute-observedMinute>c.thresholds.offlineMin;
  const jolt=active&&impacted&&c.event==='earthquake'&&c.earthquakeMagnitude>=4;
  let severity=latched?'critical':stale?'unknown':lost||battery<=c.thresholds.batteryPct||jolt?'elevated':humidity>=c.thresholds.humidityPct?'watch':'normal';
  const reasons=[];
  if(latched)reasons.push(baselineHot?'Temperature crossed the simulation limit':!active?'Earlier critical report still needs review':wetPeak?'Water detected':'Temperature crossed the simulation limit');
  if(lost)reasons.push('Mains power off; battery backup');
  if(jolt)reasons.push('Simulated ground movement; inspect the event history');
  if(disconnected)reasons.push('Wi-Fi unavailable; showing last received report');
  if(humidity>=c.thresholds.humidityPct)reasons.push('Humidity above the simulation limit');
  if(battery<=c.thresholds.batteryPct)reasons.push('Battery below the simulation limit');
  if(!reasons.length)reasons.push('No disturbances in these simulated readings');
  const values={mains_power:!lost,wan_connected:!disconnected,battery_pct:battery,temp_c:temperature,humidity_pct:humidity,water_detected:observedActive&&wetPeak,power_mode:lost?(battery<=20?'critical':'saver'):'normal',shock_g:observedActive&&impacted&&c.event==='earthquake'?round(c.earthquakeMagnitude/3*(.5+exposure)):0,wind_kph:observedActive&&impacted&&c.event==='wind'?round(c.windKph*(.5+exposure/2)):0};
  const criticalMinute=baselineHot?0:c.eventStartMin;
  const simulationEvents=[];
  const event=(at,nodeId,text,level='info')=>{if(at<=minute)simulationEvents.push({id:'sim-'+i+'-'+nodeId+'-'+at,nodeId,at:new Date(Date.parse(c.epoch)+at*60000).toISOString(),kind:nodeId==='rules_latch'?'incident':'note',text,level,refs:[],simulated:true});};
  event(0,'observation','Starting simulated readings');
  if(impacted)event(c.eventStartMin,'observation','Simulated '+c.event+' begins in this area');
  if(latched)event(criticalMinute,'rules_latch',baselineHot||!wetPeak?'Temperature incident requires review':'Water incident requires review','critical');
  if(disconnects&&c.eventStartMin+5<c.eventEndMin)event(c.eventStartMin+5,'gateway_mesh','Simulated Wi-Fi loss; reports stop','warn');
  if(impacted)event(c.eventEndMin,'observation',latched?'Reports resume; earlier critical incident remains open':'Event ends; reports resume');
  const id='SIM-'+String(i+1).padStart(4,'0');
  return {id,name:'Box '+(i+1),area:'Generated location · '+(PLACES.find(p=>p.id===c.place)?.label||'Custom area'),coordinates,synthetic:true,source:'simulation-studio',scenario:c.event,simulationClock:issuedAt,simulationOfflineMin:c.thresholds.offlineMin,simulationEvents,severity,reasons,observedAt,lastSeen:observedAt,stale,offline:stale,reviewRequired:latched,values,sensors:{mains:values.mains_power,wan:values.wan_connected,battery_pct:battery,water:values.water_detected,temperature_c:temperature,humidity_pct:humidity},risk:{status:severity,power:{mains:!lost,battery_pct:battery,mode:values.power_mode},priority:{tier:latched?'P1':severity==='normal'?'P3':'P2',label:'Simulation priority'}},incidents:latched?[{id:'sim-incident-'+id,type:baselineHot||!wetPeak?'heat':'water',status:'open',synthetic:true,observedAt:new Date(Date.parse(c.epoch)+criticalMinute*60000).toISOString(),reviewRequired:true}]:[]};
 });
 const summary={total:properties.length,normal:0,watch:0,elevated:0,critical:0,unknown:0,notReporting:0};for(const p of properties){summary[p.severity]++;if(p.stale)summary.notReporting++;}
 return {version:1,mode:'synthetic',synthetic:true,config:c,minute,issuedAt,phase:!started?'Before event':active?'Event active':'Recovery',scenario:{id:'custom',label:c.event.replaceAll('-',' '),description:'Illustrative simulation, not a disaster forecast.'},properties,summary,overlays:{exerciseWind:{type:'FeatureCollection',features:started?[circle(c.center,c.affectedRadiusKm,{name:'Simulated affected area',synthetic:true,source:'simulation-studio',tone:'#e5aa66'})]:[]}},note:'Generated coordinates are not registered addresses. Event effects are illustrative rules, not calibrated physical predictions. No real devices or messages are changed.'};
}
function roundCoordinate(x){return Math.round(x*1e6)/1e6;}
export function simulationSchema(){return {version:1,defaults:clone(DEFAULT_SIMULATION),places:PLACES,events:EVENTS,limits:{deviceCount:[1,500],radiusKm:[1,250],durationMin:[20,240]},steps:['Place','Event','Devices','Normal readings','Review'],note:'Advanced limits affect simulations only.'};}

export function simulationImport(value){
 if(value?.format==='homebeacon-simulation'||value?.synthetic===true){
  if(value.version!==1||(value.format!=='homebeacon-simulation'&&value.mode!=='synthetic'))throw new RangeError('Unsupported simulation result.');
  const config=validateSimulation(value.config);number(value,'minute',0,config.durationMin,true);return {config,minute:value.minute};
 }
 return {config:validateSimulation(value),minute:0};
}
export function simulationResult(config,minute){const imported=simulationImport({format:'homebeacon-simulation',version:1,config,minute});return {format:'homebeacon-simulation',version:1,...imported};}
