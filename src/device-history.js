// Retained canonical history. Never a replacement for fixed hazard rules.
import { ObjectId } from 'mongodb';
import { HttpError, json } from './http.js';
import { withDb } from './db.js';
import { opsAuth } from './live-api.js';
import { readCustomerSession } from './operator-session.js';

const DAY = 86400000;
export const HISTORY_METRICS = {
  temperature_c: { label: 'Temperature', unit: '°C' },
  humidity_pct: { label: 'Relative humidity', unit: '%' },
  battery_pct: { label: 'Battery charge', unit: '%' },
  water_detected: { label: 'Water-positive observations', unit: 'fraction', boolean: true },
  main_power_available: { label: 'Mains-available observations', unit: 'fraction', boolean: true },
};
const referenceKeys = ['temperature_c', 'humidity_pct'];
const liveFilter = { 'meta.exercise': { $ne: true }, 'meta.simulated': { $ne: true }, simulated: { $ne: true }, exercise: { $ne: true } };
const dayString = d => d.toISOString().slice(0, 10);
const utcDay = d => new Date(dayString(d) + 'T00:00:00Z');
const note = 'Qualified observed samples only; not calibrated normal, safe limits, or a climate normal. Fixed alarms always apply. Missing days and sensors are unknown. Canonical temperature/humidity are not installed on the current box sketches. Historical qualification reflects the last recomputation while raw data existed.';

async function criticalIncident(db, device) {
  return db.collection('incidents').findOne({
    $or: [{ deviceId: device._id }, ...(device.homeId ? [{ homeId: device.homeId }] : [])],
    severity: 'critical', status: { $ne: 'resolved' }, simulated: { $ne: true },
  }, { projection: { _id: 1 } });
}
function numericValue(key, meta) {
  return meta.boolean
    ? { $cond: [{ $eq: [{ $type: '$' + key }, 'bool'] }, { $cond: ['$' + key, 1, 0] }, null] }
    : { $cond: [{ $isNumber: '$' + key }, '$' + key, null] };
}
function summary(row, prefix, meta) {
  return { mean: row[prefix + 'Mean'], min: row[prefix + 'Min'], max: row[prefix + 'Max'], count: row[prefix + 'Count'], unit: meta.unit, label: meta.label };
}

export async function materializeDeviceHistory(db, { now = new Date() } = {}) {
  // Exclude the partial day at the TTL boundary: replacing it with surviving raw
  // samples would silently shrink an already archived full-day summary.
  const cutoff = new Date(now.getTime() - 30 * DAY);
  const from = utcDay(cutoff);
  if (+from < +cutoff) from.setUTCDate(from.getUTCDate() + 1);
  let writes = 0;
  for await (const device of db.collection('devices').find(liveFilter, { projection: { _id: 1, homeId: 1 } })) {
    const blocked = Boolean(await criticalIncident(db, device));
    const qualified = { $and: [
      { $literal: !blocked }, { $eq: ['$clockSource', 'device'] },
      { $eq: ['$water_detected', false] }, { $eq: ['$main_power_available', true] },
      { $isNumber: '$battery_pct' }, { $gte: ['$battery_pct', 20] }, { $lte: ['$battery_pct', 100] },
      // Missing temperature is not invented, but an actually reported hazard excludes all reference metrics.
      { $or: [{ $in: [{ $type: '$temperature_c' }, ['missing', 'null']] }, { $and: [{ $isNumber: '$temperature_c' }, { $gte: ['$temperature_c', -80] }, { $lt: ['$temperature_c', 55] }] }] },
    ] };
    const group = { _id: { $dateToString: { format: '%Y-%m-%d', date: '$observedAt', timezone: 'UTC' } } };
    for (const [key, meta] of Object.entries(HISTORY_METRICS)) {
      const v = numericValue(key, meta);
      for (const [prefix, value] of [[key, v], ...(referenceKeys.includes(key) ? [['q_' + key, { $cond: [{ $and: [qualified, { $isNumber: '$' + key }, { $gte: ['$' + key, key === 'temperature_c' ? -80 : 0] }, { $lte: ['$' + key, key === 'temperature_c' ? 150 : 100] }] }, v, null] }]] : [])]) {
        group[prefix + 'Mean'] = { $avg: value };
        group[prefix + 'Min'] = { $min: value };
        group[prefix + 'Max'] = { $max: value };
        group[prefix + 'Count'] = { $sum: { $cond: [{ $ne: [value, null] }, 1, 0] } };
        if (prefix.startsWith('q_')) {
          group[prefix + 'First'] = { $min: { $cond: [{ $ne: [value, null] }, '$observedAt', null] } };
          group[prefix + 'Last'] = { $max: { $cond: [{ $ne: [value, null] }, '$observedAt', null] } };
        }
      }
    }
    const rows = db.collection('telemetry').aggregate([
      { $match: { 'meta.deviceId': device._id, observedAt: { $gte: from, $lte: now }, simulated: { $ne: true }, 'meta.exercise': { $ne: true }, 'meta.simulated': { $ne: true } } },
      // Canonical ingestion is idempotent. Also tolerate duplicate persisted events during repair.
      { $sort: { observedAt: 1, _id: 1 } },
      { $group: { _id: { $ifNull: ['$eventId', '$_id'] }, sample: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$sample' } }, { $group: group },
    ], { allowDiskUse: true });
    for await (const row of rows) {
      const metrics = {}, qualifiedMetrics = {};
      for (const [key, meta] of Object.entries(HISTORY_METRICS)) {
        if (row[key + 'Count']) metrics[key] = summary(row, key, meta);
        if (referenceKeys.includes(key) && row['q_' + key + 'Count']) {
          qualifiedMetrics[key] = { ...summary(row, 'q_' + key, meta), firstObservedAt: row['q_' + key + 'First'], lastObservedAt: row['q_' + key + 'Last'] };
        }
      }
      await db.collection('device_daily_stats').updateOne({ deviceId: device._id, day: row._id }, { $set: {
        metrics, qualifiedMetrics, qualificationVersion: 1, updatedAt: now,
        kind: 'observed_daily_sample_summary', expiresAt: new Date(+new Date(row._id + 'T00:00:00Z') + 365 * DAY),
      } }, { upsert: true });
      writes++;
    }
  }
  return writes;
}

function safeMetrics(metrics, allowed = Object.keys(HISTORY_METRICS)) {
  return Object.fromEntries(allowed.flatMap(key => {
    const m = metrics?.[key], meta = HISTORY_METRICS[key];
    if (!m || !Number.isSafeInteger(m.count) || m.count <= 0 || ![m.mean, m.min, m.max].every(Number.isFinite)) return [];
    return [[key, { mean: m.mean, min: m.min, max: m.max, count: m.count, unit: meta.unit, label: meta.label }]];
  }));
}
export async function deviceHistory(db, id, { days = 365, now = new Date() } = {}) {
  if (!/^[a-f\d]{24}$/i.test(id || '')) throw new HttpError(400, 'A registered device id is required.');
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, 'days must be 1 to 365.');
  const device = await db.collection('devices').findOne({ _id: new ObjectId(id), ...liveFilter }, { projection: { _id: 1, homeId: 1 } });
  if (!device) throw new HttpError(404, 'Live device not found.');
  const from = new Date(+utcDay(now) - (days - 1) * DAY);
  const rows = await db.collection('device_daily_stats').find({ deviceId: device._id, day: { $gte: dayString(from), $lte: dayString(now) } }, { projection: { day: 1, metrics: 1, qualifiedMetrics: 1, qualificationVersion: 1 } }).sort({ day: 1 }).limit(days).toArray();
  const metrics = {};
  const blocked = Boolean(await criticalIncident(db, device));
  if (!blocked) for (const row of rows) {
    if (row.qualificationVersion !== 1) continue;
    for (const [key, m] of Object.entries(safeMetrics(row.qualifiedMetrics, referenceKeys))) {
      const q = row.qualifiedMetrics[key], first = new Date(q.firstObservedAt), last = new Date(q.lastObservedAt);
      if (!q.firstObservedAt || !q.lastObservedAt || !Number.isFinite(+first) || !Number.isFinite(+last) || last < first || last > now) continue;
      const total = metrics[key] ||= { ...m, mean: 0, count: 0, firstObservedAt: first, lastObservedAt: last };
      total.mean += m.mean * m.count; total.count += m.count;
      total.min = Math.min(total.min, m.min); total.max = Math.max(total.max, m.max);
      if (first < total.firstObservedAt) total.firstObservedAt = first;
      if (last > total.lastObservedAt) total.lastObservedAt = last;
    }
  }
  for (const m of Object.values(metrics)) {
    m.mean /= m.count;
    m.status = m.count >= 30 && m.lastObservedAt - m.firstObservedAt >= 2 * DAY ? 'observed_reference' : 'insufficient_history';
  }
  return { days, daily: rows.map(r => ({ day: r.day, metrics: safeMetrics(r.metrics) })), baseline: {
    status: Object.values(metrics).some(m => m.status === 'observed_reference') ? 'observed_reference' : 'insufficient_history',
    note: (blocked ? 'An unresolved critical incident excludes this device from baseline use. ' : '') + note, metrics,
  } };
}

export async function historyHandler(ctx, role) {
  try {
    if (ctx.request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const url = new URL(ctx.request.url);
    if (role === 'ops' && opsAuth(ctx, url).demo) throw new HttpError(403, 'Demo accounts cannot view live history.');
    return await withDb(ctx.env, ctx.injectedDb || ctx.db, async db => {
      let id = url.searchParams.get('id');
      if (role === 'customer') {
        const session = await readCustomerSession(ctx.request, ctx.env, db);
        if (!session) throw new HttpError(401, 'Sign in to see your devices.');
        const link = id && /^[a-f\d]{24}$/i.test(id) ? await db.collection('customer_links').findOne({ _id: id, customerEmail: session.email, active: true, exercise: { $ne: true } }) : null;
        if (!link) throw new HttpError(404, 'Device not found.');
        id = String(link.deviceId);
      }
      return json(await deviceHistory(db, id, { days: Number(url.searchParams.get('days') ?? 365), now: ctx.now }));
    });
  } catch (e) {
    return json({ error: e instanceof HttpError ? e.message : 'Device history is unavailable.' }, e instanceof HttpError ? e.status : 503);
  }
}
