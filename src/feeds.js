import { archiveFeedSnapshot } from './data-store.js';
// Feed cache: the server fetches public hazard feeds, stores them in Mongo and serves them to the map.
// The browser never calls an upstream. Missing data stays unknown; old data is returned flagged `stale`.
import { FeedError } from './feed-error.js';
import { LAYERS, LAYER_IDS, feedMetadata } from './feed-layers.js';
import { bboxIntersects, cellsFor, geometryBbox, tilesFor } from './feed-geo.js';
import { loadActiveZones } from './zones.js';

export { FeedError, LAYERS, LAYER_IDS, loadActiveZones };

const UA = 'HomeBeaconHackUTD/1.0 (https://github.com/hackathon26UTD)';
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_FEATURES = 5000;
const MAX_UPSTREAM_BYTES = 8 * 1024 * 1024;
const DEFAULT_CONTEXT_LAYERS = ['zones', 'nfhl', 'nws', 'declarations', 'weather'];

// ---------- indexes ----------
const indexed = new WeakSet();
export async function ensureFeedIndexes(db) {
  if (indexed.has(db)) return;
  await Promise.all([
    db.collection('overlay_zones').createIndex({ geometry: '2dsphere' }),
    db.collection('overlay_zones').createIndex({ active: 1, type: 1 }),
    db.collection('feed_cache').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('feed_cache').createIndex({ layer: 1, tileKey: 1 }),
  ]);
  indexed.add(db);
}

// ---------- upstream ----------
// Errors from here never include the request URL, because some URLs carry a server-side key.
export function makeGet(fetcher = fetch) {
  return async (url, { as = 'json', headers = {} } = {}) => {
    let res;
    try {
      res = await fetcher(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json,application/json,text/csv', ...headers }, signal: AbortSignal.timeout(9000) });
    } catch (err) {
      throw new FeedError(502, err?.name === 'TimeoutError' ? 'The source took too long to answer.' : 'The source could not be reached.');
    }
    if (!res.ok) throw new FeedError(502, `The source answered with an error (${res.status}).`);
    const body = await res.text();
    if (body.length > MAX_UPSTREAM_BYTES) throw new FeedError(502, 'The source sent more data than we accept.');
    if (as === 'text') return body;
    let json;
    try { json = JSON.parse(body); } catch { throw new FeedError(502, 'The source sent unreadable data.'); }
    if (json && !Array.isArray(json) && json.error) throw new FeedError(502, 'The source reported an error.');
    return json;
  };
}

// ---------- planning and cache documents ----------
// `read` is cache-only: no span limit, and a larger look-up cap because reading by id is cheap.
function plan(layer, env, bbox, cells, read = false) {
  const cap = read ? (layer.scope === 'cell' ? 200 : 64) : layer.maxTiles;
  if (layer.scope === 'all') return { tiles: [{ key: layer.scopeKey?.(env) ?? 'all', bbox: null }], clipped: false };
  if (layer.scope === 'cell' && cells?.length) {
    const keys = [...new Set(cells.filter((c) => /^[0-9b-hjkmnp-z]{5}$/.test(c)))].slice(0, cap);
    return { tiles: keys.map((c) => ({ key: `gh5:${c}`, bbox: null })), clipped: cells.length > keys.length };
  }
  if (!bbox) throw new FeedError(400, 'Provide bbox as west,south,east,north.', { layer: layer.id });
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  if (!read && layer.maxSpan && span > layer.maxSpan) throw new FeedError(400, 'Zoom in to load this layer.', { layer: layer.id, minZoom: layer.minZoom || null, maxSpanDeg: layer.maxSpan });
  if (layer.scope === 'cell') {
    const keys = cellsFor(bbox, 5, cap);
    return { tiles: keys.map((c) => ({ key: `gh5:${c}`, bbox: null })), clipped: false };
  }
  const all = tilesFor(bbox);
  return { tiles: all.slice(0, cap), clipped: all.length > cap };
}

const docId = (layer, key) => `${layer.id}:${key}`;
const failureId = (layer, env) => `meta:${layer.id}:${layer.scope === 'all' ? layer.scopeKey?.(env) ?? 'all' : 'tiles'}`;

function capFeatures(features) {
  let bytes = 0;
  const kept = [];
  for (const f of features) {
    bytes += JSON.stringify(f).length + 1;
    if (bytes > MAX_DOC_BYTES) return { features: kept, truncated: true };
    kept.push(f);
  }
  return { features: kept, truncated: false };
}

function buildDoc(layer, key, result, now) {
  const live = layer.postFilter ? layer.postFilter(result.features || [], now) : result.features || [];
  const capped = capFeatures(live);
  const fetchedAt = now;
  return {
    _id: docId(layer, key), layer: layer.id, tileKey: key, status: 'ok',
    data: { features: capped.features, extra: result.extra || null },
    count: capped.features.length, truncated: capped.truncated || Boolean(result.truncated),
    fetchedAt, freshUntil: new Date(now.getTime() + layer.ttlS * 1000),
    // The database purges at expiresAt. Stale data stays available much longer than it stays fresh.
    expiresAt: new Date(now.getTime() + Math.min(Math.max(layer.ttlS * 10, 6 * 3600), 7 * 86400) * 1000),
  };
}

function safeReason(err) {
  return err instanceof FeedError ? err.message : 'The source data could not be read.';
}

async function recordFailure(db, layer, env, err, now) {
  await db.collection('feed_cache').replaceOne(
    { _id: failureId(layer, env) },
    { _id: failureId(layer, env), layer: layer.id, tileKey: 'meta', status: 'error', failedAt: now, lastError: safeReason(err), expiresAt: new Date(now.getTime() + 86400000) },
    { upsert: true },
  );
}

const needsKey = (layer, env) => Boolean(layer.keyEnv && !env?.[layer.keyEnv]);

// ---------- assembling a response ----------
function dedupeKey(f) {
  return f.id ?? f.properties?.OBJECTID ?? JSON.stringify([f.properties, geometryBbox(f.geometry)]);
}

function assemble(layer, docs, { bbox, now, env = {}, missing = 0, clipped = false }) {
  const seen = new Set();
  let features = [];
  const extra = {};
  for (const d of docs) {
    Object.assign(extra, d.data?.extra || {});
    for (const f of d.data?.features || []) {
      const key = dedupeKey(f);
      if (seen.has(key)) continue;
      seen.add(key);
      if (bbox && f.geometry) {
        const box = geometryBbox(f.geometry);
        if (box && !bboxIntersects(box, bbox)) continue;
      }
      features.push(f);
    }
  }
  if (layer.postFilter) features = layer.postFilter(features, now);
  const overCap = features.length > MAX_OUTPUT_FEATURES;
  if (overCap) features = features.slice(0, MAX_OUTPUT_FEATURES);
  const oldest = docs.reduce((a, d) => (!a || d.fetchedAt < a ? d.fetchedAt : a), null);
  return {
    type: 'FeatureCollection',
    features,
    ...(Object.keys(extra).length ? { extra } : {}),
    hb: {
      source: layer.name, attribution: layer.attribution,
      ...feedMetadata(layer, env),
      fetchedAt: oldest ? oldest.toISOString() : null,
      ageS: oldest ? Math.max(0, Math.round((now - oldest) / 1000)) : null,
      stale: docs.some((d) => d.freshUntil <= now),
      truncated: overCap || clipped || missing > 0 || docs.some((d) => d.truncated),
      tiles: docs.length, missingTiles: missing,
    },
  };
}

async function readDocs(db, layer, tiles) {
  return db.collection('feed_cache').find({ _id: { $in: tiles.map((t) => docId(layer, t.key)) } }).toArray();
}

// ---------- public API ----------
// Fetch only what is missing or expired, keep the last good copy when the source fails.
export async function refreshLayer(db, env, layerId, bbox, { fetcher, now = new Date(), force = false, cells } = {}) {
  const layer = LAYERS[layerId];
  if (!layer) throw new FeedError(400, 'Unknown layer.', { layer: layerId });
  if (needsKey(layer, env)) throw new FeedError(503, 'This feed needs a server key that is not set yet.', { layer: layerId, status: 'needs_key' });
  await ensureFeedIndexes(db);
  const { tiles, clipped } = plan(layer, env, bbox, cells);
  const have = new Map((await readDocs(db, layer, tiles)).map((d) => [d._id, d]));
  const due = tiles.filter((t) => force || !have.get(docId(layer, t.key)) || have.get(docId(layer, t.key)).freshUntil <= now);
  let failure = null, refreshed = 0;
  if (due.length) {
    let results;
    try {
      results = await layer.fetchMany(due, { env, get: makeGet(fetcher), now });
    } catch (err) {
      results = new Map(due.map((t) => [t.key, err]));
    }
    for (const t of due) {
      const r = results.get(t.key);
      if (r instanceof Error || !r) { failure = r || new FeedError(502, 'The source returned nothing.'); continue; }
      const doc = buildDoc(layer, t.key, r, now);
      await db.collection('feed_cache').replaceOne({ _id: doc._id }, doc, { upsert: true });
      await archiveFeedSnapshot(db, doc);
      have.set(doc._id, doc);
      refreshed++;
    }
    if (failure) await recordFailure(db, layer, env, failure, now);
    else await db.collection('feed_cache').deleteOne({ _id: failureId(layer, env) });
  }
  const docs = tiles.map((t) => have.get(docId(layer, t.key))).filter(Boolean);
  if (!docs.length) throw new FeedError(503, 'This feed is not available right now.', { layer: layerId, reason: failure ? safeReason(failure) : undefined });
  const result = assemble(layer, docs, { bbox, now, env, missing: tiles.length - docs.length, clipped });
  result.hb.delivery = refreshed ? 'refreshed' : 'cached';
  result.hb.refreshStatus = failure ? 'error' : due.length ? 'ok' : 'not_requested';
  if (failure) result.hb.lastError = safeReason(failure);
  return result;
}

// Cache only, never touches the network. Safe for the risk engine to call on every cycle.
export async function readLayer(db, env, layerId, bbox, { now = new Date(), cells } = {}) {
  const layer = LAYERS[layerId];
  const { tiles, clipped } = plan(layer, env || {}, bbox, cells, true);
  const [docs, meta] = await Promise.all([
    readDocs(db, layer, tiles),
    Promise.resolve().then(() => db.collection('feed_cache').findOne({ _id: failureId(layer, env || {}) })),
  ]);
  return { layer, docs, meta, collection: assemble(layer, docs, { bbox, now, env, missing: tiles.length - docs.length, clipped }) };
}

const statusOf = (collection, docs) => (!docs.length ? 'unverified' : collection.hb.stale ? 'stale' : 'ok');
const dataState = (docs, stale) => !docs.length ? 'unavailable' : stale ? 'stale_cache' : 'cached';
const errorMeta = (meta, docs) => {
  const newest = docs.reduce((at, doc) => !at || doc.fetchedAt > at ? doc.fetchedAt : at, null);
  return meta && (!newest || meta.failedAt >= newest) ? { lastError: meta.lastError, lastErrorAt: meta.failedAt.toISOString() } : {};
};

/**
 * OverlayContext for the risk engine: { zones[], nfhl[], nws[], declarations[], weather:{[gh5]:{...}}, status }.
 * Each list holds GeoJSON features. Weather is keyed by the bare five character geohash, e.g. "9vgm0".
 * Never throws: a layer that cannot be read is empty and its status says `error`.
 */
export async function readCachedOverlays(db, { bbox, layers = DEFAULT_CONTEXT_LAYERS, now = new Date(), exercise = false, env = {}, cells } = {}) {
  const ctx = { zones: [], nfhl: [], nws: [], declarations: [], weather: {}, status: {} };
  await Promise.all(layers.map(async (id) => {
    try {
      if (id === 'zones') {
        ctx.zones = await loadActiveZones(db, { bbox, exercise, now });
        ctx.status.zones = { status: 'ok', fetchedAt: now.toISOString(), ageS: 0, stale: false, truncated: false };
        return;
      }
      if (!LAYERS[id]) return;
      const wide = !bbox && LAYERS[id].scope !== 'all' && !(LAYERS[id].scope === 'cell' && cells?.length);
      if (wide) { ctx.status[id] = { status: needsKey(LAYERS[id], env) ? 'needs_key' : 'unverified', fetchedAt: null, ageS: null, stale: false, truncated: false, dataState: 'unavailable', ...feedMetadata(LAYERS[id], env) }; return; }
      const { layer, docs, meta, collection } = await readLayer(db, env, id, bbox, { now, cells });
      const keyMissing = needsKey(layer, env);
      const failure = errorMeta(meta, docs);
      ctx.status[id] = { status: keyMissing ? 'needs_key' : !docs.length && meta ? 'error' : statusOf(collection, docs), fetchedAt: collection.hb.fetchedAt, ageS: collection.hb.ageS, stale: collection.hb.stale, truncated: collection.hb.truncated,
        dataState: dataState(docs, collection.hb.stale), ...feedMetadata(layer, env), ...failure };
      if (id === 'weather') {
        for (const f of collection.features) if (f.properties?.gh5) ctx.weather[f.properties.gh5] = { precip24h_mm: f.properties.precip24h_mm, peak_mmph: f.properties.peak_mmph, level: f.properties.level };
      } else if (id === 'eia') ctx.eia = { metric: 'electricity_demand', outageData: false, series: collection.extra?.series || [], note: layer.note };
      else ctx[id] = collection.features;
    } catch {
      ctx.status[id] = { status: 'error', fetchedAt: null, ageS: null, stale: false, truncated: false, dataState: 'unavailable', ...(LAYERS[id] ? feedMetadata(LAYERS[id], env) : {}) };
    }
  }));
  return ctx;
}

// Network warm-up for the context layers, then a cache read. Used by the risk loader or a scheduled call.
// `cells` lets the caller ask for rain at exact geohash5 cells (for example where devices are).
export async function refreshContext(db, env, { bbox, layers = DEFAULT_CONTEXT_LAYERS, cells, now = new Date(), fetcher, exercise = false } = {}) {
  await Promise.all(layers.filter((id) => LAYERS[id]).map((id) => refreshLayer(db, env, id, bbox, { fetcher, now, cells }).catch(() => null)));
  return readCachedOverlays(db, { bbox, layers, now, exercise, env, cells });
}

/** One row per source for GET /api/feeds. Reads cache metadata only. */
export async function getFeedStatus(db, { env = {}, now = new Date(), exercise = false, includeZones = true } = {}) {
  const rows = await db.collection('feed_cache').find({}, { projection: { data: 0 } }).toArray();
  const sources = LAYER_IDS.map((id) => {
    const layer = LAYERS[id];
    const scopeKey = layer.scope === 'all' ? layer.scopeKey?.(env) ?? 'all' : null;
    const mine = rows.filter((r) => r.layer === id && r.tileKey !== 'meta' && (!scopeKey || r.tileKey === scopeKey));
    const meta = rows.find((r) => r._id === failureId(layer, env));
    const oldest = mine.reduce((a, d) => (!a || d.fetchedAt < a ? d.fetchedAt : a), null);
    let status;
    if (needsKey(layer, env)) status = 'needs_key';
    else if (!mine.length) status = meta ? 'error' : 'unverified';
    else status = mine.some((d) => d.freshUntil <= now) ? 'stale' : 'ok';
    return {
      id, name: layer.name, status, ...feedMetadata(layer, env),
      dataState: dataState(mine, mine.some(d => d.freshUntil <= now)),
      fetchedAt: oldest ? oldest.toISOString() : null,
      ageS: oldest ? Math.max(0, Math.round((now - oldest) / 1000)) : null,
      ttlS: layer.ttlS, featureCount: mine.reduce((a, d) => a + (d.count || 0), 0), attribution: layer.attribution,
      ...(layer.keyEnv ? { keyName: layer.keyEnv } : {}),
      ...(layer.minZoom ? { minZoom: layer.minZoom } : {}),
      ...errorMeta(meta, mine),
    };
  });
  if (!includeZones) return sources;
  const zones = await db.collection('overlay_zones').countDocuments({ active: true, ...(exercise ? { exercise: true } : { exercise: { $ne: true } }) });
  sources.push({ id: 'zones', name: 'Operator zones', status: 'ok', fetchedAt: now.toISOString(), ageS: 0, ttlS: 0, featureCount: zones, attribution: 'Drawn by this team' });
  return sources;
}
