// Run after npm run build. API responses are fixtures; authentication is tested against MongoDB separately.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
let server,browser,origin;
before(async()=>{
 server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');let path=url.pathname;if(!extname(path))path=path==='/'?'/index.html':path+'.html';const file=resolve('public','.'+path);if(!file.startsWith(resolve('public')+'/'))return res.writeHead(404).end();try{const content=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'}).end(content);}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});await mkdir('work/shots',{recursive:true});
});
after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
async function setup({role=null,width=1440,successRole='customer',fail=false}={}){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const destinations={customer:'/customer',operator:'/command-center',demo:'/simulations'};
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
  if(['/customer','/command-center','/simulations'].includes(url.pathname))return route.fulfill({contentType:'text/html',body:'<h1>Destination fixture</h1>'});
  if(url.pathname==='/api/access'){if(req.method()==='GET')return route.fulfill({status:role?200:401,json:role?{authenticated:true,role,destination:destinations[role]}:{authenticated:false}});
   const body=req.postDataJSON();calls.push(body);return route.fulfill({status:fail?401:200,json:fail?{error:'Email or password is incorrect.'}:{authenticated:true,role:successRole,destination:destinations[successRole]+(body.action==='signup'?'#add-device':'')}});
  }
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{authenticated:false}});return route.continue();
 });return{page,context,calls,errors};
}
for(const width of [1440,390])test(`shared signup and Argus tabs fit ${width}px`,async()=>{
 const {page,context,errors}=await setup({width});await page.goto(origin+'/signup');await expect(page.getByRole('heading',{name:'Your home, connected.'})).toBeVisible();
 await expect(page.getByLabel('Your name',{exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const axe=await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
 await page.screenshot({path:`work/shots/dashboard-signup-${width}.png`,fullPage:true});
 await page.getByRole('tab',{name:'Sign up'}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'Sign in'})).toBeFocused();await expect(page.getByLabel('Your name',{exact:true})).toBeHidden();await expect(page.getByRole('button',{name:'Open dashboard'})).toBeVisible();assert.deepEqual(errors,[]);await context.close();
});
for(const role of ['operator','customer','demo'])test('existing '+role+' skips signup; sign-in opens correct workspace',async()=>{
 const first=await setup({role});await first.page.goto(origin+'/signup');await expect(first.page.getByRole('heading',{name:'Destination fixture'})).toBeVisible();assert.match(first.page.url(),new RegExp(role==='operator'?'/command-center':role==='customer'?'/customer':'/simulations'));await first.context.close();
 const {page,context,calls}=await setup({successRole:role});await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill('test@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Open dashboard'}).click();await expect(page.getByRole('heading',{name:'Destination fixture'})).toBeVisible();assert.equal(calls[0].action,'login');assert.equal(calls[0].role,undefined);await context.close();
});
test('signup goes to Add device and wrong credentials remain editable',async()=>{
 const {page,context,calls}=await setup();await page.goto(origin+'/signup');await page.getByLabel('Your name',{exact:true}).fill('Test');await page.getByLabel('Email',{exact:true}).fill('test@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create account'}).click();await expect(page).toHaveURL(origin+'/customer#add-device');assert.equal(calls[0].acceptTerms,true);await context.close();
 const bad=await setup({fail:true});await bad.page.goto(origin+'/login');await bad.page.getByLabel('Email',{exact:true}).fill('test@example.test');await bad.page.getByLabel('Password',{exact:true}).fill('wrong');await bad.page.getByRole('button',{name:'Open dashboard'}).click();await expect(bad.page.getByRole('status')).toContainText('Email or password is incorrect.');await expect(bad.page.getByRole('button',{name:'Open dashboard'})).toBeEnabled();await bad.context.close();
});
test('explicit account switch does not loop back to an existing demo session',async()=>{
 const {page,context}=await setup({role:'demo'});await page.goto(origin+'/login?role=operator&next=review');await expect(page.getByRole('button',{name:'Open dashboard'})).toBeVisible();await context.close();
});
