import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const routes = JSON.parse(await readFile(new URL('../public/_routes.json', import.meta.url)));
const matches = (rule, path) => new RegExp('^' + rule.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(path);
const dynamic = path => routes.include.some(r => matches(r, path)) && !routes.exclude.some(r => matches(r, path));
test('public reloads and assets bypass Functions', () => {
 for (const path of ['/', '/index.html', '/login', '/login.html', '/login/', '/simulations', '/assets/chunks/map.js', '/images/logo.svg', '/robots.txt']) assert.equal(dynamic(path), false, path);
});
test('private gates and all service routes retain Functions', () => {
 for (const path of ['/portal', '/dashboard', '/command-center', '/profile']) for (const suffix of ['', '/', '.html', '.html/']) assert.equal(dynamic(path + suffix), true, path + suffix);
 for (const path of ['/api/ingest', '/api/session', '/oauth/token', '/mcp', '/.well-known/oauth-authorization-server', '/future-private-page', '/demo']) assert.equal(dynamic(path), true, path);
});
test('Pages routing stays within provider limits', () => {
 assert.equal(routes.version, 1);
 assert.ok(routes.include.length > 0);
 assert.ok(routes.include.length + routes.exclude.length <= 100);
 for (const rule of [...routes.include, ...routes.exclude]) assert.ok(rule.length <= 100);
});
