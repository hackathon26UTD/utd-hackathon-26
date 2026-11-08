import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {MongoClient} from 'mongodb';
import {handlePublicNews,handlePublicFeeds,handlePublicOverlays,activeAlerts} from '../src/public-context.js';
import {onRequest as middleware} from '../functions/api/_middleware.js';
import {constrainConus} from '../ui/command/geo.js';
let server,client,db;
before(async()=>{const uri=process.env.TEST_MONGODB_URI||(server=await MongoMemoryServer.create()).getUri();client=await MongoClient.connect(uri);db=client.db('public_context_test');});
after(async()=>{await db?.dropDatabase();await client?.close();await server?.stop();});
beforeEach(async()=>{for(const c of ['feed_cache','public_alert_zones','public_context_limits'])await db.collection(c).deleteMany({});});
const now=new Date('2026-11-08T06:00:00Z'),future='2026-11-08T08:00:00Z';
const zone='https://api.weather.gov/zones/county/TXC113';
const geometry={type:'Polygon',coordinates:[[[-97,32],[-96,32],[-96,33],[-97,33],[-97,32]]]};
const alert=(id,props={},g=null)=>({id:'https://api.weather.gov/alerts/'+id,type:'Feature',geometry:g,properties:{event:'Flood Watch',status:'Actual',messageType:'Alert',sent:now.toISOString(),expires:future,areaDesc:'Dallas County',affectedZones:[zone],...props}});
const req=(path,method='GET')=>new Request('https://test.local/api/public/'+path,{method});
const json=x=>new Response(JSON.stringify(x));
function source(features){const calls=[];return {calls,fetcher:async url=>{calls.push(url);if(url==='https://api.weather.gov/alerts/active')return json({features});if(url===zone)return json({geometry});throw Error('Unexpected source');}};}
test('public reads bypass login, private reads and all anonymous mutations do not',async()=>{
 for(const path of ['feeds','overlays','news']){
  const r=await middleware({request:req(path),env:{},data:{},next:()=>new Response(null,{status:204})});assert.equal(r.status,204);
  assert.equal((await middleware({request:req(path,'POST'),env:{},data:{},next:()=>{throw Error('Mutation allowed');}})).status,401);
 }
 for(const path of ['/api/devices','/api/ops/live','/api/ops/device-timeline','/api/feeds'])assert.equal((await middleware({request:new Request('https://test.local'+path),env:{},data:{},next:()=>{throw Error('Private leak');}})).status,401);
});
test('expiry, cancellation and test messages never become active news',()=>{
 const rows=[alert('ok'),alert('old',{expires:'2026-11-08T05:59:59Z'}),alert('ended',{ends:'2026-11-08T05:59:59Z'}),alert('cancel',{messageType:'Cancel'}),alert('test',{status:'Test'}),alert('bad',{expires:'invalid'})];
 assert.equal(activeAlerts(rows,now).length,1);
});
test('nationwide news is public, cached, and keeps missing geometry in the list',async()=>{
 const stub=source([alert('county'),alert('polygon',{},geometry)]),deps={db,now,...stub};
 const r=await handlePublicNews(req('news'),{},deps);assert.equal(r.status,200);const body=await r.json();assert.equal(body.features.length,2);assert.equal(body.features[0].properties.source,'National Weather Service');
 await handlePublicNews(req('news'),{},deps);assert.equal(stub.calls.length,1);assert.equal(body.features[0].geometry,null);
});
test('close view resolves official county boundaries and reuses the boundary cache',async()=>{
 const stub=source([alert('county')]),deps={db,now,...stub};
 const read=()=>handlePublicNews(req('news?bbox=-96.9,32.1,-96.1,32.9'),{},deps);
 const body=await (await read()).json();assert.equal(body.features.length,1);assert.equal(body.features[0].geometry.type,'MultiPolygon');assert.equal(body.features[0].properties.geometryBasis,'NWS county area');assert.equal(body.hb.truncated,false);
 await read();assert.equal(stub.calls.length,2);
});
test('failed boundaries are partial, not invented; arbitrary zone URLs are never fetched',async()=>{
 const stub=source([alert('county'),alert('bad',{affectedZones:['http://127.0.0.1/private']})]);stub.fetcher=async url=>{stub.calls.push(url);if(url==='https://api.weather.gov/alerts/active')return json({features:[alert('county'),alert('bad',{affectedZones:['http://127.0.0.1/private']})]});throw Error('unavailable');};
 const body=await (await handlePublicNews(req('news?bbox=-96.9,32.1,-96.1,32.9'),{},{db,now,...stub})).json();
 assert.equal(body.hb.truncated,true);assert.equal(body.features[0].properties.boundaryUnavailable,true);assert.ok(stub.calls.every(u=>u.startsWith('https://api.weather.gov/')));
});
test('uncached boundary requests cap at sixteen and expose partial coverage',async()=>{
 let count=0;const zones=Array.from({length:25},(_,i)=>'https://api.weather.gov/zones/county/TXC'+String(i).padStart(3,'0'));
 const fetcher=async url=>url.includes('/alerts/')?json({features:[alert('many',{affectedZones:zones})]}):(count++,json({geometry}));
 const body=await (await handlePublicNews(req('news?bbox=-96.9,32.1,-96.1,32.9'),{},{db,now,fetcher})).json();assert.equal(count,16);assert.equal(body.hb.truncated,true);assert.equal(body.features[0].properties.boundaryPartial,true);
});
test('source failure retains dated saved data, and expired alerts are removed',async()=>{
 const stub=source([alert('live'),alert('soon',{expires:'2026-11-08T06:01:00Z'})]);await handlePublicNews(req('news'),{},{db,now,...stub});
 const r=await handlePublicNews(req('news'),{},{db,now:new Date(+now+180000),fetcher:async()=>{throw Error('offline');}});const body=await r.json();assert.equal(r.status,200);assert.equal(body.features.length,1);assert.equal(body.hb.stale,true);assert.equal(body.hb.refreshStatus,'error');
});
test('public catalog excludes operator zones and handler rejects writes and wide local requests',async()=>{
 const body=await (await handlePublicFeeds(req('feeds'),{},{db,now})).json();assert.ok(body.sources.length>10);assert.ok(!body.sources.some(s=>s.id==='zones'));
 for(const path of ['overlays?layer=zones','overlays?layer=gauges&bbox=-125,24,-67,49'])assert.equal((await handlePublicOverlays(req(path),{},{db,now})).status,400);
 assert.equal((await handlePublicNews(req('news?bbox=-125,24,-67,49'),{},{db,now})).status,400);
 assert.equal((await handlePublicNews(req('news','POST'),{},{db,now})).status,405);
});
test('viewport constraint clamps world zoom and panning on desktop and phone',()=>{
 for(const [width,height,min] of [[1440,900,3.5],[390,800,1.9]]){
  const c=constrainConus({lng:70,lat:65},0,width,height,min);assert.equal(c.zoom,min);assert.ok(c.lng< -65&&c.lng> -127);assert.ok(c.lat>23&&c.lat<51);
  const z=constrainConus({lng:-150,lat:0},10,width,height,min);assert.ok(z.lng> -126.5);assert.ok(z.lat>23.5);
 }
});

import {alertIntersects} from '../src/public-alert-geo.js';
test('local intersection excludes gaps and holes, includes edge crossings',()=>{
 const poly=ring=>({type:'Polygon',coordinates:[ring]});
 const multi={type:'MultiPolygon',coordinates:[geometry.coordinates,[[[-94,32],[-93,32],[-93,33],[-94,33],[-94,32]]]]};
 assert.equal(alertIntersects(multi,[-95.8,32.2,-94.2,32.8]),false);
 const hole={...geometry,coordinates:[...geometry.coordinates,[[-96.8,32.2],[-96.2,32.2],[-96.2,32.8],[-96.8,32.8],[-96.8,32.2]]]};
 assert.equal(alertIntersects(hole,[-96.7,32.3,-96.3,32.7]),false);
 assert.equal(alertIntersects(geometry,[-96.8,32.2,-96.2,32.8]),true);
 assert.equal(alertIntersects(poly([[-98,32.4],[-95,32.4],[-95,32.6],[-98,32.6],[-98,32.4]]),[-97,32,-96,33]),true);
});

test('public source reads have a shared per-client minute budget without storing addresses',async()=>{
 const request=new Request('https://test.local/api/public/feeds',{headers:{'CF-Connecting-IP':'192.0.2.20'}});
 for(let i=0;i<60;i++)assert.equal((await handlePublicFeeds(request,{},{db,now})).status,200);
 assert.equal((await handlePublicFeeds(request,{},{db,now})).status,429);
 const rows=await db.collection('public_context_limits').find().toArray();assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes('192.0.2.20'));
 assert.equal((await handlePublicFeeds(request,{},{db,now:new Date(+now+60000)})).status,200);
});
