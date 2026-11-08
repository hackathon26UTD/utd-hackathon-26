// Command center v2: street-level map, live device updates, regions, overlays, zones, information boxes, logs.
// Everything here consumes JSON from the API. Missing data is shown as unknown, never as safe.
import { LADDER, STATUS_LABEL, HELP_LABEL, liveUrl, pollDelay, newLiveState, mergeLive, combineProperties, matchesFilter, countStatuses, displayStatus, deviceFeatures, regionFeatures, localRegions, localFollowUps, precisionForZoom, ageText, failText } from './core.js';
import { api, exerciseMode } from './api.js';
import { MapView } from './map.js';
import { setHtml, announce, toast, debounce } from './dom.js';
import { mountDetail } from './detail.js';
import { mountOverlays, onOverlayClick } from './overlays.js';
import { mountBottom } from './bottom.js';
import { mountDialogs } from './dialogs.js';

const DEFAULT_CENTER = [-96.755, 32.976];

function layout({ demo, role, footer, brand }) {
  return `<div class="shell cc"><nav class="rail" aria-label="Main navigation"><a href="/" aria-label="HomeBeacon home"><span class="beacon" aria-hidden="true">⌂</span></a><a href="${demo ? '/demo' : '/command-center'}">◉<br>Overview</a><a href="#timeline">◷<br>Activity</a><a href="/status">↗<br>System</a><a href="/accessibility">?<br>Help</a></nav><main id="main" class="workspace">
<header class="top"><div><div class="eyebrow">HomeBeacon / Recovery operations</div><h1>Neighborhood overview</h1><span class="muted">North Dallas, Texas</span></div><div class="tools"><span class="tag" id="mode-tag">${demo || exerciseMode ? 'Exercise data' : 'Connected devices'}</span>${!demo && role ? `<a class="button" href="${exerciseMode ? '/command-center' : '/command-center?mode=exercise'}">${exerciseMode ? 'Show live data' : 'Show exercise data'}</a>` : ''}<span class="live-pill" id="live-pill" role="status">Starting</span><button id="build-layer">Build operator view</button><button id="sources">Data sources</button>${!role ? '<a class="button" href="/login">Operator sign-in</a>' : '<a class="button" href="/profile">Profile</a><button id="signout">Sign out</button>'}</div></header>
<div class="notice" id="notice">${demo ? 'Exercise mode. All homes and sensor readings shown here are fictional. Map streets are real. This view is read only.' : 'Live device observations. Missing reports mean unknown conditions, not confirmed safety.'}</div>
<section class="stats" aria-label="Response overview" id="stats"></section><div id="active-layer" class="hidden notice" role="status"></div>
<section class="board" aria-label="Properties and map">
<div class="queue"><div class="queue-tabs" role="tablist" aria-label="Lists">${[['homes', 'Homes'], ['priorities', 'Priorities'], ['regions', 'Areas']].map(([k, l]) => `<button role="tab" data-qtab="${k}" aria-selected="${k === 'homes'}" id="qtab-${k}">${l}</button>`).join('')}</div>
<div class="panel-head" id="queue-filters"><label><span class="sr-only">Search homes</span><input id="search" type="search" placeholder="Search home or area"></label><label><span class="sr-only">Filter by status</span><select id="filter"><option value="all">All statuses</option><option value="critical">Critical</option><option value="elevated">Elevated</option><option value="watch">Watch</option><option value="unknown">Unknown</option><option value="normal">No active alerts</option><option value="offline">Not reporting recently</option><option value="linked">Customer linked</option></select></label></div>
<div id="properties" class="properties" aria-label="List"></div></div>
<div class="map-wrap"><div class="map-tools" role="toolbar" aria-label="Map tools"><button id="overlay-toggle" aria-expanded="false" aria-controls="overlay-panel">Layers and zones</button><button id="send-area"${demo ? ' disabled title="Exercise mode is read only"' : ''}>Send to map area</button><button id="fit-homes">Show all homes</button></div>
<div id="map" class="map" role="region" aria-label="Neighborhood map. Use the property list for a keyboard alternative."></div>
<aside id="overlay-panel" class="overlay-panel" aria-label="Map layers and zones"><div class="ov-head"><strong>Layers and zones</strong><button id="overlay-close" class="small" aria-label="Close layers panel">Close</button></div><div id="overlay-body" class="ov-body"></div></aside>
<div id="draw-bar" class="draw-bar hidden" role="group" aria-label="Zone drawing"><p id="draw-help"></p><span id="draw-count" class="muted"></span><div class="tools"><button id="draw-undo" class="small">Undo point</button><button id="draw-finish" class="small primary">Finish</button><button id="draw-cancel" class="small">Cancel</button></div></div>
<div class="map-caption"><strong>Observed conditions</strong><p>${LADDER.slice().reverse().map(k => `<span class="tag ${k}">${STATUS_LABEL[k]}</span>`).join(' ')}</p><p class="legend-note"><small>Blue ring: customer linked. Grey edge: last known. Unknown is never shown as safe.</small></p><small id="map-status">Loading street map. All information is also available in the list.</small></div></div>
<section id="detail" class="detail" aria-label="Selected home details" aria-live="polite"></section></section>
<section id="timeline" class="timeline cc-bottom"><div class="tabs" role="tablist" aria-label="Activity"><button role="tab" data-btab="feed" aria-selected="true">Live updates</button><button role="tab" data-btab="logs" aria-selected="false">Logs</button><button role="tab" data-btab="sent" aria-selected="false">Sent messages</button></div><button id="export" class="small">Export visible homes</button><div id="bottom-body" class="bottom-body" role="tabpanel"></div></section>${footer}</main></div>
<dialog id="source-dialog" aria-labelledby="source-title"><h2 id="source-title">Public context</h2><p>Official alerts add regional context. They do not confirm damage to an individual home.</p><div id="source-list" aria-live="polite">Loading source status.</div><form method="dialog"><button>Close</button></form></dialog>
<dialog id="follow-dialog" aria-labelledby="follow-title"><form id="follow-form"><h2 id="follow-title">Record follow-up</h2><label>Action<select name="action"><option value="contact">Contact attempted</option><option value="inspection">Inspection requested</option><option value="resident_reported_evacuated">Resident reported evacuation</option><option value="responder_confirmed">Responder confirmation</option><option value="acknowledge">Reviewed observation</option></select></label><label>Note<textarea name="note" maxlength="1500" required></textarea></label><p>This records a note. It does not dispatch emergency services.</p><p id="follow-status" role="status"></p><div class="tools"><button type="button" id="cancel-follow">Cancel</button><button class="primary">Save note</button></div></form></dialog>
<dialog id="msg-dialog" class="wide" aria-labelledby="msg-heading"><form id="msg-form"><h2 id="msg-heading">Send an information box</h2><p class="muted">Short text for the small screen on the device. Devices pick it up when they check in. Do not include passwords or keys.</p>
<fieldset><legend>Send to</legend><div id="msg-scope" class="stack"></div></fieldset>
<div class="two"><label>Type<select name="kind" id="msg-kind"></select></label><label>Severity<select name="severity" id="msg-severity"></select></label></div>
<label><span class="labrow">Title <small id="msg-title-count" class="count"></small></span><input id="msg-title" name="title" maxlength="20" autocomplete="off" required></label>
<label><span class="labrow">Message <small id="msg-body-count" class="count"></small></span><textarea name="body" id="msg-body" maxlength="80" rows="3" autocomplete="off"></textarea></label>
<div class="two"><label>Keep it for<select name="expiresInMin" id="msg-expiry"></select></label><div class="stack"><label class="check inline"><input type="checkbox" name="requiresAck"> Ask for confirmation on the device</label><label class="check inline"><input type="checkbox" name="customerVisible"> Customer can see this</label></div></div>
<p id="msg-ack-note" class="muted"></p><div><div class="eyebrow">Screen preview</div><pre id="msg-oled" class="oled" aria-label="Preview of the device screen"></pre></div>
<p id="msg-error" class="error" role="alert"></p><p id="msg-result" role="status"></p><div class="tools"><button type="button" id="msg-cancel">Close</button><button class="primary">Send</button></div></form></dialog>
<dialog id="zone-dialog" aria-labelledby="zone-title"><form id="zone-form"><h2 id="zone-title">Save area</h2><div id="zone-fields" class="stack"></div><p id="zone-error" class="error" role="alert"></p><div class="tools"><button type="button" id="zone-cancel">Cancel</button><button class="primary">Save</button></div></form></dialog>
<dialog id="pair-dialog" aria-labelledby="pair-title"><h2 id="pair-title">Registration code</h2><p>Give these to the customer. They are shown once and cannot be looked up later.</p><dl class="pair"><div><dt>Serial</dt><dd id="pair-serial"></dd></div><div><dt>Code</dt><dd id="pair-code"></dd></div></dl><label>Registration link<input id="pair-link" readonly></label><div class="tools"><button id="pair-copy" type="button">Copy link</button><button id="pair-close" type="button" class="primary">Done</button></div></dialog>
<div id="announce" class="sr-only" aria-live="assertive"></div><div id="toasts" class="toasts" role="status"></div>`;
}

export async function mountCommand(env) {
  const { maplibregl, demo, role, exerciseProperties, footer, brand, escape: esc } = env;
  const $ = s => document.querySelector(s);
  $('#app').innerHTML = layout({ demo, role, footer, brand });

  const S = {
    demo, role, base: [], live: newLiveState(), liveState: 'starting', errors: 0, liveAt: 0, props: [], selectedId: null, selectedRegion: null,
    regions: [], followUps: [], riskState: 'idle', riskAt: 0, feeds: new Map(), filter: 'all', search: '', layerIds: null, queueTab: 'homes', detail: null, detailTab: 'overview', fitted: false,
  };
  const ctx = { S, $, esc, demo, role, announce, toast, api };
  ctx.renderAll = () => renderAll();

  // ---- map ----

  const mv = new MapView(maplibregl, 'map', { center: DEFAULT_CENTER, zoom: 12 });
  ctx.mv = mv;
  mv.on('error', () => { $('#map-status').textContent = 'Map unavailable. Use the property list.'; });
  mv.map.on('load', () => { $('#map-status').textContent = 'Street map · OpenFreeMap / OpenStreetMap'; renderMap(); });
  mv.on('moveend', debounce(() => { loadRegions(); overlays?.reloadVisible(); }, 600));
  mv.on('click', (e, hit) => {
    if (S.drawing) return overlays.addPoint(e.lngLat);
    if (!hit) return;
    if (hit.kind === 'device') ctx.select(hit.properties.id);
    else if (hit.kind === 'zone') overlays.selectZone(hit.properties.id);
    else if (hit.kind === 'region') ctx.selectRegion(hit.properties.key);
    else if (hit.kind.startsWith('overlay:')) onOverlayClick(ctx, hit, e.lngLat);
  });
  mv.map.on('dblclick', e => { if (S.drawing) { e.preventDefault(); document.querySelector('#draw-finish').click(); } });

  // ---- panels ----

  const detailPanel = mountDetail(ctx);
  const overlays = mountOverlays(ctx);
  const bottom = mountBottom(ctx);
  mountDialogs(ctx);
  ctx.showLogs = q => bottom.showLogs(q);
  ctx.loadRegions = () => loadRegions();
  ctx.afterSend = () => { if (S.bottomTab === 'sent') bottom.show('sent'); if (S.selectedId) detailPanel.loadDetail(S.selectedId, { quiet: true }); };

  // ---- selection ----

  ctx.select = (id, { fly = false, auto = false } = {}) => {
    if (!auto) S.userPicked = true;
    S.selectedId = id; S.selectedRegion = null; S.detailTab = S.detailTab || 'overview';
    const p = S.props.find(x => x.id === id);
    if (p && fly && p.coordinates) mv.flyTo(p.coordinates, 15);
    delete $('#detail').dataset.html;
    detailPanel.render();
    detailPanel.loadDetail(id);
    renderList(); renderMap(); bottom.render();
  };
  ctx.selectRegion = key => {
    S.selectedRegion = key;
    delete $('#detail').dataset.html;
    detailPanel.render(); renderList(); bottom.render();
  };

  // ---- rendering ----

  const visible = () => S.props.filter(p => matchesFilter(p, S));

  function recompute() { S.props = combineProperties(S.base, [...S.live.devices.values()], Date.now()); }

  function renderStats() {
    const n = countStatuses(S.props);
    const cards = [['Homes monitored', S.props.length], ['Critical', n.critical], ['Elevated or watch', n.elevated + n.watch], ['Unknown', n.unknown], ['Not reporting', n.offline], ['Customers linked', n.linked]];
    setHtml($('#stats'), cards.map(([a, b]) => `<div class="stat"><strong>${b}</strong><span>${esc(a)}</span></div>`).join(''));
  }

  function propRow(p) {
    const d = displayStatus(p);
    const chips = [p.link?.linked ? '<span class="chip link">Customer</span>' : '', p.risk?.power?.mode && p.risk.power.mode !== 'normal' ? '<span class="chip power">Power save</span>' : '', p.help?.status && p.help.status !== 'none' ? `<span class="chip help">${esc(HELP_LABEL[p.help.status] || '')}</span>` : '', p.risk?.priority?.tier === 'P1' ? '<span class="chip warn">P1</span>' : ''].join('');
    return `<button class="property" data-key="p-${esc(p.id)}" data-id="${esc(p.id)}" aria-pressed="${S.selectedId === p.id && !S.selectedRegion}"><span class="tag ${esc(d.status)}">${esc(STATUS_LABEL[d.status])}</span>${chips}<strong>${esc(p.name && p.name !== p.id ? p.name : p.id)}</strong><small>${esc(p.area || p.id)} · ${d.silent ? 'last report ' + esc(ageText(p.lastSeen || p.observedAt)) : 'reporting'}${d.lastKnown && d.status !== 'unknown' ? ' · last known' : ''}</small></button>`;
  }

  function renderList() {
    for (const b of document.querySelectorAll('[data-qtab]')) b.setAttribute('aria-selected', String(b.dataset.qtab === S.queueTab));
    $('#queue-filters').classList.toggle('hidden', S.queueTab !== 'homes');
    const el = $('#properties');
    if (S.queueTab === 'homes') {
      const v = visible();
      setHtml(el, v.length ? v.map(propRow).join('') : '<p class="panel-head">No homes match this view.</p>');
    } else if (S.queueTab === 'priorities') {
      const list = S.followUps;
      const note = S.riskState === 'unavailable' ? '<p class="soft-note pad">Priorities are not available yet.</p>' : '<p class="soft-note pad">Ordered for people to check first. This does not dispatch anyone and does not confirm damage.</p>';
      setHtml(el, note + list.map(f => { const p = S.props.find(x => x.id === f.deviceId); return `<button class="property" data-key="f-${esc(f.deviceId)}" data-id="${esc(f.deviceId)}"><span class="chip ${f.tier === 'P1' ? 'warn' : ''}">${esc(f.tier)}</span>${f.hasContact ? '<span class="chip link">Can be contacted</span>' : ''}<strong>${esc(p?.name || f.deviceId)}</strong><small>${esc(f.why)}</small></button>`; }).join('') || (S.riskState === 'ok' ? '<p class="panel-head">Nothing needs a check right now. This is not a confirmation of safety.</p>' : ''));
    } else {
      const note = S.riskState === 'unavailable' ? '<p class="soft-note pad">Area summaries are not available yet.</p>' : '<p class="soft-note pad">Areas need at least three devices. Smaller groups appear as single homes.</p>';
      const list = [...S.regions].sort((a, b) => Number(b.hotspot?.is) - Number(a.hotspot?.is) || (b.priority?.score || 0) - (a.priority?.score || 0));
      setHtml(el, note + list.map(r => `<button class="property" data-key="r-${esc(r.key)}" data-region="${esc(r.key)}" aria-pressed="${S.selectedRegion === r.key}"><span class="tag ${esc(Object.keys(r.counts || {}).length ? worst(r.counts) : 'unknown')}">${esc(STATUS_LABEL[worst(r.counts)])}</span>${r.hotspot?.is ? '<span class="chip warn">Hot spot</span>' : ''}${r.outage === 'possible_grid_or_isp_outage' ? '<span class="chip">Possible outage</span>' : ''}<strong>${esc(r.key)}</strong><small>${esc(r.deviceCount)} homes</small></button>`).join(''));
    }
  }
  const worst = c => ['critical', 'elevated', 'watch'].find(k => c?.[k] > 0) || (c?.unknown > 0 ? 'unknown' : c?.normal > 0 ? 'normal' : 'unknown');

  function renderMap() {
    mv.setData('devices', deviceFeatures(visible(), Date.now(), S.selectedId));
    if (!S.fitted && S.props.some(p => p.coordinates)) {
      S.fitted = true;
      fitHomes();
    }
  }

  function fitHomes() {
    const pts = S.props.filter(p => p.coordinates).map(p => p.coordinates);
    if (!pts.length) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    if (pts.length === 1) return mv.flyTo(pts[0], 14);
    mv.fitTo([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }

  function renderPill() {
    const el = $('#live-pill');
    const age = S.liveAt ? Math.max(0, Math.round((Date.now() - S.liveAt) / 1000)) : null;
    const t = demo ? ['off', 'Exercise data. Live updates are off.']
      : S.liveState === 'live' ? ['on', `Live · updated ${age < 5 ? 'just now' : age + ' seconds ago'}${S.live.mode === 'exercise' ? ' · exercise data' : ''}`]
      : S.liveState === 'unavailable' ? ['off', 'Live updates are not available yet. Refreshing every 30 seconds.']
      : S.liveState === 'retry' ? ['warn', 'Live updates paused. Retrying.']
      : ['off', 'Connecting'];
    el.className = 'live-pill ' + t[0];
    el.textContent = t[1];
    if (S.live.limited && !demo) $('#notice').textContent = 'Showing the first 500 devices. Zoom or filter to narrow the view. Missing reports mean unknown conditions.';
  }

  function renderAll() {
    renderStats(); renderList(); renderMap(); detailPanel.render(); bottom.render(); renderPill();
  }

  // ---- list and filter events ----

  $('#properties').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.region) { ctx.selectRegion(b.dataset.region); const r = S.regions.find(x => x.key === b.dataset.region); if (r?.bbox) mv.fitTo(r.bbox); return; }
    if (b.dataset.id) ctx.select(b.dataset.id, { fly: true });
  });
  $('.queue-tabs').addEventListener('click', e => { const b = e.target.closest('[data-qtab]'); if (!b) return; S.queueTab = b.dataset.qtab; delete $('#properties').dataset.html; renderList(); });
  $('#search').oninput = e => { S.search = e.target.value; renderList(); renderMap(); };
  $('#filter').onchange = e => { S.filter = e.target.value; renderList(); renderMap(); };
  $('#fit-homes').onclick = fitHomes;
  $('#send-area').onclick = () => ctx.openMessage({ type: 'bbox' });
  $('#signout')?.addEventListener('click', async () => { await fetch('/api/session', { method: 'DELETE' }); location.href = '/login'; });
  $('#export').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ mode: demo ? 'exercise' : 'live', exportedAt: new Date().toISOString(), properties: visible() }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'homebeacon-observations.json'; a.click(); URL.revokeObjectURL(url);
  };

  // ---- data: base list ----

  function mapLegacy(d) {
    return (d.properties || []).map(p => ({ ...p, area: p.neighborhood, sensors: { mains: p.values?.mains_power, wan: p.values?.wan_connected, water: p.values?.water_detected, battery_pct: p.values?.battery_pct, temperature_c: p.values?.temp_c } }));
  }

  async function loadBase() {
    if (demo) { S.base = exerciseProperties(); return true; }
    if (exerciseMode) { S.base = []; return true; } // exercise homes arrive through the live feed only
    const r = await api('/api/command-center');
    if (r.status === 401) { location.href = '/login'; return false; }
    if (!r.ok) { $('#notice').textContent = 'Device data is unavailable. No safety conclusion can be drawn. Try again shortly.'; return false; }
    S.base = mapLegacy(r.data);
    return true;
  }

  // ---- data: live polling ----

  async function pollLive() {
    clearTimeout(S.timer);
    if (document.hidden) { S.timer = setTimeout(pollLive, 4000); return; }
    const r = await api(liveUrl({ since: S.live.cursor }));
    if (r.status === 401) { location.href = '/login'; return; }
    if (r.ok && r.data) {
      S.errors = 0; S.liveState = 'live'; S.liveAt = Date.now();
      const res = mergeLive(S.live, r.data);
      if (res.changedIds.length || res.fresh.length || r.data.reset) {
        recompute();
        if (!S.userPicked) { const top = S.props.find(p => p.severity === 'critical'); if (top && top.id !== S.selectedId) { S.selectedId = top.id; delete $('#detail').dataset.html; detailPanel.loadDetail(top.id); } }
        renderStats(); renderList(); renderMap(); detailPanel.render(); bottom.render();
        if (S.selectedId && res.changedIds.includes(S.selectedId) && Date.now() - (S.detail?.at || 0) > 6000) detailPanel.loadDetail(S.selectedId, { quiet: true });
        for (const id of res.becameCritical) { const p = S.props.find(x => x.id === id); announce(`${p?.name || 'A home'} is now reporting critical conditions.`); toast(`${p?.name || 'A home'} is now critical.`, { error: true }); }
      }
      if (S.live.mode === 'exercise' && !demo) $('#mode-tag').textContent = 'Exercise data from live API';
    } else {
      S.errors = Math.min(S.errors + 1, 6);
      if (r.status === 404 || r.status === 503) { S.liveState = 'unavailable'; S.errors = Math.max(S.errors, 3); } else S.liveState = 'retry';
    }
    renderPill();
    S.timer = setTimeout(pollLive, pollDelay(S.errors));
  }

  // ---- data: regions and priorities ----

  async function loadRegions() {
    if (demo) {
      S.regions = localRegions(S.props); S.followUps = localFollowUps(S.props); S.riskState = 'ok'; S.riskAt = Date.now();
    } else {
      const bbox = mv.bbox().map(n => n.toFixed(4)).join(',');
      const r = await api(`/api/risk?level=regions&bbox=${bbox}&precision=${precisionForZoom(mv.zoom)}&limit=60`);
      if (r.status === 401) { location.href = '/login'; return; }
      if (r.ok) { S.regions = r.data?.regions || []; S.followUps = r.data?.followUps || []; S.riskState = 'ok'; S.riskAt = Date.now(); }
      else { S.riskState = 'unavailable'; S.riskStatus = r.status; }
    }
    mv.setData('regions', regionFeatures(S.regions));
    renderList(); overlays.render();
    if (S.selectedRegion) detailPanel.render();
  }

  // ---- start ----

  S.ovOn.add('regions'); S.ovOn.add('zones');
  const ok = await loadBase();
  recompute();
  const first = S.props.find(p => p.severity === 'critical') || S.props[0];
  S.selectedId = first?.id || null;
  renderAll();
  overlays.render();
  if (S.selectedId) detailPanel.loadDetail(S.selectedId);
  overlays.loadZones();
  mv.map.once('load', () => loadRegions());
  setInterval(renderPill, 1000);
  setInterval(() => { if (!document.hidden) loadRegions(); }, 20000);
  setInterval(() => { if (!document.hidden) overlays.reloadAll(); }, 120000);

  if (!demo) {
    pollLive();
    setInterval(async () => {
      if (document.hidden || exerciseMode) return;
      const r = await api('/api/command-center');
      if (r.status === 401) { location.href = '/login'; return; }
      if (r.ok) { S.base = mapLegacy(r.data); recompute(); renderAll(); if (S.liveState !== 'live') $('#notice').textContent = 'Live device observations. Refreshed ' + new Date().toLocaleTimeString() + '. Missing reports remain unknown.'; }
      else $('#notice').textContent = 'Refresh failed. Displaying the last loaded observations. Check timestamps before acting.';
    }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(S.timer); pollLive(); } });
  }
  $('#detail').addEventListener('keydown', e => {
    const tabs = [...document.querySelectorAll('#detail [role=tab]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0 || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.click();
  });
  return { state: S };
}
