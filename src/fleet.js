import { ObjectId } from 'mongodb';
import { isAdmin, newSecret, sha256Hex } from './auth.js';
import { sameOrigin } from './operator-session.js';
import { HttpError, badRequest, json, readJson } from './http.js';
import { withDb, oid } from './db.js';
import { ensureCustomerIndexes } from './customer.js';
import { inventorySerial, randomCharacters, pairingDigest } from './pairing-code.js';
import { fleetStatus, recordSilentBoxes } from './device-lifecycle.js';
const fail = e => json({ error: e instanceof HttpError ? e.message : 'Fleet service is unavailable. Try again shortly.' }, e instanceof HttpError ? e.status : 503);
const clean = (s, max = 160) => typeof s === 'string' && s.trim().length <= max && !/[\u0000-\u001f\u007f]|(?:dk_|ak_)[a-z0-9]+/i.test(s) ? s.trim() : null;
const run = (ctx, fn) => withDb(ctx.env || {}, ctx.injectedDb || ctx.db, fn);
function gate(ctx, write = false) {
  if (!isAdmin(ctx.request, ctx.env)) throw new HttpError(401, 'Sign in to view the fleet.');
  if (write && ctx.data?.operator?.role === 'demo') throw new HttpError(403, 'Simulation accounts cannot change boxes.');
  if (write && ctx.data?.operator && !sameOrigin(ctx.request)) throw new HttpError(403, 'Request origin is not allowed.');
}
const actor = ctx => ({ type: 'operator', id: ctx.data?.operator?.email || 'admin-key' });
async function transaction(db, fn) {
  const session = db.client.startSession();
  try { return await session.withTransaction(() => fn({ session }), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 5000 }); }
  finally { await session.endSession(); }
}
export async function createFleetBatch(db, body, { env, origin, actor: by, now = new Date() }) {
  if (!Number.isInteger(body.count) || body.count < 1 || body.count > 100) throw badRequest('Choose between 1 and 100 boxes.');
  if (!env.SESSION_SECRET) throw new HttpError(503, 'Pairing is not configured.');
  const name = clean(body.prefix ?? body.namePrefix ?? 'Safe Home box', 60), note = clean(body.note ?? '');
  if (name === null || !name || note === null) throw badRequest('Use a short box name and note without credentials.');
  const type = body.type ?? 'esp32';
  if (!['esp32', 'xiao-esp32s3-sense', 'unoq'].includes(type)) throw badRequest('Choose a supported box type.');
  const interval = body.expectedReportIntervalSeconds ?? 60;
  if (!Number.isInteger(interval) || interval < 5 || interval > 86400) throw badRequest('Reporting interval must be 5 to 86400 seconds.');
  await ensureCustomerIndexes(db);
  const batchId = String(new ObjectId()), records = [], pairs = [], output = [];
  for (let n = 0; n < body.count; n++) {
    const _id = new ObjectId(), deviceId = String(_id), serial = inventorySerial(), deviceKey = newSecret('dk_'), pairingCode = randomCharacters(8);
    const pairing = { _id: deviceId, serial, version: 2, salt: crypto.randomUUID(), claimed: false, failures: 0, createdAt: now, expiresAt: null, exercise: false };
    pairing.codeHash = await pairingDigest(pairing, pairingCode, env);
    records.push({ _id, type, name: `${name} ${n + 1}`, keyHash: await sha256Hex(deviceKey), disabled: false, lastSeen: null, createdAt: now, updatedAt: now, keyCreatedAt: now, expectedReportIntervalSeconds: interval, serial, batchId, note, meta: { exercise: false } });
    pairs.push(pairing);
    const qr = `${origin}/customer#claim=${serial}.${pairingCode}`;
    output.push({ deviceId, serial, deviceKey, pairingCode, qr, qrPayload: qr, expiresAt: null });
  }
  await transaction(db, async options => {
    await db.collection('devices').insertMany(records, options);
    await db.collection('device_pairing').insertMany(pairs, options);
    await db.collection('audit_log').insertOne({ at: now, actor: by, action: 'fleet.provision', details: { batchId, count: records.length }, exercise: false }, options);
  });
  return { batchId, devices: output };
}
export async function fleetBatchHandler(ctx) {
  try {
    gate(ctx, true);
    if (ctx.data?.operator) throw new HttpError(403, 'Box provisioning is available through the administrator CLI only.');
    if (ctx.request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const body = await readJson(ctx.request);
    return await run(ctx, async db => json(await createFleetBatch(db, body, { env: ctx.env, origin: new URL(ctx.request.url).origin, actor: actor(ctx), now: ctx.now }), 201));
  } catch (e) { return fail(e); }
}
export async function listFleet(db, { exercise = false, now = new Date() } = {}) {
  const devices = await db.collection('devices').find(exercise ? { 'meta.exercise': true } : { 'meta.exercise': { $ne: true } }, { projection: { keyHash: 0 } }).sort({ createdAt: -1 }).limit(500).toArray();
  const ids = devices.map(d => String(d._id));
  const [links, pairs] = await Promise.all([
    db.collection('customer_links').find({ deviceId: { $in: ids }, active: true }).toArray(),
    db.collection('device_pairing').find({ _id: { $in: ids } }, { projection: { serial: 1 } }).toArray(),
  ]);
  await recordSilentBoxes(db, devices, links, now);
  const rows = devices.map(d => {
    const link = links.find(l => l.deviceId === String(d._id));
    return { id: String(d._id), name: d.name, serial: pairs.find(p => p._id === String(d._id))?.serial || d.serial || null,
      fleetStatus: fleetStatus(d, link, now), linked: !!link, linkedCustomer: link?.consent ? { name: link.contactName || '', email: link.customerEmail } : null,
      lastSeenAt: d.lastSeen || null, firstReportAt: d.firstReportAt || null, firmwareVersion: d.firmwareVersion || d.meta?.firmwareVersion || null,
      keyCreatedAt: d.keyCreatedAt || d.createdAt || null, keyRotatedAt: d.keyRotatedAt || null, homeId: d.homeId ? String(d.homeId) : null,
      disabled: d.disabled === true, exercise: d.meta?.exercise === true, note: d.note || '', expectedReportIntervalSeconds: d.expectedReportIntervalSeconds || null };
  });
  return { devices: rows, limit: 500, serverTime: now };
}
export async function fleetAction(db, deviceId, body, { env, origin, actor: by, now = new Date() }) {
  const _id = oid(deviceId, 'device id'), reason = clean(body.reason);
  if (!reason) throw badRequest('Enter a short reason for this change.');
  const allowed = ['disable', 'enable', 'rotate_key', 'reassign_home', 'force_unlink', 'reissue_code', 'set_note'];
  if (!allowed.includes(body.action)) throw badRequest('Choose an available fleet action.');
  let output = { ok: true };
  await transaction(db, async options => {
    const device = await db.collection('devices').findOne({ _id }, options);
    if (!device) throw new HttpError(404, 'Box not found.');
    const pair = await db.collection('device_pairing').findOne({ _id: deviceId }, options);
    const serial = pair?.serial || device.serial;
    if (!serial || body.confirmSerial !== serial) throw badRequest('Type the box serial to confirm.');
    const link = await db.collection('customer_links').findOne({ deviceId, active: true }, options);
    const set = { updatedAt: now };
    switch (body.action) {
      case 'disable': set.disabled = true; break;
      case 'enable': set.disabled = false; break;
      case 'rotate_key': {
        const deviceKey = newSecret('dk_'); set.keyHash = await sha256Hex(deviceKey); set.keyRotatedAt = now;
        output = { ok: true, deviceKey }; break;
      }
      case 'reassign_home': {
        if (link) throw new HttpError(409, 'Unlink the customer before reassigning this box.');
        const homeId = oid(body.homeId, 'home id');
        const home = await db.collection('homes').findOne({ _id: homeId }, options);
        if (!home || (home.exercise === true || home.meta?.exercise === true) !== (device.meta?.exercise === true)) throw badRequest('Choose a home in the same environment.');
        set.homeId = homeId;
        const meta = { ...(device.meta || {}) };
        for (const key of ['latitude', 'longitude', 'lat', 'lon', 'address', 'locationSource']) delete meta[key];
        if (home.address) meta.address = home.address;
        if (home.locationSource) meta.locationSource = home.locationSource;
        set.meta = meta; break;
      }
      case 'force_unlink': {
        if (!link) throw new HttpError(409, 'This box is not linked.');
        await db.collection('customer_links').updateOne({ _id: link._id, active: true }, { $set: { active: false, unlinkedAt: now, consent: false }, $unset: { contactName: '', nickname: '', room: '' } }, options);
        await db.collection('device_pairing').updateOne({ _id: deviceId }, { $set: { claimed: true }, $unset: { codeHash: '', salt: '' } }, options);
        set.unlinkedAt = now; break;
      }
      case 'reissue_code': {
        if (link) throw new HttpError(409, 'Unlink the customer before issuing a new pairing code.');
        if (!env.SESSION_SECRET) throw new HttpError(503, 'Pairing is not configured.');
        const code = randomCharacters(8), p = { serial, version: 2, salt: crypto.randomUUID(), failures: 0, claimed: false, createdAt: now, expiresAt: new Date(now.getTime() + 30 * 86400000), exercise: device.meta?.exercise === true };
        p.codeHash = await pairingDigest(p, code, env);
        await db.collection('device_pairing').updateOne({ _id: deviceId }, { $set: p, $unset: { claimedAt: '' } }, { ...options, upsert: true });
        output = { ok: true, serial, pairingCode: code, qr: `${origin}/customer#claim=${serial}.${code}`, expiresAt: p.expiresAt }; break;
      }
      case 'set_note': {
        const note = clean(body.note); if (note === null) throw badRequest('Use a short note without credentials.'); set.note = note; break;
      }
    }
    await db.collection('devices').updateOne({ _id }, { $set: set, $inc: { ownershipRevision: 1 } }, options);
    await db.collection('audit_log').insertOne({ at: now, actor: by, action: `fleet.${body.action}`, deviceId, details: { reason }, exercise: device.meta?.exercise === true }, options);
  });
  return output;
}
export async function fleetHandler(ctx) {
  try {
    const method = ctx.request.method, url = new URL(ctx.request.url);
    gate(ctx, method !== 'GET');
    if (method === 'GET') return await run(ctx, async db => json(await listFleet(db, { exercise: ctx.data?.operator?.role === 'demo' || url.searchParams.get('mode') === 'exercise', now: ctx.now })));
    if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const id = ctx.params?.id || url.pathname.match(/\/fleet\/([a-f0-9]{24})\/action$/)?.[1];
    const body = await readJson(ctx.request);
    return await run(ctx, async db => json(await fleetAction(db, id, body, { env: ctx.env, origin: url.origin, actor: actor(ctx), now: ctx.now })));
  } catch (e) { return fail(e); }
}
