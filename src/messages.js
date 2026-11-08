// Downlink "information boxes": operators send, devices pull (devices only dial out).
// States: queued -> delivered (first pull) -> acked; expired (computed lazily) and cancelled.
import { ObjectId } from 'mongodb';
import { HttpError, badRequest, notFound } from './http.js';
import { effectiveState, ensureLiveIndexes, isHex24, loadScopeDevices, looksSecret, modeFilter, parseBbox, parseScopeParams, writeAudit, writeDeviceLog } from './live.js';

export const KINDS = ['info', 'condition', 'instruction'];
export const SEVERITIES = ['info', 'advisory', 'urgent'];
export const TITLE_MAX = 20;
export const BODY_MAX = 80;
export const MAX_LIVE_PER_DEVICE = 5;
export const MAX_FANOUT = 200;
export const SENDS_PER_MIN = 30;
export const DEFAULT_EXPIRY_MIN = 360;
export const MAX_EXPIRY_MIN = 7 * 24 * 60;
const LIVE_STATES = ['queued', 'delivered'];
const URL_RE = /https?:|www\.|:\/\/|\b[a-z0-9-]+\.(?:com|net|org|io|gov|edu|us|co|app|dev|me|info|ly|xyz)\b/i;

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Text rules for the small screen: printable ASCII, no links, nothing that looks like a credential. */
function checkText(label, value, { min, max }) {
  if (typeof value !== 'string') throw badRequest(`${label} must be text`);
  const text = value.trim();
  if (text.length < min) throw badRequest(`${label} is required`);
  if (text.length > max) throw badRequest(`${label} can be at most ${max} characters`);
  if (!/^[\x20-\x7E]*$/.test(text)) throw badRequest(`${label} can use plain keyboard characters only`);
  if (URL_RE.test(text)) throw badRequest(`${label} cannot contain links`);
  if (looksSecret(text)) throw badRequest(`${label} looks like a key or password and was not sent`);
  return text;
}

/** Validates an operator send body. Returns the normalized message fields and scope. */
export function parseMessageInput(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw badRequest('Body must be an object');
  const kind = b.kind ?? 'info';
  const severity = b.severity ?? 'info';
  if (!KINDS.includes(kind)) throw badRequest(`kind must be one of ${KINDS.join(', ')}`);
  if (!SEVERITIES.includes(severity)) throw badRequest(`severity must be one of ${SEVERITIES.join(', ')}`);
  const title = checkText('title', b.title, { min: 1, max: TITLE_MAX });
  const body = checkText('body', b.body ?? '', { min: 0, max: BODY_MAX });
  const mins = b.expiresInMin ?? DEFAULT_EXPIRY_MIN;
  if (!Number.isInteger(mins) || mins < 1 || mins > MAX_EXPIRY_MIN) throw badRequest('expiresInMin must be a whole number from 1 to 10080');
  for (const k of ['requiresAck', 'customerVisible']) if (b[k] !== undefined && typeof b[k] !== 'boolean') throw badRequest(`${k} must be true or false`);
  const s = b.scope;
  if (!s || typeof s !== 'object') throw badRequest('scope is required');
  let scope;
  if (s.type === 'device') {
    if (!Array.isArray(s.deviceIds) || !s.deviceIds.length || s.deviceIds.length > MAX_FANOUT || !s.deviceIds.every(isHex24)) throw badRequest(`scope.deviceIds must list 1 to ${MAX_FANOUT} device ids`);
    scope = { type: 'device', deviceIds: [...new Set(s.deviceIds.map((x) => x.toLowerCase()))] };
  } else if (s.type === 'region') {
    const m = /^gh([4-6]):([0-9b-hjkmnp-z]+)$/.exec(s.region);
    if (!m || m[2].length !== Number(m[1])) throw badRequest('scope.region must look like gh5:9vgm0');
    scope = { type: 'region', region: s.region };
  } else if (s.type === 'bbox') {
    scope = { type: 'bbox', bbox: parseBbox(Array.isArray(s.bbox) ? s.bbox.join(',') : '') };
  } else throw badRequest('scope.type must be device, region or bbox');
  return { kind, severity, title, body, expiresInMin: mins, requiresAck: b.requiresAck === true, customerVisible: b.customerVisible === true, scope };
}

async function nextSeq(db) {
  const r = await db.collection('counters').findOneAndUpdate({ _id: 'device_messages_seq' }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' });
  return r.n;
}

/** Marks overdue live deliveries as expired. Cheap; called before reads that show states. */
export async function expireDue(db, now, filter = {}) {
  await db.collection('message_deliveries').updateMany({ ...filter, state: { $in: LIVE_STATES }, expiresAt: { $lte: now } }, { $set: { state: 'expired', updatedAt: now } });
}

const messageOut = (m) => ({
  id: String(m._id), seq: m.seq, kind: m.kind, severity: m.severity, title: m.title, body: m.body, requiresAck: m.requiresAck, customerVisible: m.customerVisible,
  expiresAt: iso(m.expiresAt), createdAt: iso(m.createdAt), createdBy: m.createdBy, scope: m.scope, exercise: m.exercise === true, cancelled: m.cancelled === true,
});

async function resolveTargets(db, scope, exercise) {
  if (scope.type === 'device') {
    const found = await db.collection('devices').find({ _id: { $in: scope.deviceIds.map((i) => new ObjectId(i)) }, disabled: { $ne: true }, ...(exercise ? { 'meta.exercise': true } : { 'meta.exercise': { $ne: true } }) }, { projection: { _id: 1 } }).toArray();
    if (found.length !== scope.deviceIds.length) throw badRequest('One or more devices were not found');
    return { ids: found.map((d) => String(d._id)), truncated: false };
  }
  const bbox = scope.type === 'bbox' ? scope.bbox : parseScopeParams(new URL(`http://x/?region=${scope.region}`)).bbox;
  const r = await loadScopeDevices(db, { exercise, bbox, cap: MAX_FANOUT });
  if (!r.devices.length) throw badRequest('No devices are in that area');
  return { ids: r.devices.map((d) => String(d._id)), truncated: r.limited };
}

/**
 * Creates one message and one delivery per device. `ctx` = {operator, exercise, now}.
 * Devices that already hold 5 live messages are skipped and listed in `skipped`.
 */
export async function createMessage(db, input, { operator = 'admin-key', exercise = false, now = new Date() } = {}) {
  await ensureLiveIndexes(db);
  const p = parseMessageInput(input);
  const recent = await db.collection('device_messages').countDocuments({ createdBy: operator, createdAt: { $gte: new Date(now.getTime() - 60_000) } });
  if (recent >= SENDS_PER_MIN) throw new HttpError(429, 'Too many messages sent. Try again in a minute.');
  const { ids, truncated } = await resolveTargets(db, p.scope, exercise);
  await expireDue(db, now, { deviceId: { $in: ids } });
  const counts = await db.collection('message_deliveries').aggregate([
    { $match: { deviceId: { $in: ids }, state: { $in: LIVE_STATES }, expiresAt: { $gt: now } } },
    { $group: { _id: '$deviceId', n: { $sum: 1 } } },
  ]).toArray();
  const full = new Set(counts.filter((c) => c.n >= MAX_LIVE_PER_DEVICE).map((c) => c._id));
  const targets = ids.filter((i) => !full.has(i));
  if (!targets.length) throw new HttpError(409, `Those devices already have ${MAX_LIVE_PER_DEVICE} live messages`);
  const seq = await nextSeq(db);
  const expiresAt = new Date(now.getTime() + p.expiresInMin * 60_000);
  const message = {
    _id: new ObjectId(), seq, kind: p.kind, severity: p.severity, title: p.title, body: p.body, requiresAck: p.requiresAck, customerVisible: p.customerVisible,
    scope: p.scope, expiresAt, createdAt: now, createdBy: operator, exercise, cancelled: false,
  };
  await db.collection('device_messages').insertOne(message);
  const mid = String(message._id);
  await db.collection('message_deliveries').insertMany(targets.map((deviceId) => ({
    _id: `${mid}:${deviceId}`, messageId: mid, deviceId, seq, state: 'queued', kind: p.kind, severity: p.severity, title: p.title, body: p.body,
    requiresAck: p.requiresAck, customerVisible: p.customerVisible, expiresAt, createdAt: now, updatedAt: now, exercise,
  })), { ordered: false });
  await writeAudit(db, {
    actor: { type: 'operator', id: operator }, action: 'message.send', at: now, exercise,
    ...(targets.length === 1 ? { deviceId: targets[0] } : {}), ...(p.scope.type === 'region' ? { region: p.scope.region } : {}),
    details: { messageId: mid, scope: p.scope.type, deliveries: targets.length, severity: p.severity, kind: p.kind, title: p.title, skipped: full.size },
  });
  return { message: messageOut(message), deliveries: targets.length, skipped: [...full], truncated };
}

/** Operator list. Messages with per-device delivery states, newest first. */
export async function listMessages(db, { deviceId = null, state = null, limit = 50, exercise = false, now = new Date() } = {}) {
  const states = ['queued', 'delivered', 'acked', 'expired', 'cancelled'];
  if (state && !states.includes(state)) throw badRequest(`state must be one of ${states.join(', ')}`);
  if (deviceId && !isHex24(deviceId)) throw badRequest('Invalid device id');
  limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  await expireDue(db, now, deviceId ? { deviceId } : {});
  let messageIds = null;
  if (deviceId || state) {
    const q = { ...modeFilter(exercise), ...(deviceId ? { deviceId } : {}), ...(state ? { state } : {}) };
    messageIds = [...new Set((await db.collection('message_deliveries').find(q, { projection: { messageId: 1 } }).sort({ createdAt: -1 }).limit(limit * 5).toArray()).map((d) => d.messageId))].slice(0, limit);
    if (!messageIds.length) return { messages: [] };
  }
  const msgs = await db.collection('device_messages').find({ ...modeFilter(exercise), ...(messageIds ? { _id: { $in: messageIds.map((i) => new ObjectId(i)) } } : {}) }).sort({ createdAt: -1 }).limit(limit).toArray();
  const mids = msgs.map((m) => String(m._id));
  const deliveries = mids.length ? await db.collection('message_deliveries').find({ messageId: { $in: mids } }).limit(2000).toArray() : [];
  const by = new Map();
  for (const d of deliveries) {
    if (!by.has(d.messageId)) by.set(d.messageId, []);
    by.get(d.messageId).push({ deviceId: d.deviceId, state: effectiveState(d, now), deliveredAt: iso(d.deliveredAt), ackedAt: iso(d.ackedAt), updatedAt: iso(d.updatedAt) });
  }
  return { messages: msgs.map((m) => ({ ...messageOut(m), deliveries: by.get(String(m._id)) || [] })) };
}

/** Cancels a message everywhere it has not been acknowledged. Idempotent. */
export async function cancelMessage(db, id, { operator = 'admin-key', exercise = false, now = new Date() } = {}) {
  if (!isHex24(id)) throw badRequest('Invalid message id');
  const msg = await db.collection('device_messages').findOne({ _id: new ObjectId(id), ...modeFilter(exercise) });
  if (!msg) throw notFound('Message not found');
  let cancelled = 0;
  if (!msg.cancelled) {
    await db.collection('device_messages').updateOne({ _id: msg._id }, { $set: { cancelled: true, cancelledAt: now, cancelledBy: operator } });
    cancelled = (await db.collection('message_deliveries').updateMany({ messageId: id, state: { $in: LIVE_STATES } }, { $set: { state: 'cancelled', updatedAt: now } })).modifiedCount;
    await writeAudit(db, { actor: { type: 'operator', id: operator }, action: 'message.cancel', at: now, exercise, details: { messageId: id, deliveries: cancelled, title: msg.title } });
  }
  return { message: { ...messageOut({ ...msg, cancelled: true }) }, cancelled };
}

/** Device pull. Returns what the small screen needs and marks queued items delivered. */
export async function pullForDevice(db, device, { after = 0, limit = 3, now = new Date() } = {}) {
  after = Number.isInteger(after) && after >= 0 ? after : 0;
  limit = Math.min(Math.max(Number.isInteger(limit) ? limit : 3, 1), 3);
  const id = String(device._id);
  const exercise = device.meta?.exercise === true;
  await expireDue(db, now, { deviceId: id });
  const rows = await db.collection('message_deliveries').find({ deviceId: id, state: { $in: LIVE_STATES }, seq: { $gt: after } }).sort({ seq: 1 }).limit(limit).toArray();
  const fresh = rows.filter((r) => r.state === 'queued');
  if (fresh.length) {
    await db.collection('message_deliveries').updateMany({ _id: { $in: fresh.map((r) => r._id) }, state: 'queued' }, { $set: { state: 'delivered', deliveredAt: now, updatedAt: now } });
    for (const r of fresh) await writeDeviceLog(db, { deviceId: id, level: 'info', code: 'message.delivered', msg: `Message delivered: ${r.title}`, at: now, exercise });
  }
  return {
    messages: rows.map((r) => ({ seq: r.seq, id: r.messageId, kind: r.kind, severity: r.severity, title: r.title, body: r.body, expires_at: iso(r.expiresAt), requires_ack: r.requiresAck === true })),
    cursor: rows.length ? rows[rows.length - 1].seq : after,
    poll_after_s: await pollInterval(db, id, now),
  };
}

/** 10 s while an urgent message is open for the device, otherwise 30 s. */
export async function pollInterval(db, deviceId, now = new Date()) {
  const urgent = await db.collection('message_deliveries').countDocuments({ deviceId, severity: 'urgent', state: { $in: LIVE_STATES }, expiresAt: { $gt: now } });
  return urgent ? 10 : 30;
}

/** How many queued messages the device has not pulled yet. Used by the ingest hook. */
export async function pendingCount(db, deviceId, now = new Date()) {
  return db.collection('message_deliveries').countDocuments({ deviceId: String(deviceId), state: 'queued', expiresAt: { $gt: now } });
}

/** Device reports a message was shown on screen or acknowledged by a button press. */
export async function deviceReport(db, device, { messageId, state }, now = new Date()) {
  if (!isHex24(messageId)) throw badRequest('message_id is required');
  if (!['shown', 'acked'].includes(state)) throw badRequest('state must be shown or acked');
  const id = String(device._id);
  const exercise = device.meta?.exercise === true;
  const _id = `${messageId.toLowerCase()}:${id}`;
  const cur = await db.collection('message_deliveries').findOne({ _id });
  if (!cur) throw notFound('Message not found for this device');
  const s = effectiveState(cur, now);
  if (s === 'acked') return { state: 'acked' };
  if (s === 'expired' || s === 'cancelled') throw new HttpError(409, 'That message is no longer active');
  const set = { updatedAt: now, ...(cur.state === 'queued' ? { state: 'delivered', deliveredAt: now } : {}) };
  if (state === 'shown') {
    set.shownAt = cur.shownAt || now;
  } else {
    Object.assign(set, { state: 'acked', ackedAt: now, ackedBy: 'device' });
  }
  await db.collection('message_deliveries').updateOne({ _id }, { $set: set });
  await writeDeviceLog(db, { deviceId: id, level: 'info', code: state === 'acked' ? 'message.acked' : 'message.shown', msg: `${state === 'acked' ? 'Message acknowledged' : 'Message shown'}: ${cur.title}`, at: now, exercise });
  return { state: state === 'acked' ? 'acked' : 'delivered', shown: true };
}

/** For the customer role: live messages the operator marked customer visible. */
export async function customerMessages(db, deviceId, now = new Date()) {
  const rows = await db.collection('message_deliveries').find({
    deviceId: String(deviceId), customerVisible: true, state: { $in: [...LIVE_STATES, 'acked'] }, expiresAt: { $gt: now },
  }).sort({ seq: -1 }).limit(10).toArray();
  return rows.map((r) => ({ id: r.messageId, title: r.title, body: r.body, severity: r.severity, expiresAt: iso(r.expiresAt), seen: Boolean(r.customerSeenAt) }));
}

/**
 * The customer has read a message. Only customer visible messages count.
 * If the operator asked for confirmation, this also confirms it. Returns false when nothing matched.
 */
export async function markCustomerSeen(db, deviceId, messageId, now = new Date()) {
  if (!isHex24(messageId)) return false;
  const _id = `${messageId.toLowerCase()}:${String(deviceId)}`;
  const cur = await db.collection('message_deliveries').findOne({ _id, customerVisible: true });
  if (!cur || effectiveState(cur, now) === 'expired' || cur.state === 'cancelled') return false;
  const set = { customerSeenAt: cur.customerSeenAt || now, updatedAt: now };
  if (cur.requiresAck && LIVE_STATES.includes(cur.state)) Object.assign(set, { state: 'acked', ackedAt: now, ackedBy: 'customer' });
  await db.collection('message_deliveries').updateOne({ _id }, { $set: set });
  return true;
}
