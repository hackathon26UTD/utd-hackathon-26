// Regression tests for the ops-readiness review: installer hardening and CLI flag forwarding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { main } from '../scripts/hb.mjs';
import { benchArgv } from '../scripts/commands/bench.mjs';
import { emailArgv } from '../scripts/commands/email.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const INSTALL = join(ROOT, 'agents/unoq/packaging/install.sh');
// The installer needs Python 3.11 or newer (the Uno Q's Debian ships it); older runners skip these tests.
const hasPython = spawnSync('python3', ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)']).status === 0;
const sink = () => { const b = { text: '', isTTY: false, on() {}, write(s) { b.text += s; return true; } }; return b; };
async function cli(argv, env = {}) {
  const stdout = sink(); const stderr = sink();
  const code = await main(argv, { env, stdout, stderr, repoRoot: ROOT });
  return { code, out: stdout.text, err: stderr.text };
}

function runInstaller(args, d, extraEnv = {}) {
  const shim = join(d, 'bin');
  mkdirSync(shim, { recursive: true });
  writeFileSync(join(shim, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });    // pass the root check
  return new Promise((ok) => {
    const c = spawn('sh', [INSTALL, ...args], { env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, HB_PREFIX: join(d, 'opt'), ...extraEnv } });
    let o = '';
    c.stdout.on('data', (x) => { o += x; }); c.stderr.on('data', (x) => { o += x; });
    c.on('close', (code) => ok({ code, o }));
  });
}

test('installer never evaluates manifest fields (a hostile signature name does not run)', { skip: !hasPython }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'ops-inst-'));
  try {
    const marker = join(d, 'pwned');
    const manifest = {
      version: '0.1.0', file: 'homebeacon-unoq-0.1.0.tar.gz', size: 100, sha256: 'a'.repeat(64),
      signature: `x;touch ${marker}`,
    };
    let manifests = 0;
    const srv = createServer((req, res) => {
      if (req.url.endsWith('/manifest.json')) { manifests++; res.writeHead(200); res.end(JSON.stringify(manifest)); } else { res.writeHead(404); res.end(); }
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const run = await runInstaller(['--base', `http://127.0.0.1:${srv.address().port}`], d);
    srv.close();
    assert.equal(manifests, 1, 'the manifest was fetched');
    assert.notEqual(run.code, 0);
    assert.match(run.o, /manifest is malformed/);
    assert.equal(existsSync(marker), false, 'the injected command did not run');
    assert.doesNotMatch(readFileSync(INSTALL, 'utf8'), /\beval\b\s*["$(]/, 'no eval of downloaded data');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('installer: other hostile manifest fields are rejected too', { skip: !hasPython }, async () => {
  for (const patch of [{ file: 'homebeacon-unoq-0.1.0.tar.gz;id' }, { version: '0.1.0\nfoo' }, { sha256: 'z'.repeat(64) }, { size: '100' }, { signature: ['x'] }, { signature: 'evil.sig' }]) {
    const d = mkdtempSync(join(tmpdir(), 'ops-inst-'));
    try {
      const manifest = { version: '0.1.0', file: 'homebeacon-unoq-0.1.0.tar.gz', size: 100, sha256: 'a'.repeat(64), ...patch };
      const srv = createServer((req, res) => { res.writeHead(200); res.end(JSON.stringify(manifest)); });
      await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
      const run = await runInstaller(['--base', `http://127.0.0.1:${srv.address().port}`], d);
      srv.close();
      assert.match(run.o, /manifest is malformed/, JSON.stringify(patch));
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
});

test('installer: --base accepts https and exact loopback http only', { skip: !hasPython }, async () => {
  for (const base of ['http://127.0.0.1.evil.com', 'http://localhost.evil.com', 'http://127.0.0.1@evil.com', 'http://127.0.0.1:80@evil.com/x', 'http://example.com', 'ftp://example.com', 'https://evil.com/\nx', 'https://user@evil.com']) {
    const d = mkdtempSync(join(tmpdir(), 'ops-inst-'));
    try {
      const run = await runInstaller(['--base', base], d);
      assert.notEqual(run.code, 0, base);
      assert.match(run.o, /--base must be https/, base);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // exact loopback forms get past the guard (and then fail on the unreachable port, not on the guard)
  for (const base of ['http://127.0.0.1:9', 'http://localhost:9/', 'http://127.0.0.1:9/prefix']) {
    const d = mkdtempSync(join(tmpdir(), 'ops-inst-'));
    try {
      const run = await runInstaller(['--base', base], d);
      assert.doesNotMatch(run.o, /--base must be https/, base);
      assert.match(run.o, /could not download the manifest/, base);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
});

test('installer: remote fetches are https only and may not redirect to http', () => {
  const text = readFileSync(INSTALL, 'utf8');
  assert.match(text, /--proto '=https' --proto-redir '=https'/);
  assert.doesNotMatch(text, /http:\/\/127\.0\.0\.1\*|http:\/\/localhost\*/, 'the loose prefix patterns are gone');
  assert.equal(readFileSync(INSTALL, 'utf8'), readFileSync(join(ROOT, 'public/downloads/unoq/install.sh'), 'utf8'), 'published installer matches the source');
});

test('benchArgv forwards the flags the dispatcher parsed', () => {
  assert.deepEqual(benchArgv([], { target: 'local', url: 'http://127.0.0.1:8790', runs: '2', 'no-db': true }),
    ['--target', 'local', '--runs', '2', '--url', 'http://127.0.0.1:8790', '--no-db']);
  assert.deepEqual(benchArgv([], { local: true, db: false, json: true }), ['--target', 'local', '--no-db', '--json']);
  assert.deepEqual(benchArgv([], { site: 'http://127.0.0.1:1', profile: 'desktop' }), ['--url', 'http://127.0.0.1:1', '--profile', 'desktop']);
  assert.deepEqual(benchArgv([], { site: true }), []);
});

test('hb bench through the dispatcher honours --url and --no-db (never falls back to live)', async () => {
  let hits = 0;
  const srv = createServer((req, res) => { hits++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const r = await cli(['bench', '--target', 'local', '--url', url, '--runs', '1', '--no-db', '--json']);
    assert.equal(r.code, 0, r.err);
    const result = JSON.parse(r.err.slice(r.err.indexOf('{')));
    assert.equal(result.local.base, url);
    assert.equal(result.live, undefined, 'live was not benchmarked');
    assert.equal(result.atlas, undefined, '--no-db skipped the Atlas test');
    assert.ok(hits > 0, 'the local server received the requests');
  } finally { srv.close(); }
});

test('emailArgv forwards flags', () => {
  assert.deepEqual(emailArgv(['send-test', 'welcome'], { 'dry-run': true, keychain: true, to: 'delivered@resend.dev' }),
    ['send-test', 'welcome', '--keychain', '--dry-run', '--to', 'delivered@resend.dev']);
  assert.deepEqual(emailArgv(['preview'], { out: '/tmp/x', shots: true }), ['preview', '--shots', '--out', '/tmp/x']);
});

test('hb email send-test --dry-run works through the dispatcher without a key', async () => {
  const r = await cli(['email', 'send-test', 'welcome', '--dry-run'], {});
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /"dryRun":true/);
  assert.doesNotMatch(r.out + r.err, /No RESEND_API_KEY/);
});

test('hb email preview --out writes where it was told', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ops-mail-'));
  try {
    const r = await cli(['email', 'preview', 'welcome', '--out', d], {});
    assert.equal(r.code, 0, r.out + r.err);
    assert.ok(existsSync(join(d, 'welcome.html')), 'preview landed in --out');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
