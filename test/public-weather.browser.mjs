// Live integration check. Run against dev:local or a deployed URL; requires available NWS/NOAA sources.
import {chromium,expect} from '@playwright/test';
const origin=process.argv[2]||'http://127.0.0.1:8793';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto(origin+'/demo?scenario=water-hurricane');await expect(page.locator('#map-hazards')).toBeVisible();
 await expect(page.getByText('Map key & sources',{exact:true})).toHaveCount(0);await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(0);await expect(page.locator('#overlay-toggle')).toBeHidden();
 await expect(page.locator('.map-credits')).toBeVisible();
 await page.locator('#map-hazards').click();const weather=page.getByRole('checkbox',{name:/Weather alerts/});await expect(weather).toBeEnabled();await weather.check();await expect(page.getByText('Sign in as an operator to load public layers.')).toHaveCount(0);await page.keyboard.press('Escape');
 await page.locator('[data-view="news"]').click();await expect(page.locator('.news-card').first()).toBeVisible({timeout:30000});
 await expect(page.locator('.news-status')).toContainText('active alerts');
 await page.screenshot({path:'work/news-desktop.png'});
 // Use a mainland alert with an existing supplied polygon for the real-source map check.
 const cards=page.locator('.news-card');let selected=false;
 for(let i=0;i<await cards.count();i++){const txt=await cards.nth(i).innerText();if(/Flood|Tornado|Wind Advisory|Dense Fog/.test(txt)){await cards.nth(i).getByRole('button',{name:'Show on map'}).click();selected=true;break;}}
 if(!selected)throw Error('No suitable mainland source alert for map check');
 await expect(page.locator('#news-panel')).toBeHidden({timeout:45000});await expect(page.locator('.local-alerts')).toBeVisible({timeout:45000});await page.screenshot({path:'work/news-local.png'});
 await page.locator('#radar-toggle').click();await expect(page.locator('#radar-controls')).toBeVisible();await expect(page.locator('#radar-controls output')).not.toContainText('Loading',{timeout:45000});
 await expect(page.locator('[data-radar-play]')).toHaveText('Pause',{timeout:45000});await page.locator('[data-radar-play]').click();await expect(page.locator('[data-radar-play]')).toHaveText('Play');
 await page.screenshot({path:'work/news-radar.png'});
 for(const width of [390,768]){await page.setViewportSize({width,height:844});await page.waitForTimeout(500);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow '+width);await page.screenshot({path:'work/news-mobile-'+width+'.png'});}
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('[data-radar-play]')).toBeDisabled();
 await page.locator('#radar-toggle').click();await page.locator('[data-view="news"]').click();
 const {default:AxeBuilder}=await import('@axe-core/playwright');const audit=await new AxeBuilder({page}).include('#news-panel').analyze();if(audit.violations.length)throw Error(JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
 if(errors.length)throw Error(JSON.stringify(errors));console.log(JSON.stringify({origin,news:true,hazardsPublic:true,radarRealFrames:true,phone:true,errors}));
}finally{await browser.close();}
