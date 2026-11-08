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
test('static workflow has full history, scrollable checkpoints and no playback',async()=>{
 const{ctx,page,errors}=await setup();
 await expect(page.locator('.wf-play,[data-p],.wf-energy')).toHaveCount(0);
 await expect(page.locator('.wf-banner')).toBeHidden();
 await expect(page.locator('.wf-ev')).toHaveCount(6);
 const viewport=page.locator('.wf-viewport');
 await page.setViewportSize({width:1000,height:700});
 const bounds=await viewport.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(0,1800);
 await expect.poll(()=>viewport.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 await page.locator('[data-id="message_help"]').scrollIntoViewIfNeeded();await page.locator('[data-id="message_help"]').click();
 await expect(page.locator('.wf-node-panel')).toContainText('Latest-only note');
 await page.screenshot({path:'work/workflow-static-desktop.png',fullPage:true});
 await page.clock.install();await page.clock.fastForward(10000);await expect(page.locator('.wf-node')).toHaveCount(8);assert.equal(await page.evaluate(()=>wf.playing),false);
 assert.deepEqual(errors,[]);await ctx.close();
});
test('history and keyboard open current checkpoint explanations without replaying',async()=>{
 const{ctx,page,errors}=await setup();await page.locator('[data-go="3"]').click();
 await expect(page.locator('.wf-node-panel')).toContainText('Fixed rules');
 await expect(page.locator('[data-id="risk_ladder"]')).toContainText('Critical');
 const node=page.locator('[data-id="rules_latch"]');await expect(node).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'Close checkpoint explanation'}).click();await expect(node).toBeFocused();
 await page.keyboard.press('Enter');await expect(node).toHaveAttribute('aria-expanded','true');
 assert.deepEqual(errors,[]);await ctx.close();
});
test('phone allows scrolling to the final checkpoint and then the complete history',async()=>{
 const{ctx,page,errors}=await setup({viewport:{width:390,height:844}});
 const last=page.locator('[data-id="message_help"]');await last.scrollIntoViewIfNeeded();await last.click();
 await expect(page.locator('.wf-node-panel')).toBeVisible();
 const panels=page.locator('.dr-panels');await panels.evaluate(e=>e.scrollTop=e.scrollHeight);
 await expect(page.locator('.wf-log')).toBeInViewport();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'work/workflow-static-phone.png',fullPage:true});
 const axe=await new AxeBuilder({page}).include('.wf').analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
 assert.deepEqual(errors,[]);await ctx.close();
});
test('refresh retains history scroll and explanation, handles empty data and teardown',async()=>{
 const{ctx,page,errors}=await setup();
 await page.evaluate(()=>HomeBeaconKit.setTheme('dark'));
 const many={...fixture,derived:true,coverage:{truncated:true},events:Array.from({length:100},(_,i)=>({...fixture.events[0],id:'long-'+i,at:new Date(Date.parse('2026-11-08T08:00:00Z')+i*60000).toISOString(),text:'Reading '+i}))};
 await page.evaluate(f=>wf.update(f),many);await expect(page.locator('.wf-ev')).toHaveCount(100);await expect(page.locator('.wf-banner')).toHaveText('Showing the most recent 100 events.');
 await page.locator('[data-id="rules_latch"]').click();await page.locator('.wf-node-panel summary').click();
 await page.locator('.wf-events').evaluate(e=>e.scrollTop=500);await page.evaluate(f=>wf.update(f),many);
 await expect(page.locator('.wf-node-panel details')).toHaveAttribute('open','');assert.equal(await page.locator('.wf-events').evaluate(e=>e.scrollTop),500);
 await page.evaluate(f=>wf.update({...f,events:[]}),fixture);await expect(page.locator('.wf-log')).toContainText('No recorded events');
 await page.evaluate(()=>wf.destroy());await expect(page.locator('.wf-node')).toHaveCount(0);assert.deepEqual(errors,[]);await ctx.close();
});
