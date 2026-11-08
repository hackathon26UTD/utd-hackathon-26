// Module C: Resend transport, templates, dedupe/throttle/consent, hooks and the ops test endpoint. fetch is mocked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { emailConfig, isSink, safeSubject, sendEmail, DEFAULT_FROM } from '../src/email.js';
import { renderEmail, TEMPLATES } from '../src/email-templates/index.js';
import { BRAND, clean, safeUrl } from '../src/email-templates/layout.js';
import { SAMPLES, sampleFor } from '../src/email-templates/samples.js';
import { deliver, fire, notifyHelpStatus, notifyCriticalIncident, notifyWelcome, notifyAccountNotice, MAX_PER_HOUR } from '../src/email-events.js';
import { emailTestHandler } from '../src/email-api.js';
import { helpStatusHandler } from '../src/customer.js';
import { deviceReport } from '../src/messages.js';

const KEY = 're_test_not_a_real_key';
const env = { RESEND_API_KEY: KEY, SESSION_SECRET: 'test-secret' };
let server, client, db;
before(async () => { server = await MongoMemoryServer.create(); client = await MongoClient.connect(server.getUri()); db = client.db('email_test'); });
after(async () => { await client?.close(); await server?.stop(); });

const okFetch = (calls = []) => async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }); };
const deps = (calls) => ({ fetcher: okFetch(calls), sleep: async () => {}, log: () => {} });
const luminance = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('config: off without a key, default sender, flag can disable', () => {
  assert.equal(emailConfig({}).enabled, false);
  assert.equal(emailConfig({ RESEND_API_KEY: KEY }).enabled, true);
  assert.equal(emailConfig({ RESEND_API_KEY: KEY, EMAIL_ENABLED: 'false' }).enabled, false);
  assert.equal(emailConfig({}).from, DEFAULT_FROM);
  assert.equal(emailConfig({ EMAIL_FROM: 'A <a@b.co>' }).from, 'A <a@b.co>');
  assert.deepEqual(emailConfig({ EMAIL_OPERATOR_TO: 'a@b.co, nope, c@d.io' }).operatorTo, ['a@b.co', 'c@d.io']);
  assert.ok(isSink('delivered@resend.dev') && isSink('bounced+x@resend.dev') && !isSink('a@b.co') && !isSink('delivered@resend.dev.evil.com'));
});

test('every template renders html and text, escapes untrusted values, keeps unknown unknown', () => {
  for (const name of TEMPLATES) {
    const mail = renderEmail(name, sampleFor(name));
    assert.match(mail.html, /<html lang="en"/);
    assert.match(mail.html, /color-scheme/);
    assert.match(mail.html, /prefers-color-scheme:dark/);
    assert.doesNotMatch(mail.html, /<img|<script|https?:\/\/[^"' ]*\.(png|gif|jpg)|pixel|track/i);
    assert.doesNotMatch(mail.subject + mail.html + mail.text, /—|–/, `${name} has a dash character`);
    assert.doesNotMatch(mail.subject, /[\r\n]/);
    assert.ok(mail.text.length > 40 && mail.preheader);
    assert.match(mail.html + mail.text, /prototype/i);
    assert.doesNotMatch(mail.html + mail.text, /\b(safe to enter|no one is home|occupied|damage probability|dispatched)\b/i);
  }
  const evil = '<script>alert(1)</script>"><img src=x onerror=1>\r\nBcc: x@y.z';
  const mail = renderEmail('critical-incident', { ...SAMPLES['critical-incident'], deviceName: evil, region: evil, source: evil, facts: [{ label: evil, value: evil, known: true }] });
  assert.doesNotMatch(mail.html, /<script|<img src=x/);
  assert.doesNotMatch(mail.subject, /[\r\n<>]/);
  const crit = renderEmail('critical-incident', SAMPLES['critical-incident']);
  assert.match(crit.html, /Temperature: unknown/);
  const stale = renderEmail('critical-incident', { ...SAMPLES['critical-incident'], stale: true });
  assert.match(stale.html, /Last known critical/);
  assert.match(stale.html, /Stale does not mean safe/);
  assert.match(renderEmail('help-status', { status: 'resolved', nickname: 'x' }).html, /does not confirm your home is safe to enter/);
  assert.throws(() => renderEmail('nope', {}));
  assert.throws(() => renderEmail('help-status', { status: 'none' }));
});

test('exercise data is labelled in subject and body', () => {
  const mail = renderEmail('welcome', { ...SAMPLES.welcome, exercise: true });
  assert.match(mail.subject, /^\[Exercise\]/);
  assert.match(mail.html, /EXERCISE: synthetic data/);
  assert.doesNotMatch(renderEmail('welcome', { ...SAMPLES.welcome, exercise: false }).html, /EXERCISE:/);
});

test('brand text colors meet 4.5:1 on their backgrounds', () => {
  for (const [fg, bg] of [[BRAND.text, BRAND.paper], [BRAND.muted, BRAND.paper], [BRAND.link, BRAND.paper], [BRAND.critical, BRAND.paper], [BRAND.ok, BRAND.paper], [BRAND.ink, BRAND.ground], [BRAND.ground, BRAND.amber], [BRAND.text, '#ece3d0'], [BRAND.muted, '#ece3d0'], ['#f8f1e5', '#1d1a26'], ['#c9bfae', '#1d1a26'], ['#ff8a8f', '#1d1a26'], ['#f6a623', '#1d1a26']]) {
    assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)}`);
  }
});

test('helpers: clean, safeSubject and safeUrl', () => {
  assert.equal(clean('a\r\nb‮c\u0000d  e'), 'a b c d e');
  assert.ok(safeSubject('Hi\r\nBcc: a@b.co').indexOf('\n') < 0);
  assert.equal(safeUrl('https://x.example', '/customer'), 'https://x.example/customer');
  assert.equal(safeUrl('http://evil.example', '/customer').startsWith('https://utd-hackathon-26.pages.dev'), true);
  assert.equal(safeUrl('https://x.example', 'https://evil.example/a'), 'https://x.example/');
});

test('send: skipped without key, correct request with key, idempotency key and no secret in logs', async () => {
  const calls = [];
  assert.equal((await sendEmail({}, { to: 'delivered@resend.dev', subject: 's', html: 'h', text: 't' }, deps(calls))).reason, 'no_key');
  assert.equal(calls.length, 0);
  const logs = [];
  const r = await sendEmail(env, { to: 'delivered@resend.dev', subject: 'Hello\r\nBcc: a@b.co', html: '<p>BODY</p>', text: 'BODY', idempotencyKey: 'k1', template: 'welcome' }, { ...deps(calls), log: (o) => logs.push(JSON.stringify(o)) });
  assert.equal(r.ok, true); assert.equal(r.id, 'msg_1');
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(init.headers['Idempotency-Key'], 'k1');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.to, ['delivered@resend.dev']);
  assert.equal(body.from, DEFAULT_FROM);
  assert.doesNotMatch(body.subject, /[\r\n]/);
  const logged = logs.join('\n');
  assert.doesNotMatch(logged, /delivered@resend|BODY|re_test/);
  assert.match(logged, /"recipient":"[0-9a-f]{16}"/);
});

test('send: retries 429 and 5xx with backoff, not 4xx, and gives up after 3 tries', async () => {
  let n = 0; const sleeps = [];
  const flaky = async () => (++n < 3 ? new Response('{}', { status: n === 1 ? 429 : 503, headers: n === 1 ? { 'retry-after': '1' } : {} }) : new Response('{"id":"x"}', { status: 200 }));
  const r = await sendEmail(env, { to: 'delivered@resend.dev', subject: 's', html: 'h', text: 't' }, { fetcher: flaky, sleep: async (ms) => sleeps.push(ms), log: () => {} });
  assert.equal(r.ok, true); assert.equal(r.attempts, 3); assert.equal(sleeps[0], 1000); assert.ok(sleeps[1] >= 300);
  n = 0;
  const bad = await sendEmail(env, { to: 'delivered@resend.dev', subject: 's', html: 'h', text: 't' }, { fetcher: async () => { n++; return new Response('{}', { status: 422 }); }, sleep: async () => {}, log: () => {} });
  assert.deepEqual([bad.ok, bad.attempts, n, bad.reason], [false, 1, 1, 'rejected']);
  n = 0;
  const down = await sendEmail(env, { to: 'delivered@resend.dev', subject: 's', html: 'h', text: 't' }, { fetcher: async () => { n++; throw new Error('boom'); }, sleep: async () => {}, log: () => {} });
  assert.deepEqual([down.ok, n, down.reason], [false, 3, 'network']);
  assert.equal((await sendEmail(env, { to: 'not-an-address', subject: 's' }, deps([]))).reason, 'invalid_recipient');
});

test('deliver: dedupes, throttles per hour, records without addresses', async () => {
  await db.collection('email_events').deleteMany({});
  const calls = [], d = deps(calls);
  const spec = (token, to = 'delivered@resend.dev') => ({ event: 'account-notice', template: 'account-notice', audience: 'customer', to, token, windowMs: 3600_000, data: { kind: 'password_changed', role: 'customer' } });
  assert.equal((await deliver(db, env, spec('a'), d)).ok, true);
  assert.equal((await deliver(db, env, spec('a'), d)).reason, 'duplicate');
  for (let i = 0; i < MAX_PER_HOUR.customer; i++) await deliver(db, env, spec('t' + i), d);
  assert.equal((await deliver(db, env, spec('zzz'), d)).reason, 'throttled');
  assert.ok(calls.length <= MAX_PER_HOUR.customer);
  const docs = await db.collection('email_events').find({}).toArray();
  assert.ok(docs.length >= 1 && docs.every((x) => /^[0-9a-f]{16}$/.test(x.recipient) && !JSON.stringify(x).includes('resend.dev')));
  assert.equal(docs[0].status, 'sent');
  const failed = await deliver(db, env, spec('f', 'bounced@resend.dev'), { fetcher: async () => new Response('{}', { status: 422 }), sleep: async () => {}, log: () => {} });
  assert.equal(failed.ok, false);
  assert.equal((await db.collection('email_events').find({ recipient: { $ne: docs[0].recipient } }).toArray())[0].status, 'failed');
  assert.equal((await deliver(db, {}, spec('q'), d)).reason, 'disabled');
});

test('customer events respect consent and skip when nobody is linked', async () => {
  await db.collection('email_events').deleteMany({});
  const deviceId = new ObjectId().toString();
  const calls = [], d = deps(calls);
  assert.equal((await notifyHelpStatus(db, env, { deviceId, status: 'review_queued' }, d)).reason, 'no_customer');
  await db.collection('customer_links').insertOne({ _id: 'l1', deviceId, customerEmail: 'delivered+one@resend.dev', consent: false, nickname: 'Cabin', active: true });
  assert.equal((await notifyHelpStatus(db, env, { deviceId, status: 'review_queued' }, d)).reason, 'no_consent');
  assert.equal((await notifyHelpStatus(db, env, { deviceId, status: 'none' }, d)).reason, 'status_not_emailed');
  await db.collection('customer_links').updateOne({ _id: 'l1' }, { $set: { consent: true } });
  const r = await notifyHelpStatus(db, env, { deviceId, status: 'help_on_the_way' }, d);
  assert.equal(r.ok, true);
  assert.match(JSON.parse(calls.at(-1).init.body).subject, /on the way/);
  // Welcome is transactional: sent even when contact consent is off.
  assert.equal((await notifyWelcome(db, env, { email: 'delivered+two@resend.dev', contactName: 'A', nickname: 'B', consent: false, linkId: 'l9' }, d)).ok, true);
  assert.equal((await notifyAccountNotice(db, env, { email: 'delivered+two@resend.dev', kind: 'password_changed' }, d)).ok, true);
});

test('critical incident goes only to configured operator addresses', async () => {
  await db.collection('email_events').deleteMany({});
  const calls = [];
  assert.deepEqual(await notifyCriticalIncident(db, env, SAMPLES['critical-incident'], deps(calls)), []);
  const out = await notifyCriticalIncident(db, { ...env, EMAIL_OPERATOR_TO: 'delivered+op1@resend.dev,delivered+op2@resend.dev' }, SAMPLES['critical-incident'], deps(calls));
  assert.equal(out.length, 2); assert.ok(out.every((x) => x.ok));
  const again = await notifyCriticalIncident(db, { ...env, EMAIL_OPERATOR_TO: 'delivered+op1@resend.dev' }, SAMPLES['critical-incident'], deps(calls));
  assert.equal(again[0].reason, 'duplicate');
});

test('fire: no connection and no work when email is off; errors never escape', async () => {
  let ran = false;
  assert.equal((await fire({ env: {} }, () => { ran = true; })).reason, 'disabled');
  assert.equal(ran, false);
  const waited = [];
  const r = await fire({ env, db, waitUntil: (p) => waited.push(p) }, async () => { throw new Error('boom'); });
  assert.equal(r.reason, 'error'); assert.equal(waited.length, 1);
});

test('help status route: email goes out in the background and the response is unchanged, also when email breaks', async () => {
  await db.collection('email_events').deleteMany({});
  const deviceId = new ObjectId();
  await db.collection('devices').insertOne({ _id: deviceId, name: 'd', meta: {} });
  await db.collection('customer_links').insertOne({ _id: 'l2', deviceId: String(deviceId), customerEmail: 'delivered+three@resend.dev', consent: true, nickname: 'Dock', active: true });
  const real = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response('{"id":"m"}', { status: 200 }); };
  try {
    const jobs = [];
    const ctx = () => ({ request: new Request('http://local/api/ops/help-status', { method: 'POST', headers: { Authorization: 'Bearer ak_x', 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: String(deviceId), status: 'follow_up_assigned' }) }), env: { ...env, API_ADMIN_KEY: 'ak_x' }, db, waitUntil: (p) => jobs.push(p) });
    const res = await helpStatusHandler(ctx());
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 50)); await Promise.all(jobs);
    assert.equal(sent.length, 1);
    assert.match(JSON.parse(sent[0].init.body).subject, /follow up/i);
    globalThis.fetch = async () => { throw new Error('network down'); };
    const jobs2 = []; const c2 = ctx(); c2.waitUntil = (p) => jobs2.push(p);
    c2.request = new Request('http://local/api/ops/help-status', { method: 'POST', headers: { Authorization: 'Bearer ak_x', 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: String(deviceId), status: 'resolved' }) });
    const res2 = await helpStatusHandler(c2);
    assert.equal(res2.status, 200);
    await new Promise((r) => setTimeout(r, 50)); await Promise.all(jobs2);
  } finally { globalThis.fetch = real; }
});

test('message receipt hook: only customer-visible acks, optional, never throws', async () => {
  const deviceId = new ObjectId(); const id = String(deviceId);
  await db.collection('customer_links').insertOne({ _id: 'l3', deviceId: id, customerEmail: 'delivered+four@resend.dev', consent: true, nickname: 'Barn', active: true });
  const messageId = new ObjectId().toString();
  await db.collection('message_deliveries').insertOne({ _id: `${messageId}:${id}`, messageId, deviceId: id, state: 'delivered', title: 'Stay in', customerVisible: true, expiresAt: new Date(Date.now() + 3600_000), seq: 1 });
  const real = globalThis.fetch; const sent = [];
  globalThis.fetch = async (u, i) => { sent.push(i); return new Response('{"id":"m"}', { status: 200 }); };
  try {
    const jobs = [];
    const r = await deviceReport(db, { _id: deviceId, meta: {} }, { messageId, state: 'acked' }, new Date(), { email: { env, db, waitUntil: (p) => jobs.push(p) } });
    assert.equal(r.state, 'acked');
    await new Promise((x) => setTimeout(x, 50)); await Promise.all(jobs);
    assert.equal(sent.length, 1);
    assert.match(JSON.parse(sent[0].body).subject, /confirmed/);
  } finally { globalThis.fetch = real; }
});

const post = (body, { admin = true, data } = {}) => ({ request: new Request('http://local/api/ops/email-test', { method: 'POST', headers: { ...(admin ? { Authorization: 'Bearer ak_x' } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env: { ...env, API_ADMIN_KEY: 'ak_x' }, data });

test('ops endpoint: auth, sink-only, allowlist, dry run, mocked send', async () => {
  assert.equal((await emailTestHandler(post({}, { admin: false }))).status, 401);
  assert.equal((await emailTestHandler(post({}, { data: { operator: { role: 'demo' } } }))).status, 403);
  assert.equal((await emailTestHandler({ ...post({}), request: new Request('http://local/x') })).status, 405);
  assert.equal((await emailTestHandler(post({ template: 'nope' }))).status, 400);
  assert.equal((await emailTestHandler(post({ to: 'real.person@example.com' }))).status, 403);
  const dry = await (await emailTestHandler(post({ template: 'digest', dryRun: true }))).json();
  assert.equal(dry.dryRun, true); assert.match(dry.subject, /Exercise/);
  const calls = [];
  const ok = await emailTestHandler(post({ template: 'critical-incident' }), deps(calls));
  assert.equal(ok.status, 200); assert.deepEqual(JSON.parse(calls[0].init.body).to, ['delivered@resend.dev']);
  const allowed = post({ to: 'qa@example.com' }); allowed.env.EMAIL_TEST_ALLOWLIST = 'qa@example.com';
  assert.equal((await emailTestHandler(allowed, deps([]))).status, 200);
  const off = post({}); delete off.env.RESEND_API_KEY;
  assert.equal((await emailTestHandler(off, deps([]))).status, 503);
  const fail = await emailTestHandler(post({}), { fetcher: async () => new Response('{}', { status: 422 }), sleep: async () => {}, log: () => {} });
  assert.equal(fail.status, 502);
});
