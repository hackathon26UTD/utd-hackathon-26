// Live command-center reads, logs and audit trail (module C). Pure functions over a Mongo `db`.
// Polling design: see docs/LIVE_DOWNLINK.md. Missing data is unknown; nothing here infers occupancy or safety.
import { ObjectId } from 'mongodb';
import { HttpError, badRequest, notFound } from './http.js';
import { configuredWifiPreviewIds } from './display-preview.js';

export const OFFLINE_MS = 15 * 60_000;
export const RESET_AFTER_MS = 30 * 60_000;
export const CURSOR_OVERLAP_MS = 2000;
export const DEVICE_LOG_TTL_S = 14 * 86400;
export const AUDIT_TTL_S = 180 * 86400;
export const LEVELS = ['debug', 'info', 'warn', 'error'];
const MAX_DEVICES = 500;
const HEX24 = /^[a-fA-F0-9]{24}$/;
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const SECRET_KEY = /pass|secret|token|key|hash|salt|pairing|code|cookie/i;

// ---------- indexes ----------
const ensured = new Set();
/** Idempotent; remembers per database name so one isolate does not repeat it on every request. */
export async function ensureLiveIndexes(db) {
  const name = db.databaseName || 'db';
  if (ensured.has(name)) return;
  await Promise.all([
    db.collection('device_logs').createIndex({ at: 1 }, { expireAfterSeconds: DEVICE_LOG_TTL_S }),
    db.collection('device_logs').createIndex({ deviceId: 1, at: -1 }),
    db.collection('audit_log').createIndex({ at: 1 }, { expireAfterSeconds: AUDIT_TTL_S }),
    db.collection('audit_log').createIndex({ deviceId: 1, at: -1 }),
    db.collection('audit_log').createIndex({ at: -1 }),
    db.collection('device_messages').createIndex({ createdAt: -1 }),
    db.collection('device_messages').createIndex({ seq: 1 }, { unique: true }),
    db.collection('device_messages').createIndex({ createdBy: 1, createdAt: -1 }),
    db.collection('message_deliveries').createIndex({ deviceId: 1, state: 1, seq: 1 }),
    db.collection('message_deliveries').createIndex({ updatedAt: -1 }),
    db.collection('message_deliveries').createIndex({ messageId: 1 }),
    db.collection('message_deliveries').createIndex({ state: 1, expiresAt: 1 }),
  ]);
  ensured.add(name);
}

// ---------- small helpers ----------
const iso = (d) => (d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : null);
const hex = (v) => (v == null ? null : String(v));
export const isHex24 = (s) => typeof s === 'string' && HEX24.test(s);
export const modeFilter = (exercise, field = 'exercise') => (exercise ? { [field]: true } : { [field]: { $ne: true } });

/** Redact anything that looks like a credential before it is stored in a log or shown to a human. */
export function looksSecret(text) {
  return /dk_|\bak_|password|passwd|passcode|secret|api[ _-]?key|bearer|[A-Za-z0-9_-]{32,}/i.test(String(text));
}

function scrub(value, depth = 0) {
  if (value == null || depth > 3) return value == null ? value : undefined;
  if (typeof value === 'string') return value.length > 300 ? value.slice(0, 300) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEY.test(k)) out[k] = scrub(v, depth + 1);
    return out;
  }
  return undefined;
}

// ---------- geography ----------
/** [west, south, east, north] of a geohash cell, or null when the text is not a geohash. */
export function geohashBounds(hash) {
  if (typeof hash !== 'string' || !/^[0-9b-hjkmnp-z]{1,12}$/.test(hash)) return null;
  const lat = [-90, 90], lng = [-180, 180];
  let even = true;
  for (const ch of hash) {
    const v = B32.indexOf(ch);
    for (let b = 4; b >= 0; b--) {
      const range = even ? lng : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((v >> b) & 1) range[0] = mid; else range[1] = mid;
      even = !even;
    }
  }
  return [lng[0], lat[0], lng[1], lat[1]];
}

export function parseBbox(text) {
  const parts = String(text).split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) throw badRequest('bbox must be west,south,east,north');
  const [w, s, e, n] = parts;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) throw badRequest('bbox is out of range');
  return [w, s, e, n];
}

/** Reads ?region=gh5:9vgm0 or ?bbox=w,s,e,n. Returns {bbox,regionKey} or empty. */
export function parseScopeParams(url) {
  const region = url.searchParams.get('region');
  const bbox = url.searchParams.get('bbox');
  if (region) {
    const m = /^gh([4-6]):([0-9b-hjkmnp-z]+)$/.exec(region);
    if (!m || m[2].length !== Number(m[1])) throw badRequest('region must look like gh5:9vgm0');
    return { bbox: geohashBounds(m[2]), regionKey: region };
  }
  if (bbox) return { bbox: parseBbox(bbox), regionKey: null };
  return { bbox: null, regionKey: null };
}

/** Device position: its home, else device meta coordinates. Mirrors the spec's shared helper. */
export function lngLatOf(device, homesById) {
  const home = device.homeId ? homesById.get(String(device.homeId)) : null;
  const c = home?.location?.coordinates;
  if (Array.isArray(c) && c.length === 2 && c.every(Number.isFinite)) return [c[0], c[1]];
  const { latitude, longitude } = device.meta || {};
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return [longitude, latitude];
  return null;
}

/**
 * Devices visible in one mode, optionally inside a box or equal to one id.
 * Returns {devices, homesById, limited}. `cap` bounds the result.
 */
export async function loadScopeDevices(db, { exercise = false, bbox = null, deviceId = null, cap = MAX_DEVICES } = {}) {
  const q = { disabled: { $ne: true }, ...(exercise ? { 'meta.exercise': true } : { 'meta.exercise': { $ne: true } }) };
  if (deviceId) {
    if (!isHex24(deviceId)) throw badRequest('Invalid device id');
    q._id = new ObjectId(deviceId);
  }
  if (bbox) {
    const [w, s, e, n] = bbox;
    const box = { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
    const homeIds = (await db.collection('homes').find({ location: { $geoWithin: { $geometry: box } } }, { projection: { _id: 1 } }).limit(5000).toArray()).map((h) => h._id);
    q.$or = [{ homeId: { $in: homeIds } }, { 'meta.latitude': { $gte: s, $lte: n }, 'meta.longitude': { $gte: w, $lte: e } }];
  }
  const rows = await db.collection('devices').find(q, { projection: { keyHash: 0 } }).sort({ _id: 1 }).limit(cap + 1).toArray();
  const limited = rows.length > cap;
  const devices = rows.slice(0, cap);
  const homeIds = [...new Set(devices.map((d) => d.homeId).filter(Boolean).map(String))].map((h) => new ObjectId(h));
  const homes = homeIds.length ? await db.collection('homes').find({ _id: { $in: homeIds } }).toArray() : [];
  return { devices, homesById: new Map(homes.map((h) => [String(h._id), h])), limited };
}

// ---------- logs and audit ----------
/** Never throws: a failed log write must not break the action being logged. */
export async function writeDeviceLog(db, entry) {
  try {
    if (!entry || !entry.deviceId) return false;
    const level = LEVELS.includes(entry.level) ? entry.level : 'info';
    const msg = looksSecret(entry.msg) ? '[redacted]' : String(entry.msg ?? '').slice(0, 120);
    await db.collection('device_logs').insertOne({
      deviceId: hex(entry.deviceId), at: entry.at instanceof Date ? entry.at : new Date(), level,
      code: String(entry.code || 'log').slice(0, 40), msg, source: entry.source === 'device' ? 'device' : 'server',
      exercise: entry.exercise === true,
    });
    return true;
  } catch (e) {
    console.error('device log write failed', e?.name);
    return false;
  }
}

/** actor is {type:'operator'|'customer'|'device'|'system', id}. Credentials are stripped from details. */
export async function writeAudit(db, entry) {
  try {
    if (!entry || !entry.action) return false;
    const type = ['operator', 'customer', 'device', 'system'].includes(entry.actor?.type) ? entry.actor.type : 'system';
    await db.collection('audit_log').insertOne({
      at: entry.at instanceof Date ? entry.at : new Date(), actor: { type, id: String(entry.actor?.id ?? 'unknown').slice(0, 120) },
      action: String(entry.action).slice(0, 60),
      ...(entry.deviceId ? { deviceId: hex(entry.deviceId) } : {}), ...(entry.region ? { region: String(entry.region).slice(0, 20) } : {}),
      details: scrub(entry.details || {}) || {}, exercise: entry.exercise === true,
    });
    return true;
  } catch (e) {
    console.error('audit write failed', e?.name);
    return false;
  }
}

/** Counts rejected device keys per hour. Count only: no key, no address, no body. */
export async function recordKeyFailure(db, now = new Date()) {
  try {
    const hour = Math.floor(now.getTime() / 3_600_000);
    await db.collection('audit_log').updateOne({ _id: `keyfail:${hour}` }, {
      $setOnInsert: { at: new Date(hour * 3_600_000), actor: { type: 'system', id: 'device-auth' }, action: 'device.key_rejected', exercise: false },
      $inc: { 'details.count': 1 },
    }, { upsert: true });
  } catch (e) { console.error('key failure count failed', e?.name); }
}

/** POST /api/device/logs body. Returns {accepted}. */
export async function ingestDeviceLogs(db, device, body, now = new Date()) {
  const entries = body?.entries;
  if (!Array.isArray(entries) || !entries.length) throw badRequest('entries must be a non-empty array');
  if (entries.length > 20) throw badRequest('At most 20 entries per request');
  const id = String(device._id);
  const recent = await db.collection('device_logs').countDocuments({ deviceId: id, source: 'device', at: { $gte: new Date(now.getTime() - 60_000) } });
  if (recent >= 120) throw new HttpError(429, 'Too many log entries. Try again in a minute.');
  const docs = entries.map((e, i) => {
    if (!e || typeof e !== 'object') throw badRequest(`entries[${i}] must be an object`);
    if (!LEVELS.includes(e.level)) throw badRequest(`entries[${i}].level must be one of ${LEVELS.join(', ')}`);
    if (typeof e.msg !== 'string' || !e.msg.trim()) throw badRequest(`entries[${i}].msg is required`);
    if (typeof e.code !== 'string' || !/^[A-Za-z0-9_.:-]{1,40}$/.test(e.code)) throw badRequest(`entries[${i}].code must be 1-40 letters, digits or . _ : -`);
    let at = now;
    if (e.ts !== undefined) {
      const t = new Date(e.ts);
      if (Number.isNaN(t.getTime())) throw badRequest(`entries[${i}].ts is not a valid date`);
      // Device clocks drift: keep plausible times only, otherwise stamp server time.
      if (t.getTime() <= now.getTime() + 300_000 && t.getTime() >= now.getTime() - 86_400_000) at = t;
    }
    return {
      deviceId: id, at, level: e.level, code: e.code, msg: looksSecret(e.msg) ? '[redacted]' : e.msg.replace(/[^\x20-\x7E]/g, '?').slice(0, 120),
      source: 'device', exercise: device.meta?.exercise === true,
    };
  });
  await db.collection('device_logs').insertMany(docs, { ordered: false });
  return { accepted: docs.length };
}

const logRow = (r) => ({ kind: 'device', id: String(r._id), at: iso(r.at), deviceId: r.deviceId, level: r.level, code: r.code, msg: r.msg, source: r.source });
const auditRow = (r) => ({ kind: 'audit', id: String(r._id), at: iso(r.at), actor: r.actor, action: r.action, deviceId: r.deviceId || null, region: r.region || null, details: r.details || {} });

/** GET /api/ops/logs. Newest first across device logs and the audit trail. */
export async function queryLogs(db, { kind = 'all', deviceId = null, bbox = null, regionKey = null, level = null, since = null, until = null, limit = 100, exercise = false } = {}) {
  if (!['device', 'audit', 'all'].includes(kind)) throw badRequest('kind must be device, audit or all');
  if (level && !LEVELS.includes(level)) throw badRequest(`level must be one of ${LEVELS.join(', ')}`);
  limit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  let ids = null;
  if (deviceId) {
    if (!isHex24(deviceId)) throw badRequest('Invalid device id');
    ids = [deviceId];
  } else if (bbox) {
    ids = (await loadScopeDevices(db, { exercise, bbox, cap: MAX_DEVICES })).devices.map((d) => String(d._id));
  }
  const time = since || until ? { at: { ...(since ? { $gte: since } : {}), ...(until ? { $lte: until } : {}) } } : {};
  const out = [];
  if (kind !== 'audit') {
    const q = { ...modeFilter(exercise), ...time, ...(ids ? { deviceId: { $in: ids } } : {}), ...(level ? { level } : {}) };
    out.push(...(await db.collection('device_logs').find(q).sort({ at: -1, _id: -1 }).limit(limit).toArray()).map(logRow));
  }
  if (kind !== 'device' && !level) {
    const scopeOr = ids ? [{ deviceId: { $in: ids } }, ...(regionKey ? [{ region: regionKey }] : [])] : null;
    const q = { ...modeFilter(exercise), ...time, ...(scopeOr ? { $or: scopeOr } : {}) };
    out.push(...(await db.collection('audit_log').find(q).sort({ at: -1, _id: -1 }).limit(limit).toArray()).map(auditRow));
  }
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { entries: out.slice(0, limit) };
}

// ---------- live polling ----------
export function parseCursor(text) {
  if (text == null || text === '') return null;
  const m = /^v1\.(\d{10,15})$/.exec(String(text));
  if (!m) throw badRequest('since must be a cursor returned by a previous live response');
  return Number(m[1]);
}
const makeCursor = (now) => `v1.${now.getTime() - CURSOR_OVERLAP_MS}`;

/** Messages that are past their time are shown as expired even before any write marks them so. */
export function effectiveState(delivery, now) {
  if (['queued', 'delivered'].includes(delivery.state) && delivery.expiresAt && new Date(delivery.expiresAt) <= now) return 'expired';
  return delivery.state;
}

async function latestReadings(db, objectIds, now) {
  if (!objectIds.length) return new Map();
  const rows = await db.collection('readings').aggregate([
    { $match: { deviceId: { $in: objectIds }, ts: { $gte: new Date(now.getTime() - 30 * 86400_000) } } },
    { $sort: { ts: -1, _id: -1 } },
    { $group: { _id: { d: '$deviceId', s: '$sensor' }, value: { $first: '$value' }, unit: { $first: '$unit' }, ts: { $first: '$ts' } } },
    { $limit: objectIds.length * 40 },
  ]).toArray();
  const map = new Map();
  for (const r of rows) {
    const key = String(r._id.d);
    if (!map.has(key)) map.set(key, {});
    map.get(key)[r._id.s] = { value: r.value, ...(r.unit ? { unit: r.unit } : {}), ts: iso(r.ts) };
  }
  return map;
}

const withBoth = (ids) => ({ $in: [...ids, ...ids.filter(isHex24).map((i) => new ObjectId(i))] });

async function linksAndHelp(db, ids) {
  if (!ids.length) return { links: new Map(), helps: new Map() };
  const [links, helps] = await Promise.all([
    db.collection('customer_links').find({ deviceId: withBoth(ids), active: true }).toArray(),
    db.collection('device_help').find({ _id: withBoth(ids) }).toArray(),
  ]);
  return { links: new Map(links.map((l) => [String(l.deviceId), l])), helps: new Map(helps.map((h) => [String(h._id), h])) };
}

/** Risk comes from module A when it exists. If it is missing or fails, risk is null and reported as unavailable. */
async function riskFor(db, env, ids, exercise, now) {
  if (!ids.length) return { map: new Map(), status: 'ok' };
  try {
    const mod = await import('./risk/load.js');
    if (typeof mod.loadRisk !== 'function') return { map: new Map(), status: 'unavailable' };
    const res = await mod.loadRisk(db, { deviceIds: ids, exercise, now, env });
    const list = Array.isArray(res) ? res : res?.assessments || [];
    return { map: new Map(list.map((a) => [String(a.deviceId), a])), status: 'ok' };
  } catch (e) {
    console.error('risk unavailable', e?.name);
    return { map: new Map(), status: 'unavailable' };
  }
}

function deviceLive(d, ctx) {
  const id = String(d._id);
  const pos = lngLatOf(d, ctx.homesById);
  const link = ctx.links.get(id);
  const help = ctx.helps.get(id);
  const lastSeen = d.lastSeen ? new Date(d.lastSeen) : null;
  return {
    id, name: d.name, selfBuilt: d.meta?.selfBuilt === true, address: d.meta?.address || null, lng: pos ? pos[0] : null, lat: pos ? pos[1] : null,
    lastSeen: iso(lastSeen), offline: !lastSeen || ctx.now.getTime() - lastSeen.getTime() > OFFLINE_MS,
    latest: ctx.latest.get(id) || {},
    risk: ctx.risk.get(id) || null,
    link: link ? { linked: true, contactName: link.contactName ?? null, consent: link.consent === true } : { linked: false },
    help: { status: help?.status || 'none', updatedAt: iso(help?.updatedAt) },
  };
}

const incidentRow = (i) => ({ id: String(i._id), deviceId: String(i.deviceId), type: i.type, severity: i.severity, status: i.status, detectedAt: iso(i.detectedAt), lastObservedAt: iso(i.lastObservedAt), updatedAt: iso(i.updatedAt || i.createdAt) });

/**
 * One poll. No `since` (or one older than 30 min) returns a snapshot with reset:true.
 * Otherwise only changes at or after the cursor, with a 2 s overlap the client dedupes by id and updatedAt.
 */
export async function getLive(db, { since = null, bbox = null, regionKey = null, deviceId = null, exercise = false, now = new Date(), env = {} } = {}) {
  const cursorMs = parseCursor(since);
  const reset = cursorMs === null || now.getTime() - cursorMs > RESET_AFTER_MS;
  const sinceDate = reset ? null : new Date(cursorMs);
  const scope = await loadScopeDevices(db, { exercise, bbox, deviceId });
  if (deviceId && !scope.devices.length) throw notFound('Device not found');
  const ids = scope.devices.map((d) => String(d._id));
  const oids = scope.devices.map((d) => d._id);
  const out = { cursor: makeCursor(now), serverTime: now.toISOString(), reset, mode: exercise ? 'exercise' : 'live', devices: [], helpChanged: [], messages: [], incidents: [], logs: [], audit: [] };
  if (scope.limited) out.limited = true;
  if (!ids.length) return out;

  const sinceQ = (field) => ({ [field]: { $gte: sinceDate } });
  const [helpDocs, linkChanges, deliveries, incidents, logs, audit] = await Promise.all([
    reset ? [] : db.collection('device_help').find({ _id: withBoth(ids), ...sinceQ('updatedAt') }).toArray(),
    reset ? [] : db.collection('customer_links').find({ deviceId: withBoth(ids), $or: [sinceQ('linkedAt'), sinceQ('updatedAt'), sinceQ('unlinkedAt')] }).toArray(),
    db.collection('message_deliveries').find({
      deviceId: { $in: ids },
      ...(reset ? { updatedAt: { $gte: new Date(now.getTime() - 6 * 3600_000) } }
        : { $or: [sinceQ('updatedAt'), { state: { $in: ['queued', 'delivered'] }, expiresAt: { $gte: sinceDate, $lte: now } }] }),
    }).sort({ updatedAt: -1 }).limit(300).toArray(),
    db.collection('incidents').find({
      deviceId: { $in: oids },
      ...(reset ? { status: { $in: ['open', 'acknowledged'] } } : { $or: [sinceQ('updatedAt'), sinceQ('createdAt')] }),
    }).sort({ updatedAt: -1 }).limit(200).toArray(),
    db.collection('device_logs').find({ ...modeFilter(exercise), deviceId: { $in: ids }, ...(reset ? {} : sinceQ('at')) }).sort({ at: -1 }).limit(reset ? 50 : 200).toArray(),
    db.collection('audit_log').find({
      ...modeFilter(exercise), ...(reset ? {} : sinceQ('at')),
      ...(deviceId || bbox ? { $or: [{ deviceId: { $in: ids } }, ...(regionKey ? [{ region: regionKey }] : [])] } : {}),
    }).sort({ at: -1 }).limit(reset ? 50 : 200).toArray(),
  ]);

  // Which devices changed since the cursor. A device going silent changes nothing in the database,
  // so devices that crossed the offline line inside the window are included as well.
  let changed = scope.devices;
  if (!reset) {
    const extra = new Set([...helpDocs.map((h) => String(h._id)), ...linkChanges.map((l) => String(l.deviceId))]);
    const t = cursorMs;
    changed = scope.devices.filter((d) => {
      const seen = d.lastSeen ? new Date(d.lastSeen).getTime() : null;
      if (extra.has(String(d._id))) return true;
      if (seen === null) return false;
      return seen >= t || (seen < now.getTime() - OFFLINE_MS && seen >= t - OFFLINE_MS);
    });
  }
  const cids = changed.map((d) => String(d._id));
  const [latest, lh, risk] = await Promise.all([
    latestReadings(db, changed.map((d) => d._id), now), linksAndHelp(db, cids), riskFor(db, env, cids, exercise, now),
  ]);
  const ctx = { homesById: scope.homesById, latest, links: lh.links, helps: lh.helps, risk: risk.map, now };
  out.devices = changed.map((d) => deviceLive(d, ctx));
  out.sources = { risk: risk.status };
  out.helpChanged = helpDocs.map((h) => ({ deviceId: String(h._id), status: h.status, updatedAt: iso(h.updatedAt) }));
  out.messages = deliveries.map((m) => ({ id: m.messageId, deviceId: m.deviceId, state: effectiveState(m, now), updatedAt: iso(m.updatedAt) }));
  out.incidents = incidents.map(incidentRow);
  out.logs = logs.map(logRow);
  out.audit = audit.map(auditRow);
  return out;
}

/** GET /api/ops/device. Everything about one device: 60 min series, risk, logs, messages, help, link. */
export async function getDeviceDetail(db, { id, exercise = false, now = new Date(), env = {} } = {}) {
  if (!isHex24(id)) throw badRequest('Invalid device id');
  const scope = await loadScopeDevices(db, { exercise, deviceId: id });
  const d = scope.devices[0];
  if (!d) throw notFound('Device not found');
  const sid = String(d._id);
  const [latest, lh, risk, rows, logs, deliveries, incidents] = await Promise.all([
    latestReadings(db, [d._id], now), linksAndHelp(db, [sid]), riskFor(db, env, [sid], exercise, now),
    db.collection('readings').find({ deviceId: d._id, ts: { $gte: new Date(now.getTime() - 3600_000) } }).sort({ ts: 1 }).limit(3000).toArray(),
    db.collection('device_logs').find({ ...modeFilter(exercise), deviceId: sid }).sort({ at: -1 }).limit(50).toArray(),
    db.collection('message_deliveries').find({ deviceId: sid }).sort({ createdAt: -1 }).limit(20).toArray(),
    db.collection('incidents').find({ deviceId: d._id, status: { $in: ['open', 'acknowledged'] } }).sort({ updatedAt: -1 }).limit(20).toArray(),
  ]);
  const series = {};
  for (const r of rows) (series[r.sensor] ||= []).push({ t: iso(r.ts), v: r.value });
  for (const k of Object.keys(series)) series[k] = series[k].slice(-120);
  const live = deviceLive(d, { homesById: scope.homesById, latest, links: lh.links, helps: lh.helps, risk: risk.map, now });
  const help = lh.helps.get(sid);
  // Presentation metadata only: never feed a preview into readings, risk or model evidence.
  const previewIds = configuredWifiPreviewIds(env);
  const displayPreview = !exercise && previewIds.includes(sid) ? { wifiConnected: true, source: 'simulation' } : null;
  return {
    device: { id: sid, name: d.name, type: d.type || null, lng: live.lng, lat: live.lat, lastSeen: live.lastSeen, offline: live.offline, exercise: d.meta?.exercise === true },
    displayPreview,
    latest: live.latest, series, risk: live.risk, link: live.link,
    help: { status: live.help.status, note: help?.note || '', updatedAt: live.help.updatedAt, history: (help?.history || []).slice(-20) },
    logs: logs.map(logRow),
    messages: deliveries.map((m) => ({ id: m.messageId, seq: m.seq, kind: m.kind, severity: m.severity, title: m.title, body: m.body, state: effectiveState(m, now), requiresAck: m.requiresAck === true, expiresAt: iso(m.expiresAt), updatedAt: iso(m.updatedAt) })),
    incidents: incidents.map(incidentRow),
    mode: exercise ? 'exercise' : 'live', serverTime: now.toISOString(), sources: { risk: risk.status },
  };
}
