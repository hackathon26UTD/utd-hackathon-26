// Actual MapLibre rendering with synthetic forecast fixtures, never production records.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
const {outputFiles}=await build({stdin:{contents:`import * as maplibregl from 'maplibre-gl';import {MapView} from './ui/command/map.js';maplibregl.setWorkerUrl('/assets/map-worker.mjs');window.view=new MapView(maplibregl,'map');`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/')return res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><html lang="en"><title>Wind fixture</title><link rel="stylesheet" href="/assets/app.css"><div id="map" style="position:absolute;inset:0"></div><script type="module" src="/fixture.js"></script></html>');
 if(path==='/fixture.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(outputFiles[0].contents);
 const f=resolve('public',path.slice(1));if(!f.startsWith(resolve('public')+'/'))return res.writeHead(404).end();
 try{const bytes=await readFile(f);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json'})[extname(f)]||'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:800},reducedMotion:'no-preference'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForFunction(()=>window.view?.map.getLayer('ov-atmosphere-label'),{},{timeout:20000});
 for(const width of [1200,390]){await page.setViewportSize({width,height:800});await page.evaluate(()=>{view.map.resize();view.map.jumpTo({zoom:0,center:[30,60]});});const c=await page.evaluate(()=>({zoom:view.zoom,min:view.homeMinZoom,center:view.map.getCenter()}));if(c.zoom<c.min-.001||c.center.lng< -127||c.center.lng> -65)throw Error('Mainland constraint failed');}
 await page.setViewportSize({width:1200,height:800});
 await page.evaluate(()=>{
  view.setExt('atmosphere',{type:'FeatureCollection',features:[[-96,33,32,270],[-94,34,0,0],[-98,32,null,90]].map(([lng,lat,wind_kph,wind_direction])=>({type:'Feature',geometry:{type:'Point',coordinates:[lng,lat]},properties:{wind_kph,wind_direction}}))});
  view.setWorldView('wind');view.setVisible('atmosphere',true);view.map.jumpTo({center:[-96,33],zoom:5});
 });
 const flow=page.locator('.wind-flow');await expect(flow).toHaveAttribute('data-samples','2');await expect(flow).toHaveAttribute('data-running','true');
 const label=await page.evaluate(()=>view.map.getLayoutProperty('ov-atmosphere-label','text-field'));
 if(!JSON.stringify(label).includes(' km/h'))throw Error('Wind label missing units');
 const color=await page.evaluate(()=>view.map.getPaintProperty('background','background-color'));
 if(color!=='#2068a8')throw Error('Wind base did not turn blue: '+color);
 await page.evaluate(()=>view.windFlow.setPaused(true));await expect(flow).toHaveAttribute('data-running','false');
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>view.windFlow.setPaused(false));await expect(flow).toHaveAttribute('data-running','false');
 await page.emulateMedia({reducedMotion:'no-preference'});await expect(flow).toHaveAttribute('data-running','true');
 await page.evaluate(()=>view.setVisible('atmosphere',false));await expect(flow).toHaveAttribute('data-samples','0');await expect(flow).toHaveAttribute('data-running','false');
 await page.evaluate(()=>{view.setVisible('atmosphere',true);view.setWorldView('street');});await expect(flow).toHaveAttribute('data-samples','0');
 await page.evaluate(()=>view.map.remove());await expect(flow).toHaveCount(0);
 if(errors.length)throw Error(JSON.stringify(errors));console.log('Wind renderer: blue base, numeric labels, missing/calm values, pause, reduced motion, hide, view reset and cleanup passed.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
