// Pure logic for the command center UI. No DOM, no fetch. Tested in test/command-ui.test.js.
// Safety rules encoded here: missing or silent data is never shown as safe, a stale critical
// reading stays critical, nothing here infers occupancy, damage or dispatch.

export const LADDER = ['unknown', 'normal', 'watch', 'elevated', 'critical'];
export const STATUS_LABEL = { unknown: 'Unknown', normal: 'No active alerts', watch: 'Watch', elevated: 'Elevated', critical: 'Critical' };
export const STATUS_COLOR = { unknown: '#667d89', normal: '#21665f', watch: '#b17a23', elevated: '#c4601f', critical: '#b9413b' };
export const SILENT_AFTER_MS = 15 * 60 * 1000;
export const POLL_BASE_MS = 4000;
export const POLL_MAX_MS = 30000;

const finite = v => typeof v === 'number' && Number.isFinite(v);
const time = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : null; };

export function normalizeStatus(s) {
  if (s === 'warning') return 'elevated';
  return LADDER.includes(s) ? s : 'unknown';
}

// What to draw for a device. A device that has gone quiet is never "normal": it becomes unknown.
// Anything worse than normal stays as it was, flagged as last known (stale critical never turns safe).
export function displayStatus(dev, now = Date.now()) {
  const status = normalizeStatus(dev?.risk?.status ?? dev?.severity);
  const seen = time(dev?.lastSeen) ?? time(dev?.observedAt);
  const silent = dev?.offline === true || dev?.stale === true || seen === null || now - seen > SILENT_AFTER_MS;
  if (status === 'normal' && silent) return { status: 'unknown', lastKnown: true, silent };
  return { status, lastKnown: silent && status !== 'unknown', silent };
}

export function ageText(iso, now = Date.now()) {
  const t = time(iso);
  if (t === null) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

export function worstStatus(counts = {}) {
  for (const k of ['critical', 'elevated', 'watch']) if (counts[k] > 0) return k;
  if (counts.unknown > 0) return 'unknown';
  return counts.normal > 0 ? 'normal' : 'unknown';
}

export function countStatuses(props, now = Date.now()) {
  const c = { unknown: 0, normal: 0, watch: 0, elevated: 0, critical: 0, offline: 0, linked: 0 };
  for (const p of props) {
    const d = displayStatus(p, now);
    c[d.status]++;
    if (d.silent) c.offline++;
    if (p.link?.linked) c.linked++;
  }
  return c;
}

// ---- Live polling ----

export function liveUrl({ since, region, bbox, deviceId } = {}) {
  const q = new URLSearchParams();
  if (since) q.set('since', since);
  if (region) q.set('region', region);
  else if (Array.isArray(bbox) && bbox.length === 4) q.set('bbox', bbox.join(','));
  if (deviceId) q.set('device_id', deviceId);
  const s = q.toString();
  return '/api/ops/live' + (s ? '?' + s : '');
}

export function pollDelay(errors = 0, rng = Math.random) {
  if (errors > 0) return Math.min(POLL_MAX_MS, POLL_BASE_MS * 2 ** errors);
  return Math.round(POLL_BASE_MS + (rng() - 0.5) * 2000);
}

export function newLiveState() {
  return { cursor: null, devices: new Map(), feed: [], seen: new Set(), mode: null, limited: false, serverTime: null };
}

const fingerprint = d => [d.lastSeen, d.risk?.status, d.risk?.priority?.tier, d.help?.updatedAt, d.link?.linked, d.offline].join('|');

function feedItems(p) {
  const out = [];
  for (const l of p.logs || []) out.push({ key: `log:${l.id || `${l.deviceId}:${l.at}:${l.code}`}`, kind: 'log', at: l.at, deviceId: l.deviceId || null, level: l.level || 'info', text: `${l.code ? l.code + ': ' : ''}${l.msg || ''}`.trim(), source: l.source || null });
  for (const a of p.audit || []) out.push({ key: `audit:${a.id || `${a.at}:${a.action}:${a.deviceId}`}`, kind: 'audit', at: a.at, deviceId: a.deviceId || null, level: 'info', text: `${a.actor?.type || 'system'} ${String(a.action || '').replace(/_/g, ' ')}`.trim() });
  for (const m of p.messages || []) out.push({ key: `msg:${m.id}:${m.updatedAt}`, kind: 'message', at: m.updatedAt, deviceId: m.deviceId || null, level: 'info', text: `Message ${m.state}` });
  for (const i of p.incidents || []) out.push({ key: `inc:${i.id || i._id}:${i.updatedAt}`, kind: 'incident', at: i.updatedAt || i.at, deviceId: i.deviceId || null, level: 'warn', text: i.title || i.summary || i.type || 'Incident updated' });
  for (const h of p.helpChanged || []) out.push({ key: `help:${h.deviceId}:${h.updatedAt}`, kind: 'help', at: h.updatedAt, deviceId: h.deviceId, level: 'info', text: `Help status: ${HELP_LABEL[h.status] || h.status}` });
  return out;
}

// Applies one /api/ops/live payload. Returns the ids that changed and the feed items that are new.
export function mergeLive(state, p, { feedMax = 300 } = {}) {
  const result = { changedIds: [], fresh: [], becameCritical: [] };
  if (!p || typeof p !== 'object') return result;
  if (p.reset) state.devices.clear();
  for (const d of p.devices || []) {
    if (!d || !d.id) continue;
    const prev = state.devices.get(d.id);
    if (!prev || fingerprint(prev) !== fingerprint(d)) {
      result.changedIds.push(d.id);
      if (prev && d.risk?.status === 'critical' && prev.risk?.status !== 'critical') result.becameCritical.push(d.id);
    }
    state.devices.set(d.id, d);
  }
  for (const item of feedItems(p)) {
    if (state.seen.has(item.key)) continue;
    state.seen.add(item.key);
    result.fresh.push(item);
  }
  if (result.fresh.length) {
    state.feed = [...result.fresh, ...state.feed].sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0)).slice(0, feedMax);
    if (state.seen.size > feedMax * 6) state.seen = new Set(state.feed.map(f => f.key));
  }
  if (p.cursor) state.cursor = p.cursor;
  if (p.mode) state.mode = p.mode;
  state.limited = !!p.limited;
  state.serverTime = p.serverTime || state.serverTime;
  return result;
}

// Base properties come from /api/command-center (or exercise). Live devices enrich or add to them.
export function combineProperties(base = [], liveDevices = [], now = Date.now()) {
  const byId = new Map();
  for (const b of base) byId.set(String(b.id), { ...b });
  for (const d of liveDevices) {
    const prev = byId.get(String(d.id)) || { id: String(d.id) };
    const coordinates = finite(d.lng) && finite(d.lat) ? [d.lng, d.lat] : prev.coordinates || null;
    byId.set(String(d.id), { ...prev, id: String(d.id), name: d.name || prev.name, selfBuilt: d.selfBuilt === true || prev.selfBuilt === true, area:d.address || prev.area, coordinates, lastSeen: d.lastSeen ?? prev.lastSeen, offline: d.offline, live: d, link: d.link, help: d.help, risk: d.risk, observedAt: d.risk?.observedAt || prev.observedAt || d.lastSeen });
  }
  return [...byId.values()].map(p => {
    const shown = displayStatus(p, now);
    const reasons = p.risk?.reasons?.length ? p.risk.reasons.map(r => r.text) : p.reasons || [];
    return { ...p, severity: shown.status, lastKnown: shown.lastKnown, silent: shown.silent, reasons };
  });
}

export function matchesFilter(p, { filter = 'all', search = '', layerIds = null } = {}) {
  if (layerIds && !layerIds.has(p.id)) return false;
  if (filter === 'linked') { if (!p.link?.linked) return false; }
  else if (filter === 'offline') { if (!p.silent) return false; }
  else if (filter !== 'all' && p.severity !== filter) return false;
  return `${p.id} ${p.name || ''} ${p.area || ''}`.toLowerCase().includes(String(search).toLowerCase());
}

export function failText(status, what, error) {
  if (status === 401) return 'Sign in again to continue.';
  if (status === 403) return 'This account cannot do that.';
  if (status === 404) return `${what} is not available yet.`;
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status === 503) return `${what} is temporarily unavailable.`;
  if (status === 0) return 'Network unavailable. Check the connection.';
  return error || 'Something went wrong. Try again.';
}

// ---- Regions ----

export function precisionForZoom(z) { return z < 10 ? 4 : z < 13 ? 5 : 6; }

export function bboxPolygon([w, s, e, n]) { return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }; }

export function regionFeatures(regions = []) {
  return {
    type: 'FeatureCollection',
    features: regions.filter(r => Array.isArray(r.bbox) && r.bbox.length === 4).map(r => ({
      type: 'Feature', geometry: bboxPolygon(r.bbox),
      properties: { key: r.key, worst: worstStatus(r.counts), hotspot: !!r.hotspot?.is, outage: r.outage || 'none', deviceCount: r.deviceCount || 0, tier: r.priority?.tier || null },
    })),
  };
}

// Exercise mode only: group exercise properties into simple grid cells so the region view has something to show.
export function localRegions(props, { cell = 0.05, now = Date.now() } = {}) {
  const cells = new Map();
  for (const p of props) {
    if (!Array.isArray(p.coordinates)) continue;
    const ix = Math.floor(p.coordinates[0] / cell), iy = Math.floor(p.coordinates[1] / cell);
    const key = `ex:${ix}:${iy}`;
    if (!cells.has(key)) cells.set(key, { key, ix, iy, list: [] });
    cells.get(key).list.push(p);
  }
  return [...cells.values()].filter(c => c.list.length >= 3).map(c => {
    const counts = { unknown: 0, normal: 0, watch: 0, elevated: 0, critical: 0 };
    let silent = 0;
    for (const p of c.list) { const d = displayStatus(p, now); counts[d.status]++; if (d.silent) silent++; }
    const bad = counts.elevated + counts.critical;
    const w = c.ix * cell, s = c.iy * cell;
    return { key: c.key, bbox: [w, s, w + cell, s + cell], centroid: [w + cell / 2, s + cell / 2], deviceCount: c.list.length, counts, offlineShare: silent / c.list.length, outage: 'none', hotspot: { is: bad >= 3, score: Math.min(100, bad * 25), reasons: bad >= 3 ? [`${bad} homes report elevated or critical conditions in this cell.`] : [] }, worsened30m: 0, correlations: [], priority: { tier: bad >= 3 ? 'P1' : 'P3' }, advisory: 'Exercise grouping. Advisory only, human review required.' };
  });
}

export function devicesInBbox(props, [w, s, e, n]) {
  return props.filter(p => Array.isArray(p.coordinates) && p.coordinates[0] >= w && p.coordinates[0] <= e && p.coordinates[1] >= s && p.coordinates[1] <= n);
}

export function deviceFeatures(props, now = Date.now(), selectedId = null) {
  return {
    type: 'FeatureCollection',
    features: props.filter(p => Array.isArray(p.coordinates)).map(p => {
      const d = displayStatus(p, now);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: p.coordinates }, properties: { id: p.id, status: d.status, lastKnown: d.lastKnown, linked: !!p.link?.linked, selected: p.id === selectedId, power: p.risk?.power?.mode && p.risk.power.mode !== 'normal' ? p.risk.power.mode : '' } };
    }),
  };
}

// ---- Information box (downlink) messages ----

export const MSG_LIMITS = { title: 20, body: 80, maxExpiryMin: 7 * 24 * 60, defaultExpiryMin: 360, devices: 200, oledCols: 21, oledRows: 8 };
export const MSG_KINDS = ['info', 'condition', 'instruction'];
export const MSG_SEVERITIES = ['info', 'advisory', 'urgent'];
export const EXPIRY_CHOICES = [[15, '15 minutes'], [60, '1 hour'], [360, '6 hours'], [1440, '24 hours'], [10080, '7 days']];

export function validateMessage(m) {
  const errors = {};
  const title = String(m.title ?? ''), body = String(m.body ?? '');
  const ascii = /^[\x20-\x7E]*$/;
  if (!title.trim()) errors.title = 'Add a short title.';
  else if (title.length > MSG_LIMITS.title) errors.title = `Title is limited to ${MSG_LIMITS.title} characters.`;
  if (body.length > MSG_LIMITS.body) errors.body = `Message is limited to ${MSG_LIMITS.body} characters.`;
  for (const [k, v] of [['title', title], ['body', body]]) {
    if (errors[k]) continue;
    if (!ascii.test(v)) errors[k] = 'The small screen shows plain keyboard characters only.';
    else if (/https?:|www\.|\.(com|net|org|io|gov|edu)\b/i.test(v)) errors[k] = 'Links cannot be shown on the device.';
    else if (/dk_|[0-9a-f]{32,}|password/i.test(v)) errors[k] = 'This looks like a secret. Remove it.';
  }
  const exp = Number(m.expiresInMin ?? MSG_LIMITS.defaultExpiryMin);
  if (!Number.isFinite(exp) || exp < 1 || exp > MSG_LIMITS.maxExpiryMin) errors.expiresInMin = 'Choose an expiry up to 7 days.';
  if (!MSG_KINDS.includes(m.kind ?? 'info')) errors.kind = 'Choose a message type.';
  if (!MSG_SEVERITIES.includes(m.severity ?? 'info')) errors.severity = 'Choose a severity.';
  const sc = m.scope;
  if (!sc) errors.scope = 'Choose who receives this.';
  else if (sc.type === 'device' && !(sc.deviceIds?.length >= 1)) errors.scope = 'Choose a device.';
  else if (sc.type === 'device' && sc.deviceIds.length > MSG_LIMITS.devices) errors.scope = `At most ${MSG_LIMITS.devices} devices per message.`;
  else if (sc.type === 'region' && !sc.region) errors.scope = 'Choose a region.';
  else if (sc.type === 'bbox' && !(Array.isArray(sc.bbox) && sc.bbox.length === 4 && sc.bbox.every(finite))) errors.scope = 'Choose an area on the map.';
  else if (!['device', 'region', 'bbox'].includes(sc.type)) errors.scope = 'Choose who receives this.';
  return { ok: !Object.keys(errors).length, errors };
}

export function messageBody(m) {
  return {
    scope: m.scope, kind: m.kind || 'info', severity: m.severity || 'info', title: String(m.title).trim(), body: String(m.body || '').trim(),
    expiresInMin: Number(m.expiresInMin ?? MSG_LIMITS.defaultExpiryMin), requiresAck: !!m.requiresAck, customerVisible: !!m.customerVisible,
  };
}

// What the 21 column by 8 row screen will roughly show. Preview only; the device does its own layout.
export function oledPreview(title, body, { cols = MSG_LIMITS.oledCols, rows = MSG_LIMITS.oledRows } = {}) {
  const lines = [String(title || '').slice(0, cols).toUpperCase(), ''];
  let cur = '';
  for (const word of String(body || '').split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > cols) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, cols)); w = w.slice(cols); }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= cols) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, rows);
}

// ---- Operator zones ----

export const ZONE_TYPES = {
  evacuation: { label: 'Evacuation area', color: '#b9413b' },
  closure: { label: 'Road or area closure', color: '#c4601f' },
  damage_survey: { label: 'Damage survey area', color: '#7a4fb5' },
  staging: { label: 'Staging area', color: '#1c5fa8' },
  shelter: { label: 'Shelter', color: '#2f7d4f' },
  custom: { label: 'Custom', color: '#526974' },
};
export const POINT_TYPES = ['staging', 'shelter', 'custom'];

function cross(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function segmentsCross(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function selfIntersects(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      if (segmentsCross(a, b, points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}
const inRange = ([lng, lat]) => finite(lng) && finite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;

// draft: {type,name,note,points:[[lng,lat]...], pin:boolean}. Server re-validates; this keeps obviously bad shapes out.
export function validateZoneDraft(draft) {
  const errors = {};
  if (!ZONE_TYPES[draft.type]) errors.type = 'Choose a zone type.';
  const name = String(draft.name ?? '').trim();
  if (!name) errors.name = 'Add a name.';
  else if (name.length > 80) errors.name = 'Name is limited to 80 characters.';
  if (String(draft.note ?? '').length > 300) errors.note = 'Note is limited to 300 characters.';
  const pts = draft.points || [];
  let geometry = null;
  if (draft.pin) {
    if (pts.length !== 1 || !inRange(pts[0])) errors.shape = 'Place one pin on the map.';
    else geometry = { type: 'Point', coordinates: pts[0] };
  } else if (pts.length < 3) errors.shape = 'Click at least three points on the map.';
  else if (pts.length > 200) errors.shape = 'Shapes are limited to 200 points.';
  else if (!pts.every(inRange)) errors.shape = 'A point is outside the valid map range.';
  else if (selfIntersects(pts)) errors.shape = 'The outline crosses itself. Undo the last point or start again.';
  else geometry = { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
  if (draft.startsAt && draft.endsAt && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) errors.endsAt = 'End must be after start.';
  return { ok: !Object.keys(errors).length, errors, geometry };
}

export function drawPreview(points, pin = false) {
  const features = points.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }));
  if (!pin && points.length >= 2) features.push({ type: 'Feature', geometry: { type: points.length >= 3 ? 'Polygon' : 'LineString', coordinates: points.length >= 3 ? [[...points, points[0]]] : points }, properties: {} });
  return { type: 'FeatureCollection', features };
}

// ---- Overlay catalog ----

export const OVERLAYS = [
  {id:'nwps',name:'NOAA river flood guidance',note:'Observed and forecast river conditions with native units',minZoom:10},
  {id:'weather',name:'Forecast precipitation',note:'Open-Meteo forecast rainfall, not observed flood extent',minZoom:11},
  {id:'ercot',name:'ERCOT supply and demand',note:'Texas grid series, not home outage locations',minZoom:0},
  {id:'river_forecast',name:'River discharge forecast',note:'Open-Meteo / GloFAS modelled discharge',minZoom:11},
  {id:'nws_forecast',name:'NWS hourly forecast',note:'Hourly forecast at the map-cell center',minZoom:11},
  {id:'tides',name:'NOAA coastal water levels',note:'Configured coastal stations, metres relative to MSL',minZoom:0},
  { id: 'nws', name: 'Weather alerts', note: 'NWS active alerts with mapped areas', minZoom: 0 },
  { id: 'nfhl', name: 'FEMA flood zones', note: 'National Flood Hazard Layer. Shown from zoom 11.', minZoom: 11 },
  { id: 'declarations', name: 'FEMA declarations', note: 'Counties with recent declarations', minZoom: 0 },
  { id: 'gauges', name: 'River gauges', note: 'USGS stage readings', minZoom: 0 },
  { id: 'quakes', name: 'Earthquakes', note: 'USGS, last day', minZoom: 0 },
  { id: 'shelters', name: 'Open shelters', note: 'FEMA shelter listings', minZoom: 0 },
  { id: 'firms', name: 'Fire detections', note: 'NASA FIRMS. Needs an API key on the server.', minZoom: 0 },
  { id: 'airnow', name: 'Air quality', note: 'AirNow. Needs an API key on the server.', minZoom: 0 },
  { id: 'eia', name: 'Regional electricity demand', note: 'EIA / ERCOT demand context, not household outage locations. Requires a server API key.', minZoom: 0 },
];

export const SOURCE_STATUS_TEXT = { ok: 'Current', stale: 'Out of date', error: 'Error', needs_key: 'Needs key', unverified: 'Unverified' };

export function overlayUrl(layer, bbox) {
  const q = new URLSearchParams({ layer });
  if (bbox) q.set('bbox', bbox.map(n => Number(n).toFixed(4)).join(','));
  return '/api/overlays?' + q;
}

// Describes the freshness of one overlay response for the panel.
export function overlayNote(layer, hb, now = Date.now()) {
  if (!hb) return '';
  const parts = [];
  if (hb.fetchedAt) parts.push(`Updated ${ageText(hb.fetchedAt, now)}`);
  else if (Number.isFinite(hb.ageS)) parts.push(`Updated ${ageText(new Date(now - hb.ageS * 1000).toISOString(), now)}`);
  if (hb.stale) parts.push('Out of date, showing last saved data');
  if (hb.truncated) parts.push('Too many shapes, zoom in to see all');
  return parts.join(' · ');
}

// ---- Readings ----

export const SENSOR_GROUPS = [
  ['Power', ['mains_power', 'battery_pct', 'power_mode']],
  ['Water', ['water_detected', 'water_level_mm', 'moisture_pct']],
  ['Air and fire', ['smoke_alarm', 'fire_flame', 'co_ppm', 'pm25_ugm3', 'voc_index']],
  ['Climate', ['temp_c', 'humidity_pct']],
  ['Network', ['wan_connected', 'rssi_dbm']],
  ['Movement', ['tilt_deg', 'shock_g']],
];
export const SENSOR_LABEL = {
  mains_power: 'Mains power', battery_pct: 'Battery', power_mode: 'Power mode', water_detected: 'Water at sensor', water_level_mm: 'Water depth', moisture_pct: 'Moisture',
  smoke_alarm: 'Smoke alarm', fire_flame: 'Flame sensor', co_ppm: 'Carbon monoxide', pm25_ugm3: 'Fine particles (PM2.5)', voc_index: 'Air chemicals (VOC)', air_alarm: 'Air alarm',
  temp_c: 'Temperature', humidity_pct: 'Humidity', wan_connected: 'Internet', rssi_dbm: 'Wi-Fi signal', tilt_deg: 'Tilt', shock_g: 'Shock',
};
const BOOL_TEXT = { mains_power: ['Connected', 'Lost'], water_detected: ['Detected', 'Not detected'], smoke_alarm: ['Alarm', 'No alarm'], fire_flame: ['Flame detected', 'None detected'], air_alarm: ['Alarm', 'No alarm'], wan_connected: ['Connected', 'Disconnected'] };
const POWER_MODE_TEXT = { normal: 'Normal', saver: 'Power save mode', critical: 'Critical power save' };
const UNIT_FALLBACK = { battery_pct: '%', humidity_pct: '%', moisture_pct: '%', water_level_mm: 'mm', co_ppm: 'ppm', pm25_ugm3: 'ug/m3', temp_c: '°C', rssi_dbm: 'dBm', tilt_deg: '°', shock_g: 'g' };

export function formatReading(sensor, value, unit) {
  if (value === null || value === undefined) return 'Not reported';
  if (typeof value === 'boolean') { const t = BOOL_TEXT[sensor]; return t ? t[value ? 0 : 1] : value ? 'Yes' : 'No'; }
  if (sensor === 'power_mode') return POWER_MODE_TEXT[value] || String(value);
  const u = unit ?? UNIT_FALLBACK[sensor] ?? '';
  return `${typeof value === 'number' ? Math.round(value * 100) / 100 : value}${u ? (u === '%' || u === '°C' || u === '°' ? '' : ' ') + u : ''}`;
}

// latest: {sensor:{value,unit,ts}}. Returns groups with rows, including sensors that have not reported (as unknown).
export function readingRows(latest = {}, now = Date.now()) {
  const known = new Set(SENSOR_GROUPS.flatMap(g => g[1]));
  const groups = SENSOR_GROUPS.map(([title, sensors]) => ({ title, rows: sensors.map(s => rowFor(s, latest[s], now)) }));
  const extra = Object.keys(latest).filter(s => !known.has(s)).sort().map(s => rowFor(s, latest[s], now));
  if (extra.length) groups.push({ title: 'Other', rows: extra });
  return groups;
}
function rowFor(sensor, r, now) {
  const reported = !!r && r.value !== undefined && r.value !== null;
  const age = reported ? now - (time(r.ts) ?? now) : null;
  return { sensor, label: SENSOR_LABEL[sensor] || sensor.replace(/_/g, ' '), text: reported ? formatReading(sensor, r.value, r.unit) : 'Not reported', reported, ts: reported ? r.ts : null, old: age !== null && age > 30 * 60 * 1000 };
}

// Legacy /api/command-center values become the same shape so the readings tab works without the new API.
export function latestFromValues(values = {}, ts = null) {
  const latest = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) latest[k] = { value: v, unit: null, ts };
  return latest;
}

export function sparkline(points = [], w = 120, h = 28) {
  const pts = points.map(p => ({ t: time(p.ts ?? p.t), v: typeof p.value === 'boolean' ? (p.value ? 1 : 0) : Number(p.value ?? p.v) })).filter(p => p.t !== null && Number.isFinite(p.v));
  if (pts.length < 2) return '';
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  return pts.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / (t1 - t0 || 1)) * w).toFixed(1)} ${(h - 2 - ((p.v - lo) / span) * (h - 4)).toFixed(1)}`).join('');
}

// ---- Help status ----

export const HELP_LABEL = { none: 'No update', review_queued: 'Review queued', follow_up_assigned: 'Follow-up assigned', help_on_the_way: 'Help is on the way', resolved: 'Resolved' };
export const HELP_STATUSES = Object.keys(HELP_LABEL);

export function linkText(link) {
  if (!link?.linked) return 'No customer linked';
  return link.contactName ? `Customer linked: ${link.contactName}` : 'Customer linked';
}

// ---- Logs ----

export function logsUrl({ kind = 'all', deviceId, region, level, sinceMin, limit = 200 } = {}, now = Date.now()) {
  const q = new URLSearchParams({ kind, limit: String(Math.min(500, limit)) });
  if (deviceId) q.set('device_id', deviceId);
  if (region) q.set('region', region);
  if (level && level !== 'all') q.set('level', level);
  if (sinceMin) q.set('since', new Date(now - sinceMin * 60000).toISOString());
  return '/api/ops/logs?' + q;
}

export function inScope(item, scope, ids) {
  if (scope === 'all' || !ids) return true;
  return item.deviceId ? ids.has(item.deviceId) : false;
}

// ---- Priorities, text entry of points ----

const PRIORITY_BY_STATUS = { critical: [100, 'P1', 'Review now'], elevated: [60, 'P2', 'Check soon'], watch: [30, 'P3', 'Routine'], unknown: [20, 'P3', 'Routine'] };

// Exercise mode only. Live priorities come from /api/risk. Orders humans' follow-up list; never a dispatch.
export function localFollowUps(props, now = Date.now(), limit = 20) {
  return props
    .map(p => ({ p, d: displayStatus(p, now) }))
    .filter(x => x.d.status !== 'normal')
    .map(({ p, d }) => { const [score, tier] = PRIORITY_BY_STATUS[d.status]; return { deviceId: p.id, tier, score, why: p.reasons?.[0] || (d.silent ? 'No recent report' : STATUS_LABEL[d.status]), hasContact: !!(p.link?.linked && p.link.consent) }; })
    .sort((a, b) => b.score - a.score || String(a.deviceId).localeCompare(String(b.deviceId)))
    .slice(0, limit);
}

// Keyboard alternative to clicking the map: one "latitude, longitude" pair per line.
export function parsePoints(text) {
  const points = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    const lat = m ? Number(m[1]) : NaN, lng = m ? Number(m[2]) : NaN;
    if (!m || Math.abs(lat) > 90 || Math.abs(lng) > 180) errors.push(`Line ${i + 1} is not a latitude and longitude pair.`);
    else points.push([lng, lat]);
  });
  if (points.length > 200) errors.push('Shapes are limited to 200 points.');
  return { points, errors };
}

export function formatPoints(points = []) { return points.map(([lng, lat]) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`).join('\n'); }

// Message state for one device from a message row of unknown exact shape (flat state or per-device deliveries).
export function messageState(m, deviceId) {
  const d = (m.deliveries || []).find(x => String(x.deviceId) === String(deviceId));
  return d?.state || m.state || 'queued';
}
export const MSG_STATE_TEXT = { queued: 'Waiting for the device', delivered: 'Delivered', acked: 'Confirmed', expired: 'Expired', cancelled: 'Cancelled' };
