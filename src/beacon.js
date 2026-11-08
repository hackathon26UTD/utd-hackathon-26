// Safe Home's additive data model. Legacy /ingest and readings remain intact.
import { ObjectId } from 'mongodb';
import { badRequest, HttpError, notFound } from './http.js';
import { requireAdmin, requireRead, requireDevice, sha256Hex } from './auth.js';

export const RETENTION_SECONDS = 30 * 86400;
const FIELDS = ['temperature_c', 'humidity_pct', 'water_detected', 'main_power_available', 'battery_pct'];

/** @typedef {{_id: ObjectId, label: string, location: {type: 'Point', coordinates: number[]},
 * createdAt: Date, updatedAt: Date}} Home */
/** @typedef {{_id: ObjectId, homeId: ObjectId, name: string, keyHash: string,
 * disabled: boolean, lastSeen?: Date, latestTelemetry?: Telemetry}} BeaconDevice */
/** @typedef {{_id: ObjectId, homeId: ObjectId, deviceId: ObjectId,
 * type: 'flood'|'power_outage'|'high_temperature', severity: string,
 * status: 'open'|'acknowledged'|'resolved', detectedAt: Date, lastObservedAt: Date}} Incident */
/** @typedef {{observedAt: Date, receivedAt: Date, eventId: string, sequence?: number,
 * temperature_c?: number, humidity_pct?: number, water_detected?: boolean,
 * main_power_available?: boolean, battery_pct?: number}} Telemetry */

export async function setupBeacon(db) {
  const { versionArray } = await db.command({ buildInfo: 1 });
  if (versionArray[0] < 6 || (versionArray[0] === 6 && versionArray[1] < 3)) throw new Error('Safe Home requires MongoDB 6.3 or newer');
  const existing = await db.listCollections({ name: 'telemetry' }).next();
  if (!existing) {
    try {
      await db.createCollection('telemetry', { timeseries: { timeField: 'observedAt', metaField: 'meta', granularity: 'seconds' }, expireAfterSeconds: RETENTION_SECONDS });
    } catch (e) { if (e.code !== 48) throw e; }
  }
  const info = await db.listCollections({ name: 'telemetry' }).next();
  if (info?.options?.timeseries?.timeField !== 'observedAt' || info?.options?.timeseries?.metaField !== 'meta' || Number(info.options.expireAfterSeconds) !== RETENTION_SECONDS) {
    throw new Error('Existing telemetry options differ; review migration manually. No data was changed.');
  }
  await Promise.all([
    db.collection('homes').createIndex({ location: '2dsphere' }),
    db.collection('devices').createIndex({ homeId: 1 }),
    db.collection('telemetry').createIndex({ 'meta.deviceId': 1, observedAt: -1 }),
    db.collection('ingestion_receipts').createIndex({ deviceId: 1, eventId: 1 }, { unique: true }),
    db.collection('incidents').createIndex({ activeKey: 1 }, { unique: true, sparse: true }),
    db.collection('incidents').createIndex({ homeId: 1, detectedAt: -1 }),
    db.collection('incidents').createIndex({ status: 1, severity: 1, detectedAt: -1 }),
    db.collection('incidents').createIndex({ deviceId: 1, status: 1 }),
    db.collection('incident_events').createIndex({ incidentId: 1, timestamp: -1 }),
  ]);
  await db.collection('beacon_schema').updateOne({ _id: 'v1' }, { $set: { ready: true } }, { upsert: true });
}

export function parseTelemetry(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Body must be an object');
  if (typeof body.event_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(body.event_id)) throw badRequest('event_id is required (1-100 letters, digits, . _ : -)');
  if (typeof body.device_id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(body.device_id)) throw badRequest('device_id must be the registered device id');
  const out = { eventId: body.event_id };
  if (body.sequence !== undefined) {
    if (!Number.isSafeInteger(body.sequence) || body.sequence < 0) throw badRequest('sequence must be a nonnegative safe integer');
    out.sequence = body.sequence;
  }
  for (const [key, min, max] of [['temperature_c', -80, 150], ['humidity_pct', 0, 100], ['battery_pct', 0, 100]]) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < min || body[key] > max) throw badRequest(`${key} must be between ${min} and ${max}`);
      out[key] = body[key];
    }
  }
  for (const key of ['water_detected', 'main_power_available']) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean') throw badRequest(`${key} must be boolean`);
      out[key] = body[key];
    }
  }
  if (!FIELDS.some(k => out[k] !== undefined)) throw badRequest('At least one sensor is required');
  if (body.observed_at !== undefined) {
    if (typeof body.observed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.observed_at) || !Number.isFinite(Date.parse(body.observed_at))) throw badRequest('observed_at must be an ISO timestamp with timezone');
    const time = Date.parse(body.observed_at);
    if (time > now.getTime() + 300000 || time < now.getTime() - RETENTION_SECONDS * 1000) throw badRequest('observed_at must be within retention and at most five minutes ahead');
    out.observedAt = new Date(time);
    out.clockSource = 'device';
  } else { out.observedAt = now; out.clockSource = 'server_fallback'; }
  return out;
}

function hazards(t) {
  return [
    ...(t.water_detected === true ? [{ type: 'flood', severity: 'critical', trigger: { water_detected: true } }] : []),
    ...(t.main_power_available === false ? [{ type: 'power_outage', severity: 'medium', trigger: { main_power_available: false } }] : []),
    ...(t.temperature_c >= 55 ? [{ type: 'high_temperature', severity: 'high', trigger: { temperature_c: t.temperature_c, threshold: 55 } }] : []),
  ];
}

async function detectIncidents(db, device, t, receiptId) {
  const ids = [];
  for (const hazard of hazards(t)) {
    const activeKey = `${device._id}:${hazard.type}`;
    // A late retry of the SAME event must not reopen an operator-resolved incident.
    const observationId = `${receiptId}:${hazard.type}`;
    const observation = await db.collection('incident_events').findOne({ _id: observationId });
    let incident = observation
      ? await db.collection('incidents').findOne({ _id: observation.incidentId })
      : await db.collection('incidents').findOne({ sourceReceipt: receiptId, type: hazard.type });
    if (!incident) {
      const candidate = {
        _id: new ObjectId(), deviceId: device._id, homeId: device.homeId, ...hazard,
        sourceReceipt: receiptId, activeKey, status: 'open', simulated: device.meta?.exercise === true,
        detectedAt: t.observedAt, createdAt: t.receivedAt,
      };
      try {
        incident = await db.collection('incidents').findOneAndUpdate({ activeKey }, {
          $setOnInsert: candidate,
          $max: { lastObservedAt: t.observedAt, updatedAt: t.receivedAt },
        }, { upsert: true, returnDocument: 'after' });
      } catch (e) {
        if (e.code !== 11000) throw e;
        incident = await db.collection('incidents').findOneAndUpdate({ activeKey }, { $max: { lastObservedAt: t.observedAt, updatedAt: t.receivedAt } }, { returnDocument: 'after' });
        if (!incident) throw new HttpError(409, 'Incident changed concurrently; retry event');
      }
    }
    // The audit's stable id makes retries safe after a partial write.
    await db.collection('incident_events').updateOne({ _id: `created:${incident._id}` }, { $setOnInsert: {
      incidentId: incident._id, eventType: 'created', timestamp: incident.createdAt,
      actorType: 'rule', details: incident.trigger,
    } }, { upsert: true });
    await db.collection('incident_events').updateOne({ _id: observationId }, { $setOnInsert: {
      incidentId: incident._id, eventType: 'observation', timestamp: t.receivedAt,
      actorType: 'device', details: { eventId: t.eventId, observedAt: t.observedAt },
    } }, { upsert: true });
    ids.push(String(incident._id));
  }
  return ids;
}

/** Persist an authenticated observation, with receipts as the durable retry ledger. */
export async function ingestTelemetry(db, device, input, claimedDeviceId) {
  if (String(device._id) !== claimedDeviceId.toLowerCase()) throw new HttpError(403, 'device_id does not match the device key');
  if (!device.homeId || !await db.collection('homes').findOne({ _id: device.homeId })) throw new HttpError(409, 'Assign a home to the device before ingesting');
  if (!await db.collection('beacon_schema').findOne({ _id: 'v1', ready: true })) throw new HttpError(503, 'Safe Home database setup is required');
  const fingerprintInput = { ...input };
  // A missing device timestamp is stable across retries; receipt preserves the first fallback.
  if (input.clockSource === 'server_fallback') delete fingerprintInput.observedAt;
  const fingerprint = await sha256Hex(JSON.stringify(fingerprintInput));
  const receiptId = `${device._id}:${input.eventId}`;
  const receivedAt = new Date();
  const doc = { ...input, receivedAt, meta: { deviceId: device._id, homeId: device.homeId }, _id: receiptId };
  let receipt;
  try {
    receipt = { _id: receiptId, deviceId: device._id, eventId: input.eventId, fingerprint, state: 'reserved', telemetry: doc, createdAt: receivedAt };
    await db.collection('ingestion_receipts').insertOne(receipt);
  } catch (e) {
    if (e.code !== 11000) throw e;
    receipt = await db.collection('ingestion_receipts').findOne({ _id: receiptId });
    if (receipt.fingerprint !== fingerprint) throw new HttpError(409, 'event_id was already used with a different payload');
    if (receipt.state === 'complete') return { accepted: true, duplicate: true, incident_ids: receipt.incidentIds };
    // Never blindly repeat an ambiguous time-series insert: unique indexes are unsupported.
    if (receipt.state === 'reserved') throw new HttpError(409, 'Event is processing or requires receipt reconciliation; retry later');
  }
  if (receipt.state === 'reserved') {
    await db.collection('telemetry').insertOne(doc);
    await db.collection('ingestion_receipts').updateOne({ _id: receiptId }, { $set: { state: 'persisted' } });
  }
  const t = receipt.telemetry;
  const incidentIds = await detectIncidents(db, device, t, receiptId);
  // Projection into legacy readings keeps the existing command center usable.
  for (const field of FIELDS) {
    if (t[field] === undefined) continue;
    const sensor = { temperature_c: 'temp_c', main_power_available: 'mains_power' }[field] || field;
    await db.collection('readings').updateOne({ _id: `${receiptId}:${field}` }, { $setOnInsert: {
      deviceId: device._id, sensor, value: t[field], ts: t.observedAt, receivedAt: t.receivedAt, source: 'beacon',
    } }, { upsert: true });
  }
  await db.collection('devices').updateOne({ _id: device._id }, { $max: { lastSeen: t.receivedAt, lastObservedAt: t.observedAt, ...(t.sequence !== undefined ? { lastSequence: t.sequence } : {}) } });
  // Conditional update prevents offline replay from overwriting newer state.
  await db.collection('devices').updateOne({ _id: device._id, $or: [{ 'latestTelemetry.observedAt': { $lte: t.observedAt } }, { latestTelemetry: { $exists: false } }] }, { $set: { latestTelemetry: t } });
  await db.collection('ingestion_receipts').updateOne({ _id: receiptId }, { $set: { state: 'complete', incidentIds, completedAt: new Date() } });
  return { accepted: true, duplicate: false, incident_ids: incidentIds };
}

export async function reconcileReceipt(db, receiptId) {
  const receipt = await db.collection('ingestion_receipts').findOne({ _id: receiptId, state: 'reserved' });
  if (!receipt) throw new Error('Reserved receipt not found');
  // Run only with ingestion paused. A missing measurement is left for explicit review.
  const count = await db.collection('telemetry').countDocuments({ _id: receiptId });
  if (count !== 1) throw new Error('Expected exactly one measurement; manual reconciliation required');
  await db.collection('ingestion_receipts').updateOne({ _id: receiptId, state: 'reserved' }, { $set: { state: 'persisted' } });
}

export function registerBeaconRoutes(route, withDb, helpers) {
  const { readJson, json, oid, intParam, dateParam } = helpers;
  route('POST', '/beacon/homes', async ctx => {
    requireAdmin(ctx.request, ctx.env);
    const b = await readJson(ctx.request);
    if (!b || typeof b.label !== 'string' || !b.label.trim() || b.label.length > 80) throw badRequest('label is required (1-80 chars)');
    const c = b.location?.coordinates;
    if (b.location?.type !== 'Point' || !Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) throw badRequest('location must be a GeoJSON Point [longitude, latitude]');
    const home = { label: b.label.trim(), location: { type: 'Point', coordinates: c }, createdAt: new Date(), updatedAt: new Date() };
    return withDb(ctx, async d => { await d.collection('homes').insertOne(home); return json({ home }, 201); });
  });
  route('PATCH', '/beacon/devices/:id/home', async ctx => {
    requireAdmin(ctx.request, ctx.env);
    const b = await readJson(ctx.request);
    const homeId = oid(b?.home_id, 'home_id');
    return withDb(ctx, async d => {
      if (!await d.collection('homes').findOne({ _id: homeId })) throw notFound('Home not found');
      // Home changes after ingestion need an explicit migration, not a silent move.
      const device = await d.collection('devices').findOneAndUpdate({ _id: oid(ctx.params.id), homeId: { $exists: false } }, { $set: { homeId, updatedAt: new Date() } }, { returnDocument: 'after', projection: { keyHash: 0 } });
      if (!device) throw new HttpError(409, 'Device is missing or already assigned');
      return json({ device });
    });
  });
  route('POST', '/beacon/ingest', async ctx => {
    const b = await readJson(ctx.request);
    const t = parseTelemetry(b);
    return withDb(ctx, async d => json(await ingestTelemetry(d, await requireDevice(ctx.request, d), t, b.device_id), 202));
  });
  route('GET', '/beacon/devices/:id/telemetry', async ctx => {
    requireRead(ctx.request, ctx.env);
    const from = dateParam(ctx.url, 'from') || new Date(Date.now() - 86400000);
    const to = dateParam(ctx.url, 'to') || new Date();
    if (from > to || to - from > RETENTION_SECONDS * 1000) throw badRequest('Query range must be ordered and at most 30 days');
    const limit = intParam(ctx.url, 'limit', { def: 100, min: 1, max: 1000 });
    return withDb(ctx, async d => json({ telemetry: await d.collection('telemetry').find({ 'meta.deviceId': oid(ctx.params.id), observedAt: { $gte: from, $lte: to } }).sort({ observedAt: -1 }).limit(limit).toArray() }));
  });
  for (const path of ['/beacon/incidents', '/beacon/homes/:id/incidents']) route('GET', path, async ctx => {
    requireRead(ctx.request, ctx.env);
    const q = ctx.params.id ? { homeId: oid(ctx.params.id) } : {};
    for (const [field, allowed] of [['status', ['open', 'acknowledged', 'resolved']], ['severity', ['low', 'medium', 'high', 'critical']]]) {
      const value = ctx.url.searchParams.get(field);
      if (value) { if (!allowed.includes(value)) throw badRequest(`Invalid ${field}`); q[field] = value; }
    }
    const limit = intParam(ctx.url, 'limit', { def: 100, min: 1, max: 500 });
    return withDb(ctx, async d => json({ incidents: await d.collection('incidents').find(q).sort({ detectedAt: -1 }).limit(limit).toArray() }));
  });
  route('PATCH', '/beacon/incidents/:id', async ctx => {
    requireAdmin(ctx.request, ctx.env);
    const b = await readJson(ctx.request);
    if (!['acknowledged', 'resolved'].includes(b?.status)) throw badRequest('status must be acknowledged or resolved');
    return withDb(ctx, async d => {
      const now = new Date();
      // Audit proposal first, then outcome. Failed updates remain explicit pending records.
      const audit = { incidentId: oid(ctx.params.id), eventType: 'status_change', actorType: 'operator', timestamp: now, details: { status: b.status }, outcome: 'pending' };
      await d.collection('incident_events').insertOne(audit);
      const incident = await d.collection('incidents').findOneAndUpdate({ _id: audit.incidentId, status: { $in: ['open', 'acknowledged'] } }, {
        $set: { status: b.status, updatedAt: now, ...(b.status === 'resolved' ? { resolvedAt: now } : {}) },
        ...(b.status === 'resolved' ? { $unset: { activeKey: '' } } : {}),
      }, { returnDocument: 'after' });
      await d.collection('incident_events').insertOne({ incidentId: audit.incidentId, eventType: 'status_change_result', actorType: 'operator', timestamp: new Date(), details: { requestId: audit._id, status: b.status }, outcome: incident ? 'applied' : 'not_applied' });
      if (!incident) throw new HttpError(409, 'Incident is missing or already resolved');
      return json({ incident });
    });
  });
  route('GET', '/beacon/homes/nearby', async ctx => {
    requireRead(ctx.request, ctx.env);
    const lat = Number(ctx.url.searchParams.get('lat')), lon = Number(ctx.url.searchParams.get('lon'));
    if (!ctx.url.searchParams.has('lat') || !ctx.url.searchParams.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw badRequest('Valid lat and lon required');
    const radius = intParam(ctx.url, 'radius_m', { def: 5000, min: 1, max: 50000 });
    return withDb(ctx, async d => json({ homes: await d.collection('homes').find({ location: { $near: { $geometry: { type: 'Point', coordinates: [lon, lat] }, $maxDistance: radius } } }).limit(100).toArray() }));
  });
}
