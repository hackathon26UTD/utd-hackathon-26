// hb provision: build inventory (serials, device keys, pairing codes, label sheets) for boxes we make.
// Operators never add boxes in a screen. This command calls the admin-only batch endpoint, then writes
// private files. Device keys and pairing codes are written to mode 600 files and are never printed.
import { mkdirSync, writeFileSync, existsSync, chmodSync, readdirSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HbError, EXIT, usageError } from '../lib/hb-errors.mjs';
import { isLocalSite } from '../lib/hb-http.mjs';
import { buildSheet, buildSecretsHeader, checkSerial, SERIAL_RE, CODE_V1_RE, CODE_V2_RE, DEVICE_KEY_RE } from '../lib/labels.mjs';

export const TYPES = ['esp32', 'xiao-esp32s3-sense', 'unoq'];
export const MAX_COUNT = 100;
const PREFIX_RE = /^[a-z0-9][a-z0-9-]{0,23}$/i;
const BATCH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ID_RE = /^[a-f0-9]{24}$/i;
const USAGE = [
  'hb provision --count N --prefix NAME --home-less [--type esp32|xiao-esp32s3-sense|unoq] [--note TEXT] [--origin URL] [--secrets-dir DIR] [--dry-run] [--yes]',
  'hb provision add --prefix NAME [same options]   (one box)',
  'hb provision rotate <deviceId> --reason TEXT --confirm SERIAL [--secrets-dir DIR] [--dry-run]',
  'alias: hb devices provision ... is documented as this command; devices.mjs is not edited, so run hb provision.',
].join('\n');

const isHttpOrigin = (u) => { try { const p = new URL(u); return p.protocol === 'https:' || (p.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(p.hostname)); } catch { return false; } };
const plainText = (s, max) => typeof s === 'string' && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s);

/** Validate flags into the request body for POST /api/ops/fleet-batch. Throws usage errors. */
export function planBatch(flags, { site, single = false } = {}) {
  const count = single ? 1 : Number(flags.count);
  if (!single && (!Number.isInteger(count) || count < 1 || count > MAX_COUNT)) throw usageError(`--count must be a whole number from 1 to ${MAX_COUNT}`);
  const prefix = flags.prefix;
  if (typeof prefix !== 'string' || !PREFIX_RE.test(prefix)) throw usageError('--prefix is required: 1 to 24 letters, digits or hyphens, starting with a letter or digit (for example lab)');
  const type = flags.type === undefined || flags.type === true ? 'esp32' : String(flags.type);
  if (!TYPES.includes(type)) throw usageError(`--type must be one of ${TYPES.join(', ')}`);
  const note = flags.note === undefined || flags.note === true ? '' : flags.note;
  if (!plainText(note, 200)) throw usageError('--note must be plain text up to 200 characters');
  const origin = String(flags.origin && flags.origin !== true ? flags.origin : site).replace(/\/+$/, '');
  if (!isHttpOrigin(origin)) throw usageError('--origin must be an https URL (http only for localhost)');
  if (!single && !flags['home-less']) {
    throw usageError('Pass --home-less. New boxes are made with no home; the customer claim creates one. (npm run provision still builds the older synthetic-home demo boxes.)');
  }
  return { count, prefix, type, note, origin };
}

/** Check the server answer before anything is written. Returns the normalised list, or throws. */
export function validateBatchResponse(data, plan) {
  const bad = (why) => new HbError(`Batch response was not usable (${why}). Nothing was written. Check the server before retrying: boxes may already exist.`, EXIT.FAIL);
  if (!data || typeof data !== 'object') throw bad('not JSON');
  const batch = String(data.batch || '');
  if (!BATCH_RE.test(batch)) throw bad('batch id missing or unsafe');
  const list = Array.isArray(data.devices) ? data.devices : null;
  if (!list) throw bad('devices missing');
  if (list.length !== plan.count) throw bad(`expected ${plan.count} boxes, got ${list.length}`);
  const seenSerial = new Set(), seenId = new Set();
  let legacyChecksum = 0;
  const devices = list.map((d, i) => {
    const serial = String(d?.serial || '').toUpperCase();
    if (!SERIAL_RE.test(serial)) throw bad(`box ${i + 1} serial malformed`);
    if (seenSerial.has(serial)) throw bad('duplicate serial');
    seenSerial.add(serial);
    const id = String(d?.id || '');
    if (!id || id.length > 64 || seenId.has(id)) throw bad(`box ${i + 1} id missing or duplicate`);
    seenId.add(id);
    const code = String(d?.pairingCode || '').toUpperCase();
    if (!CODE_V2_RE.test(code) && !CODE_V1_RE.test(code)) throw bad(`box ${i + 1} pairing code malformed`);
    if (!DEVICE_KEY_RE.test(String(d?.deviceKey || ''))) throw bad(`box ${i + 1} device key missing`);
    const qr = String(d?.qrPayload || '');
    if (!isHttpOrigin(qr.split('#')[0]) || !qr.includes('#claim=')) throw bad(`box ${i + 1} QR payload malformed`);
    if (!checkSerial(serial).checksum) legacyChecksum++;
    return { id, name: String(d?.name || `${plan.prefix}-${String(i + 1).padStart(3, '0')}`).slice(0, 80), serial, pairingCode: code, deviceKey: String(d.deviceKey), qrPayload: qr };
  });
  return { batch, devices, legacyChecksum };
}

function privateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* best effort */ }
}
/** Write a new private file. Never overwrites: on a clash a numeric suffix is added. Returns the path used. */
function writeNew(dir, base, ext, content) {
  privateDir(dir);
  for (let n = 1; n < 100; n++) {
    const file = join(dir, n === 1 ? `${base}${ext}` : `${base}-${n}${ext}`);
    try { writeFileSync(file, content, { flag: 'wx', mode: 0o600 }); chmodSync(file, 0o600); return file; }
    catch (e) { if (e?.code !== 'EEXIST') throw e; }
  }
  throw new HbError(`Too many existing files named ${base}`, EXIT.FAIL);
}

/** Refuse a secrets directory that git would not ignore when it lives inside the repository. */
function checkSecretsDir(repoRoot, dir, sample) {
  const abs = resolve(repoRoot, dir);
  const rel = relative(repoRoot, abs);
  const inside = rel && !rel.startsWith('..') && !isAbsolute(rel);
  if (!inside) return abs;
  const r = spawnSync('git', ['check-ignore', '-q', '--', join(rel, sample)], { cwd: repoRoot });
  if (r.status !== 0) throw usageError(`${rel}${sep} is inside the repository and git would not ignore files named ${sample}. Use firmware/<sketch>/ (secrets.*.h is ignored), a folder under work/, or a path outside the repo.`);
  return abs;
}

function wifiFromEnv(env) { return { ssid: env.WIFI_SSID || '', pass: env.WIFI_PASS || '' }; }

function writeSecrets(ctx, dir, devices, apiBase) {
  const written = [];
  for (const d of devices) {
    const file = join(dir, `secrets.${d.serial}.h`);
    if (existsSync(file)) throw usageError(`Refusing to overwrite ${file}`);
  }
  privateDir(dir);
  for (const d of devices) {
    const file = join(dir, `secrets.${d.serial}.h`);
    writeFileSync(file, buildSecretsHeader(d, { apiBase, wifi: wifiFromEnv(ctx.env) }), { flag: 'wx', mode: 0o600 });
    chmodSync(file, 0o600);
    written.push(file);
  }
  return written;
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\..*/, '');

async function runBatch(ctx, single) {
  const plan = planBatch(ctx.flags, { site: ctx.site, single });
  const outRoot = resolve(ctx.repoRoot, typeof ctx.flags['out-dir'] === 'string' ? ctx.flags['out-dir'] : 'work');
  const secretsDir = typeof ctx.flags['secrets-dir'] === 'string' ? ctx.flags['secrets-dir'] : null;
  const local = isLocalSite(ctx.site);
  const warnings = [];
  if (isLocalSite(plan.origin)) warnings.push('QR codes will point at a local address. Pass --origin https://<your site> for labels you will print.');
  if (secretsDir) checkSecretsDir(ctx.repoRoot, secretsDir, 'secrets.HB-AAAA-AAAA.h');

  if (ctx.flags['dry-run']) {
    const result = { dryRun: true, site: ctx.site, endpoint: 'POST /api/ops/fleet-batch', body: plan, inventory: join(outRoot, 'inventory', '<batch>.json'), sheet: join(outRoot, 'labels', '<batch>', 'sheet.html'), secretsDir: secretsDir ? resolve(ctx.repoRoot, secretsDir) : null, warnings };
    ctx.emit(result, () => {
      ctx.out(`Dry run. Would ask ${ctx.site} for ${plan.count} box${plan.count === 1 ? '' : 'es'} named ${plan.prefix}-001${plan.count > 1 ? ' onward' : ''} (type ${plan.type}).`);
      ctx.out(`  inventory (keys, mode 600): ${result.inventory}`);
      ctx.out(`  label sheet:                ${result.sheet}`);
      if (secretsDir) ctx.out(`  secrets headers:            ${result.secretsDir}`);
      warnings.forEach((w) => ctx.warn(w));
      ctx.out('Nothing was sent or written.');
    });
    return EXIT.OK;
  }
  if (!local && !ctx.flags.yes) throw usageError(`This creates real inventory on ${ctx.site}. Re-run with --yes to confirm, or use --dry-run first.`);

  const r = await ctx.api('/api/ops/fleet-batch', { method: 'POST', auth: 'admin', body: plan, timeoutMs: 60000 });
  if (r.status === 404 || r.status === 405) throw new HbError(`${ctx.site} has no /api/ops/fleet-batch yet (HTTP ${r.status}). Deploy the onboarding server module first.`, EXIT.FAIL);
  if (r.status === 403) throw new HbError('The batch endpoint accepts the admin key only (HTTP 403). Operator sessions cannot create inventory.', EXIT.AUTH);
  if (!r.ok) throw new HbError(`POST /api/ops/fleet-batch: ${r.data?.error || 'failed'} (HTTP ${r.status})`, r.status === 401 ? EXIT.AUTH : r.status >= 500 ? EXIT.NETWORK : EXIT.FAIL);

  const { batch, devices, legacyChecksum } = validateBatchResponse(r.data, plan);
  if (legacyChecksum) warnings.push(`${legacyChecksum} serial${legacyChecksum === 1 ? '' : 's'} did not match the CLI check character rule. Fine for older serials; confirm with the server owner if all of them do.`);

  // Inventory first: it holds the only copy of the keys.
  const createdAt = new Date(ctx.now()).toISOString();
  const manifest = { batch, createdAt, site: ctx.site, origin: plan.origin, prefix: plan.prefix, type: plan.type, note: plan.note, devices };
  const inventory = writeNew(join(outRoot, 'inventory'), batch, '.json', JSON.stringify(manifest, null, 2) + '\n');
  const sheet = writeNew(join(outRoot, 'labels', batch), 'sheet', '.html', buildSheet(devices, { batch, origin: plan.origin, createdAt }));
  let secrets = [];
  if (secretsDir) secrets = writeSecrets(ctx, resolve(ctx.repoRoot, secretsDir), devices, plan.origin);

  const result = { batch, count: devices.length, serials: devices.map((d) => d.serial), inventory, sheet, secretsFiles: secrets, warnings };
  ctx.emit(result, () => {
    ctx.out(`${ctx.c.green('created')} ${devices.length} box${devices.length === 1 ? '' : 'es'} in batch ${batch}`);
    ctx.out(`  serials: ${devices[0].serial}${devices.length > 1 ? ` to ${devices[devices.length - 1].serial}` : ''}`);
    ctx.out(`  inventory (device keys and codes, mode 600): ${inventory}`);
    ctx.out(`  label sheet (print, then delete): ${sheet}`);
    if (secrets.length) ctx.out(`  secrets headers: ${secrets.length} written (mode 600)`);
    warnings.forEach((w) => ctx.warn(w));
    ctx.out('Keys and pairing codes were not printed. Add a credentials registry row for the batch, then flash each box.');
  });
  return EXIT.OK;
}

async function runRotate(ctx, args) {
  const id = args[1];
  if (!id || !ID_RE.test(id)) throw usageError('Usage: hb provision rotate <24-hex device id> --reason TEXT --confirm SERIAL');
  const reason = ctx.flags.reason;
  if (typeof reason !== 'string' || reason.length < 3 || reason.length > 200 || /[\u0000-\u001f\u007f]/.test(reason)) throw usageError('--reason is required (3 to 200 plain characters)');
  const secretsDir = typeof ctx.flags['secrets-dir'] === 'string' ? ctx.flags['secrets-dir'] : null;
  const outRoot = resolve(ctx.repoRoot, typeof ctx.flags['out-dir'] === 'string' ? ctx.flags['out-dir'] : 'work');

  const detail = await ctx.api('/api/ops/fleet', { auth: 'admin', query: { id } });
  if (detail.status === 404 && !detail.data?.error) throw new HbError(`${ctx.site} has no /api/ops/fleet yet. Deploy the onboarding server module first.`, EXIT.FAIL);
  if (!detail.ok) throw new HbError(`Could not read box ${id}: ${detail.data?.error || 'HTTP ' + detail.status}`, detail.status === 401 || detail.status === 403 ? EXIT.AUTH : EXIT.FAIL);
  const dev = detail.data?.device || detail.data || {};
  const serial = String(dev.serial || '').toUpperCase();
  if (!SERIAL_RE.test(serial)) throw new HbError('The server did not return a usable serial for that box.', EXIT.FAIL);
  const name = String(dev.name || id).slice(0, 80);
  if (secretsDir) checkSecretsDir(ctx.repoRoot, secretsDir, `secrets.${serial}.h`);

  const confirm = typeof ctx.flags.confirm === 'string' ? ctx.flags.confirm.toUpperCase() : '';
  if (ctx.flags['dry-run'] || confirm !== serial) {
    const summary = { dryRun: true, id, name, serial, action: 'rotate_key', note: 'The old key stops working at once. The box stays silent until it is reflashed with the new key.' };
    ctx.emit(summary, () => {
      ctx.out(`Would rotate the device key for ${name} (${serial}). The old key stops working immediately, and the box reads silent until it is reflashed.`);
      if (!ctx.flags['dry-run']) ctx.out(`To proceed, repeat the command with --confirm ${serial}`);
    });
    return ctx.flags['dry-run'] ? EXIT.OK : EXIT.USAGE;
  }

  const r = await ctx.api('/api/ops/fleet-actions', { method: 'POST', auth: 'admin', body: { deviceId: id, action: 'rotate_key', reason }, timeoutMs: 30000 });
  if (r.status === 404 && !r.data?.error) throw new HbError(`${ctx.site} has no /api/ops/fleet-actions yet. Deploy the onboarding server module first.`, EXIT.FAIL);
  if (!r.ok) throw new HbError(`rotate_key: ${r.data?.error || 'failed'} (HTTP ${r.status})`, r.status === 401 || r.status === 403 ? EXIT.AUTH : EXIT.FAIL);
  const deviceKey = String(r.data?.deviceKey || '');
  if (!DEVICE_KEY_RE.test(deviceKey)) throw new HbError('The server accepted the rotation but returned no usable key. Rotate again to get one; the old key is already dead.', EXIT.FAIL);

  const rec = { rotatedAt: new Date(ctx.now()).toISOString(), id, name, serial, site: ctx.site, reason, deviceKey };
  const file = writeNew(join(outRoot, 'inventory', 'rotations'), `${serial}-${stamp(ctx.now())}`, '.json', JSON.stringify(rec, null, 2) + '\n');
  let secrets = [];
  if (secretsDir) secrets = writeSecrets(ctx, resolve(ctx.repoRoot, secretsDir), [{ id, serial, deviceKey }], ctx.site);
  const result = { id, serial, rotation: file, secretsFiles: secrets };
  ctx.emit(result, () => {
    ctx.out(`${ctx.c.green('rotated')} ${name} (${serial}). The old key is dead now.`);
    ctx.out(`  new key saved (mode 600, not printed): ${file}`);
    if (secrets.length) ctx.out(`  fresh secrets header: ${secrets[0]}`);
    ctx.out('Reflash the box (hubs and the Uno Q: place the key in the agent env file). The fleet panel shows recovered when it reports. Update the credentials registry row.');
  });
  return EXIT.OK;
}

export default {
  name: 'provision',
  summary: 'Build box inventory: serials, keys, pairing codes and label sheets',
  usage: USAGE,
  group: 'Hardware and agent',
  booleans: ['home-less', 'dry-run', 'yes'],
  async run(args, ctx) {
    if (args[0] === 'rotate') return runRotate(ctx, args);
    if (args[0] === 'add') return runBatch(ctx, true);
    if (args[0] === 'list') {
      const dir = resolve(ctx.repoRoot, typeof ctx.flags['out-dir'] === 'string' ? ctx.flags['out-dir'] : 'work', 'inventory');
      const batches = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
      ctx.emit({ batches }, () => ctx.out(batches.length ? batches.join('\n') : 'No local inventory batches.'));
      return EXIT.OK;
    }
    if (args[0] && args[0] !== 'batch') throw usageError(`Unknown provision subcommand "${args[0]}".\n${USAGE}`);
    return runBatch(ctx, false);
  },
};
