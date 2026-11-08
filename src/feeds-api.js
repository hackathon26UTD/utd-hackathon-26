// HTTP handlers for /api/overlays and /api/feeds. The Pages Function files are thin wrappers so tests can
// call these directly with an injected database and a stub fetcher.
import { HttpError, json, readJson } from './http.js';
import { withDb } from './db.js';
import { FeedError } from './feed-error.js';
import { parseBbox } from './feed-geo.js';
import { LAYERS, LAYER_IDS, ensureFeedIndexes, getFeedStatus, refreshLayer } from './feeds.js';
import { createZone, listZones, retireZone, updateZone } from './zones.js';

const truthy = (v) => v === '1' || v === 'true';

function failure(err) {
  if (err instanceof HttpError) {
    const res = json({ error: err.message, ...(err.extra || {}) }, err.status);
    if (err.status === 429) res.headers.set('Retry-After', String(err.extra?.retryAfterS || 60));
    return res;
  }
  const dbDown = /Mongo|ECONNREFUSED|ETIMEDOUT|Server selection/i.test(`${err?.name} ${err?.message}`);
  return json({ error: dbDown ? 'Database unavailable' : 'Internal error' }, dbDown ? 503 : 500);
}

// Middleware has already required an operator, demo or admin key. This only decides what each may do.
function who(operator) {
  const role = operator?.role || 'operator';
  if (!['operator', 'demo'].includes(role)) throw new HttpError(403, 'Operator access is required.');
  return { role, demo: role === 'demo', actor: operator?.email || 'admin-key' };
}

export async function handleOverlays(request, env, { db, fetcher, now = new Date(), operator } = {}) {
  try {
    const me = who(operator);
    const url = new URL(request.url);
    const layer = url.searchParams.get('layer');
    const method = request.method;
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new HttpError(405, 'Method not allowed.');
    return await withDb(env, db, async (conn) => {
      await ensureFeedIndexes(conn);
      if (method === 'GET' && !layer) return json({ layers: ['zones', ...LAYER_IDS] });
      if (layer === 'zones') return await zoneRoute(conn, request, url, me, now);
      if (!LAYERS[layer]) throw new HttpError(400, 'Unknown layer.');
      if (method !== 'GET') throw new HttpError(405, 'This layer is read only.');
      const def = LAYERS[layer];
      const bbox = parseBbox(url.searchParams.get('bbox'), { required: def.scope !== 'all' });
      return json(await refreshLayer(conn, env, layer, bbox, { fetcher, now }));
    });
  } catch (err) {
    return failure(err);
  }
}

async function zoneRoute(db, request, url, me, now) {
  const method = request.method;
  const p = url.searchParams;
  if (method === 'GET') {
    const exercise = me.demo || truthy(p.get('exercise'));
    const bbox = parseBbox(p.get('bbox'), { required: false });
    const { features, truncated } = await listZones(db, { bbox, type: p.get('type') || undefined, exercise, includeInactive: !me.demo && truthy(p.get('inactive')), now, hideOperator: me.demo });
    return json({ type: 'FeatureCollection', features, hb: { source: 'Operator zones', fetchedAt: now.toISOString(), ageS: 0, stale: false, truncated } });
  }
  if (me.demo) throw new HttpError(403, 'Demo accounts can view exercise data only.');
  if (method === 'POST') {
    const body = await readJson(request);
    const zone = await createZone(db, body, { actor: me.actor, exercise: body.exercise === true || truthy(p.get('exercise')), now });
    return json({ zone }, 201);
  }
  const id = p.get('id');
  if (!id) throw new HttpError(400, 'Provide the zone id as ?id=.');
  const body = await readJson(request);
  if (method === 'PATCH') return json({ zone: await updateZone(db, id, body, { actor: me.actor, now }) });
  const version = body.version ?? (p.get('version') ? Number(p.get('version')) : undefined);
  return json({ zone: await retireZone(db, id, { actor: me.actor, version, now }) });
}

export async function handleFeeds(request, env, { db, fetcher, now = new Date(), operator } = {}) {
  try {
    const me = who(operator);
    if (!['GET', 'POST'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
    return await withDb(env, db, async (conn) => {
      await ensureFeedIndexes(conn);
      if (request.method === 'GET') return json({ asOf: now.toISOString(), sources: await getFeedStatus(conn, { env, now, exercise: me.demo }) });
      if (me.demo) throw new HttpError(403, 'Demo accounts can view exercise data only.');
      const body = await readJson(request);
      const def = LAYERS[body.layer];
      if (!def) throw new HttpError(400, 'Unknown layer.');
      const bbox = parseBbox(body.bbox, { required: def.scope !== 'all' });
      const out = await refreshLayer(conn, env, body.layer, bbox, { fetcher, now, force: body.force === true });
      return json({ layer: body.layer, featureCount: out.features.length, hb: out.hb });
    });
  } catch (err) {
    return failure(err);
  }
}

export { FeedError };
