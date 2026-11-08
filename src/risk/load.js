// Reads devices, readings, links and overlay context, then runs the pure risk functions.
// Direct collection reads only. The one write is `risk_state` (status changes, used for "got worse").
import { ObjectId } from 'mongodb';
import { LOOKBACK_DAYS, REGION, SENSOR_NAMES, SERIES_SENSORS, levelIndex } from './config.js';
import { assessDevice } from './device.js';
import { deviceLngLat, geohashEncode, inBbox, validLngLat } from './geo.js';
import { aggregateRegions, applyRegionBoosts, followUps, normalizePrecision } from './region.js';

const DAY = 86400000, MIN = 60000;
const EMPTY_CTX = { zones: [], nfhl: [], nws: [], declarations: [], weather: {}, status: {} };
const rank = (s) => Math.max(1, levelIndex(s));
const worseThan = (prev, next) => rank(next) >= 2 && rank(next) > rank(prev);

let ensured = false;
export async function ensureRiskIndexes(db) {
  if (ensured) return;
  await db.collection('risk_state').createIndex({ since: -1 });
  ensured = true;
}

async function defaultOverlays() {
  try { return (await import('../feeds.js')).readCachedOverlays; } catch { return null; }
}
async function defaultLogger() {
  try { return (await import('../live.js')).writeDeviceLog; } catch { return null; }
}

function bboxOf(points, pad = 0.05) {
  if (!points.length) return null;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

async function readOverlays(db, { bbox, now, exercise, deps, env, cells }) {
  const fn = deps.readCachedOverlays !== undefined ? deps.readCachedOverlays : await defaultOverlays();
  if (!fn || !bbox) return { ...EMPTY_CTX, status: { overlays: fn ? 'no_area' : 'not_available' } };
  try {
    const ctx = await fn(db, { bbox, layers: ['zones', 'nfhl', 'nws', 'declarations', 'weather'], now, exercise, env, cells });
    return { ...EMPTY_CTX, ...ctx, status: ctx?.status || {} };
  } catch {
    return { ...EMPTY_CTX, status: { overlays: 'error' } };
  }
}

/**
 * loadRisk(db, {bbox, deviceIds, precision, exercise, now, env, limit, readOnly}, deps)
 * -> {asOf, mode, assessments, regions, followUps, sources, limited}
 * deps (tests): {readCachedOverlays, writeDeviceLog}.
 */
export async function loadRisk(db, opts = {}, deps = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const nowMs = now.getTime(), exercise = Boolean(opts.exercise), precision = normalizePrecision(opts.precision), limit = Math.min(Math.max(opts.limit || 500, 1), 1000);
  const q = { disabled: { $ne: true }, 'meta.exercise': exercise ? true : { $ne: true } };
  if (Array.isArray(opts.deviceIds)) q._id = { $in: opts.deviceIds.filter((i) => typeof i === 'string' && ObjectId.isValid(i) && i.length === 24).map((i) => new ObjectId(i)) };
  const devicesAll = await db.collection('devices').find(q, { projection: { keyHash: 0 } }).limit(limit).toArray();
  const limited = !opts.deviceIds && devicesAll.length >= limit;

  const homeIds = [...new Set(devicesAll.map((d) => d.homeId).filter(Boolean).map(String))];
  const homeDocs = homeIds.length ? await db.collection('homes').find({ _id: { $in: devicesAll.map((d) => d.homeId).filter(Boolean) } }, { projection: { location: 1 } }).toArray() : [];
  const homes = new Map(homeDocs.map((h) => [String(h._id), h]));
  const located = devicesAll.map((d) => ({ d, loc: deviceLngLat(d, homes) })).filter((x) => !opts.bbox || inBbox(x.loc, opts.bbox));
  const devices = located.map((x) => x.d), idStrings = devices.map((d) => String(d._id));
  if (!devices.length) return { asOf: now.toISOString(), mode: exercise ? 'exercise' : 'live', assessments: [], regions: [], followUps: [], sources: {}, limited };

  const ids = devices.map((d) => d._id);
  const since = new Date(nowMs - LOOKBACK_DAYS * DAY), recent = new Date(nowMs - 30 * MIN);
  const [latest, series, links, helps, states] = await Promise.all([
    // Newest three per sensor so one garbage reading cannot hide older evidence.
    db.collection('readings').aggregate([
      { $match: { deviceId: { $in: ids }, sensor: { $in: SENSOR_NAMES }, ts: { $gte: since } } },
      { $sort: { ts: -1, _id: -1 } },
      { $group: { _id: { d: '$deviceId', s: '$sensor' }, docs: { $firstN: { input: '$$ROOT', n: 3 } } } },
      { $unwind: '$docs' }, { $replaceRoot: { newRoot: '$docs' } },
    ]).toArray(),
    db.collection('readings').find({ deviceId: { $in: ids }, sensor: { $in: SERIES_SENSORS }, ts: { $gte: recent } }).limit(5000).toArray(),
    db.collection('customer_links').find({ deviceId: { $in: idStrings }, active: true }, { projection: { deviceId: 1, consent: 1, contactName: 1 } }).toArray(),
    db.collection('device_help').find({ _id: { $in: idStrings } }, { projection: { status: 1, updatedAt: 1 } }).toArray(),
    db.collection('risk_state').find({ _id: { $in: idStrings } }).toArray(),
  ]);

  const byDevice = new Map();
  for (const r of [...latest, ...series]) {
    const k = String(r.deviceId);
    if (!byDevice.has(k)) byDevice.set(k, new Map());
    byDevice.get(k).set(String(r._id), r);
  }
  const linkBy = new Map(links.map((l) => [String(l.deviceId), { linked: true, consent: l.consent === true, contactName: l.consent === true ? l.contactName : undefined }]));
  const helpBy = new Map(helps.map((h) => [String(h._id), h]));
  const stateBy = new Map(states.map((s) => [String(s._id), s]));

  const locs = located.map((x) => x.loc).filter(validLngLat);
  // cells lets the feed cache answer rain per geohash5 cell where boxes actually are.
  const cells = [...new Set(locs.map((l) => geohashEncode(l[0], l[1], 5)))].slice(0, 50);
  const ctx = await readOverlays(db, { bbox: opts.bbox || bboxOf(locs), now, exercise, deps, env: opts.env || {}, cells });

  let assessments = located.map(({ d, loc }) => assessDevice({
    device: d, readings: [...(byDevice.get(String(d._id))?.values() || [])], location: loc,
    link: linkBy.get(String(d._id)), help: helpBy.get(String(d._id)),
  }, ctx, now));

  // Which boxes got worse recently: stored transitions plus any change seen right now.
  const worsened = new Set(), writes = [], logs = [];
  for (const a of assessments) {
    const st = stateBy.get(a.deviceId);
    const inWindow = st && nowMs - new Date(st.since).getTime() <= REGION.worsenedWindowMin * MIN;
    if (st && st.status === a.status) { if (inWindow && st.prevStatus && worseThan(st.prevStatus, st.status)) worsened.add(a.deviceId); }
    else {
      if (st && worseThan(st.status, a.status)) worsened.add(a.deviceId);
      writes.push({ updateOne: { filter: { _id: a.deviceId }, update: { $set: { status: a.status, since: now, prevStatus: st?.status ?? null, prevAt: st?.since ?? null, exercise, updatedAt: now } }, upsert: true } });
    }
    const newestBad = a.discarded.map((x) => Date.parse(x.observedAt)).reduce((m, t) => Math.max(m, t), 0);
    if (newestBad && newestBad > (st?.lastDiscardAt ? new Date(st.lastDiscardAt).getTime() : 0)) {
      logs.push({ deviceId: a.deviceId, at: now, level: 'warn', code: 'reading_discarded', msg: `Ignored ${a.discarded.length} reading(s) outside the valid range: ${[...new Set(a.discarded.map((x) => x.sensor))].join(', ')}`.slice(0, 120), source: 'server', exercise });
      writes.push({ updateOne: { filter: { _id: a.deviceId }, update: { $set: { lastDiscardAt: new Date(newestBad) }, $setOnInsert: { status: a.status, since: now, exercise } }, upsert: true } });
    }
  }
  const regions = aggregateRegions(assessments, { precision, now, worsened });
  assessments = applyRegionBoosts(assessments, regions, precision);

  if (!opts.readOnly && (writes.length || logs.length)) {
    try {
      await ensureRiskIndexes(db);
      // Two updates for one id in a single unordered batch would conflict; run in order instead.
      if (writes.length) await db.collection('risk_state').bulkWrite(writes, { ordered: true });
      const log = deps.writeDeviceLog !== undefined ? deps.writeDeviceLog : await defaultLogger();
      if (log) for (const entry of logs) await log(db, entry).catch(() => {});
    } catch { /* state is a cache of transitions; a failed write only delays "got worse" */ }
  }

  return {
    asOf: now.toISOString(), mode: exercise ? 'exercise' : 'live',
    assessments, regions, followUps: followUps(assessments, opts.followUpLimit || 20), sources: ctx.status, limited,
  };
}
