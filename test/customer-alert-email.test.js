import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCustomerAlertEmail as render } from '../src/customer-alert-email.js';
const sample={event:'detected-condition',homeLabel:'Example home',severity:'critical',source:'device',observedAt:'2026-11-08T12:00:00Z',now:'2026-11-08T12:05:00Z',power:'out',wifi:'offline',conditions:['water']};
test('concise facts include actual observation, source and freshness',()=>{
  const {text,html,subject}=render(sample);
  for(const phrase of ['Power: Power loss reported','Wi-Fi: Offline reported','Conditions: Water detected','Observed: 2026-11-08T12:00:00.000Z','Source: Device observation','Freshness: Recent observation','Critical condition'])assert.ok(text.includes(phrase),phrase);
  assert.ok(subject.includes('review needed'));assert.ok(![subject,html,text].some(value=>value.includes('—')));assert.ok(html.includes('lang="en"'));
  assert.ok(text.includes('do not establish current safety or confirm that help has been dispatched'));
});
test('HTML input is escaped and unsupported fact fields never render',()=>{
  const r=render({...sample,homeLabel:'<img src=x onerror="bad"> & \'',power:'<script>power</script>',wifi:'toString',source:'constructor',conditions:['<b>fire</b>','water'],html:'<script>injected</script>',helpDispatched:true,notes:'PRIVATE_NOTES'});
  assert.ok(r.html.includes('&lt;img'));assert.ok(r.html.includes('&quot;'));assert.ok(r.html.includes('&#39;'));
  assert.ok(!r.html.includes('<img'));assert.ok(!r.html.includes('<script>'));assert.ok(!r.text.includes('PRIVATE_NOTES'));
  assert.ok(r.text.includes('Power: Unknown'));assert.ok(r.text.includes('Wi-Fi: Unknown'));assert.ok(r.text.includes('Source: Unknown source'));
  assert.ok(r.text.includes('Conditions: Water detected'));
});
test('stale critical stays last known critical, including explicitly offline events',()=>{
  for(const overrides of [{now:'2026-11-08T13:00:00Z'},{event:'stale-offline'},{freshness:'stale'}]){
    const r=render({...sample,...overrides});assert.ok(r.text.includes('Last known critical condition'));assert.ok(r.text.includes('current conditions unknown'));assert.ok(!r.text.includes('Freshness: Recent'));
  }
});
test('missing, invalid or future time never means recent; 15-minute boundary is explicit',()=>{
  for(const overrides of [{observedAt:null},{observedAt:'yesterday'},{now:null},{observedAt:'2026-11-09T12:00:00Z'}]){
    const r=render({...sample,...overrides});assert.ok(r.text.includes('Unknown freshness'));assert.ok(r.text.includes('Last known critical'));
  }
  assert.ok(render({...sample,now:'2026-11-08T12:15:00Z'}).text.includes('Recent observation'));
  assert.ok(render({...sample,now:'2026-11-08T12:15:01Z'}).text.includes('Stale / offline'));
});
test('recovery requires review, simulation is labeled and contradictory normal is suppressed',()=>{
  const r=render({...sample,event:'recovery-needs-review',source:'simulation',conditions:['none_detected','unknown','water']});
  assert.ok(r.subject.includes('EXERCISE: Recovery update: review needed'));assert.ok(r.text.includes('Synthetic exercise'));
  assert.ok(!r.text.includes('No disturbance detected'));assert.ok(r.text.includes('Water detected'));
});
test('customer link is restricted to exact HTTPS origin and account page without query/fragment',()=>{
  const target='https://safehomemesh.us/customer';
  for(const url of ['javascript:alert(1)','https://evil.test/customer','https://safehomemesh.us.evil.test/customer','https://safehomemesh.us/customer?redirect=https://evil.test','https://user:pass@utd-hackathon-26.pages.dev/customer','http://utd-hackathon-26.pages.dev/customer','https://safehomemesh.us/customer#secret',target]){
    const r=render({...sample,customerUrl:url});assert.ok(r.html.includes(`href="${target}"`));assert.ok(!r.html.includes('evil.test'));assert.ok(!r.html.includes('javascript:'));
  }
});
test('unsupported event fails closed; rendering is deterministic and subject ignores arbitrary input',()=>{
  for(const event of ['constructor','toString','dispatch','<b>test</b>'])assert.throws(()=>render({...sample,event}),/Unsupported/);
  assert.deepEqual(render(sample),render(sample));assert.ok(!render({...sample,homeLabel:'\r\nBcc: unwanted'}).subject.includes('Bcc'));
});
