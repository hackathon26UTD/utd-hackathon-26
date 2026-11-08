import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onRequest as middleware} from '../functions/api/_middleware.js';
import {onRequestPost as layer} from '../functions/api/layers.js';
import {issueSession,sessionCookie} from '../src/operator-session.js';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { DEFAULT_NVIDIA_MODEL } from '../src/nemotron.js';
const env={SESSION_SECRET:'demo-test-secret'};
test('shared demo is blocked from live API and account writes',async()=>{const cookie=sessionCookie(await issueSession(env,'demo@homebeacon.local','demo'));for(const [method,path] of [['GET','/api/devices'],['POST','/api/followups'],['PATCH','/api/account']]){const response=await middleware({env,request:new Request('https://home.test'+path,{method,headers:{Cookie:cookie,Origin:'https://home.test'}}),data:{},next:()=>{throw Error('Demo reached privileged route');}});assert.equal(response.status,403);}});
test('exercise layers return exact recorded matches and never call NVIDIA',async()=>{let response=await layer({env,data:{operator:{role:'demo'}},request:new Request('https://home.test/api/layers',{method:'POST',body:JSON.stringify({method:'preset',filter:'water',question:''})})});assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.ids,['HB-1003','HB-1009']);assert.equal(data.mode,'exercise');assert.equal(data.model,null);assert.ok(data.evidence.every(p=>p.values.water_detected===true&&p.observedAt));response=await layer({env,data:{operator:{role:'demo'}},request:new Request('https://home.test/api/layers',{method:'POST',body:JSON.stringify({method:'nvidia',filter:'water',question:'show water'})})});assert.equal(response.status,403);});

test('layer inference applies Nano reasoning control while retaining JSON validation and the default model prompt', async t => {
  const server = process.env.TEST_MONGODB_URI ? null : await MongoMemoryServer.create();
  const uri = process.env.TEST_MONGODB_URI || server.getUri();
  const client = await MongoClient.connect(uri);
  const databaseName = `nano_layers_test_${process.pid}`;
  const db = client.db(databaseName);
  t.after(async () => { await db.dropDatabase(); await client.close(); await server?.stop(); });
  const deviceId = new ObjectId();
  await db.collection('devices').insertOne({ _id: deviceId, meta: {} });
  await db.collection('readings').insertOne({ deviceId, sensor: 'water_detected', value: true, ts: new Date() });
  let payload, fenced = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://inference.example.test/v1/chat/completions');
    payload = JSON.parse(init.body);
    const json = JSON.stringify({ title: 'Water observations', summary: 'Recorded water needs review.', filters: ['water'], combine: 'all', contextEvidenceIds: [] });
    return Response.json({ choices: [{ message: { content: fenced ? `  \n\`\`\`json\n${json}\n\`\`\`\n  ` : json } }] });
  });
  let defaultSystemPrompt;
  for (const [model, wrap] of [[undefined, false], ['nvidia/NVIDIA-Nemotron-Nano-9B-v2', false], ['nvidia/NVIDIA-Nemotron-Nano-9B-v2', true]]) {
    fenced = wrap;
    const response = await layer({
      env: { MONGODB_URI: uri, MONGODB_DB: databaseName, NVIDIA_BASE_URL: 'https://inference.example.test/v1', ...(model ? { NVIDIA_MODEL: model } : {}) },
      data: { operator: { role: 'operator', email: 'operator@example.test' } },
      request: new Request('https://home.test/api/layers', { method: 'POST', body: JSON.stringify({ method: 'nvidia', question: 'Show recorded water.' }) }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.ids, [String(deviceId)]);
    assert.equal(result.model, model || DEFAULT_NVIDIA_MODEL);
    assert.equal(payload.stream, false);
    assert.equal(payload.max_tokens, 800);
    if (!model) {
      defaultSystemPrompt = payload.messages[0].content;
      assert.doesNotMatch(defaultSystemPrompt, /\/no_think/);
    } else assert.equal(payload.messages[0].content, `${defaultSystemPrompt}\n/no_think`);
    assert.match(payload.messages[0].content, /Return only JSON/);
    assert.equal(JSON.parse(payload.messages[1].content).question, 'Show recorded water.');
  }
});
