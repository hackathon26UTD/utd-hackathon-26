import {ObjectId} from 'mongodb';
import {sha256Hex} from './auth.js';
import {bodyText, customer, guarded, reply, run, fail} from './customer-connect-common.js';
import {resolveHousehold} from './households.js';

const MINUTE = 60000;
const text = (s, n = 180) => typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) : '';
const iso = v => Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
export const NEWS_SOURCES = [
  {id:'kera',name:'KERA News',url:'https://www.keranews.org/news.rss',site:'https://www.keranews.org',scope:'North Texas regional headlines',bounds:[-98,32,-95.5,34]},
  {id:'kut',name:'KUT News',url:'https://www.kut.org/news.rss',site:'https://www.kut.org',scope:'Austin and Central Texas headlines',bounds:[-98.3,29.8,-97,31]},
  {id:'wusf',name:'WUSF',url:'https://www.wusf.org/local-state.rss',site:'https://www.wusf.org',scope:'Tampa Bay and Florida headlines',bounds:[-83,26.8,-81.5,29]},
  {id:'kpbs',name:'KPBS',url:'https://www.kpbs.org/index.rss',site:'https://www.kpbs.org',scope:'San Diego regional headlines',bounds:[-117.7,32.5,-116,33.6]},
];
function safeUrl(value, host, pattern) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === host && !u.port && !u.username && !u.password && (!pattern || pattern.test(u.pathname)) ? u.href : null; } catch { return null; }
}
async function fetchText(url, fetcher, max = 1500000) {
  const r = await fetcher(url, {headers:{'User-Agent':'HomeBeacon/1.0 (https://utd-hackathon-26.pages.dev)','Accept':'application/geo+json, application/json, application/rss+xml;q=0.8'},signal:AbortSignal.timeout(7000),redirect:'error'});
  if (!r.ok) throw new Error('Source unavailable');
  return bodyText(r, max);
}
async function json(url, fetcher) { return JSON.parse(await fetchText(url, fetcher)); }

export function parseHomeAlerts(data, now) {
  return (Array.isArray(data.features) ? data.features : []).slice(0,100).flatMap(f => {
    const p = f.properties || {}, sent = iso(p.sent), expires = iso(p.expires);
    if (p.status !== 'Actual' || !sent || !expires || new Date(sent)>now || new Date(expires)<=now || p.messageType==='Cancel' || (p.effective && new Date(p.effective)>now)) return [];
    const id = text(p.id || f.id,300); if (!id) return [];
    return [{id,title:text(p.event)||'Weather alert',headline:text(p.headline),severity:text(p.severity,30),sent,expires,url:safeUrl(p.web,'www.weather.gov') || 'https://www.weather.gov/alerts'}];
  }).slice(0,20);
}
export async function loadHomeWeather(coordinates, {fetcher=fetch,now=new Date()}={}) {
  const [x,y]=coordinates, point=y.toFixed(4)+','+x.toFixed(4);
  const url='https://forecast.weather.gov/MapClick.php?lat='+y.toFixed(4)+'&lon='+x.toFixed(4);
  const result={status:'unavailable',alertsStatus:'unavailable',forecastStatus:'unavailable',checkedAt:now.toISOString(),alerts:[],forecast:[],url};
  const attempts=await Promise.allSettled([
    json('https://api.weather.gov/alerts/active?point='+encodeURIComponent(point),fetcher),
    (async()=>{
      const p=(await json('https://api.weather.gov/points/'+point,fetcher)).properties;
      const hourly=safeUrl(p?.forecastHourly,'api.weather.gov',/^\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast\/hourly$/);
      if(!hourly)throw Error('No forecast');
      return json(hourly,fetcher);
    })(),
  ]);
  if(attempts[0].status==='fulfilled' && Array.isArray(attempts[0].value.features)) {
    result.alerts=parseHomeAlerts(attempts[0].value,now);result.alertsStatus='ok';
  }
  if(attempts[1].status==='fulfilled') {
    const p=attempts[1].value.properties||{}, issued=iso(p.generatedAt||p.updateTime);
    result.forecastIssuedAt=issued;
    result.forecastStatus=issued && new Date(issued)<=now && now-new Date(issued)<=6*60*MINUTE?'ok':'stale';
    result.forecast=(Array.isArray(p.periods)?p.periods:[]).filter(v=>iso(v.startTime)&&iso(v.endTime)&&new Date(v.endTime)>now&&new Date(v.startTime)<new Date(+now+12*60*MINUTE)).slice(0,12).map(v=>({
      startTime:iso(v.startTime),summary:text(v.shortForecast),temperature:Number.isFinite(v.temperature)?v.temperature:null,temperatureUnit:['F','C'].includes(v.temperatureUnit)?v.temperatureUnit:null,windSpeed:text(v.windSpeed,35),rainChance:Number.isFinite(v.probabilityOfPrecipitation?.value)?v.probabilityOfPrecipitation.value:null,
    }));
    if(!result.forecast.length) result.forecastStatus='unavailable';
  }
  result.status=result.alertsStatus==='ok'&&result.forecastStatus==='ok'?'ok':result.alertsStatus==='ok'||result.forecast.length?'partial':'unavailable';
  return result;
}
const unxml = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(?:amp|lt|gt|quot|apos);/g,v=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[v])).replace(/&#(x[\da-f]+|\d+);/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});
export function parseNews(xml, source, now) {
  // Bounded RSS subset only: no entity expansion, remote includes, article text or markup.
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsupported feed');
  const tag=(item,name)=>unxml(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+name+'>','i').exec(item)?.[1]||'');
  const host=new URL(source.site).hostname;
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,100).flatMap(([,item])=>{
    const title=text(tag(item,'title'),180),url=safeUrl(tag(item,'link').trim(),host),publishedAt=iso(tag(item,'pubDate'));
    if(!title||!url||!publishedAt||new Date(publishedAt)>now||now-new Date(publishedAt)>7*86400000)return [];
    return [{title,url,publishedAt}];
  }).slice(0,5);
}
async function cached(db,key,ttl,loader,now) {
  const old=await db.collection('household_context_cache').findOne({_id:key});
  if(old?.nextAttemptAt>now)return old.value;
  try {
    const value=await loader();
    await db.collection('household_context_cache').updateOne({_id:key},{$set:{value,nextAttemptAt:new Date(+now+ttl),expiresAt:new Date(+now+86400000)}},{upsert:true});
    return value;
  } catch {
    const value=old?.value ? {...old.value,status:'stale'} : {status:'unavailable',checkedAt:now.toISOString(),items:[]};
    await db.collection('household_context_cache').updateOne({_id:key},{$set:{value,nextAttemptAt:new Date(+now+5*MINUTE),expiresAt:new Date(+now+86400000)}},{upsert:true});
    return value;
  }
}
export async function householdContext(db,access,{fetcher=fetch,now=new Date(),includeNews=true,includeLinkIds=false}={}) {
  const places=[],seen=new Set();let total=0;
  for(const link of access.links) {
    if(!ObjectId.isValid(link.deviceId))continue;
    const d=await db.collection('devices').findOne({_id:new ObjectId(link.deviceId),'meta.exercise':{$ne:true},disabled:{$ne:true}},{projection:{homeId:1}});
    if(!d?.homeId)continue;
    const h=await db.collection('homes').findOne({_id:d.homeId},{projection:{location:1}}),c=h?.location?.coordinates;
    if(!Array.isArray(c)||c.length!==2||!c.every(Number.isFinite)||c[0]<-125.1||c[0]>-66.8||c[1]<24.3||c[1]>49.6)continue;
    const key=c.map(n=>n.toFixed(4)).join(',');if(seen.has(key))continue;seen.add(key);total++;
    if(places.length===5)continue;
    places.push({link,c,key});
  }
  const locations=await Promise.all(places.map(async({link,c,key})=>{
    const weather=await cached(db,'weather:'+await sha256Hex(key),5*MINUTE,()=>loadHomeWeather(c,{fetcher,now}),now);
    const source=includeNews&&NEWS_SOURCES.find(s=>c[0]>=s.bounds[0]&&c[0]<=s.bounds[2]&&c[1]>=s.bounds[1]&&c[1]<=s.bounds[3]);
    const news=source?{source:source.name,scope:source.scope,...await cached(db,'news:'+source.id,15*MINUTE,async()=>({status:'ok',checkedAt:now.toISOString(),items:parseNews(await fetchText(source.url,fetcher),source,now)}),now)}:{status:'not_configured',source:null,scope:'No local publisher connected for this area.',items:[]};
    return {label:text(link.nickname,60)||'Home',weather,news,...(includeLinkIds?{linkId:link._id}:{})};
  }));
  return {locations,checkedAt:now.toISOString(),truncated:total>5};
}
export function householdContextHandler(ctx) {return guarded(()=>run(ctx,async db=>{
  if(ctx.request.method!=='GET')fail(405,'Method not allowed.');
  const email=await customer(ctx,db),id=new URL(ctx.request.url).searchParams.get('id');
  const access=await resolveHousehold(db,{email,householdId:id});
  const result=await householdContext(db,access,{fetcher:ctx.fetcher,now:ctx.now});
  const current=await resolveHousehold(db,{email,householdId:id});
  if(current.member._id!==access.member._id||current.member.accountGeneration!==access.member.accountGeneration||JSON.stringify(current.links.map(l=>l._id).sort())!==JSON.stringify(access.links.map(l=>l._id).sort()))fail(409,'Household access changed. Refresh the page.');
  return reply(result);
}));}
