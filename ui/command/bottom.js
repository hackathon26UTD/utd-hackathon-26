// Bottom panel: live feed, searchable logs, and sent messages.
import { devicesInBbox, inScope, logsUrl, failText, messageState, MSG_STATE_TEXT } from './core.js';
import { setHtml, timeText, dateTimeText, toast } from './dom.js';
import { api } from './api.js';

export function mountBottom(ctx) {
  const { S, $, esc } = ctx;
  S.bottomTab = 'feed'; S.feedScope = 'all'; S.logs = { state: 'idle', entries: [] }; S.logQuery = { kind: 'all', level: 'all', sinceMin: 60, deviceId: '', region: '' }; S.sent = { state: 'idle', items: [] };

  const nameOf = id => { const p = S.props.find(x => x.id === id); return p ? p.name || p.id : id ? String(id).slice(-6) : ''; };

  function scopeIds() {
    if (S.feedScope === 'device' && S.selectedId) return new Set([S.selectedId]);
    if (S.feedScope === 'region') { const r = S.regions.find(x => x.key === S.selectedRegion); if (r?.bbox) return new Set(devicesInBbox(S.props, r.bbox).map(p => p.id)); }
    return null;
  }

  function render() {
    for (const b of document.querySelectorAll('[data-btab]')) b.setAttribute('aria-selected', String(b.dataset.btab === S.bottomTab));
    const el = $('#bottom-body');
    if (S.bottomTab === 'feed') setHtml(el, feedView());
    else if (S.bottomTab === 'logs') setHtml(el, logsView());
    else setHtml(el, sentView());
  }

  function feedView() {
    const scope = S.feedScope === 'all' ? 'all' : 'scoped';
    const ids = scopeIds();
    const items = S.live.feed.filter(i => inScope(i, scope, ids)).slice(0, 60);
    const note = ctx.demo ? 'Exercise mode has no live stream. Switch to a signed in operator session to watch real updates.' : S.liveState === 'unavailable' ? 'Live updates are not available yet.' : '';
    return `<div class="bar"><label>Show<select id="feed-scope"><option value="all"${S.feedScope === 'all' ? ' selected' : ''}>Everything</option><option value="device"${S.feedScope === 'device' ? ' selected' : ''}>Selected home${S.selectedId ? ': ' + esc(nameOf(S.selectedId)) : ''}</option><option value="region"${S.feedScope === 'region' ? ' selected' : ''}>Selected area${S.selectedRegion ? ': ' + esc(S.selectedRegion) : ''}</option></select></label><small>${esc(items.length)} recent updates</small></div>${note ? `<p class="soft-note">${esc(note)}</p>` : ''}
<ol class="feed" aria-label="Recent updates">${items.length ? items.map(i => `<li class="${esc(i.kind)}"><time>${esc(timeText(i.at))}</time><span class="kind">${esc(i.kind)}</span><span class="lvl ${esc(i.level)}">${esc(i.level)}</span><span class="txt">${i.deviceId ? `<button class="link-button" data-pick="${esc(i.deviceId)}" data-key="f-${esc(i.key)}">${esc(nameOf(i.deviceId))}</button> ` : ''}${esc(i.text)}</span></li>`).join('') : '<li class="muted empty">Nothing new yet. Updates appear here as devices report.</li>'}</ol>`;
  }

  function logsView() {
    const q = S.logQuery, L = S.logs;
    const opt = (v, cur, t) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${t}</option>`;
    const rows = L.entries.map(e => {
      const audit = e.action !== undefined;
      return `<tr><td>${esc(dateTimeText(e.at))}</td><td>${audit ? 'Audit' : esc(e.source === 'server' ? 'Server' : 'Device')}</td><td><span class="lvl ${esc(e.level || 'info')}">${esc(e.level || (audit ? 'info' : ''))}</span></td><td>${e.deviceId ? `<button class="link-button" data-pick="${esc(e.deviceId)}">${esc(nameOf(e.deviceId))}</button>` : ''}</td><td>${audit ? esc((e.actor?.type || 'system') + ' ' + String(e.action).replace(/_/g, ' ')) + (e.details ? ` <small>${esc(JSON.stringify(e.details).slice(0, 160))}</small>` : '') : esc((e.code ? e.code + ': ' : '') + (e.msg || ''))}</td></tr>`;
    }).join('');
    const status = L.state === 'loading' ? 'Loading.' : L.state === 'unavailable' ? esc(L.text) : L.state === 'ok' ? `${L.entries.length} entries${L.entries.length >= 500 ? ' (limit reached, narrow the filters)' : ''}` : '';
    return `<form id="log-form" class="bar wrap"><label>Type<select name="kind">${opt('all', q.kind, 'All')}${opt('device', q.kind, 'Device logs')}${opt('audit', q.kind, 'Audit trail')}</select></label><label>Level<select name="level">${['all', 'debug', 'info', 'warn', 'error'].map(v => opt(v, q.level, v === 'all' ? 'All' : v)).join('')}</select></label><label>Period<select name="sinceMin">${[[15, 'Last 15 minutes'], [60, 'Last hour'], [1440, 'Last 24 hours'], [10080, 'Last 7 days']].map(([v, t]) => opt(v, q.sinceMin, t)).join('')}</select></label><label>Home<select name="deviceId"><option value="">Any home</option>${S.props.slice(0, 500).map(p => opt(p.id, q.deviceId, esc(p.name || p.id))).join('')}</select></label><label>Area<input name="region" value="${esc(q.region)}" placeholder="gh5:9vgm0" maxlength="20"></label><button class="primary">Search</button><button type="button" id="log-export"${L.entries.length ? '' : ' disabled'}>Download</button></form>
<p role="status" class="muted">${status}</p><div class="table-wrap"><table class="logs"><thead><tr><th>Time</th><th>From</th><th>Level</th><th>Home</th><th>Entry</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No entries to show.</td></tr>'}</tbody></table></div>`;
  }

  function sentView() {
    const I = S.sent;
    const status = I.state === 'unavailable' ? esc(I.text) : I.state === 'loading' ? 'Loading.' : '';
    return `<div class="bar"><button id="sent-refresh">Refresh</button><small>${status}</small></div><ul class="log-list sent">${I.items.length ? I.items.map(m => {
      const ds = m.deliveries || [];
      const counts = ds.reduce((a, d) => { a[d.state] = (a[d.state] || 0) + 1; return a; }, {});
      const summary = ds.length ? Object.entries(counts).map(([k, n]) => `${n} ${MSG_STATE_TEXT[k] || k}`).join(', ') : MSG_STATE_TEXT[messageState(m, '')] || '';
      return `<li><strong>${esc(m.title)}</strong> <span class="chip">${esc(m.severity || 'info')}</span><br>${esc(m.body || '')}<br><small>${esc(dateTimeText(m.createdAt))} · ${esc(summary)}${m.customerVisible ? ' · customer can see' : ''}</small>${!ctx.demo && !['cancelled', 'expired'].includes(m.state) ? `<br><button class="small" data-cancel-msg="${esc(m.id)}">Cancel</button>` : ''}</li>`;
    }).join('') : '<li class="muted">No messages sent yet.</li>'}</ul>`;
  }

  async function runLogs() {
    if (ctx.demo) { S.logs = { state: 'unavailable', text: 'Logs are recorded for live devices. Exercise mode has none.', entries: [] }; return render(); }
    S.logs.state = 'loading'; render();
    const r = await api(logsUrl(S.logQuery));
    S.logs = r.ok ? { state: 'ok', entries: r.data?.entries || [] } : { state: 'unavailable', text: failText(r.status, 'Logs', r.error), entries: [] };
    render();
  }

  async function loadSent() {
    if (ctx.demo) { S.sent = { state: 'unavailable', text: 'Exercise mode does not send messages.', items: [] }; return render(); }
    S.sent.state = 'loading'; render();
    const r = await api('/api/ops/messages?limit=50');
    S.sent = r.ok ? { state: 'ok', items: r.data?.messages || [] } : { state: 'unavailable', text: failText(r.status, 'Sent messages', r.error), items: [] };
    render();
  }

  function show(tab) {
    S.bottomTab = tab;
    if (tab === 'logs') runLogs(); else if (tab === 'sent') loadSent(); else render();
  }

  // Called from the detail panel buttons.
  function showLogs({ deviceId = '', region = '' } = {}) {
    S.logQuery = { ...S.logQuery, deviceId, region, kind: 'all' };
    show('logs');
    $('#timeline').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  $('#timeline').addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.btab) return show(t.dataset.btab);
    if (t.dataset.pick) return ctx.select(t.dataset.pick, { fly: true });
    if (t.id === 'sent-refresh') return loadSent();
    if (t.dataset.cancelMsg) {
      const r = await api('/api/ops/messages?id=' + encodeURIComponent(t.dataset.cancelMsg), { method: 'DELETE' });
      toast(r.ok ? 'Message cancelled.' : failText(r.status, 'Cancelling', r.error), { error: !r.ok });
      return loadSent();
    }
    if (t.id === 'log-export') {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), mode: S.live.mode || 'live', query: S.logQuery, entries: S.logs.entries }, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'homebeacon-logs.json'; a.click(); URL.revokeObjectURL(url);
    }
  });
  $('#timeline').addEventListener('change', e => { if (e.target.id === 'feed-scope') { S.feedScope = e.target.value; delete $('#bottom-body').dataset.html; render(); } });
  $('#timeline').addEventListener('submit', e => {
    if (e.target.id !== 'log-form') return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    S.logQuery = { kind: f.kind, level: f.level, sinceMin: Number(f.sinceMin), deviceId: f.deviceId, region: f.region.trim() };
    delete $('#bottom-body').dataset.html;
    runLogs();
  });

  return { render, show, showLogs };
}
