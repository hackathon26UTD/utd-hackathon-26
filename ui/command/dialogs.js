// Dialogs: send an information box, record a follow-up, public sources, operator view builder, pairing code.
import { MSG_LIMITS, MSG_KINDS, MSG_SEVERITIES, EXPIRY_CHOICES, validateMessage, messageBody, oledPreview, devicesInBbox, failText, ageText, SOURCE_STATUS_TEXT } from './core.js';
import { toast } from './dom.js';
import { api } from './api.js';

const KIND_TEXT = { info: 'Information', condition: 'Current conditions', instruction: 'Instruction' };
const SEV_TEXT = { info: 'Information', advisory: 'Advisory', urgent: 'Urgent. Interrupts the screen' };

export function mountDialogs(ctx) {
  const { S, $, esc } = ctx;

  // ---- information box ----

  let scope = null;

  function scopeOptions() {
    const out = [];
    const sel = S.props.find(p => p.id === S.selectedId);
    if (scope?.type === 'device' || sel) out.push({ id: 'device', text: sel ? `This home: ${sel.name || sel.id}` : 'Selected home', scope: { type: 'device', deviceIds: scope?.type === 'device' ? scope.deviceIds : [S.selectedId] }, count: 1 });
    const reg = S.regions.find(r => r.key === (scope?.type === 'region' ? scope.region : S.selectedRegion));
    if (reg) out.push({ id: 'region', text: `Area ${reg.key}`, scope: { type: 'region', region: reg.key }, count: reg.bbox ? devicesInBbox(S.props, reg.bbox).length : reg.deviceCount });
    const bb = ctx.mv.bbox().map(n => Number(n.toFixed(5)));
    out.push({ id: 'bbox', text: 'Everything in the current map view', scope: { type: 'bbox', bbox: bb }, count: devicesInBbox(S.props, bb).length });
    return out;
  }

  ctx.openMessage = hint => {
    if (ctx.demo) return toast('Exercise mode is read only. Sending is turned off.');
    scope = hint;
    const opts = scopeOptions();
    const startId = hint.type === 'device' ? 'device' : hint.type === 'region' ? 'region' : 'bbox';
    $('#msg-scope').innerHTML = opts.map(o => `<label class="check"><input type="radio" name="scope" value="${o.id}"${o.id === startId ? ' checked' : ''}><span>${esc(o.text)} <small>about ${esc(o.count)} home${o.count === 1 ? '' : 's'}</small></span></label>`).join('');
    $('#msg-scope').dataset.opts = JSON.stringify(opts.map(o => o.scope));
    $('#msg-scope').dataset.ids = JSON.stringify(opts.map(o => o.id));
    $('#msg-kind').innerHTML = MSG_KINDS.map(k => `<option value="${k}">${esc(KIND_TEXT[k])}</option>`).join('');
    $('#msg-severity').innerHTML = MSG_SEVERITIES.map(k => `<option value="${k}">${esc(SEV_TEXT[k])}</option>`).join('');
    $('#msg-expiry').innerHTML = EXPIRY_CHOICES.map(([v, t]) => `<option value="${v}"${v === MSG_LIMITS.defaultExpiryMin ? ' selected' : ''}>${t}</option>`).join('');
    $('#msg-form').reset();
    $('#msg-expiry').value = String(MSG_LIMITS.defaultExpiryMin);
    $('#msg-error').textContent = '';
    $('#msg-result').textContent = '';
    updatePreview();
    $('#msg-dialog').showModal();
    $('#msg-title').focus();
  };

  function current() {
    const f = Object.fromEntries(new FormData($('#msg-form')));
    const ids = JSON.parse($('#msg-scope').dataset.ids || '[]'), scopes = JSON.parse($('#msg-scope').dataset.opts || '[]');
    const i = ids.indexOf(f.scope);
    return { scope: scopes[i] || scopes[0], kind: f.kind, severity: f.severity, title: f.title || '', body: f.body || '', expiresInMin: Number(f.expiresInMin), requiresAck: f.requiresAck === 'on', customerVisible: f.customerVisible === 'on' };
  }

  function updatePreview() {
    const m = current();
    $('#msg-title-count').textContent = `${m.title.length}/${MSG_LIMITS.title}`;
    $('#msg-body-count').textContent = `${m.body.length}/${MSG_LIMITS.body}`;
    $('#msg-title-count').classList.toggle('over', m.title.length > MSG_LIMITS.title);
    $('#msg-body-count').classList.toggle('over', m.body.length > MSG_LIMITS.body);
    const lines = oledPreview(m.title, m.body);
    $('#msg-oled').textContent = lines.concat(Array(MSG_LIMITS.oledRows).fill('')).slice(0, MSG_LIMITS.oledRows).join('\n');
    $('#msg-oled').className = 'oled' + (m.severity === 'urgent' ? ' urgent' : '');
    $('#msg-ack-note').textContent = m.requiresAck ? 'The device will keep showing this until someone presses its button.' : '';
  }

  $('#msg-form').addEventListener('input', updatePreview);
  $('#msg-form').addEventListener('change', updatePreview);
  $('#msg-cancel').onclick = () => $('#msg-dialog').close();
  $('#msg-form').onsubmit = async e => {
    e.preventDefault();
    if (ctx.demo) return;
    const m = current();
    const v = validateMessage(m);
    if (!v.ok) { $('#msg-error').textContent = Object.values(v.errors)[0]; return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    $('#msg-error').textContent = '';
    const r = await api('/api/ops/messages', { method: 'POST', body: messageBody(m) });
    if (btn) btn.disabled = false;
    if (!r.ok) { $('#msg-error').textContent = failText(r.status, 'Sending messages', r.error); return; }
    const n = r.data?.deliveries ?? 0;
    $('#msg-result').textContent = n ? `Queued for ${n} device${n === 1 ? '' : 's'}. Each device shows it at its next check in, usually within a minute.` : 'Saved, but no devices matched. Check the area and try again.';
    toast(n ? `Message queued for ${n} device${n === 1 ? '' : 's'}.` : 'No devices matched.', { error: !n });
    ctx.afterSend?.();
  };

  // ---- follow-up note (existing endpoint) ----

  $('#cancel-follow').onclick = () => $('#follow-dialog').close();
  $('#follow-form').onsubmit = async e => {
    e.preventDefault();
    if (ctx.demo) { $('#follow-status').textContent = 'Exercise note saved for this session only.'; return; }
    try {
      const r = await fetch('/api/followups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: S.selectedId, ...Object.fromEntries(new FormData(e.currentTarget)) }) });
      if (!r.ok) throw Error();
      $('#follow-status').textContent = 'Follow-up recorded.';
    } catch { $('#follow-status').textContent = 'Could not save. Please try again.'; }
  };

  // ---- public sources ----

  $('#sources').onclick = async () => {
    $('#source-dialog').showModal();
    const out = $('#source-list');
    if (ctx.demo) {
      out.innerHTML = '<p><strong>USDA / USGS The National Map</strong><br>Satellite and aerial imagery provides geographic context. Image dates, resolution and coverage vary; it is not live disaster imagery.</p><p><strong>Exercise observations</strong><br>Dallas and Florida homes, readings, wind exposure and zones are fictional. Wind circles are not official storm radii or a forecast.</p><p>Sign in as an operator to load public weather and hazard feeds. National imagery does not imply national monitoring coverage.</p>';
      return;
    }
    out.textContent = 'Loading source status.';
    const [w, f] = await Promise.all([api('/api/weather'), api('/api/feeds')]);
    let html = '';
    if (f.ok) {
      S.feeds = new Map((f.data?.sources || []).map(s => [s.id, s]));
      const weatherArea = S.feeds.get('nws')?.coverage?.area;
      $('#quick-weather').textContent = weatherArea ? 'Weather · ' + String(weatherArea).slice(0, 30) : 'Weather';
      html += (f.data?.sources || []).map(s => `<p><strong>${esc(s.name || s.id)}</strong><br>${esc(SOURCE_STATUS_TEXT[s.status] || s.status)}${s.fetchedAt ? ' · Updated ' + esc(ageText(s.fetchedAt)) : ''}${s.featureCount != null ? ' · ' + esc(s.featureCount) + ' items' : ''}${s.coverage?.area ? `<br><small>Coverage: ${esc(s.coverage.area)}${s.coverage.type ? ' (' + esc(s.coverage.type) + ')' : ''}</small>` : ''}${s.note ? `<br><small>${esc(s.note)}</small>` : ''}${s.attribution ? `<br><small>${esc(s.attribution)}</small>` : ''}</p>`).join('');
    }
    if (w.ok) {
      const d = w.data;
      if (!f.ok) html += (d.sources || []).map(s => `<p><strong>${esc(s.name)}</strong><br>${esc(s.status)}${s.fetchedAt ? ' · Updated ' + esc(new Date(s.fetchedAt).toLocaleTimeString()) : ''}</p>`).join('');
      html += `<p>${d.weather?.features?.length || 0} active Texas weather alerts · ${d.earthquakes?.features?.length || 0} regional earthquakes · ${d.declarations?.length || 0} recent declarations</p>`;
    }
    if (!f.ok && !w.ok) html = '<p>Public feeds are currently unavailable.</p>';
    out.innerHTML = html + '<p>Source availability is checked live. Regional events do not establish individual property damage.</p>';
  };

  // ---- operator view builder (existing /api/layers) ----

  let resetBuilder = () => {};
  ctx.resetViewBuilder = () => {
    resetBuilder(); S.layerIds = null;
    $('#active-layer').classList.add('hidden'); $('#active-layer').textContent = '';
  };

  $('#build-layer').onclick = () => {
    let dialog = $('#layer-dialog');
    if (!dialog) dialog = createBuilder();
    dialog.showModal();
  };

  function createBuilder() {
    const dialog = document.createElement('dialog');
    dialog.id = 'layer-dialog';
    dialog.setAttribute('aria-labelledby', 'layer-title');
    dialog.innerHTML = '<h2 id="layer-title">Build an operator view</h2><p>Choose a verified observation layer or ask the NVIDIA model to suggest one. Original readings stay unchanged.</p><form id="layer-form"><label>Question<textarea name="question" maxlength="1000" placeholder="Which homes lost power and need a check?"></textarea></label><label>Observation layer<select name="filter"><option value="power_lost">Power lost</option><option value="water">Water detected</option><option value="connectivity_lost">Internet interrupted</option><option value="stale">No recent observations</option><option value="battery_low">Low battery</option><option value="critical">Critical observations</option></select></label><div class="tools"><button name="method" value="preset">Preview selected layer</button><button name="method" value="nvidia" class="primary">Ask NVIDIA</button></div></form><div id="layer-result" role="status"></div><div class="tools"><button id="apply-layer" disabled>Apply view</button><button id="close-layer">Close</button></div>';
    document.body.append(dialog);
    let proposal = null, request = 0;
    resetBuilder = () => {
      proposal = null; request++;
      $('#apply-layer').disabled = true; $('#layer-result').textContent = '';
      dialog.close();
    };
    const checks = { power_lost: p => p.sensors?.mains === false, water: p => p.sensors?.water === true, connectivity_lost: p => p.sensors?.wan === false, stale: p => p.stale || p.silent, battery_low: p => p.sensors?.battery_pct <= 20, critical: p => p.severity === 'critical' };
    $('#close-layer').onclick = () => dialog.close();
    $('#layer-form').onsubmit = async e => {
      e.preventDefault();
      const current = ++request;
      proposal = null;
      $('#apply-layer').disabled = true;
      $('#layer-result').textContent = 'Preparing view.';
      const body = Object.fromEntries(new FormData(e.currentTarget));
      body.method = e.submitter?.value || 'preset';
      try {
        let result;
        if (ctx.demo) {
          if (body.method === 'nvidia') throw Error('Sign in as an operator to use the NVIDIA connection.');
          result = { title: $('#layer-form select').selectedOptions[0].textContent, summary: 'Exercise observation filter. No model was used.', ids: S.props.filter(checks[body.filter]).map(p => p.id), mode: 'exercise', generatedAt: new Date().toISOString() };
        } else {
          const r = await api('/api/layers', { method: 'POST', body });
          if (!r.ok) throw Error(r.error || 'Could not build view.');
          result = r.data;
        }
        if (current !== request) return;
        proposal = result;
        $('#layer-result').textContent = `${result.title}: ${result.ids.length} homes. ${result.summary} Source: ${result.mode}. Prepared ${new Date(result.generatedAt).toLocaleTimeString()}.`;
        $('#apply-layer').disabled = false;
      } catch (error) { if (current === request) $('#layer-result').textContent = error.message; }
    };
    $('#apply-layer').onclick = () => {
      if (!proposal) return;
      S.layerIds = new Set(proposal.ids);
      const box = $('#active-layer');
      box.classList.remove('hidden');
      box.textContent = proposal.title + ' · ' + proposal.ids.length + ' homes · ';
      const clear = document.createElement('button');
      clear.textContent = 'Clear view';
      clear.onclick = () => { S.layerIds = null; box.classList.add('hidden'); ctx.renderAll(); };
      box.append(clear);
      ctx.renderAll();
      dialog.close();
    };
    return dialog;
  }

  // ---- pairing code (shown once) ----

  ctx.pair = async id => {
    if (ctx.demo) return toast('Exercise mode is read only.');
    if (!await window.Kit.confirm({title:'Create registration code?',message:'Any earlier unused code stops working.',confirmText:'Create code'})) return;
    const r = await api('/api/ops/pairing', { method: 'POST', body: { device_id: id } });
    if (!r.ok) return toast(failText(r.status, 'Registration codes', r.error), { error: true });
    const d = r.data || {};
    $('#pair-serial').textContent = d.serial || '';
    $('#pair-code').textContent = d.pairingCode || '';
    $('#pair-link').value = d.qrPayload || '';
    $('#pair-dialog').showModal();
  };
  $('#pair-close').onclick = () => { $('#pair-serial').textContent = ''; $('#pair-code').textContent = ''; $('#pair-link').value = ''; $('#pair-dialog').close(); };
  $('#pair-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#pair-link').value); toast('Link copied.'); } catch { $('#pair-link').select(); } };
}
