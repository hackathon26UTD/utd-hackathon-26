import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/_middleware.js';
import {issueSession,sessionCookie} from '../src/operator-session.js';
test('portal sends visitors to login and signed-in operators to their workspace',async()=>{const env={SESSION_SECRET:'portal-test-secret'};let result=await onRequest({env,request:new Request('https://home.test/portal')});assert.equal(result.status,302);assert.equal(result.headers.get('Location'),'https://home.test/login');const token=await issueSession(env,'operator@example.test');result=await onRequest({env,request:new Request('https://home.test/portal',{headers:{Cookie:sessionCookie(token)}})});assert.equal(result.headers.get('Location'),'https://home.test/command-center');});
