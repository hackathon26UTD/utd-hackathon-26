// Run after npm run build:ui. All API responses are disposable browser fixtures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
let server, browser, origin;
const token = 'a'.repeat(64);
const device = { id: 'owned-link', nickname: 'Kitchen', exercise: false, status: 'no_recent_signal', statusText: 'No recent report. This does not mean it is safe.', lastSeen: null, conditions: [], messages: [], help: { status: 'none', text: 'No follow-up has been set up.' } };
before(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve('public', pathname === '/customer' ? 'customer.html' : '.' + pathname);
    if (!file.startsWith(resolve('public') + '/')) { res.writeHead(404).end(); return; }
    try { const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream' }); res.end(bytes); } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }) });
});
after(async () => { await browser?.close(); await new Promise(r => server?.close(r)); });
async function setup({ signed = true, role = 'owner', width = 1280, fragment = '', empty = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(), errors = [], calls = [];
  let loggedIn = signed, items = empty ? [] : [{ id: 'home', name: 'Family home', linkIds: ['owned-link'], member: { id: 'member', email: 'owner@example.test', role, status: 'active', preferences: { device: false, weather: false } } }];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const request = route.request(); const body = request.postDataJSON(); calls.push({ path: url.pathname, method: request.method(), body });
    let status = 200, data = {};
    if (url.pathname === '/api/customer/me') { status = loggedIn ? 200 : 401; data = loggedIn ? { email: 'owner@example.test', contactName: 'Owner' } : { error: 'Sign in' }; }
    else if (url.pathname === '/api/customer/login' || url.pathname === '/api/customer/register') { loggedIn = true; data = { ok: true }; }
    else if (url.pathname === '/api/customer/logout') { loggedIn = false; data = { ok: true }; }
    else if (url.pathname === '/api/customer/devices') data = { devices: [device] };
    else if (url.pathname === '/api/customer/household-email') data = { memberId: 'member', configured: false, verified: false, suppressed: false, preferences: { device: false, weather: false } };
    else if (url.pathname === '/api/customer/household-context') data = { truncated: true, checkedAt: '2026-11-08T12:00:00Z', locations: [{ label: 'North Texas', weather: { status: 'partial', alertsStatus: 'stale', forecastStatus: 'unavailable', checkedAt: '2026-11-08T11:00:00Z', forecastIssuedAt: '2026-11-08T09:00:00Z', alerts: [{ title: '<script>Bad</script>', severity: 'Severe', sent: '2026-11-08T10:00:00Z', expires: '2026-11-08T13:00:00Z', url: 'javascript:alert(1)' }], forecast: [], url: 'https://weather.gov' }, news: { status: 'stale', source: 'KERA', scope: 'North Texas', items: [{ title: 'Regional headline', url: 'https://www.keranews.org/local', publishedAt: '2026-11-08T08:00:00Z' }] } }] };
    else if (url.pathname === '/api/customer/households') {
      if (request.method() === 'GET') data = url.searchParams.has('id') ? { household: items[0], ...(role !== 'alerts' ? { devices: [device] } : {}), ...(role === 'owner' ? { members: [items[0].member] } : {}) } : { households: items };
      else if (body.action === 'create') { const household = { id: 'created', name: body.name, linkIds: body.linkIds, member: { id: 'new-member', email: 'owner@example.test', role: 'owner', status: 'active' } }; items = [household]; data = { household }; }
      else if (body.action === 'invite') data = { token, delivery: 'not_emailed', member: { id: 'invited' } };
      else if (body.action === 'accept') data = { householdId: 'home' };
      else if (body.action === 'delete' || body.action === 'leave') { items = []; data = { ok: true }; }
      else data = { ok: true };
    }
    else if (url.pathname.includes('photo')) { status = 404; data = { error: 'No photo' }; }
    else data = { connections: [], configured: false };
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(origin + '/customer' + fragment);
  return { context, page, errors, calls };
}

test('owner creates selected household, copy-only invitation; context shows source age and no injected links', async () => {
  const { context, page, errors, calls } = await setup({ empty: true });
  try {
    const sharing = page.getByRole('region', { name: 'Household sharing' });
    await sharing.getByText('Create a household', { exact: true }).click();
    await sharing.getByLabel('Household name', { exact: true }).fill('Our home');
    await sharing.getByLabel('Kitchen', { exact: true }).check();
    await sharing.getByRole('button', { name: 'Create household', exact: true }).click();
    await expect(sharing.getByRole('heading', { name: 'Our home', exact: true })).toBeVisible();
    assert.deepEqual(calls.find(c => c.body?.action === 'create').body.linkIds, ['owned-link']);
    await sharing.getByLabel('Invitation email', { exact: true }).fill('viewer@example.test');
    await sharing.getByRole('button', { name: 'Access Read-only viewer', exact: true }).click();
    await page.getByRole('option', { name: 'Email updates only', exact: true }).click();
    await expect(sharing.getByRole('button', { name: 'Access Email updates only', exact: true })).toBeVisible();
    await sharing.getByRole('button', { name: 'Create private invitation', exact: true }).click();
    await expect(sharing.getByRole('button', { name: 'Copy private invitation link' })).toBeVisible();
    assert.equal(calls.find(c => c.body?.action === 'invite').body.role, 'alerts');
    await sharing.getByRole('button', { name: 'Copy private invitation link' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), origin + '/customer#household=' + token);
    await expect(sharing.getByText('Showing the first 5 distinct registered locations.')).toBeVisible();
    await expect(sharing.getByText('Alerts: stale · Forecast: unavailable')).toBeVisible();
    await expect(sharing.getByText(/Forecast issued:/)).toBeVisible();
    assert.equal(await sharing.locator('a[href^="javascript:"]').count(), 0);
    assert.ok(!(await page.content()).includes(token));
    await sharing.getByText('Email updates (optional)', { exact: true }).click();
    await expect(sharing.getByRole('button', { name: 'Verify my email' })).toBeDisabled();
    assert.equal(calls.filter(c => c.path === '/api/customer/household-email' && c.method === 'POST').length, 0);
    const accessibility = await new AxeBuilder({ page }).include('.households').withRules(['label-content-name-mismatch']).analyze();
    assert.deepEqual(accessibility.violations, []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('guest invitation survives login in memory and fragment is removed immediately', async () => {
  const { context, page, errors, calls } = await setup({ signed: false, role: 'viewer', fragment: '#household=' + token });
  try {
    await expect(page.getByText(/A household invitation is ready/)).toBeVisible();
    assert.equal(new URL(page.url()).hash, '');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
    await page.getByLabel('Password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page.getByText('Invitation accepted. Email updates are off until you verify and opt in.')).toBeVisible();
    assert.equal(calls.find(c => c.body?.action === 'accept').body.token, token);
    assert.equal(await page.evaluate(t => Object.values(localStorage).some(v => v.includes(t)) || Object.values(sessionStorage).some(v => v.includes(t)), token), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('alerts-only mobile view makes no context calls; email is optional and no overflow', async () => {
  const { context, page, errors, calls } = await setup({ role: 'alerts', width: 390 });
  try {
    await expect(page.getByText(/You have email-only access/)).toBeVisible();
    const sharing = page.getByRole('region', { name: 'Household sharing' });
    assert.equal(await sharing.getByRole('heading', { name: 'Shared device reports' }).count(), 0);
    assert.equal(calls.filter(c => c.path === '/api/customer/household-context').length, 0);
    await sharing.getByText('Email updates (optional)', { exact: true }).click();
    await expect(sharing.getByText('Email delivery is not connected yet. No email has been sent.')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await sharing.getByRole('button', { name: 'Leave household', exact: true }).click();
    await sharing.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(calls.filter(c => c.body?.action === 'leave').length, 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('shared snapshots poll without moving form focus or repeatedly fetching context', async () => {
  const { context, page, errors, calls } = await setup({ width: 390 });
  try {
    await expect(page.getByRole('heading', { name: 'Nearby weather and news' })).toBeVisible();
    const input = page.getByLabel('Invitation email', { exact: true });
    await input.fill('editing@example.test'); await input.focus();
    const contextCalls = calls.filter(c => c.path === '/api/customer/household-context').length;
    await page.waitForTimeout(11000);
    await expect(input).toBeFocused(); await expect(input).toHaveValue('editing@example.test');
    assert.equal(calls.filter(c => c.path === '/api/customer/household-context').length, contextCalls);
    assert.ok(calls.filter(c => c.path === '/api/customer/households').length >= 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('claim fragment remains supported', async () => {
  const { context, page, errors } = await setup({ fragment: '#claim=HB-7K3Q-9XMD.482913' });
  try {
    await expect(page.getByLabel('Device serial')).toHaveValue('HB-7K3Q-9XMD');
    await expect(page.getByLabel('Pairing code')).toHaveValue('482913');
    assert.equal(new URL(page.url()).hash, ''); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
