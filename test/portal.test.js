import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/_middleware.js';
import {issueSession,sessionCookie,issueCustomerSession,customerCookie} from '../src/operator-session.js';
test('portal sends visitors to signup and signed-in operators to their workspace',async()=>{const env={SESSION_SECRET:'portal-test-secret'};let result=await onRequest({env,request:new Request('https://home.test/portal')});assert.equal(result.status,302);assert.equal(result.headers.get('Location'),'https://home.test/signup');const token=await issueSession(env,'operator@example.test');result=await onRequest({env,request:new Request('https://home.test/portal',{headers:{Cookie:sessionCookie(token)}})});assert.equal(result.headers.get('Location'),'https://home.test/command-center');});

test('portal routes a signed-in household to its own customer page',async()=>{const env={SESSION_SECRET:'portal-test-secret'};const token=await issueCustomerSession(env,'customer@example.test');const result=await onRequest({env,request:new Request('https://home.test/portal',{headers:{Cookie:customerCookie(token)}})});assert.equal(result.headers.get('Location'),'https://home.test/customer');});


test('Dashboard routes authenticated roles and never caches its redirect', async()=>{
 const env={SESSION_SECRET:'dashboard-fixture'};
 for(const [role,target] of [[null,'/signup'],['customer','/customer'],['operator','/command-center'],['demo','/simulations']]){
  const cookie=role==='customer'?customerCookie(await issueCustomerSession(env,'fixture@example.test')):role?sessionCookie(await issueSession(env,'fixture@example.test',role)):'';
  const response=await onRequest({env,request:new Request('https://home.test/dashboard',{headers:{Cookie:cookie}})});
  assert.equal(response.headers.get('Location'),'https://home.test'+target);assert.equal(response.headers.get('Cache-Control'),'no-store');
 }
});
