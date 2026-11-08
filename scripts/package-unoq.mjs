// Builds the Uno Q agent release: a small deterministic tarball, its sha256, a manifest and the installer,
// into public/downloads/unoq/ so Cloudflare Pages serves them at /downloads/unoq/.
//   node scripts/package-unoq.mjs [--out public/downloads/unoq]
// Optional signing: UNOQ_SIGNING_KEY=/path/to/ed25519-private.pem (never committed, never printed).
// The same bytes are produced on every run for the same sources, so the checksum is reproducible.
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'agents', 'unoq');
const MTIME = 1767225600; // 2026-01-01T00:00:00Z, fixed so builds are reproducible
const EXCLUDE_DIRS = new Set(['tests', '__pycache__', '.pytest_cache', 'node_modules', '.git']);
const EXCLUDE_FILES = new Set(['conftest.py', '.DS_Store']);
const EXEC = new Set(['run_agent.py', 'packaging/install.sh', 'packaging/apply-power-profile.sh']);
export const MAX_TARBALL = 2_000_000;

export const version = () => readFileSync(join(SRC, 'VERSION'), 'utf8').trim();

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!EXCLUDE_DIRS.has(name)) walk(p, base, out); continue; }
    if (EXCLUDE_FILES.has(name) || name.endsWith('.pyc')) continue;
    out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

function octal(n, width) { return n.toString(8).padStart(width - 1, '0') + '\0'; }

function header(name, size, mode) {
  if (Buffer.byteLength(name) > 99) throw new Error(`path too long for ustar: ${name}`);
  const b = Buffer.alloc(512);
  b.write(name, 0, 'utf8');
  b.write(octal(mode, 8), 100);
  b.write(octal(0, 8), 108);
  b.write(octal(0, 8), 116);
  b.write(octal(size, 12), 124);
  b.write(octal(MTIME, 12), 136);
  b.write('        ', 148); // checksum placeholder
  b.write('0', 156);
  b.write('ustar\0', 257);
  b.write('00', 263);
  b.write('root', 265);
  b.write('root', 297);
  let sum = 0;
  for (const x of b) sum += x;
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return b;
}

export function tar(files) {
  const parts = [];
  for (const { name, data, mode } of files) {
    parts.push(header(name, data.length, mode), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function untar(buf) {
  const out = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8);
    const mode = parseInt(h.subarray(100, 108).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    off += 512;
    out.push({ name, size, mode, type, data: buf.subarray(off, off + size) });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

export function buildPackage({ outDir = join(ROOT, 'public', 'downloads', 'unoq'), signingKey = process.env.UNOQ_SIGNING_KEY } = {}) {
  const ver = version();
  if (!/^\d+\.\d+\.\d+$/.test(ver)) throw new Error(`agents/unoq/VERSION must be MAJOR.MINOR.PATCH, got ${ver}`);
  const top = `homebeacon-unoq-${ver}`;
  const files = walk(SRC).map((rel) => {
    const data = readFileSync(join(SRC, rel));
    return { name: `${top}/${rel}`, data, mode: EXEC.has(rel) ? 0o755 : 0o644 };
  });
  const guide = join(ROOT, 'docs', 'UNOQ_AGENT.md');
  if (existsSync(guide)) files.push({ name: `${top}/README.md`, data: readFileSync(guide), mode: 0o644 });
  files.sort((a, b) => (a.name < b.name ? -1 : 1));
  const tgz = gzipSync(tar(files), { level: 9 });
  if (tgz.length > MAX_TARBALL) throw new Error(`tarball is ${tgz.length} bytes, over the ${MAX_TARBALL} byte cap`);
  const file = `${top}.tar.gz`;
  const installer = files.find((f) => f.name === `${top}/packaging/install.sh`).data;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, file), tgz);
  writeFileSync(join(outDir, `${file}.sha256`), `${sha256(tgz)}  ${file}\n`);
  writeFileSync(join(outDir, 'install.sh'), installer, { mode: 0o644 });
  const manifest = {
    name: 'homebeacon-unoq', version: ver, file, size: tgz.length, sha256: sha256(tgz), minPython: '3.11',
    installer: 'install.sh', installerSha256: sha256(installer),
    notes: 'Checksum is verified by install.sh. Pass --pubkey to also verify the Ed25519 signature when one is listed.',
  };
  if (signingKey) {
    const key = createPrivateKey(readFileSync(signingKey));
    const sig = cryptoSign(null, tgz, key).toString('base64');
    writeFileSync(join(outDir, `${file}.sig`), `${sig}\n`);
    manifest.signature = `${file}.sig`;
    manifest.signatureAlgorithm = 'ed25519';
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { dir: outDir, file: join(outDir, file), manifest, files: files.map((f) => f.name) };
}

const SECRET_PATTERNS = [/dk_[A-Za-z0-9]{16,}/, /ak_[A-Za-z0-9]{16,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /mongodb(\+srv)?:\/\/[^\s'"]+:[^\s'"]+@/, /re_[A-Za-z0-9]{20,}/];

/** Verifies the published release. Returns {ok, problems, notes}. Never trusts the manifest without recomputing. */
export function verifyPackage({ outDir = join(ROOT, 'public', 'downloads', 'unoq'), pubkey, runSelfTest = true } = {}) {
  const problems = [];
  const notes = [];
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')); } catch { return { ok: false, problems: ['manifest.json missing or invalid'], notes }; }
  const file = join(outDir, manifest.file || '');
  if (!/^homebeacon-unoq-\d+\.\d+\.\d+\.tar\.gz$/.test(manifest.file || '') || !existsSync(file)) return { ok: false, problems: ['tarball named in the manifest is missing'], notes };
  const buf = readFileSync(file);
  if (sha256(buf) !== manifest.sha256) problems.push('tarball sha256 does not match the manifest');
  if (buf.length !== manifest.size) problems.push('tarball size does not match the manifest');
  if (buf.length > MAX_TARBALL) problems.push('tarball is over the size cap');
  const sidecar = existsSync(`${file}.sha256`) ? readFileSync(`${file}.sha256`, 'utf8').split(/\s+/)[0] : '';
  if (sidecar !== manifest.sha256) problems.push('.sha256 file does not match the manifest');
  if (manifest.version !== version()) problems.push(`manifest version ${manifest.version} differs from agents/unoq/VERSION ${version()}; run package again`);
  let entries;
  try { entries = untar(gunzipSync(buf)); } catch { problems.push('tarball is not a valid gzip archive'); return { ok: false, problems, notes, manifest }; }
  const top = `homebeacon-unoq-${manifest.version}`;
  for (const e of entries) {
    if (e.name.startsWith('/') || e.name.split('/').includes('..')) problems.push(`unsafe path ${e.name}`);
    if (!e.name.startsWith(`${top}/`)) problems.push(`entry outside ${top}: ${e.name}`);
    if (/__pycache__|\.pyc$|\.env$|\.sqlite|\/tests\//.test(e.name)) problems.push(`should not ship: ${e.name}`);
    if (e.type !== '0') problems.push(`non-regular entry ${e.name}`);
    for (const rx of SECRET_PATTERNS) if (rx.test(e.data.toString('utf8'))) problems.push(`secret-like text in ${e.name}`);
    if (/\u2014/.test(e.data.toString('utf8')) && /\.(md|toml|sh|service)$/.test(e.name)) problems.push(`em dash in ${e.name}`);
  }
  for (const need of ['hbagent/agent.py', 'hbagent/power.py', 'run_agent.py', 'VERSION', 'packaging/install.sh', 'packaging/homebeacon-unoq.service']) {
    if (!entries.some((e) => e.name === `${top}/${need}`)) problems.push(`missing ${need}`);
  }
  const inst = existsSync(join(outDir, 'install.sh')) ? readFileSync(join(outDir, 'install.sh')) : null;
  if (!inst || sha256(inst) !== manifest.installerSha256) problems.push('install.sh differs from the manifest');
  const inTar = entries.find((e) => e.name === `${top}/packaging/install.sh`);
  if (inTar && inst && !inTar.data.equals(inst)) problems.push('install.sh differs from the copy inside the tarball');
  if (manifest.signature) {
    if (!pubkey) notes.push('release is signed; pass a public key to check the signature');
    else {
      const sig = Buffer.from(readFileSync(join(outDir, manifest.signature), 'utf8').trim(), 'base64');
      const ok = cryptoVerify(null, buf, createPublicKey(readFileSync(pubkey)), sig);
      if (!ok) problems.push('signature does not verify'); else notes.push('signature verified');
    }
  } else notes.push('release is not signed (checksum only)');
  if (runSelfTest) {
    const dir = mkdtempSync(join(tmpdir(), 'unoq-verify-'));
    try {
      for (const e of entries) {
        const dest = join(dir, e.name);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, e.data, { mode: e.mode });
      }
      const py = spawnSync('python3', ['-B', '-I', join(dir, top, 'run_agent.py'), 'selftest'], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } });
      if (py.error) notes.push('python3 not available: extracted agent self test skipped');
      else if (py.status !== 0) problems.push(`extracted agent self test failed: ${(py.stdout + py.stderr).slice(-200)}`);
      else notes.push('extracted agent self test passed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return { ok: problems.length === 0, problems, notes, manifest };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const i = process.argv.indexOf('--out');
  const r = buildPackage(i > 0 ? { outDir: process.argv[i + 1] } : {});
  console.log(`built ${r.manifest.file} (${r.manifest.size} bytes) sha256 ${r.manifest.sha256}${r.manifest.signature ? ' signed' : ' unsigned'}`);
  console.log(`files in ${r.dir}`);
}
