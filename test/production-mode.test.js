import test from 'node:test';
import assert from 'node:assert/strict';
import {endDemoSession,operatorLoginDestination} from '../ui/command/demo-session.js';
import {readingSummary} from '../ui/command/reading-summary.js';
import {parseUnoReport,unoReadings} from '../scripts/lib/uno-sensor-input.mjs';

test('operator exits generated data into the unqualified production route without losing their session',async()=>{
 const paths=[];await endDemoSession('operator',{request:()=>{throw Error('must not sign operator out');},navigate:p=>paths.push(p)});assert.deepEqual(paths,['/command-center']);
});
test('shared demo session is removed before opening the protected production route',async()=>{
 const calls=[];await endDemoSession('demo',{request:async(p,o)=>{calls.push([p,o.method]);return {ok:true};},navigate:p=>calls.push(p)});assert.deepEqual(calls,[['/api/session','DELETE'],'/command-center']);
});
test('failed demo logout cannot claim a production transition',async()=>{
 let navigated=false;await assert.rejects(endDemoSession('demo',{request:async()=>({ok:false}),navigate:()=>{navigated=true;}}));assert.equal(navigated,false);
});
test('anonymous exit uses the protected route without creating a session',async()=>{
 let target;await endDemoSession(null,{request:()=>{throw Error('unexpected auth mutation');},navigate:p=>target=p});assert.equal(target,'/command-center');
});
test('operator leaving public or registered exercise Review stays in live Review without signing out',async()=>{
 const paths=[];await endDemoSession('operator',{view:'review',request:()=>{throw Error('must not sign operator out');},navigate:p=>paths.push(p)});assert.deepEqual(paths,['/command-center?view=review']);
});
test('operator can explicitly enter registered exercise Review',async()=>{
 let target;await endDemoSession('operator',{view:'review',mode:'exercise',request:()=>{throw Error('must not sign operator out');},navigate:p=>target=p});assert.equal(target,'/command-center?mode=exercise&view=review');
});
test('shared demo Review exit removes the demo session before operator sign-in, preserving its destination',async()=>{
 const calls=[];await endDemoSession('demo',{view:'review',request:async(p,o)=>{calls.push([p,o.method]);return {ok:true};},navigate:p=>calls.push(p)});assert.deepEqual(calls,[['/api/session','DELETE'],'/login?role=operator&next=review']);
});
test('anonymous Review entry requires operator sign-in without creating or deleting a session',async()=>{
 let target;await endDemoSession(null,{view:'review',request:()=>{throw Error('unexpected auth mutation');},navigate:p=>target=p});assert.equal(target,'/login?role=operator&next=review');
});
test('successful login return target permits only the Review view',()=>{
 assert.equal(operatorLoginDestination('review'),'/command-center?view=review');
 for(const next of [null,undefined,'','map','Review','/command-center?mode=exercise','https://example.com','//example.com','review&mode=exercise'])assert.equal(operatorLoginDestination(next),'/command-center');
});
test('failed shared demo Review exit cannot navigate to registered records',async()=>{
 let navigated=false;await assert.rejects(endDemoSession('demo',{view:'review',request:async()=>({ok:false}),navigate:()=>{navigated=true;}}));assert.equal(navigated,false);
});
test('registered exercise entry requires an operator and destinations cannot be redirected',async()=>{
 for(const role of [null,'demo'])await assert.rejects(endDemoSession(role,{view:'review',mode:'exercise',request:()=>{throw Error('unexpected auth mutation');},navigate:()=>{assert.fail('must not enter registered exercise');}}),/Sign in as an operator/);
 let target;await endDemoSession('operator',{view:'https://example.com',navigate:p=>target=p});assert.equal(target,'/command-center');
 await assert.rejects(endDemoSession('operator',{mode:'https://example.com',navigate:()=>{assert.fail('must reject unsupported mode');}}),/Choose live or exercise/);
});
test('sensor descriptions label stale and missing time and never invent power or Wi-Fi',()=>{
 const now=Date.parse('2026-11-08T15:00:00Z');const rows=readingSummary({water_detected:{value:false,ts:'2026-11-08T15:00:00Z'},flame:{value:1,ts:'2026-11-08T14:30:00Z'},tilt:{value:0}},now);assert.equal(rows[0].value,'not detected');assert.equal(rows[0].stale,false);assert.equal(rows[1].value,'active');assert.equal(rows[1].stale,true);assert.equal(rows[2].note,'Report time unknown');assert.equal(rows.length,3);assert.deepEqual(readingSummary({},now),[]);
});
test('USB input requires complete typed sensor reports and preserves raw values',()=>{
 const m={src:'unoq',seq:9,water:false,water_raw:0,flame:false,flame_raw:601,tilt:true};assert.equal(parseUnoReport('UNO '+JSON.stringify(m)).flame_raw,601);for(const change of [{water:'false'},{seq:-1},{flame_raw:null},{water_raw:999999},{src:'simulation'}])assert.equal(parseUnoReport(JSON.stringify({...m,...change})),null);assert.equal(parseUnoReport('{}'),null);
 const readings=unoReadings(parseUnoReport(JSON.stringify(m)),'2026-11-08T15:00:00Z');assert.deepEqual(readings.map(r=>r.sensor),['water_detected','water_raw','flame','flame_raw','tilt']);assert.equal(readings[0].value,false);assert.equal(readings[0].meta.timestampBasis,'host-receipt');assert.ok(readings.every(r=>r.meta.sourceSequence===9));
});

test('controller reports only bounded measured system values, never household safety or mains',async()=>{
 const {hubReadings}=await import('../scripts/lib/uno-hub-input.mjs');
 const rows=hubReadings({cpu_temp_c:36,mem_avail_mb:3200,load1:0,os_uptime_s:80,wifi_connected:false,main_power_available:true,hazard_active:0,battery_pct:100},'2026-11-08T15:00:00Z');
 assert.deepEqual(rows.map(r=>r.sensor),['cpu_temp_c','mem_avail_mb','load1','os_uptime_s','wifi_connected']);
 assert.equal(rows[4].value,false);assert.deepEqual(hubReadings({cpu_temp_c:999,load1:-1,wifi_connected:'yes'},''),[]);
});
