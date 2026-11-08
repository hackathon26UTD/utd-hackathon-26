import {readingSummary} from './reading-summary.js';
import {showDataTool} from './data-tools.js';
// Full device workspace plus the small area card for regions.
// Kit factories compose the shells. Conditions text comes from the timeline service when it answers,
// and from the same deterministic rules in the browser when it does not.
import { observationClock, observationFreshMs, STATUS_LABEL, HELP_LABEL, HELP_STATUSES, MSG_STATE_TEXT, ageText, displayStatus, linkText, readingRows, latestFromValues, sparkline, messageState, failText, devicesInBbox } from './core.js';
import { setHtml, dateTimeText, toast } from './dom.js';
import { api, exerciseMode } from './api.js';
import { deriveConditions, deriveTimeline, normalizeTimeline, NODE_DEFS, NODE_STATUS_TEXT, NODE_STATUS_GLYPH, ADVISORY_LINE } from './conditions.js';
import { mountWorkflow } from './workflow.js';
import { mountExplain } from './explain.js';

const OUTAGE_TEXT = {
  possible_grid_or_isp_outage: 'Many homes in this cell stopped reporting around the same time. This may be a power or internet outage, not damage to the homes.',
  isolated_offline: 'A few homes in this cell are not reporting. This looks isolated rather than area wide.',
};
const ADVISORY = 'Advisory only. A person must review this. It does not confirm damage, occupancy or that a home is safe to enter.';
const TABS = [['conditions', 'Conditions'], ['workflow', 'Workflow'], ['sensors', 'Sensors'], ['logs', 'Logs'], ['messages', 'Messages'], ['customer', 'Customer']];
const TAB_ALIAS = { overview: 'conditions', readings: 'sensors' };
const TIMELINE_HOURS = 24;

export function mountDetail(ctx) {
  const { S, $, esc } = ctx;
  const exercise = !!ctx.demo || exerciseMode;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const tag = (status, extra = '') => `<span class="tag ${esc(status)}">${esc(STATUS_LABEL[status] || 'Unknown')}${extra}</span>`;
  const writeOff = () => (ctx.demo ? ' disabled title="Exercise mode is read only"' : '');

  // ---- drawer shell ----
  const drawer = document.createElement('aside');
  drawer.id = 'device-drawer'; drawer.className = 'dr'; drawer.hidden = true;
  drawer.setAttribute('role', 'region'); drawer.setAttribute('aria-labelledby', 'dr-title');
  ($('.workspace') || document.body).append(drawer);
  const DR = { id: null, tab: 'conditions', explain: null, wf: null, wfSig: '', padded: false };
  let workflowOpen = false, previousCollapse = false;
  function workflowMode(open) {
    if (open === workflowOpen) return;
    workflowOpen = open;
    if (open) { previousCollapse = ctx.navigation?.collapsed; ctx.navigation?.setCollapsed(true); }
    else { if (ctx.navigation?.collapsed) ctx.navigation.setCollapsed(!!previousCollapse); DR.wf?.pause(); }
  }

  async function loadDetail(id, { quiet = false } = {}) {
    if (ctx.demo) { S.detail = { id, state: 'local', data: null }; loadTimeline(id, { quiet }); return; }
    if (!quiet) S.detail = { id, state: 'loading', data: null };
    const r = await api('/api/ops/device?id=' + encodeURIComponent(id));
    if (S.selectedId !== id) return;
    S.detail = r.ok ? { id, state: 'ok', data: r.data, at: Date.now() } : { id, state: 'unavailable', status: r.status, error: r.error, data: S.detail?.data || null };
    render();
    loadTimeline(id, { quiet });
  }

  // Timeline service: 8 checkpoints and the event history. Without a session (public demo) or when the
  // service does not answer, the same document is derived from the summary the browser already holds.
  async function loadTimeline(id, { quiet = false } = {}) {
    if (ctx.demo || !ctx.role) { S.tl = { id, state: 'local' }; render(); return; }
    if (!quiet || S.tl?.id !== id) { S.tl = { id, state: 'loading' }; render(); }
    const r = await api(`/api/ops/device-timeline?id=${encodeURIComponent(id)}&hours=${TIMELINE_HOURS}`);
    if (S.selectedId !== id) return;
    const tl = r.ok ? normalizeTimeline(r.data) : null;
    S.tl = tl ? { id, state: 'ok', data: tl, at: Date.now() } : { id, state: r.status === 404 || r.status === 405 ? 'missing' : 'unavailable', status: r.status, data: S.tl?.id === id ? S.tl.data : null };
    render();
  }

  function timelineFor(p, D, now) {
    const T = S.tl?.id === p.id ? S.tl : null;
    if (T?.state === 'ok' && T.data) return T.data;
    const reason = exercise && (ctx.demo || !ctx.role) ? 'exercise' : 'service';
    return deriveTimeline({ p, D, now, exercise, reason: exercise ? 'exercise' : reason });
  }

  const tabKey = () => TAB_ALIAS[S.detailTab] || (TABS.some(t => t[0] === S.detailTab) ? S.detailTab : 'conditions');

  function buildShell(p) {
    DR.explain?.destroy(); DR.wf?.destroy(); DR.explain = DR.wf = null; DR.wfSig = '';
    const K = window.Kit;
    const close = document.createElement('button'); close.id = 'detail-close'; close.type = 'button'; close.className = 'dr-close'; close.setAttribute('aria-label', 'Close device details');
    close.innerHTML = '<span class="dr-close-wide">Back to map</span><span class="dr-close-narrow">Back to map</span>';
    const head = document.createElement('header'); head.className = 'dr-head';
    head.innerHTML = `<div class="dr-title-block"><p class="dr-eyebrow">${exercise ? (p.source==='simulation-studio'?'Fictional device · generated location':'Fictional device · mapped address') : 'Connected home'}</p><h2 id="dr-title" tabindex="-1"></h2><p class="dr-sub"></p></div><div class="dr-chips"></div>`;
    head.append(close);
    const tabKit = K.mainTabs({ label: 'Device pages', active: tabKey(), tabs: TABS.map(([id,label]) => ({id,label})), onChange: id => setTab(id) });
    const tabs = tabKit.el; tabs.classList.add('dr-tabs');
    for (const b of tabs.querySelectorAll('[role=tab]')) { b.id = 'tab-' + b.dataset.tab; b.setAttribute('aria-controls', 'dr-p-' + b.dataset.tab); }
    const panels = document.createElement('div'); panels.className = 'dr-panels';
    for (const [k] of TABS) {
      const el = document.createElement('div'); el.id = 'dr-p-' + k; el.className = 'dr-panel'; el.setAttribute('role', 'tabpanel'); el.setAttribute('aria-labelledby', 'tab-' + k); el.hidden = true;
      if (k === 'conditions') {
        const top = document.createElement('div'); top.className = 'dr-cond-top';
        const ex = document.createElement('section'); ex.className = 'dr-explain'; ex.setAttribute('aria-label', 'Model help');
        const act = document.createElement('div'); act.className = 'dr-cond-actions';
        const assist = document.createElement('details'); assist.className='dr-more'; assist.hidden=exercise; const summary=document.createElement('summary'); summary.textContent='Ask about this device'; assist.append(summary,ex); el.append(top,assist,act);
      } else if (k === 'workflow') {
        const wf = document.createElement('div'); wf.className = 'dr-wf'; el.append(wf);
      } else { const b = document.createElement('div'); b.className = 'dr-body'; el.append(b); }
      panels.append(el);
    }
    drawer.replaceChildren(head, tabs, panels);
    DR.explain = mountExplain({ root: drawer.querySelector('.dr-explain'), ctx, deviceId: p.id, exercise });
    DR.id = p.id;
    const loc = document.createElement('section'); loc.className = 'dr-location'; panels.querySelector('#dr-p-conditions').append(loc);
    if (!exercise) api('/api/ops/location?id=' + encodeURIComponent(p.id)).then(r => { if (DR.id !== p.id || !r.ok) return; loc.innerHTML = '<h3>Location</h3><a target="_blank" rel="noopener" href="' + esc(r.data.mapsUrl) + '">Open Google Maps</a>'; if(r.data.googleImageConfigured){const img=document.createElement('img'); img.src='/api/ops/location-image?view=street&id='+encodeURIComponent(p.id); img.alt='Nearby Google Street View. Historical imagery, not current conditions.'; img.onerror=()=>img.replaceWith(document.createTextNode('Google image unavailable.'));loc.append(img); const caption=document.createElement('p');caption.className='muted';caption.textContent='Nearby street photo. It may be old and may not show this exact building.';loc.append(caption);} else loc.append(document.createTextNode(' · Google image is not connected yet.')); });
  }

  function setMapPadding(open, { center = false } = {}) {
    // Device details now occupy the workspace; leave the map camera unchanged.
    const map = ctx.mv?.map; if (map?.getPadding?.().right) map.easeTo({padding:{top:0,bottom:0,left:0,right:0},duration:0});
  }

  function render() {
    const p = S.selectedRegion ? null : S.props.find(x => x.id === S.selectedId);
    const asDrawer = S.detailOpen && !!p;
    drawer.hidden = !asDrawer;
    $('.board')?.toggleAttribute('inert', asDrawer);
    if (asDrawer) $('#workspace-name').textContent = p.name || p.id;
    document.body.classList.toggle('has-drawer', asDrawer);
    if (!asDrawer) {
      workflowMode(false);
      if (!S.workspaceView) $('#workspace-name').textContent='Map';
      if (DR.padded) { DR.padded = false; setMapPadding(false); }
      DR.explain?.destroy(); DR.wf?.destroy(); DR.explain = DR.wf = null; DR.id = null; DR.wfSig = '';
      renderCard();
      return;
    }
    renderCard();
    const fresh = DR.id !== p.id;
    if (fresh) { buildShell(p); }
    if (fresh || !DR.padded) { DR.padded = true; requestAnimationFrame(() => setMapPadding(true, { center: fresh })); }
    paintDrawer(p, fresh);
  }

  function paintDrawer(p, fresh) {
    const now = observationClock(p);
    const shown = displayStatus(p, now);
    const D = S.detail?.id === p.id ? S.detail : null;
    const dev = D?.data?.device || D?.data || {};
    const risk = dev.risk || D?.data?.risk || p.risk || null;
    const link = D?.data?.link || dev.link || p.link;
    const help = D?.data?.help || dev.help || p.help;
    const power = risk?.power || {};
    const saver = power.mode && power.mode !== 'normal';
    drawer.querySelector('#dr-title').textContent = p.name && p.name !== p.id ? p.name : p.id;
    drawer.querySelector('.dr-sub').textContent = [p.id, p.area, p.selfBuilt ? 'Self-built · not verified' : null].filter(Boolean).join(' · ') + (p.observedAt || p.lastSeen ? ` · last report ${ageText(p.lastSeen || p.observedAt, now)}` : ' · no report yet');
    const chips = [
      tag(shown.status),
      `<span class="chip ${exercise ? 'warn' : 'link'}">${exercise ? 'Exercise' : 'Live'}</span>`,
      shown.lastKnown && shown.status !== 'unknown' ? '<span class="chip warn">Last known, not recent</span>' : '',
      link?.linked ? '<span class="chip link">Customer linked</span>' : '',
      saver ? `<span class="chip power">${power.mode === 'critical' ? 'Critical power save' : 'Power save mode'}</span>` : '',
      help?.status && help.status !== 'none' ? `<span class="chip help">${esc(HELP_LABEL[help.status] || help.status)}</span>` : '',
      risk?.priority ? `<span class="chip">${esc(risk.priority.tier)} ${esc(risk.priority.label || '')}</span>` : '',
    ].join(' ');
    setHtml(drawer.querySelector('.dr-chips'), chips);
    const tab = tabKey(); drawer.dataset.tab = tab; if (DR.tab !== tab) { drawer.querySelector('.dr-panels').scrollTop=0; DR.tab=tab; }
    workflowMode(tab === 'workflow');
    for (const b of drawer.querySelectorAll('[role=tab]')) { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    for (const el of drawer.querySelectorAll('.dr-panel')) el.hidden = el.id !== 'dr-p-' + tab;
    const tl = timelineFor(p, D, now);
    const unavailable = D?.state === 'unavailable' ? `<p class="soft-note">${esc(failText(D.status, 'Full device detail', D.error))} Showing the summary only.</p>` : D?.state === 'loading' ? '<p class="soft-note">Loading device detail.</p>' : '';
    if (tab === 'conditions') {
      const c = tl.conditions && Array.isArray(tl.conditions.what) ? tl.conditions : deriveConditions({ p, risk, latest: dev.latest || p.live?.latest || latestFromValues(p.values, p.observedAt), now, exercise });
      setHtml(drawer.querySelector('.dr-cond-top'), unavailable + conditionsHtml(p, shown, c, tl, link, power, now));
      setHtml(drawer.querySelector('.dr-cond-actions'), actionsHtml(p, risk));
    } else if (tab === 'workflow') {
      if (!DR.wf) { DR.wf = mountWorkflow({ root: drawer.querySelector('.dr-wf'), ctx }); DR.wfSig = ''; }
      const st = S.tl?.id === p.id ? S.tl : null;
      if (st?.state === 'loading' && !DR.wfSig) DR.wf.setState('loading', { message: 'Loading the checkpoints and history.' });
      else {
        const sig = JSON.stringify([tl.derived, tl.nodes.map(n => [n.status, n.lastAt, n.counts?.events]), tl.events.length, tl.events.at(-1)?.id, tl.coverage?.truncated]);
        if (sig !== DR.wfSig || fresh) { DR.wfSig = sig; DR.wf.update(tl); }
      }
    } else {
      const body = drawer.querySelector(`#dr-p-${tab} .dr-body`);
      setHtml(body, unavailable + (tab === 'sensors' ? sensorsTab(p, dev, D, risk, now) : tab === 'logs' ? logsTab(p, D) : tab === 'messages' ? messagesTab(p, D) : customerTab(p, link, help, D)));
    }
    if (fresh) requestAnimationFrame(() => { if (S.detailOpen && S.selectedId === p.id && !drawer.contains(document.activeElement)) drawer.querySelector('#dr-title')?.focus({ preventScroll: true }); });
  }

  // ---- area card (regions and the empty state) ----

  function renderCard() {
    const el = $('#detail');
    const p = S.selectedRegion ? null : S.props.find(x => x.id === S.selectedId);
    const show = S.detailOpen && !(p && !S.selectedRegion);
    el.hidden = !show;
    if (!show) return;
    const r = S.selectedRegion ? S.regions.find(x => x.key === S.selectedRegion) : null;
    const key = S.selectedRegion || 'empty';
    const K = window.Kit;
    if (el.dataset.selection !== key) {
      const body = document.createElement('div');
      const tone = document.createElement('div'); tone.className = 'detail-tone';
      const reason = document.createElement('p'); reason.className = 'card-reason';
      const age = document.createElement('p'); age.className = 'card-age';
      const panel = document.createElement('div'); panel.id = 'detail-expanded'; panel.hidden = !S.detailExpanded;
      const facts = document.createElement('div'); facts.className = 'detail-facts';
      const content = document.createElement('div'); content.className = 'detail-content';
      panel.append(facts, content);
      const footer = document.createElement('div'); footer.className = 'card-footer';
      const label = document.createElement('span'); label.textContent = 'View evidence';
      const fold = K.foldOpen({ label: 'Expand evidence', panel, open: !!S.detailExpanded, onToggle: open => { S.detailExpanded = open; el.classList.toggle('is-expanded', open); label.textContent = open ? 'Hide evidence' : 'View evidence'; fold.setAttribute('aria-label', open ? 'Collapse evidence' : 'Expand evidence'); requestAnimationFrame(() => { ctx.positionDetail?.(); if (open) ctx.revealDetailAnchor?.(); }); } });
      fold.id = 'detail-expand';
      footer.append(label, fold);
      body.append(tone, reason, age, footer, panel);
      const close = document.createElement('button'); close.id = 'region-detail-close'; close.className = 'small'; close.type = 'button'; close.textContent = 'Close'; close.setAttribute('aria-label', 'Close selected details');
      el.replaceChildren(K.sectionBox({ title: r ? 'Area overview' : 'Home details', desc: ctx.demo ? 'Fictional exercise observation' : 'Connected device observation', actions: close, body }));
      el.dataset.selection = key;
    }
    const shown = { status: r?.counts?.critical ? 'critical' : r?.counts?.elevated ? 'elevated' : r?.counts?.watch ? 'watch' : r?.counts?.unknown ? 'unknown' : r?.counts?.normal ? 'normal' : 'unknown' };
    el.querySelector('.detail-tone').replaceChildren(K.pill(STATUS_LABEL[shown.status], shown.status === 'critical' ? 'bad' : ['elevated', 'watch'].includes(shown.status) ? 'warn' : shown.status === 'normal' ? 'ok' : 'muted'));
    el.querySelector('.card-reason').textContent = r ? `${r.deviceCount} homes in this area${r.hotspot?.is ? ' · elevated activity' : ''}` : 'No recent evidence available.';
    el.querySelector('.card-age').textContent = r ? 'Review individual homes before taking action.' : 'This home is not loaded yet.';
    el.querySelector('.detail-facts').replaceChildren(K.details({ items: r ? [{ label: 'Area ID', value: r.key }, { label: 'Homes observed', value: r.deviceCount }] : [{ label: 'Device', value: S.selectedId || null }] }));
    setHtml(el.querySelector('.detail-content'), r ? regionView(r) : emptyView());
    requestAnimationFrame(() => ctx.positionDetail?.());
  }

  function emptyView() {
    return '<h2>Select a home</h2><p>Choose a home from the list or a dot on the map. Connected devices appear after their first report.</p>' + (ctx.demo ? '' : '<p class="muted">Missing reports mean unknown conditions, not confirmed safety.</p>');
  }

  // ---- conditions tab ----

  const list = items => `<ul>${(items || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;

  function conditionsHtml(p, shown, c, tl, link, power, now) {
    const reporting = tl.nodes.filter(n => ['ok', 'warn', 'critical'].includes(n.status)).length;
    const silentNote = shown.silent && shown.status !== 'unknown' ? '<span class="chip warn">Last known</span>' : '';
    const latest = p.live?.latest || latestFromValues(p.values, p.observedAt);
    const read = keys => { for (const key of keys) { const r = latest?.[key]; if (r && now - Date.parse(r.ts || p.observedAt || '') <= observationFreshMs(p)) return r.value; } return null; };
    const powerValue = read(['mains_power','power.mains','main_power_available']);
    const wifiValue = read(['wifi_connected','wan_connected']);
    const signal = (label,value) => `<div class="dr-signal ${value === true || value === 1 ? 'ok' : value === false || value === 0 ? 'warn' : 'unknown'}"><span>${label}</span><strong>${value === true || value === 1 ? 'Connected' : value === false || value === 0 ? 'Disconnected' : 'Not reported'}</strong></div>`;
    const signals = signal('Power', powerValue) + signal('Wi-Fi', wifiValue) + `<div class="dr-signal ${shown.status === 'normal' ? 'ok' : shown.status === 'critical' ? 'critical' : shown.status === 'unknown' ? 'unknown' : 'warn'}"><span>Sensors</span><strong>${shown.status === 'normal' ? 'Normal readings' : shown.status === 'unknown' ? 'Not reported' : 'Needs review'}</strong></div>`;
    const observations=readingSummary(latest,now,observationFreshMs(p)).map(r=>`<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd><small>${esc(r.note)}</small></div>`).join('');
    const path = tl.nodes.map((n, i) => `<li><button type="button" class="dr-step wf-s-${esc(n.status)}${n.source === 'not_recorded' ? ' is-dashed' : ''}" data-wf="${esc(n.id)}" aria-label="${esc(`${i + 1}. ${n.label}, ${NODE_STATUS_TEXT[n.status]}. Open in the workflow.`)}"><span class="dr-step-g" aria-hidden="true">${esc(NODE_STATUS_GLYPH[n.status] || '?')}</span><span class="dr-step-l">${esc(n.label)}</span><small>${esc(NODE_STATUS_TEXT[n.status])}</small></button></li>`).join('');
    return `<div class="dr-hero dr-tone-${esc(shown.status)}"><div class="dr-hero-main"><p class="dr-eyebrow">Overall conditions</p><h3 class="dr-headline">${esc(shown.status === "normal" ? "Reporting normally" : shown.status === "unknown" ? "Waiting for a report" : shown.status === "critical" ? "Needs urgent review" : "Check this device")}</h3><p class="dr-fresh">Last report ${esc(ageText(p.lastSeen || p.observedAt, now))}</p></div><div class="dr-signals">${signals}</div></div>
${observations ? `<dl class="dr-observation-summary" aria-label="Latest sensor observations">${observations}</dl>` : '<p class="soft-note">No sensor readings received yet.</p>'}
<details class="dr-more"><summary>Why this status · more details</summary><div class="dr-cols"><section class="dr-card"><h4>What we see</h4>${list(c.what)}</section><section class="dr-card"><h4>Why it matters</h4>${list(c.why)}</section><section class="dr-card dr-card--unknown"><h4>What we do not know</h4>${list(c.unknown)}</section><section class="dr-card dr-card--next"><h4>What a person should do next</h4>${list(c.nextSteps)}</section></div></details>
<details class="dr-more"><summary>Report checkpoints</summary><section class="dr-path" aria-label="Path of a report through the checkpoints"><div class="dr-path-head"><h4>Where this report has been</h4><button type="button" data-tabgo="workflow" class="dr-linkbtn">Open the workflow</button></div><ol>${path}</ol></section></details>
<p class="dr-advisory">${esc(c.advisory || ADVISORY_LINE)}</p>`;
  }

  function actionsHtml(p, risk) {
    return `<h4 class="dr-actions-h">Actions</h4><div class="actions"><button class="primary" id="d-send"${writeOff()}>Send message to this home</button><button id="follow"${writeOff()}>Record follow-up</button>${ctx.demo ? '' : '<button data-data-tool="location">Location image</button><button data-data-tool="stats">History and averages</button><button data-data-tool="response">Preview responder message</button><button data-data-tool="settings">Board message polling</button>'}</div>${ctx.demo ? '<p class="soft-note">Exercise mode is read only. Sending and notes are turned off.</p>' : ''}<p><small>${esc(ADVISORY_LINE)} It does not confirm damage, occupancy or entry conditions.</small></p>`;
  }

  // ---- other device tabs ----

  function sensorsTab(p, dev, D, risk, now) {
    const latest = dev.latest || p.live?.latest || latestFromValues(p.values, p.observedAt);
    const series = D?.data?.series || dev.series || {};
    const power = risk?.power;
    const reasons = risk?.reasons?.length ? risk.reasons : (p.reasons || []).map(text => ({ text, evidence: [] }));
    const corr = risk?.correlations || [];
    return `<h3>Why this tier</h3><ul class="reasons">${reasons.length ? reasons.map(r => `<li>${esc(r.text)}${(r.evidence || []).map(e => `<small class="evidence">${esc(e.sensor)}${e.value !== undefined ? ' ' + esc(String(e.value)) + (e.unit ? ' ' + esc(e.unit) : '') : ''} · observed ${esc(ageText(e.observedAt, now))}${e.stale ? ' · older report' : ''}</small>`).join('')}</li>`).join('') : '<li>No active sensor alerts in the latest reports.</li>'}</ul>
${corr.length ? `<h3>Area context</h3><ul class="reasons">${corr.map(c => `<li>${esc(c.text)}</li>`).join('')}</ul>` : ''}
${power ? `<dl class="mini"><div><dt>Mains</dt><dd>${power.mains === true ? 'Connected' : power.mains === false ? 'Lost' : 'Not reported'}</dd></div><div><dt>Battery</dt><dd>${power.battery_pct == null ? 'Not reported' : esc(power.battery_pct) + '%'}</dd></div><div><dt>Power mode</dt><dd>${esc(power.mode === 'saver' ? 'Power save mode' : power.mode === 'critical' ? 'Critical power save' : power.mode === 'normal' ? 'Normal' : 'Not reported')}</dd></div></dl>` : ''}
` + readingRows(latest, now, observationFreshMs(p,30*60000)).map(g => `<h3>${esc(g.title)}</h3><table class="readings"><tbody>${g.rows.map(r => {
      const d = sparkline(series[r.sensor] || []);
      return `<tr><th scope="row">${esc(r.label)}</th><td class="${r.reported ? '' : 'muted'}">${esc(r.text)}</td><td>${d ? `<svg class="spark" viewBox="0 0 120 28" role="img" aria-label="Last hour of ${esc(r.label)}"><path d="${d}"/></svg>` : ''}</td><td class="muted">${r.reported ? esc(ageText(r.ts, now)) + (r.old ? ' (older)' : '') : ''}</td></tr>`;
    }).join('')}</tbody></table>`).join('') + '<p><small>Not reported means unknown, not zero and not fine.</small></p>';
  }

  function logsTab(p, D) {
    const logs = D?.data?.logs || [];
    if (!D?.data) return '<p class="muted">Device logs are not available yet.</p>';
    return `<div class="actions"><button id="open-logs">Open in logs panel</button></div>` + (logs.length ? `<ul class="log-list">${logs.map(l => `<li><span class="lvl ${esc(l.level || 'info')}">${esc(l.level || 'info')}</span> <small>${esc(dateTimeText(l.at || l.ts))}</small><br>${esc(l.code ? l.code + ': ' : '')}${esc(l.msg || '')}</li>`).join('')}</ul>` : '<p class="muted">No log entries yet.</p>');
  }

  function messagesTab(p, D) {
    const msgs = D?.data?.messages || [];
    return `<div class="actions"><button class="primary" id="d-send"${writeOff()}>New message</button></div>` + (msgs.length ? `<ul class="log-list">${msgs.map(m => { const st = messageState(m, p.id); return `<li><strong>${esc(m.title)}</strong> <span class="chip st-${esc(st)}">${esc(MSG_STATE_TEXT[st] || st)}</span><br>${esc(m.body || '')}<br><small>${esc(m.severity || 'info')} · ${m.customerVisible ? 'customer can see' : 'device only'} · ${esc(dateTimeText(m.createdAt))}</small>${st === 'queued' || st === 'delivered' ? `<br><button class="small" data-cancel="${esc(m.id)}"${writeOff()}>Cancel</button>` : ''}</li>`; }).join('')}</ul>` : '<p class="muted">No messages sent to this device.</p>');
  }

  function customerTab(p, link, help, D) {
    const history = help?.history || D?.data?.helpHistory || [];
    return `<h3>Linked customer</h3><p>${esc(linkText(link))}</p>${link?.linked ? `<p><small>${link.consent ? 'The customer agreed to be contacted about this device.' : 'No consent to contact has been recorded.'}${link.email && link.consent ? ' Email: ' + esc(link.email) : ''}</small></p>` : '<p><small>Create a registration code so the customer can link this device to their account.</small></p>'}
<div class="actions"><button id="d-pair"${writeOff()}>${link?.linked ? 'Create a new registration code' : 'Create registration code'}</button></div>
<h3>Help status shown to the customer</h3><p><small>Set by a person only. Nothing is changed automatically.</small></p>
<form id="help-form" class="stack"><label>Status<select name="status"${writeOff()}>${HELP_STATUSES.map(s => `<option value="${s}"${(help?.status || 'none') === s ? ' selected' : ''}>${esc(HELP_LABEL[s])}</option>`).join('')}</select></label><label><span class="labrow">Note for the customer <small id="note-count" class="count">0/140</small></span><textarea name="note" maxlength="140" rows="2"${writeOff()}>${esc(help?.note || '')}</textarea></label><button class="primary"${writeOff()}>Save help status</button><p id="help-status" role="status"></p></form>
${history.length ? `<h3>History</h3><ul class="log-list">${history.slice(-6).reverse().map(h => `<li>${esc(HELP_LABEL[h.status] || h.status)} <small>${esc(dateTimeText(h.updatedAt || h.at))}${h.updatedBy ? ' · ' + esc(h.updatedBy) : ''}</small>${h.note ? '<br>' + esc(h.note) : ''}</li>`).join('')}</ul>` : ''}`;
  }

  // ---- region ----

  function regionView(r) {
    if (!r) return emptyView();
    const c = r.counts || {};
    const inside = r.bbox ? devicesInBbox(S.props, r.bbox) : [];
    return `<div class="eyebrow">Area summary</div><h2>Area ${esc(r.key)}</h2><p class="muted">${esc(r.deviceCount)} homes with devices</p>
<div class="chips">${['critical', 'elevated', 'watch', 'unknown', 'normal'].filter(k => c[k] > 0).map(k => `<span class="tag ${k}">${c[k]} ${esc(STATUS_LABEL[k])}</span>`).join(' ')}${r.hotspot?.is ? ' <span class="chip warn">Hot spot</span>' : ''}${r.priority?.tier ? ` <span class="chip">${esc(r.priority.tier)}</span>` : ''}</div>
${r.outage && OUTAGE_TEXT[r.outage] ? `<p class="soft-note">${esc(OUTAGE_TEXT[r.outage])}</p>` : ''}
${r.hotspot?.is && r.hotspot.reasons?.length ? `<h3>Why this is a hot spot</h3><ul class="reasons">${r.hotspot.reasons.map(t => `<li>${esc(typeof t === 'string' ? t : t.text)}</li>`).join('')}</ul>` : ''}
${r.correlations?.length ? `<h3>Area context</h3><ul class="reasons">${r.correlations.map(x => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}
<div class="actions"><button class="primary" id="r-send"${writeOff()}>Send message to this area</button><button id="r-zoom">Zoom to area</button><button id="r-logs">View area logs</button><button id="r-clear">Back to homes</button></div>
${inside.length ? `<h3>Homes in this area</h3><ul class="log-list">${inside.slice(0, 40).map(p => `<li><button class="link-button" data-pick="${esc(p.id)}">${esc(p.name || p.id)}</button> ${tag(displayStatus(p).status)}</li>`).join('')}</ul>` : ''}
<p><small>${esc(r.advisory || ADVISORY)}</small></p>`;
  }

  // ---- events ----

  function forceRender() { for (const el of drawer.querySelectorAll('[data-html]')) delete el.dataset.html; delete $('#detail').dataset.html; }
  function setTab(k) {
    S.detailTab = k; render();
    drawer.querySelector('#tab-' + k)?.focus({ preventScroll: true });
  }

  async function onClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.dataTool) { const p = S.props.find(p => p.id === S.selectedId); if (p) return showDataTool(ctx, t.dataset.dataTool, p); return; }
    if (t.id === 'detail-close' || t.id === 'region-detail-close') return ctx.closeDetail();
    if (t.dataset.tab) return setTab(t.dataset.tab);
    if (t.dataset.tabgo) return setTab(t.dataset.tabgo);
    if (t.dataset.wf) { S.detailTab = 'workflow'; render(); DR.wf?.selectNode(t.dataset.wf); drawer.querySelector('#tab-workflow')?.focus({ preventScroll: true }); return; }
    if (t.dataset.pick) return ctx.select(t.dataset.pick, { fly: true });
    if (t.dataset.cancel) {
      const r = await api('/api/ops/messages?id=' + encodeURIComponent(t.dataset.cancel), { method: 'DELETE' });
      toast(r.ok ? 'Message cancelled.' : failText(r.status, 'Cancelling', r.error), { error: !r.ok });
      return loadDetail(S.selectedId, { quiet: true });
    }
    if (t.id === 'd-send') return ctx.openMessage({ type: 'device', deviceIds: [S.selectedId] });
    if (t.id === 'r-send') return ctx.openMessage({ type: 'region', region: S.selectedRegion });
    if (t.id === 'follow') { $('#follow-status').textContent = ''; $('#follow-dialog').showModal(); return; }
    if (t.id === 'open-logs') return ctx.showLogs({ deviceId: S.selectedId });
    if (t.id === 'r-logs') return ctx.showLogs({ region: S.selectedRegion });
    if (t.id === 'r-zoom') { const r = S.regions.find(x => x.key === S.selectedRegion); if (r?.bbox) ctx.mv.fitTo(r.bbox); return; }
    if (t.id === 'r-clear') return ctx.selectRegion(null);
    if (t.id === 'd-pair') return ctx.pair(S.selectedId);
  }
  const onInput = e => { if (e.target.name === 'note') drawer.querySelector('#note-count').textContent = `${e.target.value.length}/140`; };
  const onSubmit = async e => {
    if (e.target.id !== 'help-form') return;
    e.preventDefault();
    if (ctx.demo) return;
    const f = Object.fromEntries(new FormData(e.target));
    const out = drawer.querySelector('#help-status');
    out.textContent = 'Saving.';
    const r = await api('/api/ops/help-status', { method: 'POST', body: { device_id: S.selectedId, status: f.status, note: String(f.note || '').trim() } });
    out.textContent = r.ok ? 'Saved. The customer will see this.' : failText(r.status, 'Help status', r.error);
    if (r.ok) { forceRender(); loadDetail(S.selectedId, { quiet: true }); }
  };
  for (const el of [$('#detail'), drawer]) { el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('submit', onSubmit); }
  addEventListener('resize', () => { if (DR.padded && !drawer.hidden) setMapPadding(true); });

  // Surface used by the map and the list (see docs/MAP_V2_SPEC.md section 6).
  function openDevice(id, { tab } = {}) { if (tab) S.detailTab = tab; ctx.select(id); }
  function closeDevice({ restoreFocus = true } = {}) { ctx.closeDetail({ restoreFocus }); }
  function openRegion(key) { ctx.selectRegion(key); }
  ctx.drawer = { openDevice, closeDevice, openRegion, render: () => render(), element: drawer };

  return { render, loadDetail, openDevice, closeDevice, openRegion };
}
