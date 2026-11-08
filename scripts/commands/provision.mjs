// Admin-only inventory creation. One-time credentials never pass through terminal output.
import { mkdirSync, mkdtempSync, openSync, closeSync, writeFileSync, fsyncSync, fstatSync, lstatSync, realpathSync, readdirSync, constants } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname, parse, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HbError, EXIT, usageError } from '../lib/hb-errors.mjs';
import { isLocalSite } from '../lib/hb-http.mjs';
import { buildSheet, buildSecretsHeader, checkSerial, SERIAL_RE, CODE_V1_RE, CODE_V2_RE, DEVICE_KEY_RE } from '../lib/labels.mjs';

export const TYPES = ['esp32', 'xiao-esp32s3-sense', 'unoq'];
export const MAX_COUNT = 100;
const ID_RE = /^[a-f0-9]{24}$/i;
const BATCH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const USAGE = [
  'hb devices provision --count N --prefix NAME [--home-less] [--type esp32|xiao-esp32s3-sense|unoq] [--note TEXT]',
  'hb provision batch --count N --prefix NAME [--expected-report-interval-seconds N]',
  'hb provision add --prefix NAME (one box)',
  'hb provision rotate <deviceId> --reason TEXT --confirm SERIAL',
  'Options: --out-dir DIR --secrets-dir DIR --origin URL --dry-run --yes',
].join('\n');
const plainText = (s, max) => typeof s === 'string' && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s);

function originOf(value, flag) {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
        !(u.protocol === 'https:' || (u.protocol === 'http:' && isLocalSite(u.href)))) throw Error();
    return u.origin;
  } catch { throw usageError(`${flag} must be an HTTPS origin without a path, credentials, query or fragment (local HTTP is allowed).`); }
}

export function planBatch(flags, { site, single = false } = {}) {
  if (typeof flags.count === 'boolean' || (single && flags.count !== undefined && Number(flags.count) !== 1)) throw usageError('--count must be a whole number from 1 to 100 (add creates exactly one box).');
  const count = single ? 1 : Number(flags.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw usageError('--count must be a whole number from 1 to 100.');
  const prefix = flags.prefix;
  if (typeof prefix !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/i.test(prefix)) throw usageError('--prefix is required: 1 to 24 letters, digits or hyphens.');
  const type = flags.type === undefined ? 'esp32' : flags.type;
  if (!TYPES.includes(type)) throw usageError(`--type must be one of ${TYPES.join(', ')}.`);
  const note = flags.note === undefined ? '' : flags.note;
  if (!plainText(note, 160)) throw usageError('--note must be plain text up to 160 characters.');
  if (flags['home-less'] === false) throw usageError('New inventory is always home-less; customer claim creates the home.');
  const origin = originOf(flags.origin === undefined ? site : flags.origin, '--origin');
  // Bound the QR before creating anything on the server.
  if (Buffer.byteLength(`${origin}/customer#claim=HB-AAAA-AAAA.AAAA-AAAA`) > 213) throw usageError('--origin is too long for the printed QR.');
  const plan = { count, prefix, type, note, origin };
  if (flags['expected-report-interval-seconds'] !== undefined) {
    const value = flags['expected-report-interval-seconds'];
    const n = Number(value);
    if (typeof value === 'boolean' || !Number.isSafeInteger(n) || n < 5 || n > 86400) throw usageError('--expected-report-interval-seconds must be a whole number from 5 to 86400.');
    plan.expectedReportIntervalSeconds = n;
  }
  return plan;
}

export function validateBatchResponse(data, plan, { serverOrigin = plan.origin } = {}) {
  const bad = () => new HbError('Batch response was not usable. Inspect the private manifest before retrying; boxes may already exist.', EXIT.FAIL);
  if (!data || typeof data.batchId !== 'string' || !BATCH_RE.test(data.batchId) || !Array.isArray(data.devices) || data.devices.length !== plan.count) throw bad();
  const seenSerial = new Set(), seenId = new Set(), seenKey = new Set();
  let legacyChecksum = 0;
  const devices = data.devices.map((d, i) => {
    if (!d || !['serial', 'deviceId', 'pairingCode', 'deviceKey'].every(k => typeof d[k] === 'string') || !SERIAL_RE.test(d.serial) || !ID_RE.test(d.deviceId) ||
        (!CODE_V2_RE.test(d.pairingCode) && !CODE_V1_RE.test(d.pairingCode)) ||
        !DEVICE_KEY_RE.test(d.deviceKey) || d.expiresAt !== null ||
        seenSerial.has(d.serial) || seenId.has(d.deviceId) || seenKey.has(d.deviceKey)) throw bad();
    const qr = `${plan.origin}/customer#claim=${d.serial}.${d.pairingCode}`;
    const serverQr = `${serverOrigin}/customer#claim=${d.serial}.${d.pairingCode}`;
    if (![qr, serverQr].includes(d.qr ?? d.qrPayload) || (d.qr !== undefined && d.qrPayload !== undefined && d.qr !== d.qrPayload)) throw bad();
    seenSerial.add(d.serial); seenId.add(d.deviceId); seenKey.add(d.deviceKey);
    if (!checkSerial(d.serial).checksum) legacyChecksum++;
    return { deviceId: d.deviceId, name: `${plan.prefix} ${i + 1}`, serial: d.serial,
      pairingCode: d.pairingCode, deviceKey: d.deviceKey, qr, expiresAt: null };
  });
  return { batchId: data.batchId, devices, legacyChecksum };
}

const within = (root, path) => { const r = relative(root, path); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
// macOS uses these system aliases. Resolve only the OS prefix, never a user-controlled link.
function systemPath(path) {
  for (const root of ['/tmp', '/var']) if (path === root || path.startsWith(root + '/')) return resolve(realpathSync(root), relative(root, path));
  return path;
}
function inspectPath(path) {
  let cursor = parse(path).root;
  for (const part of path.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try { if (lstatSync(cursor).isSymbolicLink()) throw usageError('Private output paths must not contain symbolic links.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

/** Only outside the checkout, or actually ignored .secrets paths. Reject existing symlink ancestors. */
export function privatePath(repoRoot, value) {
  const repo = realpathSync(repoRoot);
  const abs = systemPath(resolve(repo, value));
  inspectPath(abs);
  if (within(repo, abs)) {
    const secretRoot = join(repo, '.secrets');
    if (!within(secretRoot, abs)) throw usageError('Private files must be outside the repository or inside ignored .secrets/.');
    const ignored = spawnSync('git', ['check-ignore', '-q', '--', abs === secretRoot ? '.secrets/' : relative(repo, abs)], { cwd: repo });
    if (ignored.status !== 0) throw usageError('Private output is not ignored by git. Use an ignored .secrets/ directory or an external directory.');
  }
  return abs;
}

export function privateDirectory(repoRoot, value) {
  const path = privatePath(repoRoot, value);
  if (path === parse(path).root || path === realpathSync(repoRoot)) throw usageError('Choose a dedicated private output directory.');
  try {
    const pending = [];
    let parent = path;
    while (true) {
      try { lstatSync(parent); break; } catch (e) { if (e.code !== 'ENOENT') throw e; pending.unshift(parent); parent = dirname(parent); }
    }
    for (const dir of pending) mkdirSync(dir, { mode: 0o700 });
    const stat = lstatSync(path);
    // Never silently tighten permissions on a shared existing directory.
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.()) throw usageError('Existing private output directories must be owned by you and have mode 700. Choose a new directory or fix its permissions.');
    privatePath(repoRoot, path);
    return path;
  } catch (e) { if (e instanceof HbError) throw e; throw usageError('Could not prepare the private output directory. Check its permissions.'); }
}

/** Reserve before the API mutation; exclusive + no-follow creation, held descriptor, identity checks. */
export function reservePrivateFile(repoRoot, value) {
  const path = privatePath(repoRoot, value);
  const parent = privateDirectory(repoRoot, dirname(path));
  const parentStat = lstatSync(parent);
  let fd;
  try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { throw usageError('Private output already exists or cannot be created. Choose a fresh path; existing files are never overwritten.'); }
  return {
    path,
    write(content) {
      try {
        privatePath(repoRoot, path);
        const dir = lstatSync(parent), file = lstatSync(path), opened = fstatSync(fd);
        if (dir.ino !== parentStat.ino || dir.dev !== parentStat.dev || (dir.mode & 0o777) !== 0o700 ||
            file.ino !== opened.ino || file.dev !== opened.dev || opened.nlink !== 1 || (opened.mode & 0o777) !== 0o600) throw Error();
        writeFileSync(fd, content); fsyncSync(fd);
      } catch { throw new HbError('Could not save private output safely. The server may already have changed the device; inspect the private output before retrying.', EXIT.FAIL); }
    },
    close() { if (fd !== undefined) { closeSync(fd); fd = undefined; } },
  };
}

// ctx.api may be an object exposing .ok. Suppress server/transport text: it can echo one-time codes.
export async function privateRequest(ctx, path, options) {
  try { return await ctx.api.ok(path, options); }
  catch (e) {
    const code = e instanceof HbError ? e.code : EXIT.NETWORK;
    throw new HbError(code === EXIT.AUTH ? 'Admin access failed. Check API_ADMIN_KEY; inventory requires the admin key.' :
      'The provisioning request failed. Check the site and endpoint. A write may have succeeded; inspect the fleet before retrying.', code);
  }
}

function outputOptions(ctx) {
  originOf(ctx.site, '--site');
  for (const flag of ['out-dir', 'secrets-dir']) if (ctx.flags[flag] !== undefined && (typeof ctx.flags[flag] !== 'string' || !ctx.flags[flag])) throw usageError(`--${flag} requires a directory.`);
  return { out: privatePath(ctx.repoRoot, ctx.flags['out-dir'] ?? '.secrets/onboarding'),
    secrets: ctx.flags['secrets-dir'] === undefined ? null : privatePath(ctx.repoRoot, ctx.flags['secrets-dir']) };
}
function reserveBundle(ctx, paths, kind, count, labels) {
  const files = [];
  try {
    const dir = mkdtempSync(join(privateDirectory(ctx.repoRoot, paths.out), `${kind}-`));
    const reserve = (path) => { const f = reservePrivateFile(ctx.repoRoot, path); files.push(f); return f; };
    const manifest = reserve(join(dir, 'manifest.json'));
    const sheet = labels ? reserve(join(dir, 'sheet.html')) : null;
    const secretsDir = paths.secrets ? mkdtempSync(join(privateDirectory(ctx.repoRoot, paths.secrets), `${kind}-`)) : null;
    const secrets = secretsDir ? Array.from({ length: count }, (_, i) => reserve(join(secretsDir, `secrets.${String(i + 1).padStart(3, '0')}.h`))) : [];
    return { manifest, sheet, secrets, close: () => files.forEach((f) => f.close()) };
  } catch (e) { files.forEach((f) => f.close()); if (e instanceof HbError) throw e; throw usageError('Could not reserve private output files. No request was sent.'); }
}
function saveManifest(ctx, bundle, request, response) {
  bundle.manifest.write(JSON.stringify({ createdAt: new Date(ctx.now()).toISOString(), site: ctx.site, request, response,
    secretsFiles: bundle.secrets.map((f) => f.path) }, null, 2) + '\n');
}
function saveHeaders(ctx, bundle, devices) {
  bundle.secrets.forEach((file, i) => file.write(buildSecretsHeader(devices[i], { apiBase: ctx.site,
    wifi: { ssid: ctx.env.WIFI_SSID || '', pass: ctx.env.WIFI_PASS || '' } })));
}

async function runBatch(ctx, single) {
  const plan = planBatch(ctx.flags, { site: ctx.site, single });
  const paths = outputOptions(ctx);
  if (ctx.flags['dry-run']) {
    ctx.emit({ dryRun: true, endpoint: 'POST /api/ops/fleet-batch', body: plan, outputDirectory: paths.out, secretsDirectory: paths.secrets },
      () => ctx.out(`Would create ${plan.count} home-less boxes. Private files: ${paths.out}. Nothing sent or written.`));
    return EXIT.OK;
  }
  if (!isLocalSite(ctx.site) && !ctx.flags.yes) throw usageError('This creates real inventory. Use --yes to proceed or --dry-run to preview.');
  const bundle = reserveBundle(ctx, paths, 'batch', plan.count, true);
  try {
    const r = await privateRequest(ctx, '/api/ops/fleet-batch', { method: 'POST', auth: 'admin', body: plan, timeoutMs: 60000 });
    // Save the raw response first, even if the server's contract or QR is wrong. Keys are returned once.
    saveManifest(ctx, bundle, plan, r.data);
    const { batchId, devices, legacyChecksum } = validateBatchResponse(r.data, plan, { serverOrigin: new URL(ctx.site).origin });
    bundle.sheet.write(buildSheet(devices, { batch: batchId, origin: plan.origin, createdAt: new Date(ctx.now()).toISOString() }));
    saveHeaders(ctx, bundle, devices);
    const result = { count: devices.length, inventory: bundle.manifest.path, sheet: bundle.sheet.path,
      secretsFiles: bundle.secrets.map((f) => f.path), legacyChecksum };
    ctx.emit(result, () => {
      ctx.out(`Created ${result.count} home-less boxes. Inventory: ${result.inventory}`);
      ctx.out(`Private label sheet: ${result.sheet}`);
      if (result.secretsFiles.length) ctx.out(`Saved ${result.secretsFiles.length} separate firmware headers; paths are in the manifest.`);
      if (legacyChecksum) ctx.warn('Some serials use an older check-character format. They remain usable.');
    });
    return EXIT.OK;
  } catch (e) {
    // Only locally generated messages get this far; include recovery path, never the response.
    if (e instanceof HbError) throw new HbError(`${e.message} Private manifest: ${bundle.manifest.path}`, e.code);
    throw new HbError(`Could not finish labels or headers. Inspect the private manifest before retrying: ${bundle.manifest.path}`, EXIT.FAIL);
  } finally { bundle.close(); }
}

async function runRotate(ctx, args) {
  const id = args[1];
  if (args.length !== 2 || !ID_RE.test(id)) throw usageError('Usage: hb provision rotate <24-hex device id> --reason TEXT --confirm SERIAL');
  const reason = ctx.flags.reason;
  if (!plainText(reason, 160) || reason.trim().length < 3) throw usageError('--reason is required (3 to 160 plain characters).');
  const serial = typeof ctx.flags.confirm === 'string' ? ctx.flags.confirm.toUpperCase() : '';
  if (!SERIAL_RE.test(serial)) throw usageError('--confirm must be the box serial. The old key stops working immediately; reflash the box with the saved key.');
  const paths = outputOptions(ctx);
  const body = { action: 'rotate_key', confirmSerial: serial, reason };
  const endpoint = `/api/ops/fleet/${id}/action`;
  if (ctx.flags['dry-run']) {
    ctx.emit({ dryRun: true, endpoint: `POST ${endpoint}`, body }, () => ctx.out('Would rotate the key. The old key stops working immediately; reflash with the saved key. Nothing sent or written.'));
    return EXIT.OK;
  }
  const bundle = reserveBundle(ctx, paths, 'rotation', 1, false);
  try {
    const r = await privateRequest(ctx, endpoint, { method: 'POST', auth: 'admin', body, timeoutMs: 30000 });
    saveManifest(ctx, bundle, { deviceId: id, ...body }, r.data);
    if (!DEVICE_KEY_RE.test(r.data?.deviceKey)) throw new HbError('Rotation returned no usable key. The old key may already be disabled.', EXIT.FAIL);
    saveHeaders(ctx, bundle, [{ deviceId: id, serial, deviceKey: r.data.deviceKey }]);
    ctx.emit({ id, serial, rotation: bundle.manifest.path, secretsFiles: bundle.secrets.map((f) => f.path) }, () => {
      ctx.out(`Key rotated. Private manifest: ${bundle.manifest.path}`);
      ctx.out('The old key is disabled. Reflash the box, or update the Uno Q agent environment, using the saved key.');
    });
    return EXIT.OK;
  } catch (e) {
    throw new HbError(`${e instanceof HbError ? e.message : 'Could not finish rotation output.'} Private manifest: ${bundle.manifest.path}`, e instanceof HbError ? e.code : EXIT.FAIL);
  } finally { bundle.close(); }
}

export default {
  name: 'provision', summary: 'Create home-less inventory and private pairing labels', usage: USAGE,
  group: 'Hardware and agent', booleans: ['home-less', 'dry-run', 'yes'],
  async run(args, ctx) {
    if (args[0] === 'rotate') return runRotate(ctx, args);
    if (args.length > 1) throw usageError(USAGE);
    if (args[0] === 'list') {
      const { out } = outputOptions(ctx);
      let batches = [];
      try { batches = readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory() && /^batch-[A-Za-z0-9]+$/.test(d.name)).map((d) => d.name).sort(); }
      catch (e) { if (e.code !== 'ENOENT') throw new HbError('Could not list local inventory.', EXIT.FAIL); }
      ctx.emit({ batches }, () => ctx.out(batches.join('\n') || 'No local inventory batches.'));
      return EXIT.OK;
    }
    if (args[0] && !['batch', 'add'].includes(args[0])) throw usageError(USAGE);
    return runBatch(ctx, args[0] === 'add');
  },
};
