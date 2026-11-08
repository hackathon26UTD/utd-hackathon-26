import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/_middleware.js';

const env = { SESSION_SECRET: 'headers-test-secret' };
const request = path => new Request('https://home.test' + path);
const directives = policy => new Map(policy.split(';').filter(s => s.trim()).map(s => {
  const [name, ...values] = s.trim().split(/\s+/);
  return [name, values];
}));

test('function-served pages allow only the required remote map hosts', async () => {
  const response = await onRequest({ env, request: request('/demo'), next: async () => new Response('<main>Map</main>', { headers: { 'Content-Type': 'text/html' } }) });
  const csp = directives(response.headers.get('Content-Security-Policy'));
  for (const kind of ['connect-src', 'img-src']) {
    assert.ok(csp.get(kind).includes('https://tiles.openfreemap.org'));
    assert.ok(csp.get(kind).includes('https://basemap.nationalmap.gov'));
    assert.ok(!csp.get(kind).some(value => value === '*' || value === 'https:' || value.includes('*.')));
  }
  assert.deepEqual(csp.get('script-src'), ["'self'"]);
  assert.deepEqual(csp.get('worker-src'), ["'self'", 'blob:']);
  assert.deepEqual(csp.get('frame-ancestors'), ["'self'"]);
  assert.equal(await response.text(), '<main>Map</main>');
});

test('static and function responses receive the same security policy', async () => {
  const text = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const response = await onRequest({ env, request: request('/login'), next: async () => new Response('Login') });
  // Only the catch-all `/*` block is the shared policy; later blocks are per-path cache rules.
  const shared = text.slice(text.indexOf('/*'), text.indexOf('\n\n', text.indexOf('/*')) > 0 ? text.indexOf('\n\n', text.indexOf('/*')) : undefined);
  for (const line of shared.split('\n').filter(line => /^\s+\S[^:]*:/.test(line))) {
    const colon = line.indexOf(':');
    assert.equal(response.headers.get(line.slice(0, colon).trim()), line.slice(colon + 1).trim());
  }
});

test('security headers preserve protected redirects, API bodies and session cookies', async () => {
  const redirect = await onRequest({ env, request: request('/command-center') });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('Location'), 'https://home.test/login');
  assert.ok(redirect.headers.get('Content-Security-Policy'));
  const response = await onRequest({ env, request: request('/api/session'), next: async () => Response.json({ ok: true }, { status: 201, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': 'test-session=opaque; HttpOnly; Secure; SameSite=Strict' } }) });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Set-Cookie'), 'test-session=opaque; HttpOnly; Secure; SameSite=Strict');
  assert.deepEqual(await response.json(), { ok: true });
});

 test('only the public demo may be embedded by this same origin', async () => {
  for (const path of ['/login', '/customer', '/privacy', '/api/demo']) {
    const response = await onRequest({ env, request: request(path), next: async () => new Response('Page') });
    assert.deepEqual(directives(response.headers.get('Content-Security-Policy')).get('frame-ancestors'), ["'none'"]);
  }
  const response = await onRequest({ env, request: request('/demo.html?embed=hero'), next: async () => new Response('Demo') });
  assert.deepEqual(directives(response.headers.get('Content-Security-Policy')).get('frame-ancestors'), ["'self'"]);
});
