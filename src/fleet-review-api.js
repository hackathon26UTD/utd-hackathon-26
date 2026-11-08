import { withDb } from './db.js';
import { HttpError, badRequest, json, readJson } from './http.js';
import { opsAuth } from './live-api.js';
import { sha256Hex } from './auth.js';
import { nvidiaConfig, nemotronCompletion } from './nemotron.js';
import { loadFleetReview } from './fleet-review-evidence.js';
import { investigateFleet, simulatedFleetCompletion } from './fleet-review-agent.js';

const RUN_LEASE_MS = 180_000;
const output = r => ({ id: r._id, state: r.state, mode: r.mode, engine: r.engine, model: r.model,
  simulated: r.engine === 'simulator', modelVerified: r.engine === 'nemotron' && r.state === 'completed',
  createdAt: r.createdAt, completedAt: r.completedAt || null, trace: r.trace || [], snapshot: r.snapshot,
  checkpoint: r.checkpoint || null, error: r.error || null });
async function recover(runs, run, now) {
  if (run?.state === 'running' && now.getTime() - new Date(run.createdAt).getTime() > RUN_LEASE_MS) {
    await runs.updateOne({ _id: run._id, state: 'running', createdAt: run.createdAt }, { $set: { state: 'failed', completedAt: now, error: 'Fleet review timed out. Start a new run with fresh evidence.' } });
    return runs.findOne({ _id: run._id });
  }
  return run;
}

export async function opsReviewQueue(ctx) {
  try {
    const url = new URL(ctx.request.url), method = ctx.request.method;
    if (!['GET', 'POST'].includes(method)) throw new HttpError(405, 'Method not allowed');
    const auth = opsAuth(ctx, url);
    if (auth.demo) throw new HttpError(403, 'A team operator account is required for fleet review.');
    const mode = auth.exercise ? 'exercise' : 'live', now = ctx.now || new Date();
    return await withDb(ctx.env || {}, ctx.injectedDb, async db => {
      const runs = db.collection('fleet_review_runs');
      if (method === 'GET') {
        if (url.searchParams.has('run_id')) {
          const run = await recover(runs, await runs.findOne({ _id: url.searchParams.get('run_id'), actor: auth.actor, mode }), now);
          if (!run) throw new HttpError(404, 'Fleet review not found');
          return json(output(run));
        }
        return json({ ...await loadFleetReview(db, { exercise: auth.exercise, now }), nvidia: nvidiaConfig(ctx.env || {}) });
      }
      const body = await readJson(ctx.request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['requestId', 'engine'].includes(k)) ||
        typeof body.requestId !== 'string' || !/^[a-z\d_-]{8,80}$/i.test(body.requestId)) throw badRequest('Supply requestId and engine only. requestId must be 8-80 letters, digits, underscores or hyphens.');
      const engine = body.engine;
      if (!['nemotron', 'simulator'].includes(engine)) throw badRequest('Choose engine nemotron or simulator explicitly.');
      if (engine === 'simulator' && !auth.exercise) throw badRequest('The simulator is available only in exercise mode.');
      const id = await sha256Hex(`fleet:${auth.actor}:${mode}:${body.requestId}`);
      const previous = await recover(runs, await runs.findOne({ _id: id, actor: auth.actor, mode }), now);
      if (previous) {
        if (previous.engine !== engine) throw new HttpError(409, 'requestId was already used with a different engine.');
        return json(output(previous), previous.state === 'running' ? 202 : 200);
      }
      if (engine === 'nemotron' && !nvidiaConfig(ctx.env || {}).configured) throw new HttpError(503, 'NVIDIA is not configured. The deterministic review queue is still available.');
      const limits = db.collection('system_agent_limits');
      await limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      const bucket = await limits.findOneAndUpdate({ _id: `${auth.actor}:${Math.floor(now.getTime() / 60000)}` }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + 120000) } }, { upsert: true, returnDocument: 'after' });
      if (bucket.count > 4) throw new HttpError(429, 'Wait a minute before another investigation.');
      const snapshot = await loadFleetReview(db, { exercise: auth.exercise, now });
      if (!snapshot.queue.length) throw new HttpError(409, 'No registered devices are available in this data mode.');
      const run = { _id: id, actor: auth.actor, mode, engine, model: engine === 'nemotron' ? nvidiaConfig(ctx.env || {}).model : null,
        createdAt: now, expiresAt: new Date(now.getTime() + 30 * 86400_000), state: 'running', trace: [], snapshot };
      await runs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      try { await runs.insertOne(run); }
      catch (e) {
        if (e.code !== 11000) throw e;
        const other = await recover(runs, await runs.findOne({ _id: id, actor: auth.actor, mode }), now);
        if (other?.engine !== engine) throw new HttpError(409, 'requestId was already used with a different engine.');
        return json(output(other), other.state === 'running' ? 202 : 200);
      }
      try {
        const result = await investigateFleet({ snapshot,
          complete: engine === 'simulator' ? simulatedFleetCompletion(snapshot) : input => nemotronCompletion(ctx.env, input, ctx.fetcher),
          recordStep: step => runs.updateOne({ _id: id, state: 'running' }, { $push: { trace: step } }),
        });
        if (engine === 'simulator') result.checkpoint.interpretationSource = 'simulator_not_ai';
        const done = { state: 'completed', checkpoint: result.checkpoint, completedAt: new Date() };
        const saved = await runs.updateOne({ _id: id, state: 'running' }, { $set: done });
        return json(output(saved.modifiedCount ? { ...run, ...done, trace: result.trace } : await runs.findOne({ _id: id, actor: auth.actor, mode })), saved.modifiedCount ? 201 : 200);
      } catch (e) {
        const error = e instanceof HttpError ? e.message : 'Fleet model review failed. The deterministic queue is still available.';
        await runs.updateOne({ _id: id, state: 'running' }, { $set: { state: 'failed', error, completedAt: new Date() } });
        return json(output(await runs.findOne({ _id: id, actor: auth.actor, mode })), e instanceof HttpError ? e.status : 503);
      }
    });
  } catch (e) {
    return json({ error: e instanceof HttpError ? e.message : 'Fleet review is unavailable.' }, e instanceof HttpError ? e.status : 503);
  }
}
