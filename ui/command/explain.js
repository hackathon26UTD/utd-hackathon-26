// Model help placed where it is used: inside the device conditions. Runs only on a click, never on its own.
// The model words a snapshot the server already computed. It never queries or changes anything.
// Calls the existing /api/ops/agent endpoint with its existing request shape.
import { api } from './api.js';
import { dateTimeText } from './dom.js';

const ACTION_TEXT = {
  review_water_observation: 'Review the water observation and its timing.',
  review_power_outage: 'Review the power outage and the battery reading.',
  check_connectivity: 'Check how reports are reaching the cloud.',
  check_device_health: 'Check the health of the box itself.',
  request_household_checkin: 'A person may ask the household for a check-in by normal means.',
};
const FRESH_MS = 5 * 60 * 1000;
const cache = new Map(); // deviceId -> { run, at }
let config = null;       // GET /api/ops/agent, once per page

const rid = id => `hbui-${String(id).replace(/[^a-z\d]/gi, '').slice(0, 24)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function agentConfig() {
  if (config) return config;
  const r = await api('/api/ops/agent');
  config = r.ok ? { known: true, configured: r.data?.configured === true, model: r.data?.model || null } : { known: false, configured: false, status: r.status };
  return config;
}

export function mountExplain({ root, ctx, deviceId, exercise = false }) {
  const esc = ctx.esc;
  const engine = exercise ? 'simulator' : 'nemotron';
  let cfg = null, busy = null, error = '', mode = null, dead = false;
  root.classList.add('ex');

  const run = () => { const c = cache.get(deviceId); return c && Date.now() - c.at < FRESH_MS ? c.run : null; };

  function paint() {
    if (dead) return;
    const r = run();
    const unavailable = ctx.demo ? 'Model help needs an operator sign-in.' : cfg && cfg.known === false && cfg.status === 403 ? 'Model help needs a team operator account.' : cfg && !cfg.configured && !exercise ? 'Model not configured' : '';
    const offOk = !unavailable && !busy;
    root.innerHTML = `<div class="ex-head"><h3>Model help</h3>${unavailable ? `<span class="ex-chip is-off">${esc(unavailable)}</span>` : `<span class="ex-chip">${exercise ? 'Simulator, not AI' : 'Model output, unverified'}</span>`}</div>
<p class="ex-note">${unavailable ? 'The plain-language conditions above are computed by the server and still apply.' : 'Optional. The model only rewords evidence the server already gathered. It cannot look anything up, send a message or change a device.'}</p>
${ctx.demo ? '' : `<div class="ex-actions"><button type="button" data-ex="explain"${offOk ? '' : ' disabled'}>${busy === 'explain' ? 'Working' : 'Explain these conditions'}</button><button type="button" data-ex="follow_up"${offOk ? '' : ' disabled'}>${busy === 'follow_up' ? 'Working' : 'Suggest a follow-up'}</button></div>`}
<div class="ex-result" role="status" aria-live="polite">${busy ? '<p class="ex-busy">Reading the evidence. This can take a few seconds.</p>' : ''}${error ? `<p class="ex-error">${esc(error)}</p>` : ''}${r && mode && !busy ? result(r, mode) : ''}</div>`;
  }

  function result(r, which) {
    const c = r.checkpoint;
    if (!c) return '<p class="ex-error">The run finished without a result.</p>';
    const sim = c.interpretationSource === 'simulator_not_ai' || r.simulated;
    const title = sim ? 'Simulator output, not AI' : 'Model output, unverified';
    const ids = (c.evidenceIds || []);
    const limits = [c.hardwareApplied === false ? 'No device setting was changed.' : null, c.messagesSent === false ? 'No message was sent.' : null,
      c.budget?.basis === 'unknown' ? 'Battery runtime is unknown because no power budget was supplied.' : null, sim ? 'This is a scripted exercise answer.' : 'A model can be wrong. Check the evidence before acting.'].filter(Boolean);
    const body = which === 'follow_up'
      ? `<p class="ex-big">${esc(ACTION_TEXT[c.nextAction] || 'No follow-up was suggested.')}</p><p class="ex-sub">Why: ${esc(c.interpretation || '')}</p>`
      : `<p class="ex-big">${esc(c.interpretation || '')}</p><p class="ex-sub">Suggested next look: ${esc(ACTION_TEXT[c.nextAction] || 'none')}</p>`;
    return `<div class="ex-card ${sim ? 'is-sim' : ''}"><div class="ex-card-head"><strong>${esc(which === 'follow_up' ? 'Suggested follow-up' : 'Explanation')}</strong><span class="ex-chip is-warn">${esc(title)}</span></div>${body}
<dl class="ex-meta"><div><dt>Evidence</dt><dd>${ids.length ? ids.map(i => `<code>${esc(i)}</code>`).join(' ') : 'None cited'}</dd></div><div><dt>Source data as of</dt><dd>${c.sourceGeneratedAt ? esc(dateTimeText(c.sourceGeneratedAt)) : 'Unknown'}</dd></div>${r.model && !sim ? `<div><dt>Model</dt><dd>${esc(r.model)}</dd></div>` : ''}<div><dt>Limits</dt><dd><ul>${limits.map(l => `<li>${esc(l)}</li>`).join('')}</ul></dd></div></dl>
<p class="ex-review"><strong>Human review required.</strong> Nothing here is a finding about the home.</p></div>`;
  }

  async function go(which) {
    if (busy || ctx.demo) return;
    error = ''; mode = which;
    if (run()) { paint(); root.querySelector('.ex-result')?.focus?.(); return; }
    busy = which; paint();
    const r = await api('/api/ops/agent', { method: 'POST', body: { requestId: rid(deviceId), deviceId, engine, goalHours: 24 } });
    busy = null;
    if (dead) return;
    if (r.ok && r.data?.checkpoint) cache.set(deviceId, { run: r.data, at: Date.now() });
    else error = r.status === 429 ? 'Try again in a minute. Model help is limited to four runs a minute.' : r.status === 503 ? 'Model not configured. The deterministic conditions above still apply.' : r.status === 409 ? 'No evidence is available for this device yet.' : r.status === 403 || r.status === 401 ? 'Model help needs a team operator account.' : r.ok ? 'The run did not finish. Try again.' : 'Model help is unavailable right now. The conditions above still apply.';
    paint();
  }

  root.addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (b) go(b.dataset.ex); });
  paint();
  if (!ctx.demo) agentConfig().then(c => { cfg = c; paint(); });
  return { destroy() { dead = true; root.replaceChildren(); root.classList.remove('ex'); } };
}
