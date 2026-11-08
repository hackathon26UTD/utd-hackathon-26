// Geographic inspection card. Kit factories compose the card and evidence disclosure.
import { STATUS_LABEL, HELP_LABEL, HELP_STATUSES, MSG_STATE_TEXT, ageText, displayStatus, linkText, readingRows, latestFromValues, sparkline, messageState, failText, devicesInBbox } from './core.js';
import { setHtml, dateTimeText, toast } from './dom.js';
import { api } from './api.js';

const OUTAGE_TEXT = {
  possible_grid_or_isp_outage: 'Many homes in this cell stopped reporting around the same time. This may be a power or internet outage, not damage to the homes.',
  isolated_offline: 'A few homes in this cell are not reporting. This looks isolated rather than area wide.',
};
const ADVISORY = 'Advisory only. A person must review this. It does not confirm damage, occupancy or that a home is safe to enter.';

export function mountDetail(ctx) {
  const { S, $, esc } = ctx;

  const tag = (status, extra = '') => `<span class="tag ${esc(status)}">${esc(STATUS_LABEL[status] || 'Unknown')}${extra}</span>`;
  const writeOff = () => (ctx.demo ? ' disabled title="Exercise mode is read only"' : '');

  async function loadDetail(id, { quiet = false } = {}) {
    if (ctx.demo) { S.detail = { id, state: 'local', data: null }; return; }
    if (!quiet) S.detail = { id, state: 'loading', data: null };
    const r = await api('/api/ops/device?id=' + encodeURIComponent(id));
    if (S.selectedId !== id) return;
    S.detail = r.ok ? { id, state: 'ok', data: r.data, at: Date.now() } : { id, state: 'unavailable', status: r.status, error: r.error, data: S.detail?.data || null };
    render();
  }

  function render() {
    const el = $('#detail');
    el.hidden = !S.detailOpen;
    if (!S.detailOpen) return;
    const p = S.selectedRegion ? null : S.props.find(x => x.id === S.selectedId);
    const r = S.selectedRegion ? S.regions.find(x => x.key === S.selectedRegion) : null;
    const key = S.selectedRegion || S.selectedId || 'empty';
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
      const close = document.createElement('button'); close.id = 'detail-close'; close.className = 'small'; close.type = 'button'; close.textContent = 'Close'; close.setAttribute('aria-label', 'Close selected details');
      el.replaceChildren(K.sectionBox({ title: r ? 'Area overview' : p?.name || p?.id || 'Home details', desc: ctx.demo ? 'Fictional exercise observation' : 'Connected device observation', actions: close, body }));
      el.dataset.selection = key;
    }
    const shown = p ? displayStatus(p) : { status: r?.counts?.critical ? 'critical' : r?.counts?.elevated ? 'elevated' : r?.counts?.watch ? 'watch' : r?.counts?.unknown ? 'unknown' : r?.counts?.normal ? 'normal' : 'unknown' };
    el.querySelector('.detail-tone').replaceChildren(K.pill(STATUS_LABEL[shown.status], shown.status === 'critical' ? 'bad' : ['elevated', 'watch'].includes(shown.status) ? 'warn' : shown.status === 'normal' ? 'ok' : 'muted'));
    el.querySelector('.card-reason').textContent = r ? `${r.deviceCount} homes in this area${r.hotspot?.is ? ' · elevated activity' : ''}` : p?.reasons?.[0] || 'No recent evidence available.';
    el.querySelector('.card-age').textContent = r ? 'Review individual homes before taking action.' : `Last report ${ageText(p?.lastSeen || p?.observedAt)}${shown.lastKnown ? ' · last known condition' : ''}`;
    el.querySelector('.detail-facts').replaceChildren(K.details({ items: r ? [{ label: 'Area ID', value: r.key }, { label: 'Homes observed', value: r.deviceCount }] : [{ label: 'Device', value: p?.id }, { label: 'Area', value: p?.area || null }] }));
    setHtml(el.querySelector('.detail-content'), r ? regionView(r) : p ? deviceView(p) : emptyView());
    requestAnimationFrame(() => ctx.positionDetail?.());
  }

  function emptyView() {
    return '<h2>Select a home</h2><p>Choose a home from the list or a dot on the map. Connected devices appear after their first report.</p>' + (ctx.demo ? '' : '<p class="muted">Missing reports mean unknown conditions, not confirmed safety.</p>');
  }

  // ---- device ----

  function deviceView(p) {
    const now = Date.now();
    const shown = displayStatus(p, now);
    const D = S.detail?.id === p.id ? S.detail : null;
    const dev = D?.data?.device || D?.data || {};
    const risk = dev.risk || D?.data?.risk || p.risk || null;
    const power = risk?.power || {};
    const link = D?.data?.link || dev.link || p.link;
    const help = D?.data?.help || dev.help || p.help;
    const saver = power.mode && power.mode !== 'normal';
    const chips = [
      tag(shown.status),
      shown.lastKnown && shown.status !== 'unknown' ? '<span class="chip warn">Last known, not recent</span>' : '',
      link?.linked ? '<span class="chip link">Customer linked</span>' : '',
      saver ? `<span class="chip power">${power.mode === 'critical' ? 'Critical power save' : 'Power save mode'}</span>` : '',
      help?.status && help.status !== 'none' ? `<span class="chip help">${esc(HELP_LABEL[help.status] || help.status)}</span>` : '',
      risk?.priority ? `<span class="chip">${esc(risk.priority.tier)} ${esc(risk.priority.label || '')}</span>` : '',
    ].join(' ');
    const tabs = [['overview', 'Overview'], ['readings', 'Readings'], ['logs', 'Logs'], ['messages', 'Messages'], ['customer', 'Customer']];
    const unavailable = D?.state === 'unavailable' ? `<p class="soft-note">${esc(failText(D.status, 'Full device detail', D.error))} Showing the summary only.</p>` : D?.state === 'loading' ? '<p class="soft-note">Loading device detail.</p>' : '';
    return `<div class="chips">${chips}</div>
<div class="tabs" role="tablist" aria-label="Home details">${tabs.map(([k, l]) => `<button role="tab" id="tab-${k}" aria-selected="${S.detailTab === k}" aria-controls="detail-body" data-tab="${k}" data-key="tab-${k}">${l}</button>`).join('')}</div>
<div id="detail-body" role="tabpanel" aria-labelledby="tab-${esc(S.detailTab)}">${unavailable}${body(p, shown, risk, dev, D, link, help, now)}</div>`;
  }

  function body(p, shown, risk, dev, D, link, help, now) {
    if (S.detailTab === 'readings') return readingsTab(p, dev, D, now);
    if (S.detailTab === 'logs') return logsTab(p, D);
    if (S.detailTab === 'messages') return messagesTab(p, D);
    if (S.detailTab === 'customer') return customerTab(p, link, help, D);
    return overviewTab(p, shown, risk, now);
  }

  function overviewTab(p, shown, risk, now) {
    const reasons = risk?.reasons?.length ? risk.reasons : (p.reasons || []).map(text => ({ text, evidence: [] }));
    const quiet = shown.silent ? `<p class="soft-note">${shown.status === 'unknown' ? 'No recent report.' : 'This device has gone quiet.'} Last report ${esc(ageText(p.lastSeen || p.observedAt, now))}. ${shown.status === 'critical' || shown.status === 'elevated' ? 'The last known condition stays on screen until a newer report replaces it.' : 'Unknown does not mean safe.'}</p>` : '';
    const corr = risk?.correlations || [];
    const power = risk?.power;
    return `${quiet}<h3>Why this status</h3><ul class="reasons">${reasons.length ? reasons.map(r => `<li>${esc(r.text)}${(r.evidence || []).map(e => `<small class="evidence">${esc(e.sensor)}${e.value !== undefined ? ' ' + esc(String(e.value)) + (e.unit ? ' ' + esc(e.unit) : '') : ''} · observed ${esc(ageText(e.observedAt, now))}${e.stale ? ' · older report' : ''}</small>`).join('')}</li>`).join('') : '<li>No active sensor alerts in the latest reports.</li>'}</ul>
${corr.length ? `<h3>Area context</h3><ul class="reasons">${corr.map(c => `<li>${esc(c.text)}</li>`).join('')}</ul>` : ''}
${power ? `<dl class="mini"><div><dt>Mains</dt><dd>${power.mains === true ? 'Connected' : power.mains === false ? 'Lost' : 'Not reported'}</dd></div><div><dt>Battery</dt><dd>${power.battery_pct == null ? 'Not reported' : esc(power.battery_pct) + '%'}</dd></div><div><dt>Power mode</dt><dd>${esc(power.mode === 'saver' ? 'Power save mode' : power.mode === 'critical' ? 'Critical power save' : power.mode === 'normal' ? 'Normal' : 'Not reported')}</dd></div></dl>` : ''}
<p class="muted">Last report ${esc(ageText(p.lastSeen || p.observedAt, now))}${p.observedAt ? ' · ' + esc(dateTimeText(p.observedAt)) : ''}</p>
<div class="actions"><button class="primary" id="d-send"${writeOff()}>Send message to this home</button><button id="follow"${writeOff()}>Record follow-up</button></div>${ctx.demo ? '<p class="soft-note">Exercise mode is read only. Sending and notes are turned off.</p>' : ''}
<p><small>${esc(risk?.advisory || ADVISORY)}</small></p>`;
  }

  function readingsTab(p, dev, D, now) {
    const latest = dev.latest || p.live?.latest || latestFromValues(p.values, p.observedAt);
    const series = D?.data?.series || dev.series || {};
    return readingRows(latest, now).map(g => `<h3>${esc(g.title)}</h3><table class="readings"><tbody>${g.rows.map(r => {
      const d = sparkline(series[r.sensor] || []);
      return `<tr><th scope="row">${esc(r.label)}</th><td class="${r.reported ? '' : 'muted'}">${esc(r.text)}</td><td>${d ? `<svg class="spark" viewBox="0 0 120 28" role="img" aria-label="Last hour of ${esc(r.label)}"><path d="${d}"/></svg>` : ''}</td><td class="muted">${r.reported ? esc(ageText(r.ts, now)) + (r.old ? ' (older)' : '') : ''}</td></tr>`;
    }).join('')}</tbody></table>`).join('') + '<p><small>Not reported means unknown, not zero and not safe.</small></p>';
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

  $('#detail').addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'detail-close') return ctx.closeDetail();
    if (t.dataset.tab) { S.detailTab = t.dataset.tab; render(); $('#tab-' + S.detailTab)?.focus(); return; }
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
  });
  $('#detail').addEventListener('input', e => {
    if (e.target.name === 'note') $('#note-count').textContent = `${e.target.value.length}/140`;
  });
  $('#detail').addEventListener('submit', async e => {
    if (e.target.id !== 'help-form') return;
    e.preventDefault();
    if (ctx.demo) return;
    const f = Object.fromEntries(new FormData(e.target));
    const out = $('#help-status');
    out.textContent = 'Saving.';
    const r = await api('/api/ops/help-status', { method: 'POST', body: { device_id: S.selectedId, status: f.status, note: String(f.note || '').trim() } });
    out.textContent = r.ok ? 'Saved. The customer will see this.' : failText(r.status, 'Help status', r.error);
    if (r.ok) { delete $('#detail').dataset.html; loadDetail(S.selectedId, { quiet: true }); }
  });

  return { render, loadDetail };
}
