// Product-agnostic API: devices + telemetry for hardware, alerts/rules for
// monitoring, events for logs, and a generic document store for app data.
// See docs/API.md for the contract.
import { HttpError, badRequest, notFound, json, readJson, corsHeaders, intParam, dateParam } from './http.js';
import { requireAdmin, requireRead, requireDevice, isAdmin, sha256Hex, newSecret } from './auth.js';
import { withDb, oid, ensureIndexes } from './db.js';
import { setupBeacon, registerBeaconRoutes } from './beacon.js';
import { setupFlood, registerFloodRoutes } from './flood.js';

const SENSOR_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const COLLECTION_RE = /^[a-z][a-z0-9_]{0,40}$/;
const OPS = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
const MAX_BATCH = 500;

// ---------- routing ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, handler });
};

export async function handle(request, env = {}, { db } = {}) {
  const cors = corsHeaders(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  let res;
  try {
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const match = routes
      .map((r) => ({ r, m: path.match(r.re) }))
      .filter((x) => x.m);
    if (!match.length) throw notFound(`No route for ${path}`);
    const hit = match.find((x) => x.r.method === request.method);
    if (!hit) throw new HttpError(405, `Method ${request.method} not allowed`);
    const params = Object.fromEntries(hit.r.keys.map((k, i) => [k, decodeURIComponent(hit.m[i + 1])]));
    res = await hit.r.handler({ request, env, url, params, injectedDb: db });
  } catch (err) {
    if (err instanceof HttpError) {
      res = json({ error: err.message, ...(err.details ? { details: err.details } : {}) }, err.status);
    } else {
      console.error('Unhandled API error', err?.name);
      const dbDown = /Mongo|ECONNREFUSED|ETIMEDOUT|Server selection/i.test(`${err?.name} ${err?.message}`);
      res = json({ error: dbDown ? 'Database unavailable' : 'Internal error' }, dbDown ? 503 : 500);
    }
  }
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

const db = (ctx, fn) => withDb(ctx.env, ctx.injectedDb, fn);

// ---------- health ----------
route('GET', '/', () => json({ name: 'utd-hackathon-26 API', docs: '/docs/API.md', health: '/api/health' }));

route('GET', '/health', async (ctx) => {
  const configured = Boolean(ctx.env.MONGODB_URI) || Boolean(ctx.injectedDb);
  const out = { status: 'ok', time: new Date().toISOString(), mongodb: { configured, reachable: false }, auth: { adminKeyConfigured: Boolean(ctx.env.API_ADMIN_KEY), publicRead: ctx.env.API_PUBLIC_READ === 'true' } };
  if (!configured) return json(out);
  const t0 = Date.now();
  try {
    await db(ctx, (d) => d.command({ ping: 1 }));
    out.mongodb.reachable = true;
    out.mongodb.latencyMs = Date.now() - t0;
  } catch (e) {
    out.status = 'degraded';
    out.mongodb.error = e?.name || 'Error';
  }
  return json(out, out.status === 'ok' ? 200 : 503);
});

// Admin: create indexes once after first deploy.
route('POST', '/setup', async (ctx) => {
  requireAdmin(ctx.request, ctx.env);
  await db(ctx, async d => { await ensureIndexes(d); await setupBeacon(d); await setupFlood(d); });
  return json({ ok: true, indexes: 'ensured' });
});

// ---------- devices ----------
function publicDevice(d) {
  const { keyHash, ...rest } = d;
  return rest;
}

route('POST', '/devices', async (ctx) => {
  requireAdmin(ctx.request, ctx.env);
  const body = await readJson(ctx.request);
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) throw badRequest('name is required (1-80 chars)');
  const deviceKey = newSecret('dk_');
  const doc = {
    name: body.name.trim(),
    type: typeof body.type === 'string' ? body.type.slice(0, 40) : 'generic',
    meta: body.meta && typeof body.meta === 'object' ? sanitize(body.meta) : {},
    keyHash: await sha256Hex(deviceKey),
    disabled: false,
    createdAt: new Date(),
    lastSeen: null,
  };
  const r = await db(ctx, (d) => d.collection('devices').insertOne(doc));
  return json({ device: publicDevice({ _id: r.insertedId, ...doc }), deviceKey, note: 'Store deviceKey now; it is not shown again.' }, 201);
});

route('GET', '/devices', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  const list = await db(ctx, (d) => d.collection('devices').find({}, { projection: { keyHash: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
  return json({ devices: list });
});

route('GET', '/devices/:id', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  const dev = await db(ctx, (d) => d.collection('devices').findOne({ _id: oid(ctx.params.id) }, { projection: { keyHash: 0 } }));
  if (!dev) throw notFound('Device not found');
  return json({ device: dev });
});

route('PATCH', '/devices/:id', async (ctx) => {
  requireAdmin(ctx.request, ctx.env);
  const body = await readJson(ctx.request);
  const set = {};
  if (typeof body.name === 'string') set.name = body.name.slice(0, 80);
  if (typeof body.disabled === 'boolean') set.disabled = body.disabled;
  if (body.meta && typeof body.meta === 'object') set.meta = sanitize(body.meta);
  const _id = oid(ctx.params.id);
  let deviceKey;
  if (body.rotateKey === true) {
    deviceKey = newSecret('dk_');
    set.keyHash = await sha256Hex(deviceKey);
  }
  if (!Object.keys(set).length) throw badRequest('Nothing to update (name, disabled, meta, rotateKey)');
  const dev = await db(ctx, (d) => d.collection('devices').findOneAndUpdate({ _id }, { $set: set }, { returnDocument: 'after', projection: { keyHash: 0 } }));
  if (!dev) throw notFound('Device not found');
  return json({ device: dev, ...(deviceKey ? { deviceKey } : {}) });
});

// ---------- telemetry ----------
function parseReading(r, i) {
  if (!r || typeof r !== 'object') throw badRequest(`readings[${i}] must be an object`);
  if (typeof r.sensor !== 'string' || !SENSOR_RE.test(r.sensor)) throw badRequest(`readings[${i}].sensor must match ${SENSOR_RE}`);
  const ok = typeof r.value === 'number' ? Number.isFinite(r.value) : typeof r.value === 'boolean' || (typeof r.value === 'string' && r.value.length <= 256);
  if (!ok) throw badRequest(`readings[${i}].value must be a finite number, boolean, or short string`);
  let ts = new Date();
  if (r.ts !== undefined) {
    ts = new Date(r.ts);
    if (Number.isNaN(ts.getTime())) throw badRequest(`readings[${i}].ts is not a valid date`);
    if (ts.getTime() > Date.now() + 5 * 60_000) ts = new Date(); // device clocks drift; never store the future
  }
  return { sensor: r.sensor, value: r.value, ...(typeof r.unit === 'string' ? { unit: r.unit.slice(0, 16) } : {}), ...(r.meta && typeof r.meta === 'object' ? { meta: sanitize(r.meta) } : {}), ts };
}

route('POST', '/ingest', async (ctx) => {
  const body = await readJson(ctx.request);
  const raw = Array.isArray(body) ? body : Array.isArray(body.readings) ? body.readings : [body];
  if (!raw.length) throw badRequest('No readings');
  if (raw.length > MAX_BATCH) throw badRequest(`At most ${MAX_BATCH} readings per request`);
  const readings = raw.map(parseReading);
  return db(ctx, async (d) => {
    const device = await requireDevice(ctx.request, d);
    const now = new Date();
    const docs = readings.map((r) => ({ ...r, deviceId: device._id, receivedAt: now }));
    await d.collection('readings').insertMany(docs, { ordered: false });
    await d.collection('devices').updateOne({ _id: device._id }, { $set: { lastSeen: now }, $inc: { readingCount: docs.length } });
    const alerts = await evaluateRules(d, device, docs);
    return json({ accepted: docs.length, alertsTriggered: alerts }, 202);
  });
});

route('GET', '/readings', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  const q = {};
  const deviceId = ctx.url.searchParams.get('deviceId');
  const sensor = ctx.url.searchParams.get('sensor');
  if (deviceId) q.deviceId = oid(deviceId, 'deviceId');
  if (sensor) q.sensor = sensor;
  const since = dateParam(ctx.url, 'since');
  const until = dateParam(ctx.url, 'until');
  if (since || until) q.ts = { ...(since ? { $gte: since } : {}), ...(until ? { $lte: until } : {}) };
  const limit = intParam(ctx.url, 'limit', { def: 100, min: 1, max: 1000 });
  const order = ctx.url.searchParams.get('order') === 'asc' ? 1 : -1;
  const list = await db(ctx, (d) => d.collection('readings').find(q).sort({ ts: order, _id: order }).limit(limit).toArray());
  return json({ count: list.length, readings: list });
});

route('GET', '/readings/latest', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  const match = {};
  const deviceId = ctx.url.searchParams.get('deviceId');
  if (deviceId) match.deviceId = oid(deviceId, 'deviceId');
  const list = await db(ctx, (d) =>
    d.collection('readings').aggregate([
      { $match: match },
      { $sort: { ts: -1, _id: -1 } },
      { $group: { _id: { deviceId: '$deviceId', sensor: '$sensor' }, value: { $first: '$value' }, unit: { $first: '$unit' }, ts: { $first: '$ts' } } },
      { $project: { _id: 0, deviceId: '$_id.deviceId', sensor: '$_id.sensor', value: 1, unit: 1, ts: 1 } },
      { $sort: { sensor: 1 } },
      { $limit: 500 },
    ]).toArray(),
  );
  return json({ latest: list });
});

// Downsampled series for charts: ?sensor=temp&bucket=60 (seconds)
route('GET', '/readings/stats', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  const sensor = ctx.url.searchParams.get('sensor');
  if (!sensor) throw badRequest('sensor is required');
  const match = { sensor, value: { $type: 'number' } };
  const deviceId = ctx.url.searchParams.get('deviceId');
  if (deviceId) match.deviceId = oid(deviceId, 'deviceId');
  const since = dateParam(ctx.url, 'since') || new Date(Date.now() - 3600_000);
  match.ts = { $gte: since };
  const bucketMs = intParam(ctx.url, 'bucket', { def: 60, min: 1, max: 86400 }) * 1000;
  const list = await db(ctx, (d) =>
    d.collection('readings').aggregate([
      { $match: match },
      { $group: { _id: { $subtract: [{ $toLong: '$ts' }, { $mod: [{ $toLong: '$ts' }, bucketMs] }] }, avg: { $avg: '$value' }, min: { $min: '$value' }, max: { $max: '$value' }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: 2000 },
      { $project: { _id: 0, t: { $toDate: '$_id' }, avg: 1, min: 1, max: 1, n: 1 } },
    ]).toArray(),
  );
  return json({ sensor, bucketSeconds: bucketMs / 1000, series: list });
});

// ---------- rules & alerts ----------
async function evaluateRules(d, device, docs) {
  const sensors = [...new Set(docs.map((x) => x.sensor))];
  const rules = await d.collection('rules').find({ enabled: true, sensor: { $in: sensors }, $or: [{ deviceId: null }, { deviceId: device._id }] }).toArray();
  let triggered = 0;
  for (const rule of rules) {
    const hits = docs.filter((x) => x.sensor === rule.sensor && typeof x.value === 'number' && OPS[rule.op](x.value, rule.threshold));
    if (!hits.length) continue;
    const last = hits[hits.length - 1];
    const r = await d.collection('alerts').updateOne(
      { ruleId: rule._id, deviceId: device._id, status: { $in: ['open', 'ack'] } },
      {
        $setOnInsert: { ruleId: rule._id, deviceId: device._id, deviceName: device.name, sensor: rule.sensor, severity: rule.severity, message: rule.message, status: 'open', createdAt: new Date() },
        $set: { lastValue: last.value, lastTs: last.ts },
        $inc: { count: hits.length },
      },
      { upsert: true },
    );
    if (r.upsertedCount) triggered++;
  }
  return triggered;
}

route('POST', '/rules', async (ctx) => {
  requireAdmin(ctx.request, ctx.env);
  const b = await readJson(ctx.request);
  if (typeof b.sensor !== 'string' || !SENSOR_RE.test(b.sensor)) throw badRequest('sensor is required');
  if (!OPS[b.op]) throw badRequest(`op must be one of ${Object.keys(OPS).join(' ')}`);
  if (typeof b.threshold !== 'number' || !Number.isFinite(b.threshold)) throw badRequest('threshold must be a number');
  const doc = {
    sensor: b.sensor,
    op: b.op,
    threshold: b.threshold,
    deviceId: b.deviceId ? oid(b.deviceId, 'deviceId') : null,
    severity: ['info', 'warning', 'critical'].includes(b.severity) ? b.severity : 'warning',
    message: typeof b.message === 'string' ? b.message.slice(0, 200) : `${b.sensor} ${b.op} ${b.threshold}`,
    enabled: b.enabled !== false,
    createdAt: new Date(),
  };
  const r = await db(ctx, (d) => d.collection('rules').insertOne(doc));
  return json({ rule: { _id: r.insertedId, ...doc } }, 201);
});

route('GET', '/rules', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  return json({ rules: await db(ctx, (d) => d.collection('rules').find().sort({ createdAt: -1 }).limit(500).toArray()) });
});

route('DELETE', '/rules/:id', async (ctx) => {
  requireAdmin(ctx.request, ctx.env);
  const r = await db(ctx, (d) => d.collection('rules').deleteOne({ _id: oid(ctx.params.id) }));
  if (!r.deletedCount) throw notFound('Rule not found');
  return json({ deleted: true });
});

route('GET', '/alerts', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  const q = {};
  const status = ctx.url.searchParams.get('status');
  if (status) q.status = { $in: status.split(',') };
  const deviceId = ctx.url.searchParams.get('deviceId');
  if (deviceId) q.deviceId = oid(deviceId, 'deviceId');
  const limit = intParam(ctx.url, 'limit', { def: 100, min: 1, max: 500 });
  return json({ alerts: await db(ctx, (d) => d.collection('alerts').find(q).sort({ createdAt: -1 }).limit(limit).toArray()) });
});

route('PATCH', '/alerts/:id', async (ctx) => {
  requireAdmin(ctx.request, ctx.env);
  const b = await readJson(ctx.request);
  if (!['open', 'ack', 'resolved'].includes(b.status)) throw badRequest('status must be open, ack, or resolved');
  const set = { status: b.status, updatedAt: new Date(), ...(typeof b.note === 'string' ? { note: b.note.slice(0, 500) } : {}) };
  const a = await db(ctx, (d) => d.collection('alerts').findOneAndUpdate({ _id: oid(ctx.params.id) }, { $set: set }, { returnDocument: 'after' }));
  if (!a) throw notFound('Alert not found');
  return json({ alert: a });
});

// ---------- events (device or admin) ----------
route('POST', '/events', async (ctx) => {
  const b = await readJson(ctx.request);
  if (typeof b.type !== 'string' || !SENSOR_RE.test(b.type)) throw badRequest('type is required (e.g. "door.open", "button.press")');
  return db(ctx, async (d) => {
    let deviceId = null;
    if (!isAdmin(ctx.request, ctx.env)) deviceId = (await requireDevice(ctx.request, d))._id;
    const doc = { type: b.type, data: b.data && typeof b.data === 'object' ? sanitize(b.data) : {}, deviceId, ts: new Date() };
    const r = await d.collection('events').insertOne(doc);
    if (deviceId) await d.collection('devices').updateOne({ _id: deviceId }, { $set: { lastSeen: doc.ts } });
    return json({ event: { _id: r.insertedId, ...doc } }, 201);
  });
});

route('GET', '/events', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  const q = {};
  const type = ctx.url.searchParams.get('type');
  if (type) q.type = type;
  const deviceId = ctx.url.searchParams.get('deviceId');
  if (deviceId) q.deviceId = oid(deviceId, 'deviceId');
  const since = dateParam(ctx.url, 'since');
  if (since) q.ts = { $gte: since };
  const limit = intParam(ctx.url, 'limit', { def: 100, min: 1, max: 1000 });
  return json({ events: await db(ctx, (d) => d.collection('events').find(q).sort({ ts: -1 }).limit(limit).toArray()) });
});

// ---------- generic document store ----------
// /api/store/:collection maps to Mongo collection `store_<collection>`.
function storeColl(d, name) {
  if (!COLLECTION_RE.test(name)) throw badRequest('collection must be lowercase letters, digits, underscores (max 41)');
  return d.collection(`store_${name}`);
}

// Strip operator/dotted keys so client JSON can never become a Mongo operator.
function sanitize(obj, depth = 0) {
  if (depth > 8) throw badRequest('Object nested too deeply');
  if (Array.isArray(obj)) return obj.map((v) => (v && typeof v === 'object' ? sanitize(v, depth + 1) : v));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$') || k.includes('.') || k === '_id') continue;
    out[k] = v && typeof v === 'object' ? sanitize(v, depth + 1) : v;
  }
  return out;
}

function storeFilter(url) {
  const raw = url.searchParams.get('filter');
  if (!raw) return {};
  let f;
  try {
    f = JSON.parse(raw);
  } catch {
    throw badRequest('filter must be JSON, e.g. {"status":"open"}');
  }
  if (!f || typeof f !== 'object' || Array.isArray(f)) throw badRequest('filter must be an object');
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (k.startsWith('$')) throw badRequest('Operators are not allowed in filter');
    if (v !== null && typeof v === 'object') throw badRequest('filter supports equality on scalar values only');
    out[k] = v;
  }
  return out;
}

route('GET', '/store/:collection', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  const limit = intParam(ctx.url, 'limit', { def: 100, min: 1, max: 1000 });
  const skip = intParam(ctx.url, 'skip', { def: 0, min: 0, max: 100000 });
  const sortRaw = ctx.url.searchParams.get('sort') || '-createdAt';
  const sortField = sortRaw.replace(/^-/, '');
  if (!/^[A-Za-z0-9_]{1,40}$/.test(sortField)) throw badRequest('Invalid sort field');
  const docs = await db(ctx, (d) => storeColl(d, ctx.params.collection).find(storeFilter(ctx.url)).sort({ [sortField]: sortRaw.startsWith('-') ? -1 : 1 }).skip(skip).limit(limit).toArray());
  return json({ count: docs.length, items: docs });
});

route('POST', '/store/:collection', async (ctx) => {
  requireAdmin(ctx.request, ctx.env);
  const b = await readJson(ctx.request);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw badRequest('Body must be a JSON object');
  const doc = { ...sanitize(b), createdAt: new Date(), updatedAt: new Date() };
  const r = await db(ctx, (d) => storeColl(d, ctx.params.collection).insertOne(doc));
  return json({ item: { _id: r.insertedId, ...doc } }, 201);
});

route('GET', '/store/:collection/:id', async (ctx) => {
  requireRead(ctx.request, ctx.env);
  const doc = await db(ctx, (d) => storeColl(d, ctx.params.collection).findOne({ _id: oid(ctx.params.id) }));
  if (!doc) throw notFound('Item not found');
  return json({ item: doc });
});

route('PATCH', '/store/:collection/:id', async (ctx) => {
  requireAdmin(ctx.request, ctx.env);
  const b = await readJson(ctx.request);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw badRequest('Body must be a JSON object');
  const set = { ...sanitize(b), updatedAt: new Date() };
  const doc = await db(ctx, (d) => storeColl(d, ctx.params.collection).findOneAndUpdate({ _id: oid(ctx.params.id) }, { $set: set }, { returnDocument: 'after' }));
  if (!doc) throw notFound('Item not found');
  return json({ item: doc });
});

route('DELETE', '/store/:collection/:id', async (ctx) => {
  requireAdmin(ctx.request, ctx.env);
  const r = await db(ctx, (d) => storeColl(d, ctx.params.collection).deleteOne({ _id: oid(ctx.params.id) }));
  if (!r.deletedCount) throw notFound('Item not found');
  return json({ deleted: true });
});

registerBeaconRoutes(route, db, { readJson, json, oid, intParam, dateParam });
registerFloodRoutes(route, db, { json, intParam });
