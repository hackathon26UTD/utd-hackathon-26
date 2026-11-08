import{createServer}from'node:http';import{readFile}from'node:fs/promises';import{resolve,extname}from'node:path';import{chromium,expect}from'@playwright/test';import{onRequest}from'../functions/api/demo.js';
const remote=process.argv[2];
const server=remote?null:createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/api/demo'){const r=await onRequest({request:new Request(u)});res.writeHead(r.status,{'Content-Type':'application/json'}).end(await r.text());return;}if(u.pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json'}).end('{}');return;}const name=u.pathname==='/'?'index.html':!extname(u.pathname)?u.pathname+'.html':u.pathname;const f=resolve('public',name.replace(/^\//,''));if(!f.startsWith(resolve('public')+'/'))return res.writeHead(404).end();try{const b=await readFile(f);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'})[extname(f)]||'application/octet-stream'}).end(b);}catch{res.writeHead(404).end();}});
if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=remote||`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'no-preference'});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 const flow=page.frameLocator('#home-preview').locator('.wind-flow');
 await expect(flow).toHaveAttribute('data-running','true');
 await expect(page.locator('#home-preview-label')).toContainText('Power outage',{timeout:12000});
 await page.getByRole('button',{name:'Pause overview animation',exact:true}).click();
 await expect(flow).toHaveAttribute('data-running','false');
 const paused=await page.locator('#home-preview-label').innerText();await page.waitForTimeout(7000);
 await expect(page.locator('#home-preview-label')).toHaveText(paused);
 await page.getByRole('button',{name:'Play overview animation',exact:true}).click();await expect(flow).toHaveAttribute('data-running','true');
 await page.screenshot({path:'work/hero-desktop.png',fullPage:false});
 await page.locator('#home-profile>summary').click();await expect(page.locator('#home-profile-link')).toBeVisible();
 await page.locator('#home-settings>summary').click();
 await page.getByRole('button',{name:'Choose avatar 4',exact:true}).click();await expect(page.locator('#home-avatar')).toHaveAttribute('src','/assets/avatars/face-04.svg');
 await page.keyboard.press('Escape');await expect(page.locator('#home-profile')).not.toHaveAttribute('open','');
 await page.reload();await expect(page.locator('#home-avatar')).toHaveAttribute('src','/assets/avatars/face-04.svg');
 // Test actual Kit dropdowns, not their hidden native selects.
 await page.locator('#home-profile>summary').click();await page.locator('#home-settings>summary').click();
 await page.getByRole('button',{name:/^Theme:/}).click();await page.getByRole('option',{name:'Dark',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-hbkit-theme','dark');
 await page.waitForTimeout(350);await page.screenshot({path:'work/hero-dark-menu.png',fullPage:false});
 const {default:AxeBuilder}=await import('@axe-core/playwright');
 const audit=await new AxeBuilder({page}).include('.home-header').include('.home-signals').analyze();
 if(audit.violations.length)throw Error(JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
 await page.locator('#home-profile>summary').click();
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.getByRole('button',{name:'Next simulated scenario',exact:true})).toBeVisible();
 await expect(flow).toHaveAttribute('data-running','false');
 const before=await page.locator('#home-preview-label').innerText();await page.getByRole('button',{name:'Next simulated scenario',exact:true}).click();
 await expect(page.locator('#home-preview-label')).not.toHaveText(before);
 await page.evaluate(()=>window.HomeBeaconKit.setTheme('light'));
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow '+width);
  await page.locator('#home-profile>summary').click();await page.locator('#home-settings>summary').click();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Menu overflow '+width);
  await page.screenshot({path:`work/hero-mobile-${width}.png`,fullPage:false});await page.keyboard.press('Escape');
 }
 await page.setViewportSize({width:1440,height:960});await page.emulateMedia({reducedMotion:'no-preference'});
 await page.goto(origin+'/demo?scenario=water-hurricane');
 await page.getByRole('button',{name:/^Map view:/}).click();await page.getByRole('option',{name:'Wind',exact:true}).click();
 await expect(page.locator('.wind-flow')).toHaveAttribute('data-running',remote?'true':'false');
 await expect(page.locator('.world-note')).toContainText('Forecast wind speeds');
 await page.getByRole('button',{name:'Pause wind',exact:true}).click();await expect(page.locator('.wind-flow')).toHaveAttribute('data-running','false');
 await page.screenshot({path:'work/wind-simulation.png',fullPage:false});
 await page.getByRole('button',{name:/^Map view:/}).click();await page.getByRole('option',{name:'Overview',exact:true}).click();
 await expect(page.locator('.wind-flow')).toHaveAttribute('data-samples','0');
 // Signed-in photos use only the existing private endpoint; fixture contains no real account.
 await page.route('**/api/customer/me',route=>route.fulfill({json:{authenticated:true,role:'customer'}}));
 await page.route('**/api/customer/photo',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7Z8AAAAASUVORK5CYII=','base64')}));
 await page.goto(origin);await expect(page.locator('#home-profile-link')).toHaveAttribute('href','/customer#profile');
 await expect(page.locator('#home-avatar')).toHaveAttribute('src',/^blob:/);
 await expect.poll(()=>page.locator('#home-avatar').evaluate(img=>img.naturalWidth)).toBe(1);
 if(errors.length)throw Error(JSON.stringify(errors));console.log(JSON.stringify({origin,autoplay:true,pause:true,avatars:true,kitTheme:true,reducedMotion:true,widths:[320,390,768],windView:true,errors}));
}finally{await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
