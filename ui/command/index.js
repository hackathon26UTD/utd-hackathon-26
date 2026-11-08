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

const DEFAULT_CENTER = [-98, 38];
const SCENARIOS = [
  { id: 'normal', label: 'Normal day', description: 'A baseline of recent reports and normal power.' },
  { id: 'power-outage', label: 'Power outage', description: 'Backup power takes over as a neighborhood loses power.' },
  { id: 'water-hurricane', label: 'Hurricane & water', description: 'Water reports and power loss during a fictional hurricane.' },
  { id: 'recovery', label: 'Recovery', description: 'New reports arrive; earlier water evidence still needs review.' },
];
const route = new URLSearchParams(location.search);
const embedded = route.get('embed') === 'hero';
const requestedScenario = route.get('scenario') === 'hurricane' ? 'water-hurricane' : route.get('scenario');

function layout({ demo, role, footer, brand }) {
  return `<div class="shell cc map-only${embedded ? ' is-embedded' : ''}"><main id="main" class="workspace"><h1 class="sr-only">HomeBeacon response map</h1>
<header class="cc-hub"><a href="/" class="cc-brand" aria-label="HomeBeacon website">HomeBeacon</a><span class="cc-scope">United States</span><span class="tag" id="mode-tag">${demo || exerciseMode ? 'Exercise' : 'Connected devices'}</span><span class="live-pill" id="live-pill" role="status">Connecting</span><details class="cc-more" id="command-more"><summary>More</summary><div class="cc-more-menu">${!demo && role ? `<a href="${exerciseMode ? '/command-center' : '/command-center?mode=exercise'}">${exerciseMode ? 'Show live data' : 'Show exercise data'}</a>` : ''}<button id="build-layer">Create a view</button><button id="sources">Data sources</button><button data-theme-toggle>Switch theme</button><a href="/customer">My home</a><a href="/status">System status</a><a href="/privacy">Privacy</a><a href="/accessibility">Accessibility</a>${!role ? '<a href="/login">Operator sign-in</a>' : '<a href="/profile">Profile</a><button id="signout">Sign out</button>'}</div></details></header>
<div class="notice" id="notice">${demo ? 'Fictional homes and hurricane exercise. No live disaster data.' : 'U.S. imagery · weather coverage is regional. Missing reports mean unknown conditions.'}</div>
<div class="map-tools" role="toolbar" aria-label="Map tools"><button id="quick-weather" aria-pressed="false"${demo ? ' disabled title="Official weather layers require operator sign-in"' : ''}>Weather</button>${demo ? '<button id="quick-wind" aria-pressed="true">Wind · exercise</button>' : ''}<button id="quick-power" aria-pressed="false">Power loss</button><button id="quick-water" aria-pressed="false">Water reports</button><button id="overlay-toggle" aria-expanded="false" aria-controls="overlay-panel">Layers</button><button id="fit-homes">Find devices</button><button id="national-view">U.S. view</button><button id="open-view-builder" aria-controls="layer-dialog" aria-expanded="false">Create view</button></div>
<nav class="workspace-island" aria-label="Workspace views"><button data-view="map" aria-pressed="true" aria-controls="map">Map</button><button data-view="overview" aria-expanded="false" aria-controls="overview-panel">Overview</button><button data-view="homes" aria-expanded="false" aria-controls="device-panel">Devices <span id="device-count">0</span></button><button id="activity-link" data-view="activity" aria-expanded="false" aria-controls="timeline">Activity</button><button data-view="demo" aria-expanded="false" aria-controls="demo-panel">Demo</button></nav><div id="embed-label" class="embed-label" hidden>Fictional hurricane exercise</div>
<section class="stats" aria-label="Response overview" id="stats" hidden></section><div id="active-layer" class="hidden notice" role="status"></div>
<section class="board" aria-label="Properties and map"><div class="map-wrap"><div id="map" class="map" role="region" aria-label="United States response map. Open Devices for a keyboard-accessible home list."></div>
<aside id="overlay-panel" class="overlay-panel" aria-label="Map layers and zones"><div class="ov-head"><strong>Layers and zones</strong><button id="overlay-close" class="small" aria-label="Close layers panel">Close</button></div><div id="overlay-body" class="ov-body"></div></aside>
<div id="draw-bar" class="draw-bar hidden" role="group" aria-label="Zone drawing"><p id="draw-help"></p><span id="draw-count" class="muted"></span><div class="tools"><button id="draw-undo" class="small">Undo point</button><button id="draw-finish" class="small primary">Finish</button><button id="draw-cancel" class="small">Cancel</button></div></div>
<details class="map-caption"><summary>Map key &amp; sources</summary><div class="map-key"><p>${LADDER.slice().reverse().map(k => `<span class="tag ${k}">${STATUS_LABEL[k]}</span>`).join(' ')}</p><p class="legend-note"><small>Large blue circles group device locations, not severity. Small blue ring: linked customer. Grey edge: last known. Unknown does not mean safe.</small></p><small id="map-status">Loading USGS imagery. Imagery dates vary; this is not a live disaster photograph.</small><p><small>${demo ? 'Dallas and Florida homes, wind exposure and zones are fictional. Wind circles are not a forecast.' : 'National imagery is geographic context. Public-layer coverage varies by source; see Data sources for verified coverage. Electricity demand is not household outage telemetry.'}</small></p></div></details></div>
<aside id="device-panel" class="queue" aria-label="Devices and priorities" hidden><div class="panel-title"><div><h2 id="queue-title">Devices</h2><p class="view-lead">Search observations, compare readings and choose a home to inspect.</p></div><button id="queue-close" class="small" aria-label="Close device list">Close</button></div><div class="queue-tabs" role="tablist" aria-label="Lists">${[['homes', 'Homes'], ['priorities', 'Priorities'], ['regions', 'Areas']].map(([k, l]) => `<button role="tab" data-qtab="${k}" aria-selected="${k === 'homes'}" id="qtab-${k}">${l}</button>`).join('')}</div><div class="panel-head" id="queue-filters"><label><span class="sr-only">Search homes</span><input id="search" type="search" placeholder="Search home or area"></label><label><span class="sr-only">Filter by status</span><select id="filter"><option value="all">All statuses</option><option value="critical">Critical</option><option value="elevated">Elevated</option><option value="watch">Watch</option><option value="unknown">Unknown</option><option value="normal">No active alerts</option><option value="offline">Not reporting</option><option value="linked">Customer linked</option><option value="power">Power loss</option></select></label><label><span class="sr-only">Sort homes</span><select id="home-sort"><option value="priority">Sort by priority</option><option value="power">Power loss first</option><option value="battery">Lowest battery</option><option value="age">Oldest report</option></select></label></div><div id="properties" class="properties" aria-label="List"></div><div class="queue-foot"><button id="send-area"${demo ? ' disabled title="Exercise mode is read only"' : ''}>Message map area</button><button id="export" class="small">Export homes</button></div></aside>
<svg id="detail-connector" aria-hidden="true"><path></path></svg><section id="detail" class="detail" aria-label="Selected home details" aria-live="polite" hidden></section></section>
<section id="timeline" class="timeline cc-bottom" aria-label="Activity" hidden><div class="panel-title"><div><h2 id="activity-title" tabindex="-1">Activity</h2><p class="view-lead">Device updates, operator logs and message delivery.</p></div><button id="activity-close" class="small">Close</button></div><div class="activity-content"><div class="activity-toolbar"><div class="tabs" role="tablist" aria-label="Activity"><button role="tab" data-btab="feed" aria-selected="true">Updates</button><button role="tab" data-btab="logs" aria-selected="false">Logs</button><button role="tab" data-btab="sent" aria-selected="false">Sent messages</button></div></div><div id="bottom-body" class="bottom-body" role="tabpanel"></div></div></section>
<section id="overview-panel" class="full-view overview-view" aria-labelledby="overview-title" hidden><div class="panel-title"><div><h2 id="overview-title" tabindex="-1">Overview</h2><p class="view-lead">Reported conditions across the homes in this workspace.</p></div><button data-close-view class="small">Back to map</button></div><div id="overview-content" class="full-view-body"></div></section>
<section id="demo-panel" class="full-view demo-view" aria-labelledby="demo-title" hidden><div class="panel-title"><div><h2 id="demo-title" tabindex="-1">Try a scenario</h2><p class="view-lead">Choose a fictional situation and inspect how the reports change.</p></div><button data-close-view class="small">Back to map</button></div><div class="full-view-body"><p class="demo-boundary">Synthetic data only. Scenarios never change connected devices or send messages.</p><div id="demo-scenarios" class="scenario-grid">${SCENARIOS.map(s => `<button class="scenario-option" data-scenario="${s.id}" aria-pressed="false"><strong>${s.label}</strong><span>${s.description}</span></button>`).join('')}</div><div id="demo-summary" class="demo-summary"></div><div class="demo-actions"><button id="demo-show-map" class="primary">Explore this scenario on the map</button><button id="demo-show-overview">See overview</button><p id="demo-status" role="status"></p></div><p class="muted">Each selection loads a new read-only scenario snapshot. Nothing advances automatically.</p></div></section>
</main></div>
<dialog id="source-dialog" aria-labelledby="source-title"><h2 id="source-title">Public context</h2><p>Official alerts add regional context. They do not confirm damage to an individual home.</p><div id="source-list" aria-live="polite">Loading source status.</div><form method="dialog"><button>Close</button></form></dialog>
<dialog id="follow-dialog" aria-labelledby="follow-title"><form id="follow-form"><h2 id="follow-title">Record follow-up</h2><label>Action<select name="action"><option value="contact">Contact attempted</option><option value="inspection">Inspection requested</option><option value="resident_reported_evacuated">Resident reported evacuation</option><option value="responder_confirmed">Responder confirmation</option><option value="acknowledge">Reviewed observation</option></select></label><label>Note<textarea name="note" maxlength="1500" required></textarea></label><p>This records a note. It does not dispatch emergency services.</p><p id="follow-status" role="status"></p><div class="tools"><button type="button" id="cancel-follow">Cancel</button><button class="primary">Save note</button></div></form></dialog>
<dialog id="msg-dialog" class="wide" aria-labelledby="msg-heading"><form id="msg-form"><h2 id="msg-heading">Send a message</h2><p class="muted">A short message for the device screen. It arrives when the device next checks in. Do not include passwords or keys.</p>
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
  // Full workspace views sit beside the retained map canvas, not inside its inert subtree.
  $('.workspace').append($('#device-panel'));
  $('#embed-label').hidden = !embedded;

  const S = {
    demo, role, base: [], live: newLiveState(), liveState: 'starting', errors: 0, liveAt: 0, props: [], selectedId: null, selectedRegion: null,
    regions: [], followUps: [], riskState: 'idle', riskAt: 0, feeds: new Map(), filter: 'all', search: '', layerIds: null, queueTab: 'homes', detail: null, detailTab: 'overview', detailOpen: false, fitted: false, embed: embedded, demoScenario: SCENARIOS.some(s => s.id === requestedScenario) ? requestedScenario : 'water-hurricane', demoRequest: 0,
  };
  const ctx = { S, $, esc, demo, role, announce, toast, api };
  ctx.renderAll = () => renderAll();

  // ---- map ----

  const mv = new MapView(maplibregl, 'map', { center: DEFAULT_CENTER, zoom: 3.4, styleKey: 'satellite', deviceMinZoom: S.embed ? 7 : 11, showGroups: !S.embed });
  ctx.mv = mv;
  mv.on('error', () => { $('#map-status').textContent = 'Map or imagery unavailable. Open Devices to continue using the list.'; $('#notice').textContent = (demo ? 'Exercise data. ' : '') + 'Some map tiles are unavailable. Devices and readings remain accessible.'; });
  mv.map.on('load', () => { updateMapSource(); renderMap(); if (!S.nationalFitted) { if (S.embed) fitScenario({ animate: false }); else fitNational(); } });
  mv.map.on('style.load', updateMapSource);
  function updateMapSource() { $('#map-status').textContent = mv.styleKey === 'satellite' ? 'USDA / USGS The National Map imagery. Collection dates and resolution vary; not live disaster imagery.' : 'Street map · OpenFreeMap / OpenStreetMap. Geographic context only.'; }
  mv.on('moveend', debounce(() => { loadRegions(); overlays?.reloadVisible(); }, 600));
  mv.on('click', (e, hit) => {
    if (S.drawing) return overlays.addPoint(e.lngLat);
    if (!hit) return;
    if (hit.kind === 'device') ctx.select(hit.properties.id);
    else if (hit.kind === 'group') { mv.flyTo(hit.geometry.coordinates, 11.5); announce(`${hit.properties.count} connected homes in this group. Zooming to neighborhood view.`); }
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

  const viewPanels = { homes: '#device-panel', activity: '#timeline', overview: '#overview-panel', demo: '#demo-panel' };
  function setWorkspaceView(view) {
    S.workspaceView = view;
    $('.workspace').classList.toggle('view-open', !!view);
    $('.board').inert = !!view; $('.board').setAttribute('aria-hidden', String(!!view));
    $('.map-tools').inert = !!view; $('.map-tools').setAttribute('aria-hidden', String(!!view));
    for (const [key, selector] of Object.entries(viewPanels)) $(selector).hidden = key !== view;
    document.querySelectorAll('[data-view]').forEach(b => {
      b.setAttribute('aria-expanded', String(b.dataset.view === view));
      b.setAttribute('aria-pressed', String(b.dataset.view === (view || 'map')));
    });
  }
  ctx.closeWorkspace = ({ focus = true } = {}) => {
    const previous = S.workspaceView;
    setWorkspaceView(null);
    if (focus) document.querySelector(`[data-view="${previous || 'map'}"]`)?.focus({ preventScroll: true });
  };
  ctx.openWorkspace = view => {
    ctx.closeViewBuilder?.({ focus: false });
    if (view === 'map') return ctx.closeWorkspace();
    if (view === 'demo' && !demo) { location.href = '/demo?view=demo'; return; }
    if (view === 'priorities') view = 'homes';
    ctx.closeDetail({ restoreFocus: false });
    $('#overlay-panel').classList.remove('open'); $('#overlay-toggle').setAttribute('aria-expanded', 'false');
    setWorkspaceView(view);
    if (view === 'homes') { $('#queue-title').textContent = 'Devices'; renderList(); }
    else if (view === 'overview') renderOverview();
    else if (view === 'demo') renderDemo();
    (view === 'homes' ? $('#search') : view === 'activity' ? $('#activity-title') : view === 'overview' ? $('#overview-title') : $('#demo-title')).focus({ preventScroll: true });
  };
  ctx.positionDetail = () => {
    const card = $('#detail'), path = $('#detail-connector path');
    if (!S.detailOpen || card.hidden) { path.setAttribute('d', ''); return; }
    const region = S.regions.find(r => r.key === S.selectedRegion);
    const coord = S.selectedRegion ? region?.centroid || (region?.bbox ? [(region.bbox[0] + region.bbox[2]) / 2, (region.bbox[1] + region.bbox[3]) / 2] : null) : S.props.find(p => p.id === S.selectedId)?.coordinates;
    const point = coord ? mv.map.project(coord) : { x: innerWidth / 2, y: innerHeight / 2 };
    const mobile = innerWidth < 700, w = card.offsetWidth, h = card.offsetHeight;
    const left = Math.max(12, Math.min(innerWidth - w - 12, mobile ? point.x - w / 2 : point.x + 26));
    const top = Math.max(S.embed ? 42 : mobile ? 145 : 130, Math.min(innerHeight - h - (S.embed ? 18 : mobile ? 82 : 40), point.y - h - 24));
    card.style.left = left + 'px'; card.style.top = top + 'px';
    const endX = Math.max(left + 18, Math.min(left + w - 18, point.x));
    const endY = point.y > top + h ? top + h : point.y < top ? top : Math.max(top + 18, Math.min(top + h - 18, point.y));
    path.setAttribute('d', coord ? `M${point.x} ${point.y} L${endX} ${endY}` : '');
  };
  mv.map.on('move', ctx.positionDetail);
  new ResizeObserver(() => ctx.positionDetail()).observe($('#detail'));
  window.addEventListener('resize', ctx.positionDetail);
  ctx.revealDetailAnchor = () => {
    if (!S.detailOpen || (!S.embed && innerWidth >= 700)) return;
    const r = S.regions.find(x => x.key === S.selectedRegion);
    const coord = S.selectedRegion ? r?.centroid : S.props.find(p => p.id === S.selectedId)?.coordinates;
    if (!coord) return;
    const point = mv.map.project(coord), targetY = innerHeight - (S.embed ? 30 : 115);
    if (Math.abs(point.y - targetY) > 8) mv.map.panBy([0, point.y - targetY], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200 });
  };

  // ---- selection ----

  function openDetail() {
    ctx.closeViewBuilder?.({ focus: false });
    if (!$('#detail').contains(document.activeElement)) {
      const active = document.activeElement;
      S.detailReturnKey = active?.getAttribute('data-key') || null;
      S.detailReturnFocus = active;
    }
    S.detailOpen = true;
    S.detailExpanded = false;
    $('#detail').classList.remove('is-expanded');
    delete $('#detail').dataset.selection;
    ctx.closeWorkspace({ focus: false });
    // Showing one contextual panel at a time keeps both reachable on small screens.
    $('#overlay-panel').classList.remove('open');
    $('#overlay-toggle').setAttribute('aria-expanded', 'false');
  }
  function focusDetail() {
    requestAnimationFrame(() => {
      if (!S.detailOpen || S.workspaceView) return;
      const active = document.activeElement;
      if (active === document.body || active === S.detailReturnFocus || active?.closest('#device-panel,#overview-panel')) $('#detail-close')?.focus({ preventScroll: true });
    });
  }
  ctx.closeDetail = ({ restoreFocus = true } = {}) => {
    S.detailOpen = false;
    detailPanel.render(); renderList(); renderMap();
    ctx.positionDetail?.();
    if (!restoreFocus) return;
    const previous = S.detailReturnKey ? document.querySelector(`[data-key="${CSS.escape(S.detailReturnKey)}"]`) : S.detailReturnFocus;
    (previous?.isConnected && previous.offsetParent !== null ? previous : S.embed ? mv.map.getCanvas() : $('[data-view="homes"]')).focus({ preventScroll: true });
  };
  ctx.select = (id, { fly = false, auto = false } = {}) => {
    if (!auto) S.userPicked = true;
    if (!auto) openDetail();
    S.selectedId = id; S.selectedRegion = null; S.detailTab = S.detailTab || 'overview';
    const p = S.props.find(x => x.id === id);
    if (p?.coordinates && !auto) {
      if (S.embed) mv.map.once('moveend', () => requestAnimationFrame(() => { if (S.selectedId === id) ctx.revealDetailAnchor(); }));
      mv.flyTo(p.coordinates, 15);
    }
    delete $('#detail').dataset.html;
    detailPanel.render();
    detailPanel.loadDetail(id);
    renderList(); renderMap(); bottom.render();
    if (!auto) focusDetail();
  };
  ctx.selectRegion = key => {
    if (!key) { S.selectedRegion = null; ctx.closeDetail(); return; }
    openDetail();
    S.selectedRegion = key;
    const r = S.regions.find(x => x.key === key); if (r?.bbox) mv.fitTo(r.bbox);
    delete $('#detail').dataset.html;
    detailPanel.render(); renderList(); bottom.render();
    focusDetail();
  };

  // ---- rendering ----

  const sensorValue = (p, key) => p.live?.latest?.[key]?.value ?? p.values?.[key] ?? (key === 'mains_power' ? p.sensors?.mains : key === 'water_detected' ? p.sensors?.water : p.sensors?.[key]);
  const visible = () => {
    const list = S.props.filter(p => matchesFilter(p, { ...S, filter: S.filter === 'power' ? 'all' : S.filter }) && (S.filter !== 'power' || sensorValue(p, 'mains_power') === false));
    const tier = p => Number(String(p.risk?.priority?.tier || (p.severity === 'critical' ? 'P1' : ['elevated', 'watch'].includes(p.severity) ? 'P2' : 'P3')).replace('P', ''));
    return list.sort((a, b) => S.sort === 'power' ? Number(sensorValue(b, 'mains_power') === false) - Number(sensorValue(a, 'mains_power') === false) : S.sort === 'battery' ? (sensorValue(a, 'battery_pct') ?? Infinity) - (sensorValue(b, 'battery_pct') ?? Infinity) : S.sort === 'age' ? (Date.parse(a.lastSeen || a.observedAt) || 0) - (Date.parse(b.lastSeen || b.observedAt) || 0) : tier(a) - tier(b));
  };

  function recompute() { S.props = combineProperties(S.base, [...S.live.devices.values()], Date.now()); }

  function renderOverview() {
    const n = countStatuses(S.props), total = S.props.length;
    const power = S.props.filter(p => sensorValue(p, 'mains_power') === false).length;
    const cards = [['Homes', total, 'all'], ['Critical reports', n.critical, 'critical'], ['Power loss', power, 'power'], ['Unknown conditions', n.unknown, 'unknown']];
    const review = S.props.filter(p => p.severity !== 'normal').sort((a, b) => ['critical', 'elevated', 'watch', 'unknown'].indexOf(a.severity) - ['critical', 'elevated', 'watch', 'unknown'].indexOf(b.severity)).slice(0, 8);
    setHtml($('#overview-content'), `<p class="view-context">${demo ? 'Synthetic scenario · ' + esc(S.demoMeta?.label || 'Loading') : exerciseMode ? 'Authenticated exercise observations' : 'Connected-device observations'}${S.live.limited ? ' · limited to the first 500 devices' : ''}</p><div class="overview-metrics">${cards.map(([label, value, filter]) => `<button class="overview-metric" data-key="overview-${filter}" data-overview-filter="${filter}"><span>${label}</span><strong>${value}</strong><small>View devices</small></button>`).join('')}</div><div class="overview-columns"><section class="overview-section"><div class="section-label"><h3>Review first</h3><span>${review.length} homes</span></div>${review.length ? `<div class="overview-review">${review.map(p => `<button data-key="review-${esc(p.id)}" data-home="${esc(p.id)}"><span><strong>${esc(p.name || p.id)}</strong><small>${esc(p.reasons?.[0] || 'Review the latest observations.')}</small></span><span class="tag ${esc(p.severity)}">${esc(STATUS_LABEL[p.severity])}</span></button>`).join('')}</div>` : '<p class="muted">No active alerts in the available reports. Missing reports still mean unknown conditions.</p>'}</section><section class="overview-section"><h3>Reported conditions</h3><dl class="condition-list">${['critical', 'elevated', 'watch', 'unknown', 'normal'].map(k => `<div><dt><span class="status-dot ${k}" aria-hidden="true"></span>${esc(STATUS_LABEL[k])}</dt><dd>${n[k]}<span>${total ? Math.round(n[k] / total * 100) : 0}%</span></dd></div>`).join('')}</dl><p class="soft-note">${n.offline} homes are not reporting recently. These observations support human review; they do not confirm damage, occupancy or safety.</p><button id="overview-missing" data-overview-filter="offline">Review missing reports</button></section></div>`);
  }

  function renderDemo() {
    if (!demo) return;
    for (const b of document.querySelectorAll('[data-scenario]')) { b.setAttribute('aria-pressed', String(b.dataset.scenario === S.demoScenario)); b.disabled = !!S.demoBusy; }
    const meta = S.demoMeta || SCENARIOS.find(s => s.id === S.demoScenario);
    const water = S.props.filter(p => sensorValue(p, 'water_detected') === true).length;
    const power = S.props.filter(p => sensorValue(p, 'mains_power') === false).length;
    setHtml($('#demo-summary'), `<div><span class="view-context">Current scenario</span><h3>${esc(meta?.label || 'Loading scenario')}</h3><p>${esc(meta?.description || '')}</p></div><dl><div><dt>Fictional homes</dt><dd>${S.props.length}</dd></div><div><dt>Power loss reports</dt><dd>${power}</dd></div><div><dt>Water reports</dt><dd>${water}</dd></div></dl>`);
    $('#demo-status').textContent = S.demoBusy ? 'Loading scenario…' : S.demoError || (S.demoIssuedAt ? 'Snapshot loaded at ' + new Date(S.demoIssuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Choose a scenario to begin.');
    $('#demo-show-map').disabled = !!S.demoBusy || !S.props.length;
    $('#demo-show-overview').disabled = !!S.demoBusy || !S.props.length;
    $('#embed-label').textContent = S.demoBusy ? 'Loading fictional scenario…' : S.demoError ? 'Demo unavailable · open full demo to retry' : (meta?.label || 'Demo') + ' · ' + countStatuses(S.props).critical + ' critical reports · fictional';
  }

  async function loadScenario(id, { initial = false } = {}) {
    if (!demo || !SCENARIOS.some(s => s.id === id)) return false;
    const request = ++S.demoRequest;
    S.demoBusy = true; S.demoError = ''; renderDemo();
    const r = await api('/api/demo?scenario=' + encodeURIComponent(id));
    if (request !== S.demoRequest) return false;
    S.demoBusy = false;
    if (!r.ok || r.data?.synthetic !== true || !Array.isArray(r.data.properties)) {
      S.demoError = 'Scenario could not load. Select it again to retry.';
      renderDemo();
      if (initial) $('#notice').textContent = 'Synthetic scenario unavailable. Open Demo to retry.';
      return false;
    }
    S.demoScenario = r.data.scenario?.id || id;
    S.demoMeta = r.data.scenario; S.demoIssuedAt = r.data.issuedAt;
    ctx.resetViewBuilder?.();
    mv.popupRef?.remove(); mv.popupRef = null;
    S.zoneSel = null; mv.selectZone(null);
    S.base = r.data.properties;
    S.live.feed.unshift({ key: 'scenario:' + r.data.issuedAt, at: r.data.issuedAt, kind: 'scenario', level: 'info', deviceId: null, text: 'Loaded synthetic scenario: ' + (r.data.scenario?.label || id) + '. ' + r.data.properties.length + ' fictional homes.' });
    S.live.feed = S.live.feed.slice(0, 60);
    S.detailOpen = false; S.selectedId = null; S.selectedRegion = null;
    S.filter = 'all'; S.search = ''; S.layerIds = null;
    $('#search').value = ''; $('#filter').value = 'all'; $('#filter').dispatchEvent(new Event('change', { bubbles: true }));
    const wind = r.data.overlays?.exerciseWind || { type: 'FeatureCollection', features: [] };
    mv.setExt('exerciseWind', wind); mv.setVisible('exerciseWind', !!wind.features?.length);
    const zonesOn = id === 'water-hurricane';
    zonesOn ? S.ovOn.add('zones') : S.ovOn.delete('zones'); mv.setVisible('zones', zonesOn);
    $('#quick-wind')?.setAttribute('aria-pressed', String(!!wind.features?.length));
    $('#notice').textContent = (S.demoMeta?.label || 'Scenario') + ' · fictional homes and readings. Read only.';
    recompute(); renderAll(); await loadRegions(); ctx.positionDetail();
    if (!initial && S.embed) fitScenario({ animate: true });
    if (S.embed && window.parent !== window) window.parent.postMessage({ type: 'homebeacon:preview-state', scenarioId: S.demoScenario, label: S.demoMeta?.label || S.demoScenario }, location.origin);
    return true;
  }

  function renderStats() {
    $('#device-count').textContent = String(S.props.length);
    const n = countStatuses(S.props);
    const cards = [['Homes', S.props.length, 'all'], ['Critical', n.critical, 'critical'], ['Unknown', n.unknown, 'unknown'], ['Not reporting', n.offline, 'offline']];
    setHtml($('#stats'), cards.map(([a, b, filter]) => `<button class="stat" data-stat-filter="${filter}" aria-pressed="${S.filter === filter}"><strong>${b}</strong><span>${esc(a)}</span></button>`).join(''));
  }

  function propRow(p) {
    const d = displayStatus(p);
    const chips = [p.link?.linked ? '<span class="chip link">Customer</span>' : '', p.risk?.power?.mode && p.risk.power.mode !== 'normal' ? '<span class="chip power">Power save</span>' : '', p.help?.status && p.help.status !== 'none' ? `<span class="chip help">${esc(HELP_LABEL[p.help.status] || '')}</span>` : '', p.risk?.priority?.tier === 'P1' ? '<span class="chip warn">P1</span>' : ''].join('');
    return `<button class="property" data-key="p-${esc(p.id)}" data-id="${esc(p.id)}" aria-pressed="${S.detailOpen && S.selectedId === p.id && !S.selectedRegion}" aria-controls="detail"><span class="property-title"><strong>${esc(p.name && p.name !== p.id ? p.name : p.id)}</strong><span class="status-dot ${esc(d.status)}" aria-hidden="true"></span></span><small>${esc(p.area || p.id)}</small><span class="property-status"><span class="tag ${esc(d.status)}">${esc(STATUS_LABEL[d.status])}</span>${d.silent ? `<small>Last report ${esc(ageText(p.lastSeen || p.observedAt))}</small>` : '<small>Reporting</small>'}${d.lastKnown && d.status !== 'unknown' ? '<small>Last known</small>' : ''}</span>${chips ? `<span class="property-chips">${chips}</span>` : ''}</button>`;
  }

  function renderList() {
    $('#device-panel').dataset.list = S.queueTab;
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
    const homes = visible(), byId = new Map(homes.map(p => [p.id, p]));
    const fc = deviceFeatures(homes, Date.now(), S.detailOpen ? S.selectedId : null);
    for (const f of fc.features) { const p = byId.get(f.properties.id); f.properties.powerLoss = sensorValue(p, 'mains_power') === false; f.properties.water = sensorValue(p, 'water_detected') === true; }
    mv.setData('devices', fc);
    // Low-zoom location groups show where devices exist without representing
    // unobserved places as monitored. Individual readings remain zoom >= 11.
    const groups = new Map();
    for (const f of fc.features) {
      const [x, y] = f.geometry.coordinates, key = `${Math.floor(x)}:${Math.floor(y)}`;
      const g = groups.get(key) || { x: 0, y: 0, count: 0 };
      g.x += x; g.y += y; g.count++; groups.set(key, g);
    }
    mv.setData('overview', { type: 'FeatureCollection', features: [...groups.values()].map(g => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [g.x / g.count, g.y / g.count] }, properties: { count: g.count } })) });
  }

  function fitHomes() {
    const pts = S.props.filter(p => p.coordinates).map(p => p.coordinates);
    if (!pts.length) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    if (pts.length === 1) return mv.flyTo(pts[0], 14);
    mv.fitTo([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }

  function fitNational({ animate = false } = {}) {
    const mobile = innerWidth < 700;
    S.nationalFitted = true;
    mv.map.fitBounds([[-125, 24], [-66, 50]], {
      padding: { top: mobile ? 165 : 155, right: mobile ? 18 : 40, bottom: mobile ? 105 : 50, left: mobile ? 18 : 40 },
      maxZoom: 5,
      duration: animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 500 : 0,
    });
  }

  function fitScenario({ animate = true } = {}) {
    const florida = S.props.filter(p => p.coordinates?.[0] > -90 && p.coordinates?.[0] < -75).map(p => p.coordinates);
    const bounds = florida.length ? [[Math.min(...florida.map(p => p[0])) - .22, Math.min(...florida.map(p => p[1])) - .15], [Math.max(...florida.map(p => p[0])) + .22, Math.max(...florida.map(p => p[1])) + .15]] : [[-84, 26.8], [-81.6, 29.2]];
    S.nationalFitted = true;
    mv.map.fitBounds(bounds, { padding: S.embed ? { top: 42, right: 24, bottom: 30, left: 24 } : { top: innerWidth < 700 ? 180 : 150, right: 35, bottom: innerWidth < 700 ? 110 : 50, left: 35 }, maxZoom: 10, duration: animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 450 : 0 });
  }

  function renderPill() {
    const el = $('#live-pill');
    const age = S.liveAt ? Math.max(0, Math.round((Date.now() - S.liveAt) / 1000)) : null;
    const t = demo ? ['off', 'Read only']
      : S.liveState === 'live' ? ['on', `Live · updated ${age < 5 ? 'just now' : age + ' seconds ago'}${S.live.mode === 'exercise' ? ' · exercise data' : ''}`]
      : S.liveState === 'unavailable' ? ['off', 'Updates unavailable · retrying']
      : S.liveState === 'retry' ? ['warn', 'Reconnecting']
      : ['off', 'Connecting'];
    el.className = 'live-pill ' + t[0];
    el.textContent = t[1];
    if ((S.live.limited || S.baseLimited) && !demo) $('#notice').textContent = 'Showing up to 500 connected devices. Additional devices are not loaded. Missing reports mean unknown conditions.';
  }

  function renderAll() {
    renderStats(); renderList(); renderMap(); detailPanel.render(); bottom.render(); renderPill(); renderOverview(); renderDemo();
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
  $('#filter').onchange = e => { S.filter = e.target.value; renderStats(); renderList(); renderMap(); };
  $('#stats').addEventListener('click', e => {
    const b = e.target.closest('[data-stat-filter]');
    if (!b) return;
    S.filter = b.dataset.statFilter; S.queueTab = 'homes';
    $('#filter').value = S.filter;
    $('#filter').dispatchEvent(new Event('change', { bubbles: true }));
  });
  $('.workspace-island').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) ctx.openWorkspace(b.dataset.view); });
  document.querySelectorAll('[data-close-view]').forEach(b => b.onclick = () => ctx.closeWorkspace());
  $('#queue-close').onclick = () => ctx.closeWorkspace();
  $('#activity-close').onclick = () => ctx.closeWorkspace();
  $('#overview-content').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.home) return ctx.select(b.dataset.home, { fly: true });
    if (b.dataset.overviewFilter) { S.search = ''; $('#search').value = ''; S.filter = b.dataset.overviewFilter; $('#filter').value = S.filter; S.queueTab = 'homes'; $('#filter').dispatchEvent(new Event('change', { bubbles: true })); ctx.openWorkspace('homes'); }
  };
  $('#demo-scenarios').onclick = e => { const b = e.target.closest('[data-scenario]'); if (b) loadScenario(b.dataset.scenario); };
  $('#demo-show-map').onclick = () => { ctx.closeWorkspace({ focus: false }); fitScenario(); $('[data-view="map"]').focus(); };
  $('#demo-show-overview').onclick = () => ctx.openWorkspace('overview');
  window.addEventListener('message', e => {
    if (!demo || !S.embed || e.origin !== location.origin || e.source !== window.parent || e.data?.type !== 'homebeacon:preview-step' || S.demoBusy) return;
    const at = SCENARIOS.findIndex(s => s.id === S.demoScenario);
    loadScenario(SCENARIOS[(at + 1) % SCENARIOS.length].id);
  });
  $('#home-sort').onchange = e => { S.sort = e.target.value; renderList(); };
  $('#national-view').onclick = () => { ctx.closeDetail({ restoreFocus: false }); ctx.closeWorkspace({ focus: false }); fitNational({ animate: true }); };
  for (const key of ['power', 'water']) $('#quick-' + key).onclick = e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); mv.setHighlight(key, on); };
  $('#quick-weather').onclick = e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); overlays.toggle('nws', on); };
  $('#quick-wind')?.addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); mv.setVisible('exerciseWind', on); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (ctx.closeViewBuilder?.()) { e.preventDefault(); return; }
    if ($('#command-more').open) { $('#command-more').open = false; $('#command-more summary').focus(); return; }
    if ($('#overlay-panel').classList.contains('open')) { $('#overlay-close').click(); return; }
    if (S.detailOpen) { e.preventDefault(); ctx.closeDetail(); }
    else if (S.workspaceView) ctx.closeWorkspace();
  });
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
    if (demo) return loadScenario(S.demoScenario, { initial: true });
    if (exerciseMode) { S.base = []; return true; } // exercise homes arrive through the live feed only
    const r = await api('/api/command-center');
    if (r.status === 401) { location.href = '/login'; return false; }
    if (!r.ok) { $('#notice').textContent = 'Device data is unavailable. No safety conclusion can be drawn. Try again shortly.'; return false; }
    S.baseLimited = !!r.data.limited;
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
        renderStats(); renderList(); renderMap(); detailPanel.render(); bottom.render(); renderOverview();
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
  renderAll();
  overlays.render();
  if (S.selectedId) detailPanel.loadDetail(S.selectedId);
  overlays.loadZones();
  if (demo && !S.embed && route.get('view') === 'demo') ctx.openWorkspace('demo');
  mv.map.once('load', () => loadRegions());
  setInterval(renderPill, 1000);
  setInterval(() => {
    if (document.hidden) return;
    // Synthetic reports are fixed snapshots, but their age still advances.
    // Recompute every surface together so an old report cannot stay green in
    // the map/list while the detail card correctly marks it unknown.
    if (demo) { recompute(); renderAll(); }
    loadRegions();
  }, 20000);
  setInterval(() => { if (!document.hidden) overlays.reloadAll(); }, 120000);

  if (!demo) {
    pollLive();
    setInterval(async () => {
      if (document.hidden || exerciseMode) return;
      const r = await api('/api/command-center');
      if (r.status === 401) { location.href = '/login'; return; }
      if (r.ok) { S.base = mapLegacy(r.data); S.baseLimited = !!r.data.limited; recompute(); renderAll(); if (S.liveState !== 'live' && !S.baseLimited) $('#notice').textContent = 'Live device observations. Refreshed ' + new Date().toLocaleTimeString() + '. Missing reports remain unknown.'; }
      else $('#notice').textContent = 'Refresh failed. Displaying the last loaded observations. Check timestamps before acting.';
    }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(S.timer); pollLive(); } });
  } else {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { recompute(); renderAll(); loadRegions(); } });
  }
  $('#detail').addEventListener('keydown', e => {
    if (e.defaultPrevented) return;
    const tabs = [...document.querySelectorAll('#detail [role=tab]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0 || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.click();
  });
  return { state: S };
}
