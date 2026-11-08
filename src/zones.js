// Operator-drawn overlay zones: validation, storage and audit. Zones are map context only.
// They never say anything about who is inside, whether entry is safe, or damage.
import { ObjectId } from 'mongodb';
import { HttpError } from './http.js';
import { writeAudit } from './live.js';
import { FeedError } from './feed-error.js';
import { bboxCenter, countPositions, geohashEncode, geometryBbox } from './feed-geo.js';

export const ZONE_TYPES = ['evacuation', 'closure', 'damage_survey', 'staging', 'shelter', 'custom'];
export const MAX_VERTICES = 200;
const MAX_ACTIVE_ZONES = 500;
const WRITES_PER_MINUTE = 60;

const bad = (message) => new HttpError(400, message);
const noControl = /[\u0000-\u001f\u007f]/g;

export function cleanText(value, max, label, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${label} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw bad(`${label} must be text.`);
  const out = value.replace(noControl, ' ').trim();
  if (required && !out) throw bad(`${label} is required.`);
  if (out.length > max) throw bad(`${label} can be at most ${max} characters.`);
  return out;
}

// ---------- geometry validation ----------
function position(p) {
  if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) throw bad('Each point must be [longitude, latitude].');
  if (p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90) throw bad('A point is outside valid longitude or latitude.');
  return [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSeg = (a, b, p) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
function segmentsTouch(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSeg(c, d, a)) || (d2 === 0 && onSeg(c, d, b)) || (d3 === 0 && onSeg(a, b, c)) || (d4 === 0 && onSeg(a, b, d));
}

function ring(r) {
  if (!Array.isArray(r) || r.length < 4) throw bad('A polygon ring needs at least four points.');
  const pts = r.map(position);
  const [first, last] = [pts[0], pts[pts.length - 1]];
  if (first[0] !== last[0] || first[1] !== last[1]) throw bad('A polygon ring must end where it starts.');
  for (let i = 1; i < pts.length; i++) if (pts[i][0] === pts[i - 1][0] && pts[i][1] === pts[i - 1][1]) throw bad('A polygon has repeated points.');
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsTouch(pts[i], pts[i + 1], pts[j], pts[j + 1])) throw bad('A polygon edge crosses itself.');
    }
  }
  return pts;
}

function insideRing(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const edgesTouch = (a, b) => a.slice(0, -1).some((p, i) => b.slice(0, -1).some((q, j) => segmentsTouch(p, a[i + 1], q, b[j + 1])));

function polygon(rings) {
  if (!Array.isArray(rings) || !rings.length) throw bad('A polygon needs at least one ring.');
  const clean = rings.map(ring);
  for (const hole of clean.slice(1)) {
    if (!hole.every((p) => insideRing(p, clean[0])) || edgesTouch(hole, clean[0])) throw bad('A hole must sit fully inside its polygon.');
  }
  for (let i = 1; i < clean.length; i++) for (let j = i + 1; j < clean.length; j++) if (edgesTouch(clean[i], clean[j])) throw bad('Polygon holes overlap.');
  return clean;
}

export function validateGeometry(g) {
  if (!g || typeof g !== 'object' || typeof g.type !== 'string') throw bad('Draw a point or a polygon for this zone.');
  let out;
  if (g.type === 'Point') out = { type: 'Point', coordinates: position(g.coordinates) };
  else if (g.type === 'Polygon') out = { type: 'Polygon', coordinates: polygon(g.coordinates) };
  else if (g.type === 'MultiPolygon') {
    if (!Array.isArray(g.coordinates) || !g.coordinates.length || g.coordinates.length > 20) throw bad('A multi polygon needs between 1 and 20 polygons.');
    const parts = g.coordinates.map(polygon);
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (edgesTouch(parts[i][0], parts[j][0])) throw bad('Polygons in a multi polygon must not overlap or touch.');
    out = { type: 'MultiPolygon', coordinates: parts };
  } else throw bad('Zones can be a point, polygon or multi polygon.');
  if (countPositions(out) > MAX_VERTICES) throw bad(`A zone can have at most ${MAX_VERTICES} points.`);
  return out;
}

// ---------- fields ----------
function parseTime(value, label) {
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(d.getTime())) throw bad(`${label} must be an ISO time or null.`);
  return d;
}

export function validateZoneInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Send a JSON object.');
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('type')) {
    if (!ZONE_TYPES.includes(body.type)) throw bad(`type must be one of ${ZONE_TYPES.join(', ')}.`);
    out.type = body.type;
  }
  if (!partial || has('name')) out.name = cleanText(body.name, 80, 'name', { required: true });
  if (!partial || has('note')) out.note = cleanText(body.note, 300, 'note');
  if (!partial || has('geometry')) out.geometry = validateGeometry(body.geometry);
  if (has('active')) {
    if (typeof body.active !== 'boolean') throw bad('active must be true or false.');
    out.active = body.active;
  } else if (!partial) out.active = true;
  if (!partial || has('startsAt')) out.startsAt = parseTime(body.startsAt ?? null, 'startsAt');
  if (!partial || has('endsAt')) out.endsAt = parseTime(body.endsAt ?? null, 'endsAt');
  return out;
}

const isoOrNull = (d) => (d ? new Date(d).toISOString() : null);

export function zoneFeature(doc, { hideOperator = false } = {}) {
  return {
    type: 'Feature',
    id: String(doc._id),
    geometry: doc.geometry,
    properties: {
      id: String(doc._id), type: doc.type, name: doc.name, note: doc.note || '', active: doc.active !== false,
      startsAt: isoOrNull(doc.startsAt), endsAt: isoOrNull(doc.endsAt),
      ...(hideOperator ? {} : { createdBy: doc.createdBy }),
      createdAt: isoOrNull(doc.createdAt), updatedAt: isoOrNull(doc.updatedAt), version: doc.version, exercise: doc.exercise === true,
    },
  };
}

// ---------- queries ----------
const exerciseFilter = (exercise) => (exercise ? { exercise: true } : { exercise: { $ne: true } });

function bboxFilter(bbox) {
  if (!bbox || bbox[2] - bbox[0] >= 170 || bbox[3] - bbox[1] >= 170) return {};
  const [w, s, e, n] = bbox;
  return { geometry: { $geoIntersects: { $geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } } } };
}

export const activeNow = (now) => ({
  active: true,
  $and: [
    { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
  ],
});

// Active, in-window zones as GeoJSON features. Used by the risk engine and the map.
export async function loadActiveZones(db, { bbox, exercise = false, now = new Date(), types } = {}) {
  const filter = { ...activeNow(now), ...exerciseFilter(exercise), ...bboxFilter(bbox) };
  if (types?.length) filter.type = { $in: types.filter((t) => ZONE_TYPES.includes(t)) };
  const docs = await db.collection('overlay_zones').find(filter).limit(MAX_ACTIVE_ZONES).toArray();
  return docs.map((d) => zoneFeature(d));
}

export async function listZones(db, { bbox, type, exercise = false, includeInactive = false, now = new Date(), hideOperator = false } = {}) {
  if (type && !ZONE_TYPES.includes(type)) throw bad(`type must be one of ${ZONE_TYPES.join(', ')}.`);
  const filter = { ...(includeInactive ? {} : activeNow(now)), ...exerciseFilter(exercise), ...bboxFilter(bbox), ...(type ? { type } : {}) };
  const docs = await db.collection('overlay_zones').find(filter).sort({ updatedAt: -1 }).limit(MAX_ACTIVE_ZONES + 1).toArray();
  const truncated = docs.length > MAX_ACTIVE_ZONES;
  return { features: docs.slice(0, MAX_ACTIVE_ZONES).map((d) => zoneFeature(d, { hideOperator })), truncated };
}

// ---------- writes ----------
function zoneId(id) {
  if (typeof id !== 'string' || id.length !== 24 || !ObjectId.isValid(id)) throw bad('Invalid zone id.');
  return new ObjectId(id);
}

const regionOf = (geometry) => `gh5:${geohashEncode(...bboxCenter(geometryBbox(geometry)), 5)}`;

const audit = writeAudit;

async function guardRate(db, actor, now) {
  const recent = await db.collection('audit_log').countDocuments({ 'actor.id': actor, action: /^zone\./, at: { $gte: new Date(now.getTime() - 60000) } });
  if (recent >= WRITES_PER_MINUTE) throw new FeedError(429, 'Too many zone changes. Wait a minute.', { retryAfterS: 60 });
}

function geoFailure(err) {
  return /Can't extract geo keys|Loop|Edges|Duplicate vertices/i.test(err?.message || '') ? bad('That shape is not a valid area. Check that edges do not cross.') : err;
}

export async function createZone(db, body, { actor, exercise = false, now = new Date() }) {
  const input = validateZoneInput(body);
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw bad('endsAt must be after startsAt.');
  await guardRate(db, actor, now);
  const count = await db.collection('overlay_zones').countDocuments({ active: true, ...exerciseFilter(exercise) });
  if (count >= MAX_ACTIVE_ZONES) throw new HttpError(409, 'Too many active zones. Retire some first.');
  const doc = { _id: new ObjectId(), ...input, createdBy: actor, createdAt: now, updatedAt: now, version: 1, exercise };
  try { await db.collection('overlay_zones').insertOne(doc); } catch (err) { throw geoFailure(err); }
  await audit(db, { at: now, actor: { type: actor === 'system' ? 'system' : 'operator', id: actor }, action: 'zone.create', region: regionOf(doc.geometry), details: { zoneId: String(doc._id), type: doc.type, name: doc.name, version: 1 }, exercise });
  return zoneFeature(doc);
}

export async function updateZone(db, id, body, { actor, now = new Date() }) {
  const _id = zoneId(id);
  const version = body?.version;
  if (!Number.isInteger(version) || version < 1) throw bad('Send the version you last loaded.');
  const { version: _v, ...rest } = body;
  const input = validateZoneInput(rest, { partial: true });
  if (!Object.keys(input).length) throw bad('Nothing to change.');
  await guardRate(db, actor, now);
  const current = await db.collection('overlay_zones').findOne({ _id });
  if (!current) throw new HttpError(404, 'Zone not found.');
  const starts = 'startsAt' in input ? input.startsAt : current.startsAt, ends = 'endsAt' in input ? input.endsAt : current.endsAt;
  if (starts && ends && ends <= starts) throw bad('endsAt must be after startsAt.');
  let updated;
  try {
    updated = await db.collection('overlay_zones').findOneAndUpdate({ _id, version }, { $set: { ...input, updatedAt: now }, $inc: { version: 1 } }, { returnDocument: 'after' });
  } catch (err) { throw geoFailure(err); }
  if (!updated) throw new FeedError(409, 'This zone changed since you loaded it. Reload and try again.', { currentVersion: current.version });
  await audit(db, { at: now, actor: { type: 'operator', id: actor }, action: 'zone.update', region: regionOf(updated.geometry), details: { zoneId: id, fields: Object.keys(input), version: updated.version }, exercise: updated.exercise === true });
  return zoneFeature(updated);
}

// Delete is soft: the zone stays for the record but stops drawing and stops counting in risk.
export async function retireZone(db, id, { actor, version, now = new Date() }) {
  const _id = zoneId(id);
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) throw bad('version must be a whole number.');
  await guardRate(db, actor, now);
  const current = await db.collection('overlay_zones').findOne({ _id });
  if (!current) throw new HttpError(404, 'Zone not found.');
  const updated = await db.collection('overlay_zones').findOneAndUpdate({ _id, ...(version ? { version } : {}) }, { $set: { active: false, updatedAt: now }, $inc: { version: 1 } }, { returnDocument: 'after' });
  if (!updated) throw new FeedError(409, 'This zone changed since you loaded it. Reload and try again.', { currentVersion: current.version });
  await audit(db, { at: now, actor: { type: 'operator', id: actor }, action: 'zone.delete', region: regionOf(updated.geometry), details: { zoneId: id, type: updated.type, name: updated.name, version: updated.version }, exercise: updated.exercise === true });
  return zoneFeature(updated);
}
