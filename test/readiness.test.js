import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/ready.js';
import { handle } from '../src/app.js';

test('readiness fails closed when database settings are absent', async () => {
  const response = await onRequestGet({ env: {} });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: 'not_ready', mongodb: { connected: false },
  });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('invalid private connection settings never reach the public response', async () => {
  const response = await onRequestGet({ env: {
    MONGODB_URI: 'invalid://secret-sentinel:password-sentinel@private-host',
    MONGODB_DB: 'private-database',
  } });
  assert.equal(response.status, 503);
  const body = await response.text();
  for (const secret of ['secret-sentinel', 'password-sentinel', 'private-host', 'private-database']) {
    assert.equal(body.includes(secret), false);
  }
});

test('health never echoes private connection settings', async () => {
  const response = await handle(new Request('http://local/api/health'), {
    MONGODB_URI: 'invalid://secret-sentinel:password-sentinel@private-host', MONGODB_DB: 'private-database',
  });
  const body = await response.text();
  for (const secret of ['secret-sentinel', 'password-sentinel', 'private-host', 'private-database']) {
    assert.equal(body.includes(secret), false);
  }
});

test('health reports an unconfigured database without failing', async () => {
  const response = await handle(new Request('http://local/api/health'), {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mongodb.configured, false);
});
