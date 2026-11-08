// Run: node --test test/fleet-ui.browser.mjs
// Fixture-only browser checks, not backend E2E. Builds into a disposable directory.
// No live API, production credentials, screenshots, traces or videos are used.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm, copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {resolve, extname} from 'node:path';
import {chromium, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
let browser, server, origin, outdir;
const records=[
 {id:'d1', serial:'HB-AAAA-BBBB', name:'Bench one', fleetStatus:{state:'active',reason:null}, linked:true,linkedCustomer:{name:'Shared Person',email:'shared@example.test'},lastSeenAt:new Date().toISOString(),firmwareVersion:'1.2.3',keyCreatedAt:'2026-10-01T00:00:00Z',keyRotatedAt:'2026-11-01T00:00:00Z',homeId:'h1',disabled:false},
 {id:'d2',serial:'HB-CCCC-DDDD',name:'Unlinked box',fleetStatus:{state:'inactive',reason:'not_linked'},linkedCustomer:null,lastSeenAt:null,firmwareVersion:null,keyCreatedAt:null,keyRotatedAt:null,homeId:null,disabled:false},
 {id:'d3',serial:'HB-EEEE-FFFF',name:'Private box',fleetStatus:{state:'inactive',reason:'silent'},linked:true,linkedCustomer:{name:'DO NOT SHOW',email:'private@example.test',consent:false},lastSeenAt:'2026-01-01T00:00:00Z',disabled:true},
 {id:'d4',serial:'HB-GGGG-HHHH',name:'<img src=x onerror=alert(1)>',fleetStatus:{state:'inactive',reason:'disabled'},linked:true,linkedCustomer:null,disabled:true},
];
before(async()=>{
 outdir=await mkdtemp(resolve(tmpdir(),'fleet-ui-test-'));
 await build({absWorkingDir:root,entryPoints:['ui/app.js','ui/design.css','ui/product-kit.css'],outdir,bundle:true,splitting:true,format:'esm',loader:{'.woff2':'file','.woff':'file'},logLevel:'silent'});
 await build({absWorkingDir:root,entryPoints:[{in:'ui/kit/kit.entry.js',out:'kit'}],outdir,bundle:true,format:'iife',loader:{'.woff2':'file'},logLevel:'silent'});
 await copyFile(require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'),resolve(outdir,'map-worker.mjs'));
 server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://local').pathname;
 if(path==='/harness')return res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fleet test</title><link rel="stylesheet" href="/assets/kit.css"><link rel="stylesheet" href="/ui/fleet.css"><script src="/assets/kit.js"></script></head><body class="light-mode"><main><section id="fleet"></section></main><script type="module">import{mountFleet}from'/ui/fleet.js';window.requests=[];window.records=${JSON.stringify(records)};window.fail=null;window.nextAction=null;window.delay=0;window.mockApi=async(url,options)=>{requests.push({url,...options});if(options?.method==='POST'){await new Promise(r=>setTimeout(r,window.delay));return window.nextAction||{ok:true,data:{ok:true}}}return window.fail||{ok:true,data:{devices:window.records}}};window.fleet=mountFleet(document.querySelector('#fleet'),{api:mockApi,role:new URLSearchParams(location.search).get('role')||'operator'});await fleet.refresh();window.ready=true;</script></body></html>`);
 const base=path.startsWith('/assets/')?outdir:root;
 const file=resolve(base,path.startsWith('/assets/')?'.'+path.slice('/assets'.length):path.startsWith('/ui/')?'.'+path:'public'+(['/command-center','/demo'].includes(path)?'/command-center.html':path));
 if(!file.startsWith(resolve(base)+'/'))return res.writeHead(404).end();
 try{const content=await readFile(file);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.html':'text/html'})[extname(file)]||'application/octet-stream'});res.end(content);}catch{res.writeHead(404).end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(existsSync(chromium.executablePath())?{}:{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})});
});
after(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(outdir)await rm(outdir,{recursive:true,force:true});});
async function setup(role='operator',width=1440){const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin+'/harness?role='+role);await page.waitForFunction(()=>window.ready);return{page,errors};}
async function action(page, label, serial='HB-CCCC-DDDD'){
 await page.getByRole('button',{name:'Manage '+serial,exact:true}).click();
 await page.getByRole('button',{name:label,exact:true}).click();
 return page.getByRole('dialog',{name:label,exact:true});
}
async function confirm(page,label,serial='HB-CCCC-DDDD'){
 const dialog=await action(page,label,serial);await dialog.getByLabel('Type serial '+serial).fill(serial);await dialog.getByLabel(/^Reason \(/).fill('Bench maintenance');return dialog;
}
test('lists requested fields, server states and consent-filtered identities safely',async()=>{
 const {page,errors}=await setup();
 await expect(page.getByRole('table')).toContainText('Shared Person');
 await expect(page.getByRole('table')).not.toContainText('DO NOT SHOW');await expect(page.getByRole('table')).not.toContainText('private@example.test');
 await expect(page.getByRole('table')).toContainText('contact not shared');
 await expect(page.getByRole('columnheader',{name:'Key created'})).toBeVisible();await expect(page.getByRole('columnheader',{name:'Key rotated'})).toBeVisible();
 await expect(page.getByRole('table').locator('img')).toHaveCount(0);
 await expect(page.getByRole('table')).toContainText('Unknown');
 await page.getByLabel('Search fleet').fill('DO NOT SHOW');await expect(page.getByText('No boxes match these filters.')).toBeVisible();
 await page.getByLabel('Search fleet').fill('Shared Person');await expect(page.locator('tbody tr')).toHaveCount(1);
 assert.deepEqual(errors,[]);await page.context().close();
});
test('state, reason, consent, firmware and sort controls work',async()=>{
 const {page}=await setup();
 await page.getByLabel('State',{exact:true}).click();await page.getByRole('option',{name:'Active',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByLabel('State',{exact:true}).click();await page.getByRole('option',{name:'All states',exact:true}).click();
 await page.getByLabel('Reason',{exact:true}).click();await page.getByRole('option',{name:'Not linked',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByLabel('Reason',{exact:true}).click();await page.getByRole('option',{name:'All reasons',exact:true}).click();
 await page.getByLabel('Contact consent',{exact:true}).click();await page.getByRole('option',{name:'Sharing allowed',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByLabel('Firmware',{exact:true}).fill('unknown');await expect(page.getByText('No boxes match these filters.')).toBeVisible();
 await page.getByLabel('Firmware',{exact:true}).fill('1.2.3');await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByLabel('Sort',{exact:true}).click();await page.getByRole('option',{name:'Oldest key first',exact:true}).click();await page.context().close();
});
for(const [label,name,serial] of [['Disable box','disable','HB-CCCC-DDDD'],['Enable box','enable','HB-EEEE-FFFF'],['Rotate key','rotate_key','HB-CCCC-DDDD'],['Reassign home','reassign_home','HB-CCCC-DDDD'],['Force unlink','force_unlink','HB-AAAA-BBBB']])test(label+' requires exact serial and reason, posts the agreed contract',async()=>{
 const{page,errors}=await setup();const dialog=await action(page,label,serial);
 await dialog.getByLabel('Type serial '+serial).fill('wrong');await dialog.getByLabel(/^Reason \(/).fill('   ');
 if(name==='reassign_home')await dialog.getByLabel('New home ID').fill('h2');
 await dialog.getByRole('button',{name:label,exact:true}).click();assert.equal(await page.evaluate(()=>requests.filter(r=>r.method==='POST').length),0);
 await dialog.getByLabel('Type serial '+serial).fill(serial);await dialog.getByRole('button',{name:label,exact:true}).click();assert.equal(await page.evaluate(()=>requests.filter(r=>r.method==='POST').length),0);
 await dialog.getByLabel(/^Reason \(/).fill('Bench maintenance');await dialog.getByRole('button',{name:label,exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>requests.filter(r=>r.method==='POST').length)).toBe(1);
 const request=await page.evaluate(()=>requests.find(r=>r.method==='POST'));assert.equal(request.url,`/api/ops/fleet/${name==='enable'?'d3':name==='force_unlink'?'d1':'d2'}/action`);
 assert.deepEqual(request.body,{action:name,confirmSerial:serial,reason:'Bench maintenance',...(name==='reassign_home'?{homeId:'h2'}:{})});assert.deepEqual(errors,[]);await page.context().close();
});
test('linked boxes cannot be reassigned, including links without contact consent',async()=>{
 const{page}=await setup();
 for(const serial of ['HB-AAAA-BBBB','HB-EEEE-FFFF','HB-GGGG-HHHH']){
 await page.getByRole('button',{name:'Manage '+serial,exact:true}).click();await expect(page.getByRole('button',{name:'Reassign home',exact:true})).toBeDisabled();await page.getByRole('dialog',{name:serial,exact:true}).getByRole('button',{name:'Close',exact:true}).click();}
 await page.context().close();
});
test('demo and unknown roles expose no actions and issue no writes',async()=>{
 for(const role of ['demo','customer','unknown']){const{page}=await setup(role);await expect(page.getByRole('button',{name:/Manage/})).toHaveCount(0);assert.equal(await page.evaluate(()=>requests.some(r=>r.method==='POST')),false);if(role==='demo')await expect(page.getByText('Exercise records only. Read-only fleet.')).toBeVisible();await page.context().close();}
});
test('rotation secret is masked, one-time, absent from storage, and cleared on close',async()=>{
 const{page}=await setup();await page.evaluate(()=>window.nextAction={ok:true,data:{deviceKey:'dk_DISPOSABLE_TEST_VALUE'}});
 const dialog=await confirm(page,'Rotate key');await dialog.getByRole('button',{name:'Rotate key',exact:true}).click();
 const secret=page.getByLabel('New device key',{exact:true});await expect(secret).toHaveAttribute('type','password');await expect(secret).toHaveValue('dk_DISPOSABLE_TEST_VALUE');
 assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)+JSON.stringify(sessionStorage)),'{}{}');
 await page.getByRole('button',{name:'Show key',exact:true}).click();await expect(secret).toHaveAttribute('type','text');
 await page.evaluate(()=>window.oldSecret=document.querySelector('[name=newDeviceKey]'));
 await page.getByRole('button',{name:'Done, clear key',exact:true}).click();assert.equal(await page.evaluate(()=>oldSecret.value),'');await expect(secret).toHaveCount(0);
 await page.getByRole('button',{name:'Refresh fleet',exact:true}).click();await expect(secret).toHaveCount(0);await page.context().close();
});
test('rotation clears on Escape, panel departure, page hide and visibility loss',async()=>{
 for(const end of ['escape','hide','pagehide','visibility']){
 const{page}=await setup();await page.evaluate(()=>window.nextAction={ok:true,data:{deviceKey:'dk_DISPOSABLE_TEST_VALUE'}});
 const dialog=await confirm(page,'Rotate key');await dialog.getByRole('button',{name:'Rotate key',exact:true}).click();await expect(page.getByLabel('New device key',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.oldSecret=document.querySelector('[name=newDeviceKey]'));
 if(end==='escape')await page.keyboard.press('Escape');else await page.evaluate(end=>{if(end==='hide')fleet.hide();if(end==='pagehide')window.dispatchEvent(new Event('pagehide'));if(end==='visibility'){Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));}},end);
 assert.equal(await page.evaluate(()=>oldSecret.value),'');await page.context().close();}
});
test('dismissed in-flight rotation never reopens a key display or sends twice',async()=>{
 const{page}=await setup();await page.evaluate(()=>{window.delay=250;window.nextAction={ok:true,data:{deviceKey:'dk_DISPOSABLE_TEST_VALUE'}}});
 const dialog=await confirm(page,'Rotate key');await dialog.getByRole('button',{name:'Rotate key',exact:true}).click();await page.keyboard.press('Escape');
 await expect(page.locator('.fleet-status')).toContainText('one-time display is unavailable');await expect(page.getByLabel('New device key',{exact:true})).toHaveCount(0);
 assert.equal(await page.evaluate(()=>requests.filter(r=>r.method==='POST').length),1);await page.context().close();
});
test('read failure removes stale customer details and action errors never echo a server secret',async()=>{
 const{page}=await setup();await page.evaluate(()=>window.nextAction={ok:false,status:409,error:'dk_DO_NOT_ECHO'});
 const dialog=await confirm(page,'Disable box');await dialog.getByRole('button',{name:'Disable box',exact:true}).click();await expect(dialog).toContainText('Refresh Fleet');await expect(page.locator('body')).not.toContainText('dk_DO_NOT_ECHO');
 await page.keyboard.press('Escape');await page.evaluate(()=>{window.fail={ok:false,status:403};return fleet.refresh()});await expect(page.getByRole('table')).toHaveCount(0);await expect(page.locator('body')).not.toContainText('Shared Person');await page.context().close();
});
test('phone layout, keyboard controls and scoped accessibility',async()=>{
 const{page,errors}=await setup('operator',390);await expect(page.getByLabel('Search fleet')).toBeVisible();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const violations=(await new AxeBuilder({page}).include('#fleet').analyze()).violations;assert.deepEqual(violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
 await page.setViewportSize({width:1440,height:900});await expect(page.getByRole('table')).toBeVisible();
 assert.deepEqual(errors,[]);await page.context().close();
});

test('integrated command center opens Fleet, scopes demo requests and returns to map',async()=>{
 for(const mode of ['operator','demo']){
 const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
 const page=await context.newPage(), errors=[], fleetRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.origin!==origin){
   if(u.pathname.endsWith('.json'))return route.fulfill({json:{version:8,sources:{},layers:[]}});
   return route.abort();
 }
 if(!u.pathname.startsWith('/api/'))return route.continue();
 if(u.pathname==='/api/session')return route.fulfill({json:{role:mode}});
 if(u.pathname==='/api/ops/fleet'){fleetRequests.push(u.search);return route.fulfill({json:{devices:records}});}
 if(u.pathname==='/api/command-center')return route.fulfill({json:{devices:[],properties:[]}});
 if(u.pathname==='/api/ops/live')return route.fulfill({json:{devices:[],events:[],snapshot:true,serverTime:new Date().toISOString()}});
 if(u.pathname==='/api/ops/regions')return route.fulfill({json:{regions:[]}});
 if(u.pathname==='/api/public/news')return route.fulfill({json:{type:'FeatureCollection',features:[]}});
 return route.fulfill({json:{devices:[],features:[],regions:[],items:[],followUps:[]}});
 });
 await page.goto(origin+(mode==='demo'?'/demo':'/command-center'));
 await expect(page.locator('[data-view="review"]')).toBeVisible();
 await page.locator('[data-view="fleet"]').click();
 await expect(page.locator('#fleet-panel')).toBeVisible();await expect(page.locator('#fleet-panel tbody tr')).toHaveCount(4);
 assert.deepEqual(fleetRequests,[mode==='demo'?'?mode=exercise':'']);
 if(mode==='demo')await expect(page.locator('#fleet-panel').getByRole('button',{name:/Manage/})).toHaveCount(0);
 else await expect(page.locator('#fleet-panel').getByRole('button',{name:/Manage/})).toHaveCount(4);

 await page.locator('#fleet-panel').getByRole('button',{name:'Back to map',exact:true}).click();
 await expect(page.locator('#fleet-panel')).toBeHidden();await expect(page.locator('.board')).not.toHaveAttribute('aria-hidden','true');
 assert.deepEqual(errors,[]);await context.close();
 }
});

test('fleet reasons over the backend limit never submit',async()=>{
 const{page}=await setup();
 const dialog=await confirm(page,'Disable box');
 const reason=dialog.getByLabel(/^Reason \(/);
 // Bypass the native cap to also exercise JavaScript validation.
 await reason.evaluate(node=>{node.value='x'.repeat(161);});
 await dialog.getByRole('button',{name:'Disable box',exact:true}).click();
 assert.equal(await page.evaluate(()=>requests.filter(r=>r.method==='POST').length),0);
 await expect(dialog).toContainText('160');
 await page.context().close();
});
