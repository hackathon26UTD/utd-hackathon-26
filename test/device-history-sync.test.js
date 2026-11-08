import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {MongoClient,ObjectId} from 'mongodb';
import {syncDeviceHistory,validateHistorySync,localDeviceHistory} from '../src/device-history-sync.js';
import {sha256Hex} from '../src/auth.js';
let server,client,db,id;const now=new Date('2026-11-08T12:00:00Z'),key='isolated-device-history-key';
before(async()=>{server=await MongoMemoryServer.create();client=await MongoClient.connect(server.getUri());db=client.db('isolated-history-sync');id=new ObjectId();await db.collection('devices').insertOne({_id:id,keyHash:await sha256Hex(key)});});
after(async()=>{await client?.close();await server?.stop();});
const sample=(seq,epoch=1794132000)=>({boot:1,seq,epoch,uptimeMs:seq*300000,flags:(epoch?65536:0)+4096+2048+8,waterRaw:120,flameRaw:0,accelMilliG:0,batteryMv:8000,soundHits:0});
const payload=(samples)=>({version:1,samples,metrics:{water_raw:{count:30,sum:3600,min:120,max:120,firstEpoch:1793858400,lastEpoch:1794132000}},overwritten:2});
const call=(body,headers={'X-Device-Key':key})=>syncDeviceHistory({env:{},db,now,request:new Request('https://test.local/api/device/history-sync',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)})});
test('retained batch replay is idempotent, unknown time stays unknown, and conflicts do not overwrite',async()=>{
 const body=payload([sample(1),sample(2,0)]);
 for(let i=0;i<2;i++){const r=await call(body);assert.equal(r.status,200);assert.deepEqual((await r.json()).accepted,['1:1','1:2']);}
 assert.equal(await db.collection('device_local_samples').countDocuments(),2);
 const h=await localDeviceHistory(db,id);assert.equal(h.samples[0].observedAt,null);assert.equal(h.samples[0].clockSource,'unknown');assert.equal(h.metrics.water_raw.mean,120);assert.equal(h.metrics.water_raw.status,'device_reported_reference');
 assert.equal((await call(payload([{...sample(1),waterRaw:999}]))).status,409);
 assert.equal((await db.collection('device_local_samples').findOne({_id:String(id)+':1:1'})).waterRaw,120);
 assert.equal(await db.collection('telemetry').countDocuments(),0);assert.equal(await db.collection('incidents').countDocuments(),0);
});
test('partial retry and concurrent replay produce one stored record per original identity',async()=>{
 const r=await Promise.all([call(payload([sample(3),sample(4)])),call(payload([sample(3),sample(4)]))]);assert.ok(r.every(x=>x.status===200));
 assert.equal(await db.collection('device_local_samples').countDocuments({deviceId:id}),4);
 const older=payload([sample(1)]);older.metrics={};await call(older);assert.equal((await localDeviceHistory(db,id)).metrics.water_raw.mean,120);
});
test('device authentication, disabled/synthetic devices, malformed fields and streaming bounds fail closed',async()=>{
 assert.equal((await call(payload([sample(5)]),{})).status,401);assert.equal((await call(payload([sample(5)]),{Authorization:'Bearer '+key})).status,401);assert.equal((await call(payload([sample(5)]),{'X-Device-Key':'wrong'})).status,401);
 for(const extra of [{disabled:true},{exercise:true}]){await db.collection('devices').updateOne({_id:id},{$set:extra});assert.ok([401,403].includes((await call(payload([sample(5)]))).status));await db.collection('devices').updateOne({_id:id},{$unset:Object.fromEntries(Object.keys(extra).map(k=>[k,'']))});}
 for(const bad of [{...payload([sample(5)]),version:2},payload([sample(5),sample(5)]),payload([{...sample(5),epoch:0}]),payload([{...sample(5),flags:2**20}]),payload([{...sample(5),seq:0}]),payload([{...sample(5),epoch:Math.floor(+now/1000)+999}]),payload(Array.from({length:9},(_,i)=>sample(i+6)))])assert.equal((await call(bad)).status,400);
 assert.equal((await call('x'.repeat(17000))).status,413);
 assert.throws(()=>validateHistorySync({...payload([sample(5)]),metrics:{water_raw:{count:2,sum:1,min:3,max:4,firstEpoch:1793858400,lastEpoch:1794132000}}},now));
 assert.equal(await db.collection('device_local_samples').countDocuments(),4);
});
