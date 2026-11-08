import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {simulationFrame,validateSimulation,DEFAULT_SIMULATION} from '../domain/simulation.js';
import {onRequest} from '../functions/api/simulations.js';
import {displayStatus} from '../ui/command/core.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('seed, population, distributions and clock reproduce exact isolated frames',()=>{
 const a=simulationFrame({seed:'seed-a',deviceCount:500},20);assert.deepEqual(a,simulationFrame({seed:'seed-a',deviceCount:500},20));assert.equal(a.properties.length,500);assert.ok(a.properties.every(p=>p.synthetic&&p.id.startsWith('SIM-')));
 assert.notDeepEqual(a.properties.map(p=>p.coordinates),simulationFrame({seed:'seed-b',deviceCount:500},20).properties.map(p=>p.coordinates));
 const distance=f=>f.properties.reduce((sum,p)=>sum+Math.hypot(p.coordinates[0]-f.config.center[0],p.coordinates[1]-f.config.center[1]),0);
 assert.ok(distance(simulationFrame({deviceCount:500,distribution:'clustered'}))<distance(a));
 assert.equal(simulationFrame().properties[0].values.temp_c,simulationFrame().properties[0].values.temp_c);
});
test('custom settings reject oversized and invalid worlds without mutating defaults',()=>{
 for(const c of [{deviceCount:501},{deviceCount:'3'},{radiusKm:0},{affectedRadiusKm:21},{event:'dispatch'},{thresholds:{temperatureC:NaN}},{thresholds:[]},{center:[-155,20]},{center:[-124.7,30],radiusKm:30},{eventEndMin:5},{extra:true},{seed:'<script>'}])assert.throws(()=>validateSimulation(c),RangeError);
 assert.throws(()=>simulationFrame({},241));assert.throws(()=>simulationFrame({},.5));assert.equal(DEFAULT_SIMULATION.thresholds.temperatureC,50);
});
test('outage, offline and recovery retain critical evidence and isolate threshold overrides',()=>{
 const c={event:'flood',floodCm:200,affectedRadiusKm:20,outagePct:100,offlinePct:100,deviceCount:40};
 assert.ok(simulationFrame(c,0).properties.every(p=>p.severity==='normal'));
 const event=simulationFrame(c,32);assert.ok(event.properties.some(p=>p.offline&&p.severity==='critical'));assert.ok(event.properties.every(p=>displayStatus(p,Date.now()+1e12).status===p.severity));
 const recovered=simulationFrame(c,50);assert.ok(recovered.properties.some(p=>p.reviewRequired&&p.severity==='critical'&&!p.values.water_detected));
 const fire={event:'fire',affectedRadiusKm:20,fireTemperatureC:45,outagePct:0,offlinePct:0};assert.equal(simulationFrame(fire,20).summary.critical,0);assert.ok(simulationFrame({...fire,thresholds:{temperatureC:40}},20).summary.critical>0);assert.equal(simulationFrame(fire,20).summary.critical,0);
 const quake=simulationFrame({event:'earthquake',earthquakeMagnitude:8,affectedRadiusKm:20,outagePct:0},20);assert.ok(quake.summary.elevated>0);
 const calm=simulationFrame({event:'wind',windKph:0,outagePct:100,affectedRadiusKm:20},20);const storm=simulationFrame({event:'wind',windKph:300,outagePct:100,affectedRadiusKm:20},20);assert.ok(storm.summary.elevated>calm.summary.elevated);
});
test('HTTP generation needs no environment or database and matches the engine',async()=>{
 const config={seed:'http',deviceCount:12};const req=new Request('https://example.test/api/simulations',{method:'POST',body:JSON.stringify({config,minute:20})});const response=await onRequest({request:req});assert.equal(response.status,200);assert.equal(response.headers.get('X-HomeBeacon-Data'),'synthetic');assert.deepEqual(await response.json(),simulationFrame(config,20));
 assert.equal((await onRequest({request:new Request(req.url,{method:'POST',body:'x'.repeat(17000)})})).status,400);assert.equal((await onRequest({request:new Request(req.url,{method:'DELETE'})})).status,405);
});
test('CLI and real stdio MCP reproduce the same headless simulation',async()=>{
 const output=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/simulations.mjs','--minute','20']);let out='';p.stdout.on('data',b=>out+=b);p.on('error',reject);p.on('exit',code=>code?reject(Error('CLI failed')):resolve(JSON.parse(out)));});assert.deepEqual(output,simulationFrame({},20));
 const client=new Client({name:'simulation-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:['scripts/simulations.mjs','--mcp']}));try{const r=await client.callTool({name:'homebeacon_run_simulation',arguments:{config:{deviceCount:7},minute:20}});assert.deepEqual(r.structuredContent,simulationFrame({deviceCount:7},20));const bad=await client.callTool({name:'homebeacon_run_simulation',arguments:{config:{deviceCount:501}}});assert.equal(bad.isError,true);}finally{await client.close();}
});
