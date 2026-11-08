import { withDb } from './db.js';
import { HttpError, badRequest, json, readJson } from './http.js';
import { opsAuth } from './live-api.js';
import { sha256Hex } from './auth.js';
import { loadSystemEvidence, correlateSignals } from './system-evidence.js';
import { powerBudget } from '../domain/system-policy.js';
import { nvidiaConfig, nemotronCompletion } from './nemotron.js';
import { investigateSystem } from './system-agent.js';
import { simulatedCompletion } from './system-simulator.js';
import { loadDeviceModelContext } from './model-context.js';

const wrap = fn => async ctx => {
  try { return await fn(ctx, new URL(ctx.request.url)); }
  catch (e) { return json({ error: e instanceof HttpError ? e.message : 'System investigation is unavailable.' }, e instanceof HttpError ? e.status : 503); }
};
const dbOf = (ctx, fn) => withDb(ctx.env || {}, ctx.injectedDb, fn);
const noDemo = auth => { if (auth.demo) throw new HttpError(403, 'A team operator account is required for system investigation.'); };
const method = (ctx, allowed) => { if (!allowed.includes(ctx.request.method)) throw new HttpError(405, 'Method not allowed'); };
const RUN_LEASE_MS = 180_000; // 55s inference deadline plus database/request overhead.
async function recoverRun(runs, run, now = new Date()) {
  if (run?.state === 'running' && now.getTime() - new Date(run.createdAt).getTime() > RUN_LEASE_MS) {
    await runs.updateOne({ _id: run._id, state: 'running', createdAt: run.createdAt }, { $set: {
      state: 'failed', completedAt: now,
      error: 'This investigation did not finish within its time limit. Start a new run with fresh evidence.',
    } });
    return runs.findOne({ _id: run._id });
  }
  return run;
}
// Return only cited, allowlisted snapshot fields. Never expose the stored run/actor or raw device documents.
const citedEvidence = r => {
  const wanted = new Set(r.checkpoint?.evidenceIds || []);
  const pick = (row, kind, fields) => ({ id: row.id, kind, ...Object.fromEntries(fields.filter(k => row[k] !== undefined).map(k => [k, row[k]])) });
  return [
    ...(r.evidence?.observations || []).filter(x => wanted.has(x.id)).map(x => pick(x, 'reading', ['deviceId', 'sensor', 'value', 'observedAt', 'receivedAt', 'stale', 'delayed'])),
    ...(r.evidence?.events || []).filter(x => wanted.has(x.id)).map(x => pick(x, 'event', ['deviceId', 'type', 'observedAt', 'receivedAt'])),
    ...(r.evidence?.incidents || []).filter(x => wanted.has(x.id)).map(x => pick(x, 'incident', ['deviceId', 'type', 'severity', 'status', 'detectedAt', 'lastObservedAt'])),
    ...(r.externalContext?.sources || []).flatMap(source => (source.records || []).filter(x => wanted.has(x.id)).map(x => ({
      id: x.id, kind: 'context', sourceId: source.id, fetchedAt: source.fetchedAt, stale: source.stale,
    }))),
  ];
};
const runOut = r => ({ id: r._id, state: r.state, mode: r.mode, deviceId: r.deviceId, model: r.model,
  engine: r.engine, simulated: r.engine === 'simulator',
  createdAt: r.createdAt, completedAt: r.completedAt || null, trace: r.trace || [], checkpoint: r.checkpoint || null,
  citedEvidence: citedEvidence(r),
  error: r.error || null, modelVerified: r.state === 'completed' && r.engine === 'nemotron' });

export const opsSystem = wrap(async (ctx, url) => {
  method(ctx, ['GET']);
  const auth = opsAuth(ctx, url); noDemo(auth);
  return dbOf(ctx, async db => {
    const evidence = await loadSystemEvidence(db, { deviceId: url.searchParams.get('device_id'), exercise: auth.exercise, now: ctx.now });
    return json({ ...evidence, correlations: correlateSignals(evidence), battery: powerBudget(evidence.policies), nvidia: nvidiaConfig(ctx.env || {}) });
  });
});

export const opsAgent = wrap(async (ctx, url) => {
  method(ctx, ['GET', 'POST']);
  const auth = opsAuth(ctx, url); noDemo(auth);
  if (ctx.request.method === 'GET' && !url.searchParams.has('run_id')) return json({ ...nvidiaConfig(ctx.env || {}), workflow: ['read_sensor_timeline', 'correlate_signals', 'plan_power_budget', 'save_review_checkpoint'] });
  return dbOf(ctx, async db => {
    const runs = db.collection('system_agent_runs');
    if (ctx.request.method === 'GET') {
      const r = await recoverRun(runs, await runs.findOne({ _id: url.searchParams.get('run_id'), actor: auth.actor, mode: auth.exercise ? 'exercise' : 'live' }), ctx.now);
      if (!r) throw new HttpError(404, 'Investigation not found');
      return json(runOut(r));
    }
    const body = await readJson(ctx.request);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.requestId !== 'string' || !/^[a-z\d_-]{8,80}$/i.test(body.requestId)) throw badRequest('requestId must be 8-80 letters, digits, underscores or hyphens');
    const goalHours = body.goalHours ?? 24;
    const engine = body.engine ?? 'nemotron';
    if (!['nemotron', 'simulator'].includes(engine)) throw badRequest('engine must be nemotron or simulator');
    if (engine === 'simulator' && !auth.exercise) throw badRequest('The simulator is allowed only with mode=exercise');
    try { powerBudget([], body.budget, goalHours); } catch (e) { throw badRequest(e.message); }
    // Only the explicit budget schema is forwarded; never free text or provider credentials.
    let budget;
    if (body.budget !== undefined) {
      const b = body.budget;
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw badRequest('budget must be an object');
      budget = { deviceId: body.deviceId, remainingWh: b.remainingWh, basis: b.basis, reserveFraction: b.reserveFraction ?? 0.15,
        loadsWatts: { normal: b.loadsWatts?.normal, saver: b.loadsWatts?.saver, critical: b.loadsWatts?.critical } };
      if (powerBudget([], budget, goalHours).basis === 'unknown') throw badRequest('Supply positive remainingWh, all three loadsWatts and an assumption or bench_measurement basis');
    }
    const now = ctx.now || new Date(), mode = auth.exercise ? 'exercise' : 'live';
    const id = await sha256Hex(`${auth.actor}:${mode}:${body.requestId}`);
    const fingerprint = await sha256Hex(JSON.stringify({ deviceId: body.deviceId, goalHours, budget, engine }));
    const previous = await recoverRun(runs, await runs.findOne({ _id: id }), now);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'requestId was used with different inputs');
      return json(runOut(previous), previous.state === 'running' ? 202 : 200);
    }
    if (engine === 'nemotron' && !nvidiaConfig(ctx.env || {}).configured) throw new HttpError(503, 'NVIDIA is not configured. Add NVIDIA_API_KEY to the server secret store.');
    const evidence = await loadSystemEvidence(db, { deviceId: body.deviceId, exercise: auth.exercise, now });
    if (!evidence.observations.length && !evidence.incidents.length && !evidence.events.length) throw new HttpError(409, 'No evidence is available for this device yet.');
    const buckets = db.collection('system_agent_limits');
    await buckets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    const bucket = await buckets.findOneAndUpdate({ _id: `${auth.actor}:${Math.floor(now.getTime() / 60000)}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + 120_000) } }, { upsert: true, returnDocument: 'after' });
    if (bucket.count > 4) throw new HttpError(429, 'Wait a minute before another investigation.');
    const externalContext = await loadDeviceModelContext(db, evidence, { env: ctx.env || {}, now });
    const run = { _id: id, actor: auth.actor, fingerprint, deviceId: body.deviceId, mode, state: 'running',
      engine, model: engine === 'nemotron' ? nvidiaConfig(ctx.env || {}).model : null, createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 86400_000), trace: [], evidence, externalContext };
    await runs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    try { await runs.insertOne(run); }
    catch (e) {
      if (e.code !== 11000) throw e;
      const current = await recoverRun(runs, await runs.findOne({ _id: id }), now);
      if (current.fingerprint !== fingerprint) throw new HttpError(409, 'requestId was used with different inputs');
      return json(runOut(current), current.state === 'running' ? 202 : 200);
    }
    try {
      const result = await investigateSystem({ evidence, budget, goalHours, externalContext,
        interpretationSource: engine === 'simulator' ? 'simulator_not_ai' : 'model_unverified',
        complete: engine === 'simulator' ? simulatedCompletion(evidence) : input => nemotronCompletion(ctx.env, input, ctx.fetcher),
        recordStep: step => runs.updateOne({ _id: id, state: 'running' }, { $push: { trace: step } }),
      });
      if (engine === 'simulator') result.checkpoint.interpretationSource = 'simulator_not_ai';
      const done = { state: 'completed', checkpoint: result.checkpoint, completedAt: new Date() };
      const saved = await runs.updateOne({ _id: id, state: 'running' }, { $set: done });
      if (!saved.modifiedCount) return json(runOut(await runs.findOne({ _id: id })), 200);
      return json(runOut({ ...run, ...done, trace: result.trace }), 201);
    } catch (e) {
      const error = e instanceof HttpError ? e.message : 'Investigation failed; deterministic policies remain available.';
      await runs.updateOne({ _id: id, state: 'running' }, { $set: { state: 'failed', error, completedAt: new Date() } });
      // The caller can recover this actor-scoped run and inspect completed steps, even after a provider failure.
      return json(runOut(await runs.findOne({ _id: id })), e instanceof HttpError ? e.status : 503);
    }
  });
});
