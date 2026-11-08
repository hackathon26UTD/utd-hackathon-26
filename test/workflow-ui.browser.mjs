// Headless Chrome with actual Argus components and disposable timeline fixtures.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
let browser,server,origin;
const fixture = {
 mode:'exercise', generatedAt:'2026-11-08T10:00:00Z',
 nodes:['observation','local_record','gateway_mesh','cloud_ingest','rules_latch','risk_ladder','operator_review','message_help'].map(id=>({id,status:id==='rules_latch'||id==='risk_ladder'?'critical':id==='gateway_mesh'?'unknown':'ok',source:id==='local_record'||id==='gateway_mesh'?'not_recorded':'recorded',lastAt:'2026-11-08T09:04:00Z',note:'Latest-only note',evidence:[{id:'future-record',at:'2026-11-08T09:04:00Z'}]})),
 events:['observation','cloud_ingest','rules_latch','risk_ladder','operator_review','message_help'].map((nodeId,i)=>({id:'e'+i,nodeId,at:`2026-11-08T09:0${i}:00Z`,text:`Recorded event ${i+1}`,level:i===2||i===3?'critical':'info',refs:i===1||i===5?['future-record']:[],simulated:true}))
};
before(async()=>{
 server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/harness')return res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><html lang="en"><head><title>Workflow test</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/design.css"><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/kit.css"><link rel="stylesheet" href="/assets/product-kit.css"><script src="/assets/kit.js"></script></head><body><div id="app" class="kit"><main class="cc map-only vertical-shell sidebar-collapsed"><aside class="dr" data-tab="workflow"><header class="dr-head"><h1 class="sr-only">Devices</h1><h2>Test home</h2></header><div class="dr-panels"><div id="dr-p-workflow"><div id="workflow"></div></div></div></aside></main></div><script type="module">import{startProductKit}from'/ui/product-kit.js';startProductKit();import{mountWorkflow}from'/ui/command/workflow.js';const root=document.querySelector('#workflow');root.className='dr-wf';window.wf=mountWorkflow({root,ctx:{esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}});window.wf.update(${JSON.stringify(fixture)});</script></body></html>`);
  const file=resolve(path.startsWith('/ui/')?'.':'public','.'+path);
  if(!file.startsWith(resolve('.')+'/'))return res.writeHead(404).end();
  try{res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});res.end(await readFile(file));}catch{res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});
});
after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
async function setup(opts={}){const ctx=await browser.newContext({viewport:{width:1440,height:960},...opts});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/harness');await expect(page.locator('.wf-node')).toHaveCount(8);return{ctx,page,errors};}
test('replay resets to one node, reveals arrivals, pulses incoming edge and keeps full history',async()=>{
 const{ctx,page,errors}=await setup();
 const controls=await page.locator('.wf-play').boundingBox(),canvas=await page.locator('.wf-viewport').boundingBox(),history=await page.locator('.wf-log').boundingBox();
 assert(controls.y+controls.height<=canvas.y+1,JSON.stringify({controls,canvas,history}));assert(history.x+history.width<=canvas.x+1);assert(canvas.height>550,JSON.stringify({controls,canvas,history}));
 await page.clock.install();await page.getByRole('button',{name:'Play history',exact:true}).click();
 await expect(page.locator('.wf-node')).toHaveCount(1);await expect(page.locator('.wf-ev')).toHaveCount(6);
 await page.clock.fastForward(1400);await expect(page.locator('.wf-ev.is-current')).toContainText('Recorded event 1');
 await page.clock.fastForward(1400);await expect(page.locator('.wf-node')).toHaveCount(4);await expect(page.locator('.wf-energy')).toHaveCount(1);await expect(page.locator('.wf-node.is-entering')).toHaveCount(3);
 await page.getByRole('button',{name:'Pause history'}).click();const count=await page.evaluate(()=>wf.cursor);await page.clock.fastForward(5000);assert.equal(await page.evaluate(()=>wf.cursor),count);
 await page.locator('[data-id="cloud_ingest"]').click();await expect(page.locator('.wf-node-panel')).toContainText('Recorded event 2');await expect(page.locator('.wf-node-panel')).not.toContainText('Latest-only note');await expect(page.locator('.wf-node-panel')).not.toContainText('future-record');
 const node=await page.locator('[data-id="cloud_ingest"]').boundingBox(),panel=await page.locator('.wf-node-panel').boundingBox();assert(panel.y>=node.y+node.height);assert(panel.x>=canvas.x);assert(panel.y+panel.height<=canvas.y+canvas.height+1);
 await expect(page.locator('[data-id="local_record"]')).toContainText('Not reported');await expect(page.locator('[data-id="gateway_mesh"]')).toContainText('Unknown');
 await page.screenshot({path:'work/workflow-replay.png',fullPage:true});
 assert.deepEqual(errors,[]);await ctx.close();
});
test('history click preserves focus, final critical state, restart and keyboard explanation',async()=>{
 const{ctx,page,errors}=await setup();
 await page.locator('[data-go="3"]').click();await expect(page.locator('[data-go="3"]')).toBeFocused();
 const node=page.locator('[data-id="rules_latch"]');await node.focus();await page.keyboard.press('Enter');await expect(node).toHaveAttribute('aria-expanded','true');await expect(page.locator('.wf-node-panel')).toContainText('Fixed rules');
 await page.getByRole('button',{name:'Close checkpoint explanation'}).click();await expect(node).toBeFocused();
 await page.getByRole('button',{name:'Now',exact:true}).click();await expect(page.locator('[data-id="risk_ladder"]')).toContainText('Critical');
 await page.getByRole('button',{name:'Restart',exact:true}).click();await expect(page.locator('.wf-node')).toHaveCount(1);
 assert.deepEqual(errors,[]);await ctx.close();
});
test('phone and reduced motion keep canvas usable with no page overflow or animated pulses',async()=>{
 const{ctx,page,errors}=await setup({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Restart',exact:true}).click();await page.getByRole('button',{name:'Next event'}).click();await page.getByRole('button',{name:'Next event'}).click();
 await expect(page.locator('.wf-energy')).toHaveCount(0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'work/workflow-mobile.png',fullPage:true});
 const axe=await new AxeBuilder({page}).include('.wf').analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
 assert.deepEqual(errors,[]);await ctx.close();
});
test('empty, refresh, truncation and teardown keep history truthful and stop timers',async()=>{
 const{ctx,page}=await setup();
 await page.evaluate(f=>wf.update({...f,events:[],coverage:{truncated:true}}),fixture);await expect(page.getByRole('button',{name:'Play history',exact:true})).toBeDisabled();await expect(page.locator('.wf-log')).toContainText('No recorded events');
 await page.evaluate(f=>wf.update(f),fixture);await page.clock.install();await page.getByRole('button',{name:'Play history',exact:true}).click();await page.clock.fastForward(1400);assert.equal(await page.evaluate(()=>wf.cursor),1);
 await page.evaluate(f=>wf.update({...f,events:[...f.events,{...f.events[5],id:'new',at:'2026-11-08T09:09:00Z'}]}),fixture);assert.equal(await page.evaluate(()=>wf.cursor),1);
 await page.evaluate(()=>wf.destroy());await page.clock.fastForward(10000);await expect(page.locator('.wf-node')).toHaveCount(0);assert.equal(await page.evaluate(()=>wf.playing),false);await ctx.close();
});

test('dark theme, long history, expanded evidence and motion setting survive refresh',async()=>{
 const{ctx,page,errors}=await setup();
 await page.evaluate(()=>{HomeBeaconKit.setTheme('dark');localStorage.setItem('homebeacon-motion','reduce');});
 await page.locator('[data-id="rules_latch"]').click();await page.locator('.wf-node-panel summary').click();
 await page.evaluate(f=>wf.update(f),fixture);await expect(page.locator('.wf-node-panel details')).toHaveAttribute('open','');
 const many={...fixture,events:Array.from({length:100},(_,i)=>({...fixture.events[0],id:'long-'+i,at:new Date(Date.parse('2026-11-08T08:00:00Z')+i*60000).toISOString(),text:'Reading '+i}))};
 await page.evaluate(f=>wf.update(f),many);await expect(page.locator('.wf-ev')).toHaveCount(100);
 await page.getByRole('button',{name:'Restart',exact:true}).click();await page.getByRole('button',{name:'Next event'}).click();await expect(page.locator('.wf-energy')).toHaveCount(0);
 const violations=(await new AxeBuilder({page}).include('.wf').analyze()).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);await ctx.close();
});

test('refresh follows the same event and pauses if that event leaves the history window',async()=>{
 const{ctx,page}=await setup();await page.clock.install();await page.getByRole('button',{name:'Play history',exact:true}).click();await page.clock.fastForward(1400);
 await page.evaluate(f=>wf.update({...f,events:[{...f.events[0],id:'earlier',at:'2026-11-08T08:00:00Z'},...f.events]}),fixture);
 assert.equal(await page.evaluate(()=>wf.cursor),2);await expect(page.locator('.wf-ev.is-current')).toContainText('Recorded event 1');
 await page.evaluate(f=>wf.update({...f,events:f.events.slice(1)}),fixture);assert.equal(await page.evaluate(()=>wf.cursor),0);assert.equal(await page.evaluate(()=>wf.playing),false);await expect(page.locator('.wf-banner')).toContainText('left this time window');await ctx.close();
});
