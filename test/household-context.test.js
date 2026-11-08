import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHomeAlerts,loadHomeWeather,parseNews,NEWS_SOURCES} from '../src/household-context.js';
const now=new Date('2026-11-08T09:00:00Z');
test('point alerts exclude tests, cancelled, expired and future issues',()=>{
  const p={id:'nws-1',status:'Actual',messageType:'Alert',sent:'2026-11-08T08:30:00Z',expires:'2026-11-08T11:00:00Z',event:'Tornado Watch'};
  const features=[p,{...p,status:'Test'},{...p,messageType:'Cancel'},{...p,sent:'2026-11-08T10:00:00Z'},{...p,expires:'2026-11-08T08:50:00Z'}].map(properties=>({properties}));
  const result=parseHomeAlerts({features},now);assert.equal(result.length,1);assert.equal(result[0].title,'Tornado Watch');assert.equal(result[0].sent,new Date(p.sent).toISOString());
});
test('NWS point-specific weather preserves forecast issue time and missing rain value',async()=>{
  const urls=[];const fetcher=async u=>{urls.push(u);if(u.includes('/alerts/'))return Response.json({features:[]});if(u.includes('/points/'))return Response.json({properties:{forecastHourly:'https://api.weather.gov/gridpoints/FWD/81,108/forecast/hourly'}});return Response.json({properties:{generatedAt:'2026-11-08T08:00:00Z',periods:[{startTime:'2026-11-08T09:00:00Z',endTime:'2026-11-08T10:00:00Z',temperature:72,temperatureUnit:'F',shortForecast:'Chance of storms',windSpeed:'15 mph',probabilityOfPrecipitation:{value:null}}]}});};
  const w=await loadHomeWeather([-96.75,32.986],{now,fetcher});assert.equal(w.status,'ok');assert.equal(w.forecast[0].rainChance,null);assert.equal(w.forecastIssuedAt,'2026-11-08T08:00:00.000Z');assert.ok(urls[0].includes('point=32.9860%2C-96.7500'));
});
test('upstream forecast URL cannot cause arbitrary requests; source failure is unknown',async()=>{
  const urls=[];const w=await loadHomeWeather([-96.75,32.986],{now,fetcher:async u=>{urls.push(u);if(u.includes('/points/'))return Response.json({properties:{forecastHourly:'https://127.0.0.1/private'}});return new Response('',{status:503});}});
  assert.equal(urls.length,2);assert.equal(w.status,'unavailable');assert.equal(w.alertsStatus,'unavailable');assert.equal(w.forecast.length,0);
});
test('RSS is headlines only with source-host links and original publication dates',()=>{
  const s=NEWS_SOURCES.find(s=>s.id==='wusf');const item=(title,link,date)=>`<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${date}</pubDate><description>Never copy article body</description></item>`;
  const xml='<rss>'+item('Flood &amp; roads','https://www.wusf.org/news/1',now.toUTCString())+item('External','https://evil.test/',now.toUTCString())+item('Old','https://www.wusf.org/news/old','1 Jan 2000 GMT')+'</rss>';
  assert.deepEqual(parseNews(xml,s,now),[{title:'Flood & roads',url:'https://www.wusf.org/news/1',publishedAt:now.toISOString()}]);
  assert.throws(()=>parseNews('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>',s,now));
});
