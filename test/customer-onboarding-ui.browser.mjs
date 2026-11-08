// Run: node --test test/customer-onboarding-ui.browser.mjs
// Builds into a disposable directory. Every API response is synthetic; external requests are blocked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
let server, browser, origin, outdir;
const serial = 'HB-AAAA-AAFE';
const box = () => ({ id: 'test-link', nickname: 'Garage', serial, room: '', consent: false, notificationsPausedUntil: null, fleetStatus: { state: 'inactive', reason: 'awaiting_first_report' }, firstReportAt: null, lastSeenAt: null, conditions: [], messages: [], help: { status: 'none', text: 'No follow-up is set up.' } });
before(async () => {
  outdir = await mkdtemp(resolve(tmpdir(), 'customer-ui-test-'));
  await build({ entryPoints: ['ui/customer.js', 'ui/customer.css', 'ui/product-kit.css'], outdir, bundle: true, format: 'esm', loader: { '.woff2': 'file' }, logLevel: 'silent' });
  await build({ entryPoints: [{ in: 'ui/kit/kit.entry.js', out: 'kit' }], outdir, bundle: true, format: 'iife', loader: { '.woff2': 'file' }, logLevel: 'silent' });
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const base = pathname.startsWith('/assets/') ? outdir : resolve('public');
    const file = resolve(base, pathname === '/customer' ? 'customer.html' : '.' + pathname.replace(/^\/assets/, ''));
    if (!file.startsWith(base + '/')) return res.writeHead(404).end();
    try { res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); } catch { res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }) });
});
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)); if (outdir) await rm(outdir, { recursive: true, force: true }); });

async function setup({ signed = true, fragment = '', devices = [], width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 950 } });
  const page = await context.newPage(), errors = [], calls = [];
  const data = { signed, devices, failPatch: false, failDelete: false, failGet: false, failClaim: false, expire: false, firstHash: null };
  page.setDefaultTimeout(7000);
  await page.clock.install();
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (...args) => { if (!window.firstFetchHash) window.firstFetchHash = { hash: location.hash }; return original(...args); };
  });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const body = request.postDataJSON(), method = request.method(), path = url.pathname;
    calls.push({ path, method, body });
    let status = 200, result = {};
    if (path === '/api/customer/me') { status = data.signed ? 200 : 401; result = data.signed ? { email: 'owner@example.test', contactName: 'Owner' } : { error: 'Sign in' }; }
    else if (path === '/api/access') { data.signed = true; result = { authenticated:true,role:'customer',destination:'/customer' }; }
    else if (path === '/api/customer/logout') data.signed = false;
    else if (path === '/api/customer/devices') { status = data.expire ? 401 : data.failGet ? 503 : 200; result = { devices: data.devices }; }
    else if (path === '/api/customer/claim') {
      status = data.failClaim ? 400 : 201;
      if (data.failClaim) result = { error: 'Those details do not match an available device.' };
      else { data.devices = [{ ...box(), nickname: body.nickname || 'My Safe Home', room: body.room || '', consent: body.consent }]; result = { linked: true, id: 'test-link' }; }
    }
    else if (path === '/api/customer/devices/test-link' && method === 'PATCH') {
      status = data.failPatch ? 503 : 200;
      if (data.failPatch) result = { error: 'Could not save this time.' };
      else Object.assign(data.devices[0], body);
    }
    else if (path === '/api/customer/devices/test-link' && method === 'DELETE') {
      status = data.failDelete ? 503 : 200;
      if (data.failDelete) result = { error: 'Could not remove this time.' }; else data.devices = [];
    }
    else if (path === '/api/customer/households') result = { households: [] };
    else if (path === '/api/customer/household-email') result = { configured: false, verified: false, preferences: {} };
    else if (path.includes('photo')) status = 404;
    else result = { connections: [], configured: false };
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto(origin + '/customer' + fragment);
  return { context, page, errors, calls, data };
}
async function tick(page) { await page.clock.runFor(10020); }
async function signIn(page) {
  await page.getByRole('tab', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.locator('form').getByRole('button', { name: 'Open dashboard', exact: true }).click();
}

for (const code of ['012345', 'K4M7-XP2R']) test(`QR ${code.length === 6 ? 'legacy' : 'v2'} survives sign-in; claims without address or extra consents`, async () => {
  const { context, page, errors, calls } = await setup({ signed: false, fragment: '#claim=' + serial + '.' + code });
  try {
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.evaluate(() => window.firstFetchHash.hash), '');
    await signIn(page);
    await expect(page.getByRole('button', { name: 'Link my box', exact: true })).toBeVisible();
    assert.equal(calls.filter(c => c.path === '/api/customer/claim').length, 0);
    await expect(page.locator('#add-box input[name=contactName]')).toBeHidden();
    assert.equal(await page.locator('#add-box input[name=locationConsent], #add-box input[name=emailAlerts]').count(), 0);
    await page.getByRole('button', { name: 'Link my box', exact: true }).click();
    await expect(page.getByText('Waiting for your box to report', { exact: true })).toBeVisible();
    const claim = calls.find(c => c.path === '/api/customer/claim');
    assert.deepEqual(claim.body, { serial, code, consent: false });
    assert.equal(await page.evaluate(code => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(x => x.includes(code)), code), false);
    await expect(page.getByRole('region', { name: 'Household sharing' })).toBeVisible();
    await expect(page.locator('#profile summary')).toHaveText('Profile photo');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('manual legacy serial warns once, validates code, and preserves errors for retry', async () => {
  const { context, page, calls, errors, data } = await setup();
  try {
    const add = page.locator('#add-box');
    await expect(add).toBeVisible();
    await add.getByLabel('Serial', { exact: false }).fill('HB-AAAA-AAFA');
    await add.getByLabel('Pairing code', { exact: false }).fill('bad');
    await add.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(add.locator('[data-msg=find]')).toContainText('The code is 8');
    await add.getByLabel('Pairing code', { exact: false }).fill('012345');
    await add.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(add.locator('[data-msg=find]')).toContainText('Check the last character');
    assert.equal(calls.some(c => c.path === '/api/customer/claim'), false);
    await add.getByRole('button', { name: 'Continue', exact: true }).click();
    await add.locator('input[name=nickname]').fill('Kitchen box');
    await add.locator('input[name=room]').fill('Kitchen');
    await add.locator('input[name=consent]').check();
    await add.locator('input[name=contactName]').fill('Test Owner');
    data.failClaim = true;
    await add.getByRole('button', { name: 'Link my box', exact: true }).click();
    await expect(add.locator('[data-msg=confirm]')).toContainText('Those details do not match');
    await expect(add.locator('input[name=nickname]')).toHaveValue('Kitchen box');
    data.failClaim = false;
    await add.getByRole('button', { name: 'Link my box', exact: true }).click();
    await expect(page.locator('#devices').getByRole('heading', { name: 'Kitchen box', exact: true })).toBeVisible();
    assert.deepEqual(calls.filter(c => c.path === '/api/customer/claim').at(-1).body, { serial: 'HB-AAAA-AAFA', code: '012345', nickname: 'Kitchen box', room: 'Kitchen', consent: true, contactName: 'Test Owner' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('returning waiting customer keeps immediate Wi-Fi help after reload using server linkedAt', async () => {
  const linkedAt = new Date(Date.now() - 11 * 60e3).toISOString();
  const { context, page, errors, calls, data } = await setup({ devices: [{ ...box(), linkedAt }] });
  try {
    const card = page.locator('#devices article');
    const help = card.getByText('Still nothing after 10 minutes', { exact: true });
    await expect(help).toBeVisible();
    const reads = calls.filter(c => c.path === '/api/customer/devices').length;
    // Reload clears page memory. Do not advance the clock: the original server time must suffice.
    await page.reload();
    await expect(card.getByText('Waiting for your box to report', { exact: true })).toBeVisible();
    await expect(help).toBeVisible();
    await expect(card.locator('.wifi-help').getByText(/Your installer sets up Wi-Fi/)).toBeVisible();
    assert.ok(calls.filter(c => c.path === '/api/customer/devices').length > reads);
    assert.equal(data.devices[0].linkedAt, linkedAt);
    // Old link age alone must never show waiting help once reporting has resumed.
    Object.assign(data.devices[0], { fleetStatus: { state: 'active', reason: 'reporting' }, lastSeenAt: new Date().toISOString(), firstReportAt: new Date().toISOString() });
    await tick(page);
    await expect(card.getByText('Reporting', { exact: true })).toBeVisible();
    await expect(help).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('polls every ten seconds through waiting, reporting, silent and disabled without inventing normal', async () => {
  const d = { ...box(), linkedAt: new Date(Date.now() - 11 * 60e3).toISOString() };
  const { context, page, errors, calls, data } = await setup({ devices: [d] });
  try {
    const card = page.locator('#devices article');
    await expect(card.getByText('Still nothing after 10 minutes', { exact: true })).toBeVisible();
    await expect(card.locator('.wifi-help').getByText(/Your installer sets up Wi-Fi/)).toBeVisible();
    const count = calls.filter(c => c.path === '/api/customer/devices').length;
    await page.clock.runFor(9900);
    assert.equal(calls.filter(c => c.path === '/api/customer/devices').length, count);
    Object.assign(data.devices[0], { fleetStatus: { state: 'active', reason: null }, lastSeenAt: new Date().toISOString(), firstReportAt: new Date().toISOString(), status: 'normal' });
    await page.clock.runFor(150);
    await expect(card.getByText('Reporting', { exact: true })).toBeVisible();
    await expect(card.getByText(/Your box is reporting/)).toBeVisible();
    assert.equal(await card.locator('.pill.normal').count(), 0);
    await card.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(card.getByText(/Your box is reporting/)).toHaveCount(0);
    data.devices[0].fleetStatus = { state: 'inactive', reason: 'silent' };
    await tick(page); await expect(card.getByText('No recent signal', { exact: true })).toBeVisible();
    data.devices[0].fleetStatus = { state: 'inactive', reason: 'disabled' };
    await tick(page); await expect(card.getByText('Paused by the team', { exact: true })).toBeVisible();
    data.failGet = true; await tick(page);
    await expect(page.getByText(/Could not update your boxes/)).toBeVisible();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('rename and room drafts retain focus during polling; pause, resume and failed save reflect saved state', async () => {
  const { context, page, errors, calls, data } = await setup({ devices: [box()] });
  try {
    const card = page.locator('#devices article');
    await card.getByText('Manage this box', { exact: true }).click();
    const name = card.getByLabel('Box name', { exact: true });
    await name.fill('Changed box'); await tick(page);
    await expect(name).toBeFocused(); await expect(name).toHaveValue('Changed box');
    await card.locator('input[name=room]').fill('Utility');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Changed box', exact: true })).toBeVisible();
    assert.deepEqual(calls.find(c => c.method === 'PATCH').body, { nickname: 'Changed box', room: 'Utility' });
    for (const option of ['Pause for 24 hours', 'Pause for 7 days', 'Resume alerts']) {
      await card.getByRole('button', { name: option, exact: true }).click();
      await expect(card.locator('[data-msg=manage-test-link]')).toContainText(option === 'Resume alerts' ? 'Pause removed' : 'Email alerts paused');
      assert.ok(Object.hasOwn(calls.filter(c => c.method === 'PATCH').at(-1).body, 'notificationsPausedUntil'));
    }
    data.failPatch = true;
    await card.getByRole('button', { name: 'Pause for 24 hours', exact: true }).click();
    await expect(card.locator('[data-msg=manage-test-link]')).toContainText('Could not save this time');
    await expect(card.getByText('No pause is set.', { exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('unlink requires confirmation, handles failure, and removes only the selected box', async () => {
  const { context, page, calls, errors, data } = await setup({ devices: [box()] });
  try {
    const card = page.locator('#devices article');
    await card.getByText('Manage this box', { exact: true }).click();
    await card.getByRole('button', { name: 'Unlink and remove this box', exact: true }).click();
    assert.equal(calls.some(c => c.method === 'DELETE'), false);
    await card.getByRole('button', { name: 'Keep this box', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Yes, unlink and remove', exact: true })).toBeHidden();
    await card.getByRole('button', { name: 'Unlink and remove this box', exact: true }).click();
    data.failDelete = true;
    await card.getByRole('button', { name: 'Yes, unlink and remove', exact: true }).click();
    await expect(card.locator('[data-msg=manage-test-link]')).toContainText('Could not remove this time');
    data.failDelete = false;
    await card.getByRole('button', { name: 'Yes, unlink and remove', exact: true }).click();
    await expect(page.locator('#devices article')).toHaveCount(0);
    assert.equal(calls.filter(c => c.method === 'DELETE').at(-1).path, '/api/customer/devices/test-link');
    await expect(page.locator('#add-box')).toBeVisible();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('phone layout preserves urgent evidence and renders user text safely; onboarding accessibility', async () => {
  const d = { ...box(), nickname: '<img src=x onerror=alert(1)>', room: 'W'.repeat(40), status: 'urgent', statusText: 'Last known smoke report needs review.', fleetStatus: { state: 'inactive', reason: 'silent' } };
  const { context, page, errors } = await setup({ devices: [d], width: 390 });
  try {
    const card = page.locator('#devices article');
    await expect(card.getByText('Urgent', { exact: true })).toBeVisible();
    await expect(card.getByText('No recent signal', { exact: true })).toBeVisible();
    assert.equal(await card.locator('img').count(), 0);
    await card.getByText('Manage this box', { exact: true }).click();
    await page.getByText('Add my box', { exact: true }).click();
    await page.locator('#add-box input[name=serial]').fill(serial);
    await page.locator('#add-box input[name=code]').fill('012345');
    await page.locator('#add-box').getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Link my box', exact: true })).toBeVisible();
    await page.clock.runFor(200);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const audit = await new AxeBuilder({ page }).include('#devices').include('#add-box').withTags(['wcag2a', 'wcag2aa']).analyze();
    assert.deepEqual(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('expired login stops device polling; malformed QR is removed before login', async () => {
  const { context, page, data, calls, errors } = await setup({ devices: [box()], fragment: '#claim=bad.secret' });
  try {
    assert.equal(new URL(page.url()).hash, '');
    await expect(page.getByText('Waiting for your box to report', { exact: true })).toBeVisible();
    data.expire = true; await tick(page);
    await expect(page.getByRole('heading', { name: 'Your home, connected.', exact: true })).toBeVisible();
    const count = calls.filter(c => c.path === '/api/customer/devices').length;
    await tick(page); assert.equal(calls.filter(c => c.path === '/api/customer/devices').length, count);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
