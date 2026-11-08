// Place card: what is happening at one spot on the map. Appears after a short hover, disappears when the
// pointer moves away, and stays only when pinned by a click, tap or the Enter key. All text is set with
// textContent, so feed text can never inject markup. Missing data is shown as unknown, never as none.
import { PLACE_ENDPOINT, inConus } from './geo.js';
import { describeOverlayFeature } from './map.js';
import { ageText, STATUS_LABEL } from './core.js';

const SHOW_DELAY_MS = 130, GRACE_MS = 150, CACHE_MS = 60000, NEARBY_KM = 8;
const SECTIONS = [
  ['weatherNow', 'Weather now'], ['forecast', 'Forecast'], ['alerts', 'Active alerts'], ['floodZone', 'Flood zone'],
  ['gauges', 'River gauges'], ['riverForecast', 'River forecast'], ['tides', 'Tides'], ['quakes', 'Earthquakes'],
  ['fires', 'Fire hotspots'], ['airQuality', 'Air quality'], ['shelters', 'Shelters'], ['declarations', 'Disaster declarations'],
  ['devices', 'Safe Home devices'], ['regionalRisk', 'Regional risk'], ['zones', 'Operator zones'],
];
const STATUS_WORDS = { ok: '', stale: 'Out of date', none: 'Checked, none found', unknown: 'Unknown', not_cached: 'Not loaded yet', needs_key: 'Needs a server key', not_applicable: 'Not applicable here', error: 'Source unavailable' };
const SEVERITY_WORDS = { critical: 'Critical', elevated: 'Elevated', watch: 'Watch', info: 'Note' };
const UNIT = { C: '°C', F: '°F' };

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const num = v => Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 10) / 10) : String(v);
const when = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
const ageOf = s => Number.isFinite(s?.ageSeconds) ? ageText(new Date(Date.now() - s.ageSeconds * 1000).toISOString()) : s?.fetchedAt ? ageText(s.fetchedAt) : '';
const km = (a, b) => { const r = x => x * Math.PI / 180, dLat = r(b[1] - a[1]), dLon = r(b[0] - a[0]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLon / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const dist = it => it.distanceKm != null ? `${num(it.distanceKm)} km away` : it.distanceM != null ? (it.distanceM >= 1000 ? `${num(it.distanceM / 1000)} km away` : `${Math.round(it.distanceM)} m away`) : '';

// One readable line for any item the server returns. Known keys first; nothing is invented.
export function itemText(it) {
  if (it == null) return '';
  if (typeof it !== 'object') return String(it);
  const parts = [];
  const head = it.event || it.name || it.label || it.title || it.period || it.id;
  const value = it.value != null ? `${num(it.value)}${it.unit ? ' ' + (UNIT[it.unit] || it.unit) : ''}` : it.temperature != null ? `${num(it.temperature)} ${UNIT[it.temperatureUnit] || it.temperatureUnit || ''}`.trim() : '';
  if (head) parts.push(String(head));
  if (value) parts.push(value);
  const say = it.shortForecast || it.summary || it.headline || it.text;
  if (say) parts.push(String(say).slice(0, 140));
  if (it.stageFt != null) parts.push(`stage ${num(it.stageFt)} ft`);
  if (it.trend && it.trend !== 'unknown') parts.push(String(it.trend));
  if (it.severity) parts.push(String(it.severity));
  if (it.mag != null || it.magnitude != null) parts.push(`magnitude ${num(it.mag ?? it.magnitude)}`);
  if (it.aqi != null) parts.push(`AQI ${num(it.aqi)}`);
  if (it.zone || it.fldZone) parts.push(`zone ${it.zone || it.fldZone}`);
  const d = dist(it); if (d) parts.push(d);
  if (it.ends) parts.push(`until ${when(it.ends)}`);
  return parts.join(', ');
}

export function mountPlaceCard({ map, ctx, mapEl }) {
  const card = el('div', 'pc kit');
  card.id = 'place-card';
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'false'); card.setAttribute('aria-label', 'Conditions at this place');
  card.tabIndex = -1; card.hidden = true;
  const live = el('div', 'sr-only'); live.setAttribute('aria-live', 'polite');
  const body = el('div', 'pc-body');
  card.append(live, body);
  mapEl.append(card);

  let pinned = false, clickedMouse = false, visible = false, hideTimer = 0, showTimer = 0, abort = null, token = 0, target = null, overCard = false;
  const cache = new Map();

  const clearTimers = () => { clearTimeout(hideTimer); clearTimeout(showTimer); hideTimer = showTimer = 0; };

  function place(point) {
    const w = mapEl.clientWidth, h = mapEl.clientHeight;
    if (w < 560) { card.style.left = card.style.top = ''; return; }
    const cw = card.offsetWidth || 340, ch = card.offsetHeight || 200;
    let x = point.x + 18, y = point.y + 14;
    if (x + cw > w - 8) x = point.x - cw - 18;
    if (y + ch > h - 8) y = point.y - ch - 14;
    card.style.left = Math.max(8, Math.min(w - cw - 8, x)) + 'px';
    card.style.top = Math.max(56, Math.min(h - ch - 8, y)) + 'px';
  }

  function hide({ restoreFocus = false } = {}) {
    clearTimers(); abort?.abort(); abort = null; token++;
    const had = visible;
    visible = pinned = clickedMouse = false; target = null;
    card.hidden = true; card.classList.remove('is-pinned');
    if (had && restoreFocus) map.map.getCanvas().focus({ preventScroll: true });
  }

  // ---- content ----

  function localNearby(lngLat) {
    const here = [lngLat.lng, lngLat.lat];
    return (ctx.S.props || []).filter(p => p.coordinates).map(p => ({ p, d: km(here, p.coordinates) })).filter(x => x.d <= NEARBY_KM).sort((a, b) => a.d - b.d).slice(0, 5);
  }

  function deviceButton(it, extra = '') {
    const b = el('button', 'pc-device kit-btn');
    b.type = 'button';
    const status = STATUS_LABEL[it.status] || STATUS_LABEL[it.tier] || it.status || 'Unknown';
    const bits = [it.label || it.id, status, it.lastSeenAgeS != null ? `last seen ${ageText(new Date(Date.now() - it.lastSeenAgeS * 1000).toISOString())}` : '', dist(it), extra, it.exercise ? 'Exercise' : ''].filter(Boolean);
    b.textContent = bits.join(', ');
    b.setAttribute('aria-label', `Open ${it.label || it.id}: ${bits.slice(1).join(', ')}`);
    b.addEventListener('click', () => { hide(); (ctx.drawer?.openDevice || ctx.select)?.call(ctx.drawer || null, it.id); });
    return b;
  }

  function chip(text, tone) { return el('span', 'pc-chip' + (tone ? ' pc-chip--' + tone : ''), text); }

  function sectionRow(id, label, s) {
    const row = el('section', 'pc-sec pc-sec--' + s.status);
    row.dataset.section = id;
    const head = el('div', 'pc-sec-head');
    head.append(el('h4', 'pc-sec-title', label));
    if (s.source) head.append(chip(String(s.source)));
    const age = ageOf(s);
    if (age) head.append(el('span', 'pc-age', age));
    row.append(head);
    const word = s.status === 'needs_key' ? (s.reason || STATUS_WORDS.needs_key) : STATUS_WORDS[s.status];
    if (word) row.append(el('p', 'pc-status pc-status--' + s.status, s.status === 'stale' ? `${word}. Last known values below.` : word));
    if (s.reason && s.status !== 'needs_key' && ['unknown', 'not_cached', 'error', 'not_applicable'].includes(s.status)) row.append(el('p', 'pc-reason', s.reason));
    if (s.note) row.append(el('p', 'pc-reason', s.note));
    const items = Array.isArray(s.items) ? s.items : [];
    if (id === 'devices') for (const it of items.slice(0, 6)) row.append(deviceButton(it));
    else if (items.length) {
      const ul = el('ul', 'pc-list');
      for (const it of items.slice(0, id === 'weatherNow' ? 8 : 4)) ul.append(el('li', null, itemText(it)));
      if (items.length > 4 && id !== 'weatherNow') ul.append(el('li', 'pc-more', `${items.length - 4} more not shown`));
      row.append(ul);
    } else if (s.status === 'ok') row.append(el('p', 'pc-status', 'Checked'));
    return row;
  }

  function mapHere(hit) {
    if (!hit || hit.kind === 'device') return null;
    const wrap = el('section', 'pc-sec pc-sec--map');
    const head = el('div', 'pc-sec-head');
    head.append(el('h4', 'pc-sec-title', 'On the map here'), chip('This map'));
    wrap.append(head);
    const ul = el('ul', 'pc-list');
    if (hit.kind.startsWith('overlay:')) {
      const d = describeOverlayFeature(hit.kind.slice(8), hit.properties);
      ul.append(el('li', 'pc-strong', d.title));
      for (const line of d.lines.slice(0, 5)) ul.append(el('li', null, line));
    } else if (hit.kind === 'region') ul.append(el('li', null, `Risk area. Worst reported condition: ${STATUS_LABEL[hit.properties.worst] || 'Unknown'}.`));
    else if (hit.kind === 'zone') ul.append(el('li', null, `${hit.properties.name || 'Zone'}${hit.properties.note ? '. ' + hit.properties.note : ''}`));
    else if (hit.kind === 'group') ul.append(el('li', null, `${hit.properties.count} connected devices in this group.`));
    wrap.append(ul);
    return wrap;
  }

  function header(name, sub, mode, asOf) {
    const head = el('header', 'pc-head');
    const titles = el('div', 'pc-titles');
    const h = el('h3', 'pc-title', name);
    h.id = 'pc-title';
    titles.append(h);
    if (sub) titles.append(el('p', 'pc-sub', sub));
    head.append(titles);
    const side = el('div', 'pc-head-side');
    if (mode) side.append(chip(mode === 'exercise' ? 'Exercise' : 'Live', mode === 'exercise' ? 'warn' : 'ok'));
    const close = el('button', 'pc-close kit-icon');
    close.type = 'button'; close.setAttribute('aria-label', 'Close place details');
    close.append(window.Kit.glyph('x', { cls: 'kit-icon__glyph' }));
    close.addEventListener('click', () => hide({ restoreFocus: true }));
    side.append(close);
    head.append(side);
    if (asOf) head.append(el('p', 'pc-asof', `Checked ${ageText(asOf)}`));
    return head;
  }

  function renderLoading(lngLat, hit) {
    body.replaceChildren(header('Checking this place', `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`, null, null), el('p', 'pc-status', 'Loading conditions'));
    const here = mapHere(hit); if (here) body.append(here);
    live.textContent = 'Loading conditions';
  }

  function renderFallback(lngLat, hit, why) {
    body.replaceChildren(header('This place', `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`, null, null));
    body.append(el('p', ctx.demo ? 'pc-status' : 'pc-status pc-status--error', why));
    const here = mapHere(hit); if (here) body.append(here);
    const near = localNearby(lngLat);
    const sec = el('section', 'pc-sec');
    const head = el('div', 'pc-sec-head'); head.append(el('h4', 'pc-sec-title', 'Safe Home devices'), chip('This map'));
    sec.append(head);
    if (near.length) for (const { p, d } of near) sec.append(deviceButton({ id: p.id, label: p.name || p.id, status: p.severity, distanceKm: d, lastSeenAgeS: p.lastSeen ? Math.max(0, (Date.now() - Date.parse(p.lastSeen)) / 1000) : null, exercise: !!(ctx.demo || p.simulated) }));
    else sec.append(el('p', 'pc-status', 'None loaded on the map within 8 km. Devices that have not loaded are unknown.'));
    body.append(sec, footer([]));
    live.textContent = why;
  }

  function footer(limits) {
    const f = el('footer', 'pc-foot');
    if (limits?.length) { const ul = el('ul', 'pc-limits'); for (const l of limits) ul.append(el('li', null, String(l))); f.append(el('p', 'pc-foot-title', 'Limits'), ul); }
    f.append(el('p', 'pc-advisory', 'Regional context only. Unknown is not the same as low risk. A person must review this.'));
    f.append(el('p', 'pc-advisory', 'Model help is available from a device view.'));
    return f;
  }

  function render(data, lngLat, hit) {
    const p = data.place || {};
    const name = p.name || 'This place';
    const sub = [p.county, p.state].filter(Boolean).join(', ') || `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;
    body.replaceChildren(header(name, sub, data.mode, data.asOf));
    const stands = Array.isArray(data.standsOut) ? data.standsOut : [];
    const top = el('section', 'pc-stands');
    top.append(el('h4', 'pc-sec-title', 'What stands out'));
    if (stands.length) {
      const ul = el('ul', 'pc-list');
      for (const s of stands.slice(0, 6)) { const li = el('li'); li.append(chip(SEVERITY_WORDS[s.severity] || 'Note', s.severity === 'critical' ? 'bad' : s.severity === 'elevated' ? 'warn' : ''), document.createTextNode(' ' + s.text)); ul.append(li); }
      top.append(ul);
    } else top.append(el('p', 'pc-status', 'Nothing stands out in the data we could check. This does not mean conditions are fine.'));
    body.append(top);
    const here = mapHere(hit); if (here) body.append(here);
    for (const [id, label] of SECTIONS) { const s = data.sections?.[id]; if (s && s.status) body.append(sectionRow(id, label, s)); }
    body.append(footer(data.limits));
    live.textContent = `Conditions loaded for ${name}`;
  }

  // ---- loading ----

  async function load(lngLat, hit, point) {
    const mine = ++token;
    abort?.abort();
    const lat = Number(lngLat.lat.toFixed(5)), lon = Number(lngLat.lng.toFixed(5));
    if (!inConus(lat, lon)) { body.replaceChildren(header('Outside the lower 48', null, null, null), el('p', 'pc-status', 'Place details cover the lower 48 states only.')); live.textContent = 'Outside the lower 48'; place(point); return; }
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const hitCache = cache.get(key);
    if (hitCache && Date.now() - hitCache.at < CACHE_MS) { render(hitCache.data, lngLat, hit); place(point); return; }
    if (ctx.demo) { renderFallback(lngLat, hit, 'Exercise area. Select a device to see its sample readings.'); place(point); return; }
    renderLoading(lngLat, hit); place(point);
    abort = new AbortController();
    const r = await ctx.api(`${PLACE_ENDPOINT}?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, { signal: abort.signal });
    if (mine !== token || !visible) return;
    if (r.ok && r.data?.sections) { cache.set(key, { at: Date.now(), data: r.data }); if (cache.size > 40) cache.delete(cache.keys().next().value); render(r.data, lngLat, hit); }
    else if (r.status === 401 || r.status === 403) renderFallback(lngLat, hit, 'Sign in as an operator to see place details.');
    else if (r.status === 429) renderFallback(lngLat, hit, 'Too many place lookups. Try again in a minute.');
    else if (r.status === 404 || r.status === 405) renderFallback(lngLat, hit, 'Place details are not available yet. Showing what is on this map.');
    else if (r.status === 422) renderFallback(lngLat, hit, 'No place details for this spot. It may be outside the lower 48 states.');
    else renderFallback(lngLat, hit, 'Place details could not load. Showing what is on this map.');
    place(point);
  }

  function show(lngLat, { pinned: pin = false, mouseClick = false, point, hit = null, focus = false } = {}) {
    clearTimers();
    const pt = point || map.projectToScreen(lngLat);
    target = { lngLat, point: pt };
    visible = true; pinned = pin; clickedMouse = mouseClick;
    card.hidden = false; card.classList.toggle('is-pinned', pin);
    load(lngLat, hit, pt);
    if (pin && focus !== false) requestAnimationFrame(() => card.focus({ preventScroll: true }));
  }

  // ---- map events ----

  map.onPlaceHover(({ lngLat, point, hit }) => {
    if (pinned) return;
    if (clickedMouse) {
      if (target && Math.hypot(point.x - target.point.x, point.y - target.point.y) > 24) hide();
      return;
    }
    // Bare map points load on click. Hovering across streets should not flood public data sources.
    if (!hit || hit.kind === 'device' || hit.kind === 'group' || hit.kind === 'state') return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => { if (!pinned) show(lngLat, { point, hit }); }, SHOW_DELAY_MS);
  });
  map.onPlaceLeave(() => {
    clearTimeout(showTimer);
    if (pinned || !visible) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!overCard && !pinned) hide(); }, GRACE_MS);
  });
  map.onPlaceClick(({ lngLat, point, hit, touch, keyboard }) => {
    const own = !hit || hit.kind.startsWith('overlay:');
    if (!own) { hide(); return; }
    if (touch && pinned) { hide(); return; }
    show(lngLat, { pinned: !!(touch || keyboard), mouseClick: !touch && !keyboard, point, hit, focus: !!keyboard });
    if (keyboard) card.setAttribute('aria-describedby', 'pc-title');
  });
  map.onMoveStart(() => { if (visible) hide(); });

  card.addEventListener('mouseenter', () => { overCard = true; clearTimeout(hideTimer); });
  card.addEventListener('mouseleave', () => { overCard = false; if (!pinned && visible) { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!overCard && !pinned) hide(); }, GRACE_MS); } });
  card.addEventListener('focusin', () => clearTimeout(hideTimer));

  const onKey = e => {
    if (e.key !== 'Escape' || !visible) return;
    e.preventDefault(); e.stopPropagation();
    hide({ restoreFocus: pinned || card.contains(document.activeElement) });
  };
  const onDown = e => {
    if (!visible || !pinned || card.contains(e.target) || e.target.closest?.('.maplibregl-canvas-container')) return;
    if (e.target.closest?.('.kit-pop-out')) return;
    hide();
  };
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);

  return {
    show, hide, isPinned: () => pinned, isVisible: () => visible,
    destroy() { window.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); hide(); card.remove(); },
  };
}
