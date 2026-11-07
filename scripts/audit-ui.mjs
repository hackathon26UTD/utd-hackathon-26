import {chromium} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();
const issues=[];
for(const path of ['/login','/demo','/privacy','/terms','/cookies','/accessibility','/reset-password']){
 await page.goto('http://localhost:8791'+path);await page.waitForTimeout(1200);
 const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 issues.push({path,violations:results.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});
}
await page.goto('http://localhost:8791/demo');await page.getByRole('button',{name:'Essential only',exact:true}).click();
await page.getByRole('combobox',{name:'Filter by response priority'}).selectOption('critical');
if(await page.locator('.property').count()!==3)throw Error('Priority filtering failed');
await page.getByRole('button',{name:'Record follow-up',exact:true}).click();
await page.keyboard.press('Escape');
if(await page.locator('dialog[open]').count())throw Error('Dialog did not close');
await page.getByRole('combobox',{name:'Filter by response priority'}).selectOption('all');
const out=process.env.OUTPUT_DIR||'work';await mkdir(out,{recursive:true});
await page.evaluate(()=>document.activeElement?.blur());await page.waitForTimeout(2500);
await page.screenshot({path:out+'/homebeacon-command-center.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/homebeacon-mobile.png',fullPage:true});
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)issues.push({mobileOverflow:true});
await writeFile('docs/accessibility-audit.json',JSON.stringify(issues,null,2));
await browser.close();console.log(JSON.stringify(issues,null,2));if(issues.some(i=>i.violations?.length||i.mobileOverflow))process.exitCode=1;
