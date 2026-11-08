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

  const builderTriggers = () => [$('#build-layer'), $('#open-view-builder')].filter(Boolean);
  let builderReturnFocus = null;
  ctx.closeViewBuilder = ({ focus = true } = {}) => {
    const panel = $('#layer-dialog');
    if (!panel || panel.hidden) return false;
    panel.hidden = true;
    $('.workspace').classList.remove('has-view-builder');
    builderTriggers().forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (focus) (builderReturnFocus?.offsetParent !== null ? builderReturnFocus : $('#command-more summary'))?.focus({ preventScroll: true });
    return true;
  };
  const openBuilder = e => {
    let panel = $('#layer-dialog');
    if (!panel) panel = createBuilder();
    builderReturnFocus = e.currentTarget;
    $('#command-more').open = false;
    ctx.closeWorkspace?.({ focus: false });
    ctx.closeDetail?.({ restoreFocus: false });
    $('#overlay-panel').classList.remove('open');
    $('#overlay-toggle').setAttribute('aria-expanded', 'false');
    panel.hidden = false;
    $('.workspace').classList.add('has-view-builder');
    builderTriggers().forEach(button => button.setAttribute('aria-expanded', 'true'));
    $('#layer-title').focus({ preventScroll: true });
  };
  builderTriggers().forEach(button => {
    button.setAttribute('aria-controls', 'layer-dialog');
    button.setAttribute('aria-expanded', 'false');
    button.onclick = openBuilder;
  });

  function createBuilder() {
    const panel = document.createElement('aside');
    panel.id = 'layer-dialog';
    panel.className = 'view-builder';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'layer-title');
    panel.innerHTML = `<header class="view-builder-head"><div><span class="view-builder-kicker">Map tools</span><h2 id="layer-title" tabindex="-1">Create a view</h2></div><button id="close-layer" type="button" aria-label="Close view builder"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></header>
<div id="layer-tabs" class="view-builder-tabs"></div>
<div class="view-builder-scroll"><form id="layer-form"><div id="layer-input-panel">
<section id="layer-ai-fields"><label for="layer-question">What would you like to see?</label><textarea id="layer-question" name="question" maxlength="1000" rows="3" placeholder="Homes with power loss and water reports"></textarea><div class="view-builder-examples" aria-label="Example questions"><button type="button" data-question="Which homes have lost power and reported water?">Power loss + water</button><button type="button" data-question="Which homes have low batteries?">Low batteries</button></div>
${ctx.demo ? '<div class="view-builder-access"><strong>Use your operator account</strong><p>NVIDIA can query connected devices after you sign in. You can explore this demo with Filters.</p><a class="button" href="/login?role=operator">Operator sign-in <span aria-hidden="true">↗</span></a></div>' : '<button id="ask-nvidia" type="submit" class="primary view-builder-submit">Ask NVIDIA <span aria-hidden="true">↗</span></button><p class="view-builder-help">Uses the latest connected-device observations.</p>'}</section>
<section id="layer-filter-fields"><label for="layer-filter">Observation</label><select id="layer-filter" name="filter"><option value="power_lost">Power lost</option><option value="water">Water detected</option><option value="connectivity_lost">Internet interrupted</option><option value="stale">No recent observations</option><option value="battery_low">Low battery</option><option value="critical">Critical observations</option></select><p class="view-builder-help">Match recorded readings directly.</p><button type="submit" class="view-builder-submit" id="preview-layer">Preview filter</button></section>
</div></form><div id="layer-status" role="status" aria-live="polite"></div><div id="layer-result"></div></div>
<footer class="view-builder-footer"><p id="layer-apply-note">Preview a view, then apply it to the map.</p><button id="apply-layer" class="primary" disabled>Apply view</button><span>Original readings stay unchanged.</span></footer>`;
    $('.workspace').append(panel);
    let proposal = null, request = 0, method = ctx.demo ? 'preset' : 'nvidia', controller = null;
    const form = $('#layer-form'), status = $('#layer-status'), resultBox = $('#layer-result'), apply = $('#apply-layer');
    const tabs = window.Kit.subTabs({
      tabs: [{ id: 'nvidia', label: 'Ask NVIDIA' }, { id: 'preset', label: 'Filters' }],
      active: method, label: 'Create a map view', panel: $('#layer-input-panel'),
      onChange: next => { method = next; resetProposal(); showMethod(); },
    });
    // Kit already implements the tab keyboard pattern; the product decorator needn't add it again.
    tabs.el.dataset.hbKeys = '1';
    $('#layer-tabs').append(tabs.el);
    function showMethod() {
      $('#layer-ai-fields').hidden = method !== 'nvidia';
      $('#layer-filter-fields').hidden = method !== 'preset';
    }
    function setBusy(busy) {
      form.setAttribute('aria-busy', String(busy));
      form.querySelectorAll('button[type="submit"]').forEach(button => button.disabled = busy);
      $('#ask-nvidia')?.classList.toggle('is-loading', busy && method === 'nvidia');
      if ($('#ask-nvidia')) $('#ask-nvidia').innerHTML = busy && method === 'nvidia' ? 'Checking observations…' : 'Ask NVIDIA <span aria-hidden="true">↗</span>';
      $('#preview-layer').textContent = busy && method === 'preset' ? 'Preparing view…' : 'Preview filter';
    }
    function resetProposal() {
      proposal = null; request++;
      controller?.abort(); controller = null;
      apply.disabled = true;
      status.textContent = ''; status.classList.remove('is-error', 'sr-only');
      resultBox.replaceChildren();
      $('#layer-apply-note').textContent = 'Preview a view, then apply it to the map.';
      setBusy(false);
    }
    showMethod();
    resetBuilder = () => {
      resetProposal(); ctx.closeViewBuilder({ focus: false });
    };
    const checks = { power_lost: p => p.sensors?.mains === false, water: p => p.sensors?.water === true, connectivity_lost: p => p.sensors?.wan === false, stale: p => p.stale || p.silent, battery_low: p => typeof p.sensors?.battery_pct === 'number' && p.sensors.battery_pct <= 20, critical: p => p.severity === 'critical' };
    $('#close-layer').onclick = () => ctx.closeViewBuilder();
    form.addEventListener('input', resetProposal);
    form.addEventListener('change', resetProposal);
    panel.querySelectorAll('[data-question]').forEach(button => { button.onclick = () => { $('#layer-question').value = button.dataset.question; resetProposal(); $('#layer-question').focus(); }; });
    form.onsubmit = async e => {
      e.preventDefault();
      resetProposal();
      const body = { ...Object.fromEntries(new FormData(form)), method };
      if (method === 'nvidia' && !body.question.trim()) { status.textContent = 'Enter a question about device observations.'; status.classList.add('is-error'); $('#layer-question').focus(); return; }
      const current = ++request;
      controller = new AbortController();
      setBusy(true);
      status.textContent = method === 'nvidia' ? 'NVIDIA is checking recorded observations…' : 'Preparing view…';
      try {
        let result;
        if (ctx.demo) {
          if (body.method === 'nvidia') throw Error('Sign in as an operator to use the NVIDIA connection.');
          result = { title: $('#layer-filter').selectedOptions[0].textContent, summary: 'Matches fictional exercise observations. No model was used.', ids: S.props.filter(checks[body.filter]).map(p => p.id), mode: 'exercise', generatedAt: new Date().toISOString() };
        } else {
          const r = await api('/api/layers', { method: 'POST', body, signal: controller.signal });
          if (!r.ok) throw Error(r.error || 'Could not build view.');
          result = r.data;
        }
        if (current !== request) return;
        proposal = result;
        const bodyNode = document.createElement('div');
        const count = document.createElement('p'); count.className = 'view-builder-count';
        count.innerHTML = `<strong>${result.ids.length}</strong><span>matching home${result.ids.length === 1 ? '' : 's'}</span>`;
        const summary = document.createElement('p'); summary.className = 'view-builder-summary'; summary.textContent = result.summary;
        const meta = document.createElement('p'); meta.className = 'view-builder-meta'; meta.textContent = `${result.mode === 'exercise' ? 'Fictional exercise' : 'Connected devices'} · ${new Date(result.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
        bodyNode.append(count, summary, meta);
        resultBox.replaceChildren(window.Kit.sectionBox({ title: result.title, level: 3, actions: window.Kit.pill(result.model ? 'NVIDIA' : 'Recorded filter', 'muted'), body: bodyNode }));
        status.textContent = `${result.ids.length} matching homes. View ready to apply.`;
        status.classList.add('sr-only');
        $('#layer-apply-note').textContent = result.ids.length ? 'Ready to show on your map.' : 'No matches. Applying this view will hide all homes.';
        apply.disabled = false;
      } catch (error) { if (current === request) { status.classList.remove('sr-only'); status.classList.add('is-error'); status.textContent = error.message; } }
      finally { if (current === request) setBusy(false); }
    };
    apply.onclick = () => {
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
      toast(`View applied: ${proposal.ids.length} matching home${proposal.ids.length === 1 ? '' : 's'}.`);
      ctx.closeViewBuilder();
    };
    return panel;
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
