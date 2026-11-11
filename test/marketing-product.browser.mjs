import{createServer}from'node:http';import{readFile}from'node:fs/promises';import{resolve,extname}from'node:path';import{chromium,expect}from'@playwright/test';import{onRequest}from'../functions/api/demo.js';
const remote=process.argv[2];
const server=remote?null:createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/api/demo'){const r=await onRequest({request:new Request(u)});res.writeHead(r.status,{'Content-Type':'application/json'}).end(await r.text());return;}if(u.pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json'}).end('{}');return;}const name=u.pathname==='/'?'index.html':!extname(u.pathname)?u.pathname+'.html':u.pathname;const f=resolve('public',name.replace(/^\//,''));if(!f.startsWith(resolve('public')+'/'))return res.writeHead(404).end();try{const b=await readFile(f);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'})[extname(f)]||'application/octet-stream'}).end(b);}catch{res.writeHead(404).end();}});
if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=remote||`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const context = await browser.newContext({viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
 const page = await context.newPage(), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 await expect(page.getByRole('heading',{name:/See trouble sooner/})).toBeVisible();
 await page.getByRole('button',{name:'Your home',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your home, at a glance.'})).toBeVisible();
 await expect(page.locator('#home-preview-pause')).toBeDisabled();
 await page.getByRole('button',{name:'Event history',exact:true}).click();
 await expect(page.getByRole('heading',{name:'A moment becomes a record.'})).toBeVisible();
 await page.getByRole('button',{name:'Command map',exact:true}).click();
 await expect(page.locator('#home-preview')).toBeVisible();
 await page.screenshot({path:'../../outputs/Safe-Home-marketing-home.png',fullPage:false});
 await page.locator('#device').scrollIntoViewIfNeeded();
 await expect(page.locator('#marketing-enclosure')).toHaveAttribute('data-loaded','true',{timeout:30000});
 await expect(page.locator('#marketing-enclosure')).toHaveAttribute('data-lid','open');
 await page.getByRole('button',{name:'Staying connected',exact:true}).click();
 await expect(page.locator('#box-feature-title')).toHaveText('A box. A nearby hub. A wider view.');
 await page.getByRole('button',{name:'Connected sensors',exact:true}).click();
 await expect(page.locator('#box-feature-title')).toHaveText('Small signals, useful context.');
 // Ray-pick the connection hotspot in the actual assembled model, not only its text alternative.
 const THREE = await import('three');
 const rect = await page.locator('#marketing-enclosure canvas').boundingBox();
 const camera = new THREE.PerspectiveCamera(34, rect.width / rect.height, 1, 2000);
 camera.position.set(310,255,360);camera.lookAt(0,52,0);camera.updateMatrixWorld();
 const point = new THREE.Vector3(28,39,-22).applyAxisAngle(new THREE.Vector3(0,1,0),-.2).project(camera);
 await page.mouse.click(rect.x+(point.x+1)/2*rect.width,rect.y+(1-point.y)/2*rect.height);
 await expect(page.locator('#box-feature-title')).toHaveText('A box. A nearby hub. A wider view.');
 await page.getByRole('button',{name:'Close lid',exact:true}).click();
 await expect(page.locator('#marketing-enclosure')).toHaveAttribute('data-lid','closed');
 const canvas=page.locator('#marketing-enclosure canvas');await canvas.focus();await page.keyboard.press('Enter');
 await expect(page.locator('#marketing-enclosure')).toHaveAttribute('data-lid','open');
 await page.keyboard.press('ArrowRight');await page.keyboard.press('Home');
 await page.screenshot({path:'../../outputs/Safe-Home-box-explorer.png',fullPage:false});
 const {default:AxeBuilder}=await import('@axe-core/playwright');
 const audit=await new AxeBuilder({page}).include('#device').include('.home-showcase-tabs').analyze();
 if(audit.violations.length)throw Error(JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
 for(const width of [320,390,768]) {
  await page.setViewportSize({width,height:844});
  for(const selector of ['#home-header','#device']) {await page.locator(selector).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(origin+'/about');
 await expect(page.getByRole('heading',{name:'A weekend build. A lasting question.'})).toBeVisible();
 await expect(page.getByRole('link',{name:'About',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.locator('main')).toContainText('Ayan, Dhruv, Adyaan and Saif');
 await expect(page.locator('#home-preview')).toHaveCount(0);
 await page.screenshot({path:'../../outputs/Safe-Home-about.png',fullPage:false});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 if(errors.length)throw Error(JSON.stringify(errors));
 console.log(JSON.stringify({origin,showcase:true,model:true,lidKeyboard:true,features:true,about:true,widths:[320,390,768],accessibilityViolations:audit.violations.length,errors}));
} finally {await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
