// HTTP glue for module C. Each file under functions/api/ is a one-line wrapper around a function here,
// so tests can call them with an injected database. Auth: operators arrive with the admin key injected by
// the middleware, demo sessions are marked in context.data, devices send X-Device-Key.
import { HttpError, badRequest, json, readJson, intParam, dateParam, unauthorized } from './http.js';
import { isAdmin, requireDevice, sha256Hex } from './auth.js';
import { withDb } from './db.js';
import { handle } from './app.js';
import { ensureLiveIndexes, getDeviceDetail, getLive, ingestDeviceLogs, parseScopeParams, queryLogs, recordKeyFailure, writeDeviceLog } from './live.js';
import { cancelMessage, createMessage, deviceReport, listMessages, pendingCount, pollInterval, pullForDevice } from './messages.js';

const fail = (err) => {
  if (err instanceof HttpError) {
    const res = json({ error: err.message, ...(err.details ? { details: err.details } : {}) }, err.status);
    if (err.status === 429) res.headers.set('Retry-After', '60');
    return res;
  }
  console.error('Unhandled live API error', err?.name);
  const down = /Mongo|ECONNREFUSED|ETIMEDOUT|Server selection/i.test(`${err?.name} ${err?.message}`);
  return json({ error: down ? 'Database unavailable' : 'Internal error' }, down ? 503 : 500);
};

/** Resolves who is calling an operator-only endpoint. */
export function opsAuth({ request, env, data }, url) {
  const demo = data?.operator?.role === 'demo';
  if (demo) return { demo: true, exercise: true, actor: 'demo' };
  if (!isAdmin(request, env)) throw unauthorized('Sign in to view this data.');
  return { demo: false, exercise: url.searchParams.get('mode') === 'exercise', actor: String(data?.operator?.email || 'admin-key') };
}
const needWrite = (auth) => { if (auth.demo) throw new HttpError(403, 'Demo accounts can view exercise data only.'); };
const allow = (ctx, methods) => { if (!methods.includes(ctx.request.method)) throw new HttpError(405, `Method ${ctx.request.method} not allowed`); };

async function run(ctx, methods, fn) {
  try {
    allow(ctx, methods);
    const url = new URL(ctx.request.url);
    return await fn(url);
  } catch (e) { return fail(e); }
}
const dbOf = (ctx, fn) => withDb(ctx.env || {}, ctx.injectedDb, async (db) => { await ensureLiveIndexes(db); return fn(db); });

// ---------- operator endpoints ----------
export const opsLive = (ctx) => run(ctx, ['GET'], async (url) => {
  const auth = opsAuth(ctx, url);
  const { bbox, regionKey } = parseScopeParams(url);
  const deviceId = url.searchParams.get('device_id');
  const since = url.searchParams.get('since');
  return dbOf(ctx, async (db) => json(await getLive(db, { since, bbox, regionKey, deviceId, exercise: auth.exercise, env: ctx.env || {}, now: ctx.now })));
});

export const opsDevice = (ctx) => run(ctx, ['GET'], async (url) => {
  const auth = opsAuth(ctx, url);
  return dbOf(ctx, async (db) => json(await getDeviceDetail(db, { id: url.searchParams.get('id'), exercise: auth.exercise, env: ctx.env || {}, now: ctx.now })));
});

export const opsLogs = (ctx) => run(ctx, ['GET'], async (url) => {
  const auth = opsAuth(ctx, url);
  const { bbox, regionKey } = parseScopeParams(url);
  const p = url.searchParams;
  return dbOf(ctx, async (db) => json(await queryLogs(db, {
    kind: p.get('kind') || 'all', deviceId: p.get('device_id'), bbox, regionKey, level: p.get('level'),
    since: dateParam(url, 'since'), until: dateParam(url, 'until'), limit: intParam(url, 'limit', { def: 100, min: 1, max: 500 }), exercise: auth.exercise,
  })));
});

export const opsMessages = (ctx) => run(ctx, ['GET', 'POST', 'DELETE'], async (url) => {
  const auth = opsAuth(ctx, url);
  const method = ctx.request.method;
  if (method === 'GET') {
    return dbOf(ctx, async (db) => json(await listMessages(db, {
      deviceId: url.searchParams.get('device_id'), state: url.searchParams.get('state'), limit: intParam(url, 'limit', { def: 50, min: 1, max: 200 }), exercise: auth.exercise, now: ctx.now,
    })));
  }
  needWrite(auth);
  if (method === 'POST') {
    const body = await readJson(ctx.request);
    return dbOf(ctx, async (db) => {
      const r = await createMessage(db, body, { operator: auth.actor, exercise: auth.exercise, now: ctx.now });
      return json({ message: r.message, deliveries: r.deliveries, skipped: r.skipped, truncated: r.truncated }, 201);
    });
  }
  const id = url.searchParams.get('id');
  return dbOf(ctx, async (db) => json(await cancelMessage(db, id, { operator: auth.actor, exercise: auth.exercise, now: ctx.now })));
});

// ---------- device endpoints ----------
/** Device-key auth. Rejections are only counted, never attributed. */
async function deviceAuth(ctx, db) {
  try { return await requireDevice(ctx.request, db); } catch (e) {
    if (e instanceof HttpError && e.status === 401) await recordKeyFailure(db, ctx.now);
    throw e;
  }
}

export const deviceMessages = (ctx) => run(ctx, ['GET', 'POST'], async (url) => dbOf(ctx, async (db) => {
  const device = await deviceAuth(ctx, db);
  if (ctx.request.method === 'GET') {
    const after = intParam(url, 'after', { def: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
    const limit = intParam(url, 'limit', { def: 3, min: 1, max: 3 });
    const out=await pullForDevice(db, device, { after, limit, now: ctx.now });
    return json({...out,...(device.desiredSettings?{configuration:{revision:device.desiredSettings.revision,pollAfterSeconds:device.desiredSettings.pollAfterSeconds}}:{})});
  }
  const b = await readJson(ctx.request);
  return json(await deviceReport(db, device, { messageId: b?.message_id, state: b?.state }, ctx.now));
}));

export const deviceLogs = (ctx) => run(ctx, ['POST'], async () => dbOf(ctx, async (db) => {
  const device = await deviceAuth(ctx, db);
  return json(await ingestDeviceLogs(db, device, await readJson(ctx.request), ctx.now), 202);
}));

// ---------- ingest hooks (additive wrappers) ----------
const GAP_MS = 15 * 60_000;

function readingsOf(text) {
  try {
    const body = JSON.parse(text);
    return Array.isArray(body) ? body : Array.isArray(body?.readings) ? body.readings : body && typeof body === 'object' ? [body] : [];
  } catch { return []; }
}

/**
 * Forwards an ingest request to the unchanged handler in src/app.js. On a 202 it adds
 * `messages_pending` and `poll_after_s` to the JSON and writes server-side device logs:
 * first report, return after a gap over 15 min, and power-save mode changes (power_mode readings).
 * Any failure in the extras leaves the handler's own response untouched.
 */
export async function ingestWithDownlink(ctx) {
  const { request, env = {} } = ctx;
  const key = request.headers.get('X-Device-Key');
  if (request.method !== 'POST' || !key) return handle(request, env, ctx.injectedDb ? { db: ctx.injectedDb } : {});
  try {
    return await withDb(env, ctx.injectedDb, async (db) => {
      const text = await request.text();
      const forward = new Request(request.url, { method: 'POST', headers: request.headers, body: text });
      let pre = null;
      try {
        const device = await db.collection('devices').findOne({ keyHash: await sha256Hex(key) }, { projection: { keyHash: 0 } });
        if (device && !device.disabled) {
          const modeReading = text.length < 262144 ? readingsOf(text).filter((r) => r?.sensor === 'power_mode' && typeof r.value === 'string').pop() : null;
          const prevMode = modeReading ? (await db.collection('readings').find({ deviceId: device._id, sensor: 'power_mode' }).sort({ ts: -1, _id: -1 }).limit(1).toArray())[0]?.value : undefined;
          pre = { device, modeReading, prevMode };
        }
      } catch (e) { console.error('ingest hook lookup failed', e?.name); }
      const res = await handle(forward, env, { db });
      if (res.status === 401) await recordKeyFailure(db, ctx.now);
      if (res.status !== 202 || !pre) return res;
      try {
        const now = ctx.now || new Date();
        const id = String(pre.device._id);
        const exercise = pre.device.meta?.exercise === true;
        const last = pre.device.lastSeen ? new Date(pre.device.lastSeen) : null;
        if (!last) await writeDeviceLog(db, { deviceId: id, level: 'info', code: 'seen.first', msg: 'First report received', at: now, exercise });
        else if (now.getTime() - last.getTime() > GAP_MS) await writeDeviceLog(db, { deviceId: id, level: 'warn', code: 'seen.gap', msg: `Reporting again after ${Math.round((now.getTime() - last.getTime()) / 60000)} min of silence`, at: now, exercise });
        const mode = pre.modeReading?.value;
        if (mode && mode !== pre.prevMode && !(pre.prevMode === undefined && mode === 'normal')) {
          await writeDeviceLog(db, { deviceId: id, level: mode === 'critical' ? 'error' : mode === 'saver' ? 'warn' : 'info', code: 'power.mode', msg: `Power mode ${pre.prevMode ? `changed from ${pre.prevMode} to` : 'reported as'} ${mode}`.slice(0, 120), at: now, exercise });
        }
        const out = await res.clone().json();
        const extra = { messages_pending: await pendingCount(db, id, now), poll_after_s: await pollInterval(db, id, now) };
        const headers = new Headers(res.headers);
        headers.delete('Content-Length');
        return new Response(JSON.stringify({ ...out, ...extra }), { status: res.status, headers });
      } catch (e) {
        console.error('ingest hook extras failed', e?.name);
        return res;
      }
    });
  } catch (e) {
    return fail(e);
  }
}
