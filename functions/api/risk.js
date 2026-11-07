import { withDb } from '../../src/db.js';
import { isAdmin } from '../../src/auth.js';
import { json, HttpError } from '../../src/http.js';
import { loadRisk } from '../../src/risk/load.js';
import { parseBbox } from '../../src/risk/geo.js';

// GET /api/risk?level=devices|regions&bbox=w,s,e,n&precision=5&device_id=&limit=&mode=exercise
// Operator or demo (demo sees exercise data only). Advisory output for human review.
const fail = (status, error) => json({ error }, status);

export async function onRequestGet(context) {
  const { request, env, data } = context;
  const demo = data?.operator?.role === 'demo';
  if (!data?.operator && !isAdmin(request, env)) return fail(401, 'Sign in to view this data.');
  const url = new URL(request.url), q = url.searchParams;

  const level = q.get('level') || 'devices';
  if (!['devices', 'regions'].includes(level)) return fail(400, 'level must be devices or regions.');
  const bbox = parseBbox(q.get('bbox'));
  if (q.get('bbox') && !bbox) return fail(400, 'bbox must be west,south,east,north in degrees.');
  const precision = q.get('precision') === null ? 5 : Number(q.get('precision'));
  if (![4, 5, 6].includes(precision)) return fail(400, 'precision must be 4, 5 or 6.');
  const deviceId = q.get('device_id');
  if (deviceId !== null && !/^[0-9a-f]{24}$/i.test(deviceId)) return fail(400, 'device_id must be a 24 character id.');
  const rawLimit = q.get('limit') === null ? 200 : Number(q.get('limit'));
  if (!Number.isInteger(rawLimit) || rawLimit < 1) return fail(400, 'limit must be a positive whole number.');
  const limit = Math.min(rawLimit, 500);
  const exercise = demo || q.get('mode') === 'exercise';

  try {
    return await withDb(env, context.db ?? null, async (db) => {
      const r = await loadRisk(db, { bbox, precision, exercise, deviceIds: deviceId ? [deviceId] : undefined, limit: deviceId ? 1 : 500, env, readOnly: demo }, context.deps);
      if (deviceId && !r.assessments.length) return fail(404, 'Box not found.');
      const body = { asOf: r.asOf, mode: r.mode, followUps: r.followUps, sources: r.sources, limited: r.limited };
      if (level === 'regions') body.regions = r.regions.slice(0, limit);
      else { body.assessments = r.assessments.sort((a, b) => b.priority.score - a.priority.score).slice(0, limit); body.truncated = r.assessments.length > limit; }
      return json(body);
    });
  } catch (e) {
    if (e instanceof HttpError && e.status !== 503) return fail(e.status, e.message);
    return fail(503, 'Risk data is temporarily unavailable.');
  }
}
