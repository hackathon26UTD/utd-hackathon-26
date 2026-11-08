import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main, discoverCommands } from '../scripts/hb.mjs';
import { parseArgs } from '../scripts/lib/hb-args.mjs';
import { makeRedactor, redactDeep } from '../scripts/lib/hb-redact.mjs';
import { colorEnabled } from '../scripts/lib/hb-ui.mjs';
import { siteFromFlags, PRODUCTION_SITE } from '../scripts/lib/hb-http.mjs';
import { parseTtl } from '../scripts/commands/send-message.mjs';

const ADMIN = 'ak_0123456789abcdef0123456789abcdef0123456789abcdef';
const JOB = 'jobtoken_abcdef0123456789abcdef0123456789';
const sink = () => { const b = { text: '', isTTY: false, on() {}, write(s) { b.text += s; return true; } }; return b; };
const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function cli(argv, { env = { API_ADMIN_KEY: ADMIN, DATA_JOB_TOKEN: JOB }, fetchImpl, commandsDir } = {}) {
  const stdout = sink(); const stderr = sink(); const calls = [];
  const f = fetchImpl && (async (url, init) => { calls.push({ url: String(url), init }); return fetchImpl(String(url), init); });
  const code = await main(argv, { env, stdout, stderr, fetchImpl: f, commandsDir, repoRoot: resolve(import.meta.dirname, '..') });
  return { code, out: stdout.text, err: stderr.text, calls };
}

test('parseArgs: values, booleans, inline, negation, double dash', () => {
  const r = parseArgs(['send', 'abc', '--severity', 'urgent', '--ttl=2h', '--json', 'hello', '--no-deployment', '-h', '--', '--raw']);
  assert.deepEqual(r.positionals, ['send', 'abc', 'hello', '--raw']);
  assert.equal(r.flags.severity, 'urgent');
  assert.equal(r.flags.ttl, '2h');
  assert.equal(r.flags.json, true);
  assert.equal(r.flags['no-deployment'], true);
  assert.equal(r.flags.help, true);
  assert.equal(parseArgs(['--foo', '--bar', 'x']).flags.foo, true);
  assert.equal(parseArgs(['--color', '--no-banner']).flags.banner, false);
  assert.equal(parseArgs(['--json', 'word']).positionals[0], 'word');
});

test('redaction masks env secrets, bearer tokens, db uris and key shapes', () => {
  const redact = makeRedactor({ API_ADMIN_KEY: ADMIN, MONGODB_URI: 'mongodb+srv://user:pw1234567@cluster.example/db' });
  const dirty = `key ${ADMIN} Bearer abcdef123456 mongodb+srv://u:p@h dk_abcdefgh12345678 X-Device-Key: zzzzzzzz1234 nvapi-abcdefghijk`;
  const clean = redact(dirty);
  for (const bad of [ADMIN, 'abcdef123456', 'u:p@', 'dk_abcdefgh12345678', 'zzzzzzzz1234', 'nvapi-abcdefghijk']) assert.ok(!clean.includes(bad), bad);
  const deep = redactDeep({ deviceKey: 'dk_whatever1234', nested: [{ note: `Bearer ${'x'.repeat(20)}` }] }, redact);
  assert.equal(deep.deviceKey, '[redacted]');
  assert.ok(!JSON.stringify(deep).includes('xxxxxxxx'));
});

test('color: only on a TTY, never with NO_COLOR or --no-color', () => {
  assert.equal(colorEnabled({ env: {}, flags: {}, isTTY: false }), false);
  assert.equal(colorEnabled({ env: {}, flags: {}, isTTY: true }), true);
  assert.equal(colorEnabled({ env: { NO_COLOR: '1' }, flags: {}, isTTY: true }), false);
  assert.equal(colorEnabled({ env: {}, flags: { 'no-color': true }, isTTY: true }), false);
  assert.equal(colorEnabled({ env: { FORCE_COLOR: '1' }, flags: {}, isTTY: false }), true);
});

test('site selection: production default, --local, --site', () => {
  assert.equal(siteFromFlags({}, {}), PRODUCTION_SITE);
  assert.equal(siteFromFlags({ local: true }, {}), 'http://127.0.0.1:8788');
  assert.equal(siteFromFlags({ site: 'example.test/' }, {}), 'https://example.test');
});

test('dispatch: help lists real commands, unknown command suggests and exits 2', async () => {
  const h = await cli(['help']);
  assert.equal(h.code, 0);
  for (const name of ['status', 'health', 'devices', 'send-message', 'thresholds', 'deploy-check']) assert.match(h.out, new RegExp(name));
  assert.doesNotMatch(h.out, /\u001b\[/);
  const bad = await cli(['stauts']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /Did you mean "status"/);
  assert.equal((await cli(['status', '--help'])).code, 0);
  assert.equal((await cli([])).code, 0);
});

test('dispatch: a command file that fails to import is reported, others still run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hb-cmds-'));
  try {
    const real = pathToFileURL(resolve(import.meta.dirname, '../scripts/commands/help.mjs')).href;
    writeFileSync(join(dir, 'help.mjs'), `export { default } from '${real}';\n`);
    writeFileSync(join(dir, 'good.mjs'), `export default { name: 'good', summary: 'works', usage: 'hb good', run(a, ctx) { ctx.out('good ran'); return 0; } };\n`);
    writeFileSync(join(dir, 'broken.mjs'), `import 'does-not-exist-anywhere';\nexport default {};\n`);
    writeFileSync(join(dir, 'shape.mjs'), `export default { nope: true };\n`);
    const found = await discoverCommands(dir);
    assert.deepEqual([...found.commands.keys()].sort(), ['good', 'help']);
    assert.equal(found.broken.length, 2);
    const h = await cli(['help'], { commandsDir: dir });
    assert.match(h.out, /good\s+works/);
    assert.match(h.out, /broken\.mjs/);
    const g = await cli(['good'], { commandsDir: dir });
    assert.equal(g.out.trim(), 'good ran');
    const b = await cli(['broken'], { commandsDir: dir });
    assert.equal(b.code, 1);
    assert.match(b.err, /failed to load/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--json: stdout is pure JSON, human logging goes to stderr', async () => {
  const f = (url) => url.endsWith('/api/ready') ? res(200, { status: 'ready', mongodb: { connected: true } })
    : url.endsWith('/api/health') ? res(200, { status: 'ok' }) : res(200, {});
  const r = await cli(['health', '--json', '--samples', '2'], { fetchImpl: f });
  assert.equal(r.code, 0);
  const data = JSON.parse(r.out);
  assert.equal(data.ready, true);
  assert.equal(data.samples, 2);
  assert.equal(data.site, PRODUCTION_SITE);
});

test('status --json combines readiness, feeds and devices without deployment lookup', async () => {
  const now = Date.now();
  const f = (url) => {
    if (url.endsWith('/api/ready')) return res(200, { status: 'ready' });
    if (url.endsWith('/api/ops/data-catalog')) return res(200, { sources: [
      { _id: 'nws', name: 'NWS', cadenceSeconds: 300, status: 'ok', lastSuccessAt: new Date(now - 60000).toISOString() },
      { id: 'usgs', name: 'USGS', cadenceSeconds: 300, status: 'ok', lastSuccessAt: new Date(now - 3600000).toISOString() },
      { _id: 'eia', name: 'EIA', cadenceSeconds: 600, requiresCredential: 'EIA_API_KEY', configured: false, status: 'needs_key' },
    ] });
    if (url.endsWith('/api/ops/live')) return res(200, { devices: [{ id: 'a', offline: false }, { id: 'b', offline: true }] });
    return res(404, {});
  };
  const r = await cli(['status', '--json', '--no-deployment'], { fetchImpl: f });
  assert.equal(r.code, 0);
  const d = JSON.parse(r.out);
  assert.deepEqual([d.feeds.fresh, d.feeds.stale, d.feeds.needsKey], [1, 1, 1]);
  assert.deepEqual([d.devices.online, d.devices.offline], [1, 1]);
});

test('admin key is sent as a header but never printed, even when a server echoes it', async () => {
  const f = () => res(500, { error: `bad ${ADMIN} Bearer ${ADMIN}` });
  const r = await cli(['devices'], { fetchImpl: f });
  assert.notEqual(r.code, 0);
  assert.ok(!r.out.includes(ADMIN) && !r.err.includes(ADMIN));
  assert.equal(r.calls[0].init.headers.Authorization, `Bearer ${ADMIN}`);
});

test('missing admin key exits 4 and credentials never go over plain http to remote hosts', async () => {
  const none = await cli(['devices'], { env: {}, fetchImpl: () => res(200, {}) });
  assert.equal(none.code, 4);
  assert.match(none.err, /API_ADMIN_KEY/);
  const plain = await cli(['devices', '--site', 'http://example.test'], { fetchImpl: () => res(200, {}) });
  assert.equal(plain.code, 2);
  assert.equal(plain.calls.length, 0);
});

test('network failure exits 3 with a redacted message', async () => {
  const r = await cli(['health', '--samples', '1'], { fetchImpl: () => { throw new TypeError('fetch failed'); } });
  assert.equal(r.code, 3);
  assert.match(r.err, /Could not reach/);
});

test('send-message validates, supports --dry-run and posts the right body', async () => {
  const id = 'a'.repeat(24);
  assert.equal((await cli(['send-message', id])).code, 2);
  assert.equal((await cli(['send-message', 'nothex', 'hi'])).code, 2);
  assert.equal((await cli(['send-message', id, 'x'.repeat(81)])).code, 2);
  assert.equal((await cli(['send-message', id, 'hi', '--severity', 'panic'])).code, 2);
  const dry = await cli(['send-message', id, 'Check the sump', '--severity', 'urgent', '--ttl', '2h', '--dry-run', '--json']);
  const body = JSON.parse(dry.out).request;
  assert.equal(body.severity, 'urgent');
  assert.equal(body.expiresInMin, 120);
  assert.deepEqual(body.scope, { type: 'device', deviceIds: [id] });
  const sent = await cli(['send-message', id, 'Check the sump'], { fetchImpl: () => res(201, { message: { id: 'm1' }, deliveries: 1 }) });
  assert.equal(sent.code, 0);
  assert.equal(sent.calls[0].init.method, 'POST');
  assert.match(sent.calls[0].url, /\/api\/ops\/messages$/);
  assert.deepEqual([parseTtl('30'), parseTtl('2h'), parseTtl('1d')], [30, 120, 1440]);
  assert.throws(() => parseTtl('soon'));
});

test('refresh uses the job token header by default and the admin key with --admin', async () => {
  const f = () => res(200, { outcomes: [{ id: 'nws', status: 'ok', featureCount: 3 }] });
  const job = await cli(['refresh', '--json'], { fetchImpl: f });
  assert.equal(job.calls[0].init.headers['X-Data-Job-Key'], JOB);
  assert.ok(!job.calls[0].init.headers.Authorization);
  assert.ok(!job.out.includes(JOB));
  const adm = await cli(['refresh', '--admin'], { fetchImpl: f });
  assert.equal(adm.calls[0].init.headers.Authorization, `Bearer ${ADMIN}`);
  assert.equal((await cli(['refresh', '--limit', '9'], { fetchImpl: f })).code, 2);
});

test('simulate against a remote site needs --yes', async () => {
  const r = await cli(['simulate', '--once']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--yes/);
});

test('thresholds come from the real source files', async () => {
  const { riskCfg } = { riskCfg: await import('../src/risk/config.js') };
  const r = await cli(['thresholds', 'co_ppm', '--json']);
  assert.equal(r.code, 0);
  const items = JSON.parse(r.out).groups.flatMap((g) => g.items);
  const crit = items.find((i) => i.name === 'co_ppm -> critical');
  const rule = riskCfg.SENSORS.co_ppm.rules.find((x) => x.level === 'critical');
  assert.ok(rule.test(150) && !rule.test(149));
  assert.match(crit.value, /^>= 150 ppm$/);
  const all = JSON.parse((await cli(['thresholds', '--json'])).out).groups;
  assert.ok(all.some((g) => g.source === 'domain/system-policy.js'));
  assert.ok(all.some((g) => g.source.startsWith('firmware/')));
  assert.equal((await cli(['thresholds', 'zzzz-no-match'])).code, 1);
});

test('docs lists and searches; completion prints scripts for zsh and bash', async () => {
  const list = JSON.parse((await cli(['docs', '--json'])).out).docs;
  assert.ok(list.some((d) => d.file === 'docs/API.md'));
  const s = JSON.parse((await cli(['docs', 'search', 'API_ADMIN_KEY', '--json'])).out);
  assert.ok(s.hits.length > 0);
  const z = await cli(['completion', 'zsh']);
  assert.match(z.out, /compdef _hb hb/);
  assert.match(z.out, /send-message/);
  assert.match((await cli(['completion', 'bash'])).out, /complete -F _hb hb/);
  assert.equal((await cli(['completion', 'fish'])).code, 2);
});
