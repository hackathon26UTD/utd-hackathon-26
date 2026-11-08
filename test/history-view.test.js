import {test} from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';import {readFile} from 'node:fs/promises';import {chromium} from '@playwright/test';
test('history view labels each sensor independently when only one has a qualified reference',async t=>{
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';if(!existsSync(chrome)&&!existsSync(chromium.executablePath()))return t.skip('Local Chromium unavailable.');
 const browser=await chromium.launch(existsSync(chrome)?{executablePath:chrome}:{}),page=await browser.newPage();try{
  await page.route('https://history.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));await page.goto('https://history.test');
  await page.evaluate(()=>{window.Kit={popUpWindow:({body})=>document.body.append(body),select:()=>{const d=document.createElement('div');d.append(document.createElement('button'));d.kitValue=()=>30;return d;},details:({items})=>{const root=document.createElement('section');for(const item of items){const card=document.createElement('article');card.textContent=[item.label,item.value,item.sub].join(' | ');root.append(card);}return root;}};window.fetch=async()=>({ok:true,json:async()=>({daily:[{day:'2026-11-08',metrics:{}}],baseline:{status:'observed_reference',metrics:{temperature:{label:'Temperature',unit:'°C',mean:22,min:21,max:23,count:30,status:'observed_reference'},humidity:{label:'Humidity',unit:'%',mean:50,min:50,max:50,count:1,status:'insufficient_history'}}}})});});
  const source=await readFile(new URL('../ui/device-history.js',import.meta.url),'utf8');await page.addScriptTag({content:source.replace('export function openDeviceHistory','window.openDeviceHistory=function')});await page.evaluate(()=>window.openDeviceHistory('test'));
  await page.waitForFunction(()=>document.querySelectorAll('article').length===2);
  const cards=await page.locator('article').allTextContents();assert.match(cards[0],/30 eligible samples · Recorded reference/);assert.match(cards[1],/1 eligible sample · Still learning/);assert.doesNotMatch(cards[1],/Recorded reference/);
 }finally{await browser.close();}
});
