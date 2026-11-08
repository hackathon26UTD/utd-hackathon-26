import {test} from 'node:test';
import assert from 'node:assert/strict';
import {windSamples,simulationWind} from '../ui/command/wind-flow.js';
const point=(speed,direction,coordinates=[-96,33])=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{wind_kph:speed,wind_direction:direction}});
test('wind flow rejects missing and invalid values without treating them as calm',()=>{
 const rows=windSamples([point(null,180),point('',180),point(12,null),point(-1,40),point(10,361),point(10,0,[NaN,33]),point(0,0),point(12,270)]);
 assert.deepEqual(rows.map(r=>[r.speed,r.direction]),[[0,0],[12,270]]);
 assert.equal(windSamples(Array.from({length:200},()=>point(20,90))).length,100);
});
test('illustrated weather stays separate from sensor values and uses simulation configuration',()=>{
 const config={event:'wind',windKph:80,center:[-96,33],eventStartMin:10,eventEndMin:35},copy=structuredClone(config);
 assert.equal(simulationWind('custom',config).length,25);
 assert.ok(simulationWind('custom',config,20).every(p=>p.speed===80));assert.deepEqual(config,copy);
 assert.ok(simulationWind('custom',{...config,event:'power-outage'}).every(p=>p.speed===0));
 assert.ok(simulationWind('custom',config,0).every(p=>p.speed===0));
 assert.ok(simulationWind('custom',config,35).every(p=>p.speed===0));
 assert.ok(simulationWind('normal').every(p=>p.speed===12));
});
