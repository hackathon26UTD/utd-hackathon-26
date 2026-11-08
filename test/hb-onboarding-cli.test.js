import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync, symlinkSync, renameSync, readdirSync, rmSync, realpathSync, linkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { main } from '../scripts/hb.mjs';
import { createContext } from '../scripts/lib/hb-context.mjs';
import provision, { planBatch, validateBatchResponse, reservePrivateFile, privatePath } from '../scripts/commands/provision.mjs';
import { serialFromBody } from '../scripts/lib/labels.mjs';

const REPO = resolve(import.meta.dirname, '..');
const ADMIN = 'ak_cli_onboarding_test_only';
const KEY = `dk_${'a'.repeat(64)}`;
const CODE = 'ABCD-EFGH';
const SERIAL = serialFromBody('ABCDEFG');
const SITE = 'http://127.0.0.1:8788';
const sink = () => ({ text: '', on() {}, write(s) { this.text += s; } });
const fixture = (origin = SITE, qrField = 'qr') => ({ batchId: 'batch-test', devices: [{ deviceId: 'a'.repeat(24), serial: SERIAL, pairingCode: CODE, deviceKey: KEY, [qrField]: `${origin}/customer#claim=${SERIAL}.${CODE}`, expiresAt: null }] });
function temp(t) { const dir = mkdtempSync(join(realpathSync(tmpdir()), 'hb-cli-onboard-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
async function cli(args, fetcher = () => fixture(), deps = {}) {
  const stdout = sink(), stderr = sink(), calls = [];
  const code = await main(args, { repoRoot: REPO, env: { API_ADMIN_KEY: ADMIN, HB_LOCAL_ADMIN_KEY: ADMIN, WIFI_PASS: 'fixture-wifi-password' }, stdout, stderr,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), ...init });
      const body = await fetcher(String(url), init);
      return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 });
    }, ...deps });
  return { code, out: stdout.text, err: stderr.text, calls };
}
const batchArgs = (dir) => ['provision', 'batch', '--count', '1', '--prefix', 'bench', '--local', '--out-dir', dir];
function noSecrets(r) { for (const secret of [KEY, CODE, ADMIN, 'fixture-wifi-password', `#claim=${SERIAL}`]) assert.ok(!(r.out + r.err).includes(secret), 'terminal leaked a private value'); }
function filesBelow(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? filesBelow(join(dir, d.name)) : [join(dir, d.name)]); }

test('batch aliases use the current contract and write separate private artifacts', async (t) => {
  for (const command of [['provision', 'batch'], ['devices', 'provision'], ['devices', 'provision', 'batch'], ['provision', 'add']]) {
    const dir = temp(t), headers = join(dir, 'headers');
    const r = await cli([...command, '--count', '1', '--prefix', 'bench', '--home-less', '--local', '--out-dir', dir, '--secrets-dir', headers, '--expected-report-interval-seconds', '1800', '--json']);
    assert.equal(r.code, 0, r.err); noSecrets(r);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].url, SITE + '/api/ops/fleet-batch');
    assert.equal(r.calls[0].method, 'POST');
    assert.equal(r.calls[0].headers.Authorization, `Bearer ${ADMIN}`);
    assert.deepEqual(JSON.parse(r.calls[0].body), { count: 1, prefix: 'bench', type: 'esp32', note: '', origin: SITE, expectedReportIntervalSeconds: 1800 });
    const result = JSON.parse(r.out), manifest = JSON.parse(readFileSync(result.inventory, 'utf8'));
    assert.equal(manifest.response.devices[0].deviceKey, KEY);
    const html = readFileSync(result.sheet, 'utf8');
    assert.ok(html.includes(CODE)); assert.ok(!html.includes(KEY));
    const header = readFileSync(result.secretsFiles[0], 'utf8');
    assert.ok(header.includes(KEY)); assert.ok(header.includes('a'.repeat(24)));
    assert.match(header, /#define API_BASE "http:\/\/127.0.0.1:8788"/);
    for (const file of filesBelow(dir)) { assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(resolve(file, '..')).mode & 0o777, 0o700); }
  }
});

test('provision accepts an object API client exposing ok', async (t) => {
  const dir = temp(t), stdout = sink(), stderr = sink();
  const ctx = createContext({ env: {}, repoRoot: REPO, flags: { local: true, count: '1', prefix: 'bench', 'out-dir': dir }, stdout, stderr });
  ctx.api = { async ok() { return { data: fixture() }; } };
  assert.equal(await provision.run(['batch'], ctx), 0);
});

test('batch validates flags before any request and dry-run writes nothing', async (t) => {
  const dir = temp(t);
  for (const flags of [{ count: true }, { count: 0 }, { count: 101 }, { count: '1.5' }, { prefix: '../x' }, { type: true }, { note: true }, { 'home-less': false }, { 'expected-report-interval-seconds': true }, { 'expected-report-interval-seconds': '-1' }, { 'expected-report-interval-seconds': '4' }, { 'expected-report-interval-seconds': '86401' }, { origin: 'https://u:pass@example.test' }, { origin: 'https://example.test/path' }]) {
    assert.throws(() => planBatch({ count: '1', prefix: 'bench', ...flags }, { site: SITE }));
  }
  assert.equal(planBatch({ count: '100', prefix: 'bench' }, { site: SITE }).count, 100);
  assert.throws(() => planBatch({ count: 2, prefix: 'bench' }, { site: SITE, single: true }));
  const r = await cli([...batchArgs(dir), '--dry-run', '--json']);
  assert.equal(r.code, 0); assert.equal(r.calls.length, 0); assert.deepEqual(readdirSync(dir), []);
  const remote = await cli(['provision', 'batch', '--count', '1', '--prefix', 'bench', '--out-dir', dir]);
  assert.equal(remote.code, 2); assert.equal(remote.calls.length, 0);
});

test('response supports both QR names, old serials and both code formats; rejects cross-box or hostile URLs', () => {
  const plan = planBatch({ count: 1, prefix: 'bench' }, { site: SITE });
  for (const qrField of ['qr', 'qrPayload']) for (const code of [CODE, 'ABCDEFGH', '123456']) {
    const data = fixture(SITE, qrField);
    data.devices[0].serial = 'HB-AAAA-AAAB';
    data.devices[0].pairingCode = code;
    data.devices[0][qrField] = `${SITE}/customer#claim=HB-AAAA-AAAB.${code}`;
    const result = validateBatchResponse(data, plan);
    assert.equal(result.legacyChecksum, 1); assert.equal(result.devices[0].pairingCode, code);
  }
  for (const change of [d => d.devices[0].qr = 'https://evil.test/customer#claim=x', d => d.devices[0].qr += '&extra=1', d => d.devices[0].qrPayload = 'https://evil.test', d => d.devices[0].expiresAt = 'tomorrow', d => d.devices[0].deviceId = '../x', d => d.batchId = '../escape', d => d.devices = []]) {
    const data = fixture(); change(data); assert.throws(() => validateBatchResponse(data, plan));
  }
  const duplicate = fixture(); duplicate.devices.push({ ...duplicate.devices[0] });
  assert.throws(() => validateBatchResponse(duplicate, { ...plan, count: 2 }));
});

test('QR origin override does not redirect the firmware API', async (t) => {
  const dir = temp(t), origin = 'https://claim.example.test';
  const r = await cli([...batchArgs(dir), '--origin', origin, '--secrets-dir', join(dir, 'headers'), '--json'], () => fixture());
  assert.equal(r.code, 0, r.err);
  const result = JSON.parse(r.out);
  assert.ok(readFileSync(result.secretsFiles[0], 'utf8').includes(`#define API_BASE "${SITE}"`));
});

test('failed response validation still retains one-time credentials privately', async (t) => {
  const dir = temp(t);
  const r = await cli(batchArgs(dir), () => { const data = fixture(); data.devices[0].qr = 'bad'; return data; });
  assert.equal(r.code, 1); noSecrets(r);
  const manifest = filesBelow(dir).find(f => f.endsWith('manifest.json'));
  assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).response.devices[0].deviceKey, KEY);
  assert.match(r.err, /Private manifest:/);
});

test('rotation calls the exact action route with typed serial and saves the key privately', async (t) => {
  const dir = temp(t), id = 'b'.repeat(24);
  const args = ['devices', 'provision', 'rotate', id, '--confirm', SERIAL, '--reason', 'replace compromised key', '--local', '--out-dir', dir, '--secrets-dir', join(dir, 'headers'), '--json'];
  const dry = await cli([...args, '--dry-run']);
  assert.equal(dry.code, 0); assert.equal(dry.calls.length, 0); assert.deepEqual(readdirSync(dir), []);
  const r = await cli(args, () => ({ deviceKey: KEY }));
  assert.equal(r.code, 0, r.err); noSecrets(r);
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].url, `${SITE}/api/ops/fleet/${id}/action`);
  assert.deepEqual(JSON.parse(r.calls[0].body), { action: 'rotate_key', confirmSerial: SERIAL, reason: 'replace compromised key' });
  const result = JSON.parse(r.out);
  assert.equal(JSON.parse(readFileSync(result.rotation, 'utf8')).response.deviceKey, KEY);
  assert.ok(readFileSync(result.secretsFiles[0], 'utf8').includes(id));
  const missing = await cli(['provision', 'rotate', id, '--reason', 'test', '--local', '--out-dir', dir]);
  assert.equal(missing.code, 2); assert.equal(missing.calls.length, 0);
});

test('remote errors and transport failures never echo pairing credentials, including verbose mode', async (t) => {
  for (const status of [400, 401, 403, 404, 500]) {
    const dir = temp(t);
    const r = await cli([...batchArgs(dir), '--verbose'], () => new Response(JSON.stringify({ error: `${CODE} ${KEY} ${ADMIN}` }), { status }));
    assert.notEqual(r.code, 0); noSecrets(r);
    if ([401, 403].includes(status)) assert.equal(r.code, 4);
  }
  const r = await cli([...batchArgs(temp(t)), '--verbose'], () => { throw Error(CODE); });
  assert.equal(r.code, 3); noSecrets(r);
});

test('private paths reject repository files, ignored work/, symlinks and loose directory permissions before sending', async (t) => {
  const dir = temp(t), linked = join(dir, 'linked'), loose = join(dir, 'loose');
  symlinkSync(dir, linked); mkdirSync(loose, { mode: 0o755 }); chmodSync(loose, 0o755);
  for (const out of [REPO, join(REPO, 'work', 'inventory-test'), join(REPO, 'docs', 'private'), linked, join(linked, 'nested'), loose]) {
    const r = await cli(batchArgs(out)); assert.equal(r.code, 2, r.err); assert.equal(r.calls.length, 0);
  }
  const outsideAlias = join(dir, 'repo'); symlinkSync(REPO, outsideAlias);
  assert.throws(() => privatePath(REPO, join(outsideAlias, 'docs', 'private')));
});

test('ignored .secrets works, tracked files do not, and no ignore rule means refusal', async (t) => {
  const repo = temp(t); assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  writeFileSync(join(repo, '.gitignore'), '.secrets/\n');
  const r = await cli(['provision', 'batch', '--count', '1', '--prefix', 'bench', '--local', '--json'], () => fixture(), { repoRoot: repo });
  assert.equal(r.code, 0, r.err); assert.ok(JSON.parse(r.out).inventory.startsWith(join(repo, '.secrets')));
  const tracked = join(repo, '.secrets', 'tracked.key'); writeFileSync(tracked, 'existing');
  assert.equal(spawnSync('git', ['add', '-f', tracked], { cwd: repo }).status, 0);
  assert.throws(() => privatePath(repo, tracked));
  writeFileSync(join(repo, '.gitignore'), '');
  const noIgnore = await cli(['provision', 'batch', '--count', '1', '--prefix', 'bench', '--local'], () => fixture(), { repoRoot: repo });
  assert.equal(noIgnore.code, 2); assert.equal(noIgnore.calls.length, 0);
});

test('exclusive file creation refuses existing files, symlinks, hardlinks and replaced parents', (t) => {
  const dir = temp(t), old = join(dir, 'old'); writeFileSync(old, 'keep', { mode: 0o600 });
  assert.throws(() => reservePrivateFile(REPO, old)); assert.equal(readFileSync(old, 'utf8'), 'keep');
  const link = join(dir, 'link'); symlinkSync(old, link); assert.throws(() => reservePrivateFile(REPO, link));
  const hard = reservePrivateFile(REPO, join(dir, 'hard')); linkSync(hard.path, join(dir, 'another-link'));
  assert.throws(() => hard.write(KEY)); hard.close(); assert.equal(readFileSync(join(dir, 'another-link'), 'utf8'), '');
  const parent = join(dir, 'parent'); mkdirSync(parent, { mode: 0o700 });
  const reserved = reservePrivateFile(REPO, join(parent, 'private'));
  renameSync(parent, join(dir, 'moved')); symlinkSync(dir, parent);
  assert.throws(() => reserved.write(KEY)); reserved.close();
  assert.equal(readFileSync(join(dir, 'moved', 'private'), 'utf8'), '');
});

test('preflight prevents a bad secrets destination from issuing or rotating keys', async (t) => {
  const dir = temp(t), headers = join(dir, 'headers'); mkdirSync(headers, { mode: 0o755 }); chmodSync(headers, 0o755);
  for (const args of [batchArgs(dir), ['provision', 'rotate', 'a'.repeat(24), '--confirm', SERIAL, '--reason', 'test', '--local', '--out-dir', dir]]) {
    const r = await cli([...args, '--secrets-dir', headers]); assert.equal(r.code, 2); assert.equal(r.calls.length, 0);
  }
});

test('repeating a batch never overwrites previous manifests or headers', async (t) => {
  const dir = temp(t);
  const a = await cli([...batchArgs(dir), '--json']), b = await cli([...batchArgs(dir), '--json']);
  assert.equal(a.code, 0); assert.equal(b.code, 0);
  assert.notEqual(JSON.parse(a.out).inventory, JSON.parse(b.out).inventory);
  assert.equal(JSON.parse(readFileSync(JSON.parse(a.out).inventory, 'utf8')).response.devices[0].deviceKey, KEY);
});

test('existing register interface saves its per-device key securely and refuses overwrites before mutation', async (t) => {
  const dir = temp(t), file = join(dir, 'device.key');
  const response = () => ({ device: { id: 'a'.repeat(24) }, deviceKey: KEY });
  const args = ['devices', 'register', 'bench', '--key-file', file, '--local', '--json'];
  const first = await cli(args, response); assert.equal(first.code, 0, first.err); noSecrets(first);
  assert.equal(readFileSync(file, 'utf8'), KEY + '\n');
  const second = await cli(args, response); assert.equal(second.code, 2); assert.equal(second.calls.length, 0);
  const repo = temp(t); spawnSync('git', ['init', '-q', repo]); writeFileSync(join(repo, '.gitignore'), '.secrets/\n');
  const defaultPath = await cli(['devices', 'register', 'bench', '--local', '--json'], response, { repoRoot: repo });
  assert.equal(defaultPath.code, 0, defaultPath.err);
});
