import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { ROOT, buildPackage, untar, verifyPackage, version } from '../scripts/package-unoq.mjs';
import agentCommand from '../scripts/commands/agent.mjs';

const hasPython = !spawnSync('python3', ['--version']).error;
const tmp = () => mkdtempSync(join(tmpdir(), 'unoq-test-'));

test('package is reproducible and small', () => {
  const a = tmp(), b = tmp();
  try {
    const x = buildPackage({ outDir: a, signingKey: undefined });
    const y = buildPackage({ outDir: b, signingKey: undefined });
    assert.equal(x.manifest.sha256, y.manifest.sha256);
    assert.ok(x.manifest.size < 200_000, `tarball is ${x.manifest.size} bytes`);
    assert.equal(x.manifest.version, version());
    assert.match(readFileSync(join(a, `${x.manifest.file}.sha256`), 'utf8'), new RegExp(`^${x.manifest.sha256}  ${x.manifest.file}\n$`));
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('tarball ships the agent and nothing it should not', () => {
  const d = tmp();
  try {
    const r = buildPackage({ outDir: d, signingKey: undefined });
    const names = untar(gunzipSync(readFileSync(r.file))).map((e) => e.name);
    const top = `homebeacon-unoq-${version()}/`;
    assert.ok(names.every((n) => n.startsWith(top)));
    for (const need of ['hbagent/agent.py', 'hbagent/power.py', 'hbagent/commands.py', 'run_agent.py', 'packaging/install.sh', 'packaging/homebeacon-unoq.service', 'packaging/unoq.example.toml']) assert.ok(names.includes(top + need), need);
    assert.ok(!names.some((n) => /tests\/|__pycache__|\.pyc|\.env|\.sqlite|conftest/.test(n)));
    const exec = untar(gunzipSync(readFileSync(r.file))).find((e) => e.name.endsWith('packaging/install.sh'));
    assert.equal(exec.mode & 0o111, 0o111);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('verify passes on a fresh build and fails when the tarball is tampered with', { skip: !hasPython }, () => {
  const d = tmp();
  try {
    const r = buildPackage({ outDir: d, signingKey: undefined });
    const ok = verifyPackage({ outDir: d });
    assert.deepEqual(ok.problems, []);
    assert.ok(ok.notes.some((n) => /self test passed/.test(n)));
    const bytes = readFileSync(r.file);
    bytes[bytes.length - 40] ^= 0xff;
    writeFileSync(r.file, bytes);
    const bad = verifyPackage({ outDir: d, runSelfTest: false });
    assert.equal(bad.ok, false);
    assert.ok(bad.problems.some((p) => /sha256|size/.test(p)));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('signed release verifies with the right key and not with another', () => {
  const d = tmp();
  try {
    const a = generateKeyPairSync('ed25519');
    const b = generateKeyPairSync('ed25519');
    const keyFile = join(d, 'signing.pem');
    writeFileSync(keyFile, a.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const pubA = join(d, 'a.pub.pem'), pubB = join(d, 'b.pub.pem');
    writeFileSync(pubA, a.publicKey.export({ type: 'spki', format: 'pem' }));
    writeFileSync(pubB, b.publicKey.export({ type: 'spki', format: 'pem' }));
    const out = join(d, 'out');
    const r = buildPackage({ outDir: out, signingKey: keyFile });
    assert.equal(r.manifest.signatureAlgorithm, 'ed25519');
    assert.deepEqual(verifyPackage({ outDir: out, pubkey: pubA, runSelfTest: false }).problems, []);
    assert.ok(verifyPackage({ outDir: out, pubkey: pubB, runSelfTest: false }).problems.some((p) => /signature/.test(p)));
    // the device checks the same signature with openssl 3, as install.sh does
    const o = spawnSync('openssl', ['pkeyutl', '-verify', '-pubin', '-inkey', pubA, '-rawin', '-in', r.file, '-sigfile', '/dev/stdin'], {
      input: Buffer.from(readFileSync(join(out, r.manifest.signature), 'utf8').trim(), 'base64'),
    });
    assert.ok(!o.error, 'openssl is needed for the device-side signature check');
    assert.equal(o.status, 0, String(o.stderr));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('install.sh is valid POSIX shell and refuses to run unverified', () => {
  const script = join(ROOT, 'agents/unoq/packaging/install.sh');
  assert.equal(spawnSync('sh', ['-n', script]).status, 0);
  const text = readFileSync(script, 'utf8');
  assert.match(text, /sha256 does not match the manifest; nothing was installed/);
  assert.match(text, /--no-same-owner/);
  assert.doesNotMatch(text, /HB_DEVICE_KEY=[A-Za-z0-9]/, 'the installer never contains a key');
  const unit = readFileSync(join(ROOT, 'agents/unoq/packaging/homebeacon-unoq.service'), 'utf8');
  for (const line of ['User=homebeacon', 'NoNewPrivileges=true', 'MemoryMax=', 'CPUQuota=', 'ProtectSystem=strict']) assert.ok(unit.includes(line), line);
  assert.match(unit, /EnvironmentFile=-\/etc\/homebeacon\/unoq\.env/);
});

test('installer refuses a tampered download before touching the system', async () => {
  const { createServer } = await import('node:http');
  const d = tmp();
  const shim = join(d, 'bin');
  try {
    const out = join(d, 'out');
    const r = buildPackage({ outDir: out, signingKey: undefined });
    const bytes = readFileSync(r.file);
    bytes[bytes.length - 60] ^= 0x55;       // the manifest still lists the honest checksum
    writeFileSync(r.file, bytes);
    mkdirSync(shim);
    writeFileSync(join(shim, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 }); // pass the root check; nothing after verification is reached
    const srv = createServer((req, res) => {
      const f = join(out, req.url.replace('/downloads/unoq/', ''));
      if (existsSync(f)) { res.writeHead(200); res.end(readFileSync(f)); } else { res.writeHead(404); res.end(); }
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const run = await new Promise((ok) => {
      const c = spawn('sh', [join(ROOT, 'agents/unoq/packaging/install.sh'), '--base', base], { env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, HB_PREFIX: join(d, 'opt') } });
      let o = '';
      c.stdout.on('data', (x) => { o += x; }); c.stderr.on('data', (x) => { o += x; });
      c.on('close', (code) => ok({ code, o }));
    });
    srv.close();
    assert.notEqual(run.code, 0);
    assert.match(run.o, /sha256 does not match the manifest; nothing was installed/);
    assert.equal(existsSync(join(d, 'opt')), false, 'nothing was created');
  } finally { rmSync(d, { recursive: true, force: true }); }
}, { skip: !hasPython });

test('committed download matches the sources', { skip: !hasPython }, () => {
  const dir = join(ROOT, 'public/downloads/unoq');
  if (!existsSync(join(dir, 'manifest.json'))) return;
  const r = verifyPackage({ outDir: dir, runSelfTest: false });
  assert.deepEqual(r.problems, [], 'run: npm run hb -- agent package');
  const d = tmp();
  try {
    const fresh = buildPackage({ outDir: d, signingKey: undefined });
    const published = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    if (!published.signature) assert.equal(published.sha256, fresh.manifest.sha256, 'sources changed since the release was built: run npm run hb -- agent package');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('agent files and docs avoid em dashes and secrets', () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() && !['__pycache__', '.pytest_cache'].includes(n) ? walk(join(dir, n)) : [join(dir, n)]));
  const files = [...walk(join(ROOT, 'agents/unoq')), join(ROOT, 'docs/UNOQ_AGENT.md'), join(ROOT, 'docs/POWER_DESIGN.md')].filter((f) => existsSync(f) && /\.(py|md|sh|toml|service|txt)$/.test(f));
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!t.includes('\u2014'), `em dash in ${f}`);
    assert.doesNotMatch(t, /dk_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY/, `secret-like text in ${f}`);
  }
});

test('agent CLI command shape and power-plan', { skip: !hasPython }, async () => {
  assert.equal(agentCommand.name, 'agent');
  assert.equal(typeof agentCommand.run, 'function');
  const lines = [];
  const code = await agentCommand.run(['power-plan', '--mah', '6000', '--volts', '7.4', '--chemistry', 'liion', '--soc', '90'], { log: (m) => lines.push(m) });
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /estimates until measured/);
  assert.equal(await agentCommand.run(['nope'], { log: () => {} }), 2);
});

test('python unit tests pass', { skip: !hasPython }, async () => {
  const lines = [];
  const code = await agentCommand.run(['test'], { log: (m) => lines.push(m) });
  assert.equal(code, 0, lines.join('\n'));
});

test('simulated agent run against the mock API', { skip: !hasPython, timeout: 90_000 }, async () => {
  const lines = [];
  const code = await agentCommand.run(['simulate', '--duration', '12', '--scenario', 'quiet'], { log: (m) => lines.push(m) });
  assert.equal(code, 0, lines.join('\n'));
  assert.match(lines.join('\n'), /PASS allowlisted command acknowledged/);
});
