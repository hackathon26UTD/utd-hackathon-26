import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_VIEWS, WORLD_PALETTES, worldView, basePaint, metricColor, viewSourceState, viewSourceNeedsAttention, selectedSourceState, gridSummary } from '../ui/command/world-views.js';
import { MapView, describeOverlayFeature } from '../ui/command/map.js';

test('theme changes restore original base paints without touching device alerts', () => {
  const layers = [{id:'background',type:'background',paint:{'background-color':'#fff'}},{id:'water',type:'fill',paint:{'fill-color':'#abc'}},{id:'road-label',type:'symbol',layout:{'text-field':'name'},paint:{'text-color':'#111'}}];
  const applied = new Map();
  const mv = { worldKey:'wind', baseLayers:layers, basePaintKeys:new Map(), map:{getLayer:id => layers.find(l=>l.id===id),setPaintProperty:(id,key,v)=>applied.set(id+':'+key,v)} };
  MapView.prototype.applyWorldStyle.call(mv);
  assert.equal(applied.get('water:fill-color'),WORLD_PALETTES.wind.water);
  mv.worldKey='uv'; MapView.prototype.applyWorldStyle.call(mv);
  assert.equal(applied.get('water:fill-color'),WORLD_PALETTES.uv.water);
  mv.worldKey='street'; MapView.prototype.applyWorldStyle.call(mv);
  assert.equal(applied.get('water:fill-color'),'#abc');
  assert.equal(applied.get('road-label:text-color'),'#111');
  assert.equal(applied.get('road-label:text-halo-color'),null);
  assert.equal([...applied.keys()].some(k=>k.startsWith('dev-')),false);
});

test('weather paints do not convert missing values to zero', () => {
  for (const view of WORLD_VIEWS.filter(v=>v.field)) {
    const paint=metricColor(view);
    assert.deepEqual(paint.slice(0,3),['case',['==',['get',view.field],null],'#87949c']);
    assert.ok(view.stops.every(([v])=>Number.isFinite(v)));
  }
  const p=describeOverlayFeature('atmosphere',{wind_kph:0,solar_wm2:0,uv_index:null,wind_direction:0});
  assert.ok(p.lines.includes('Wind: 0 km/h'));
  assert.ok(p.lines.includes('Sunshine: 0 W/m²'));
  assert.ok(p.lines.includes('UV index: Not available'));
  assert.ok(p.lines.includes('Forecast time unavailable'));
});

test('source state distinguishes simulated, hidden, empty, stale and partial data', () => {
  const input={view:worldView('uv'),id:'atmosphere',zoom:7};
  assert.match(viewSourceState({...input,demo:true}),/not loaded in simulations/);
  assert.match(viewSourceState({...input,enabled:false}),/hidden/);
  assert.match(viewSourceState({...input,minZoom:10}),/Zoom in/);
  assert.match(viewSourceState({...input,feed:{status:'needs_key'}}),/not configured/);
  assert.match(viewSourceState({...input,state:{loading:true}}),/Loading/);
  assert.match(viewSourceState({...input,state:{count:0,hb:{stale:true,truncated:true}}}),/Out of date.*Partial coverage.*No mapped coverage/);
  assert.match(viewSourceState({...input,state:{error:'Source unavailable',count:1,hb:{}}}),/unavailable/);
  for (const error of ['Sign in to continue.','You do not have access.','Too many requests.','Something went wrong.']) assert.equal(viewSourceNeedsAttention({...input,state:{error,count:1,hb:{}}}),true);
  assert.equal(viewSourceNeedsAttention({...input,state:{count:0,hb:{}}}),true);
  assert.equal(viewSourceNeedsAttention({...input,state:{count:3,hb:{}}}),false);
});

test('fault line layers participate in hit testing and survive view changes', () => {
  const calls=[];
  const mv={worldKey:'uv',visible:new Set(['atmosphere','faults']),map:{getLayer:()=>true,setLayoutProperty:(...a)=>calls.push(a)},extLayerIds:MapView.prototype.extLayerIds};
  MapView.prototype.applyVisibility.call(mv,'atmosphere');
  assert.deepEqual(calls.find(c=>c[0]==='ov-atmosphere-arrow'),['ov-atmosphere-arrow','visibility','none']);
  mv.worldKey='wind';calls.length=0;MapView.prototype.applyVisibility.call(mv,'atmosphere');
  assert.equal(calls.find(c=>c[0]==='ov-atmosphere-arrow')[2],'visible');
  assert.ok(describeOverlayFeature('faults',{name:'Example fault'}).lines.some(l=>l.includes('does not predict')));
  assert.deepEqual(basePaint({id:'water-pattern',type:'fill',paint:{'fill-pattern':'pattern'}},WORLD_PALETTES.wind),{});
});

test('mixed metric coverage is partial even when the upstream envelope missed its flag', () => {
  const original={count:4,metrics:{uv_index:1},hb:{truncated:false}};
  const state=selectedSourceState('atmosphere',original,'uv_index');
  assert.equal(state.count,1);assert.equal(state.hb.truncated,true);assert.equal(original.hb.truncated,false);
  assert.equal(viewSourceNeedsAttention({state,zoom:4}),true);
  assert.match(viewSourceState({state,zoom:4}),/Partial coverage/);
});

test('regional series count as grid data and retain ERCOT demand, capacity and forecast labels', () => {
  const ercot=selectedSourceState('ercot',{count:0,hb:{},extra:{series:[{at:'t1',demand:0,capacity:42,unit:'MW'},{at:'t2',forecast:50,demand:null,unit:'MW'}]}});
  assert.equal(ercot.count,2);
  assert.equal(viewSourceNeedsAttention({state:ercot,zoom:3}),false);
  assert.match(viewSourceState({state:ercot,zoom:3}),/2 regional readings/);
  assert.equal(gridSummary('ercot',ercot),'Demand: 0 MW · Capacity: 42 MW (t1)');
  assert.equal(gridSummary('ercot',{extra:{series:[{forecast:50,at:'t2',unit:'MW'}]}}),'Forecast demand: 50 MW (t2)');
  const eia=selectedSourceState('eia',{count:0,hb:{},extra:{series:[{value:'0',unit:'megawatthours',period:'t1',region:'ERCO'},{value:null},{value:''}]}});
  assert.equal(eia.count,1);assert.match(gridSummary('eia',eia),/0 megawatthours/);
});

test('national map clicks select forecast markers before the state, with devices still first', () => {
  const point={type:'Point',coordinates:[-97.7,30.3]};let device=false;
  const mv={map:{getZoom:()=>2,getLayer:()=>true,project:()=>({x:0,y:0}),queryRenderedFeatures:(_p,{layers}) => layers[0]==='state-fill' ? [{properties:{name:'Texas'},geometry:{type:'Polygon'}}] : layers[0]==='ov-atmosphere-pt' ? [{properties:{name:'Austin'},geometry:point}] : device && layers[0]==='dev-circle' ? [{properties:{id:'device'},geometry:point}] : []}};
  assert.equal(MapView.prototype.hit.call(mv,{x:0,y:0}).kind,'overlay:atmosphere');
  device=true;assert.equal(MapView.prototype.hit.call(mv,{x:0,y:0}).kind,'device');
});
