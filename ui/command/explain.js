// A bounded, operator-started investigation. Display only server-reported tool activity.
// Results belong to this mount/device/mode/engine; a new run always asks for a new snapshot.
import { api } from './api.js';
import { dateTimeText } from './dom.js';

const ACTION_TEXT = {
  review_water_observation: 'Review the water observation and its timing.',
  review_power_outage: 'Review the power outage and battery reading.',
  check_connectivity: 'Check how reports are reaching the cloud.',
  check_device_health: 'Check the health of the box itself.',
  request_household_checkin: 'Ask a person to arrange a household check-in.',
};
const TOOL_TEXT = {
  read_sensor_timeline: 'Read recorded observations',
  correlate_signals: 'Compare related signals',
  plan_power_budget: 'Check power and connectivity policy',
  save_review_checkpoint: 'Save a checkpoint for review',
};
const LINK_TEXT = { uplink_reported: 'Uplink reported', wifi_unavailable: 'Wi-Fi unavailable', wifi_only_uplink_unverified: 'Wi-Fi connected; internet unverified', unknown: 'Unknown' };
const PRESERVE_TEXT = { local_sensor_sampling: 'Sensor sampling', local_alarm: 'Local alarms', help_button: 'Help button', durable_event_log: 'Local event log', esp_now_receive: 'Peer reception' };
const requestId = id => `hbui-${String(id).replace(/[^a-z\d]/gi, '').slice(0, 24)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value : '';
const when = value => value && Number.isFinite(Date.parse(value)) ? dateTimeText(value) : 'Unknown';
const number = value => typeof value === 'number' && Number.isFinite(value);
const interval = value => number(value) ? `${value / 1000} seconds` : 'Unknown';
const yesNo = value => value === true ? 'Yes' : value === false ? 'No' : 'Unknown';
const node = (tag, content, cls) => { const el = document.createElement(tag); if (content != null) el.textContent = String(content); if (cls) el.className = cls; return el; };
const row = (label, value) => { const el = node('div'); el.append(node('dt', label), value instanceof Node ? value : node('dd', value)); return el; };
const note = value => node('p', value, 'ex-note');
const button = (label, action) => { const el = node('button', label, 'kit-btn'); el.type = 'button'; el.dataset.ex = action; return el; };
const codeList = ids => { const box = node('dd'); list(ids).forEach(id => box.append(node('code', id))); return box; };

export async function agentConfig({ signal } = {}) {
  const r = await api('/api/ops/agent', { signal });
  return r.ok ? { known: true, configured: r.data?.configured === true, model: r.data?.model || null }
    : { known: false, status: r.status, error: r.error };
}

function pause(ms, signal) {
  return new Promise(resolve => {
    const finish = value => { clearTimeout(timer); signal.removeEventListener('abort', aborted); resolve(value); };
    const aborted = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    if (signal.aborted) finish(false); else signal.addEventListener('abort', aborted, { once: true });
  });
}

export function mountExplain({ root, ctx, deviceId, exercise = false }) {
  const mode = exercise ? 'exercise' : 'live';
  const lifetime = new AbortController();
  let cfg = null, configBusy = false, engine = 'nemotron', busy = false, dead = false;
  let currentRun = null, pendingRequest = null, error = '', controller = null, generation = 0;
  const detailPreferences = new Map();
  root.classList.add('ex');
  const head = node('div', null, 'ex-head');
  const chip = node('span', exercise ? 'Exercise records' : 'Device records', 'ex-chip');
  head.append(node('h3', 'Nemotron investigation'), chip);
  const intro = note('Read the recorded evidence, compare signals, check power policy and prepare a review checkpoint.');
  const engineHelp = note('');
  const configStatus = node('p', null, 'ex-note');
  const actions = node('div', null, 'ex-actions');
  const runButton = button('Run investigation', 'run');
  const stopButton = button('Stop waiting', 'stop'); stopButton.hidden = true;
  const configButton = button('Check connection', 'config');
  const status = node('p', null, 'ex-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const errorBox = node('p', null, 'ex-error'); errorBox.setAttribute('role', 'alert');
  const resultBox = node('div', null, 'ex-result');
  let enginePicker = null;
  root.replaceChildren(head, intro);
  if (!ctx.demo && exercise) {
    enginePicker = window.Kit.pickOne({ label: 'Investigation engine', value: engine,
      options: [{ value: 'nemotron', label: 'Nemotron', help: 'NVIDIA model' }, { value: 'simulator', label: 'Simulator', help: 'Scripted, not AI' }],
      onChange: value => {
        if (dead || busy || !['nemotron', 'simulator'].includes(value)) return;
        engine = value; currentRun = null; pendingRequest = null; detailPreferences.clear(); error = ''; paint(); renderResult();
      },
    });
    enginePicker.classList.add('ex-engine'); root.append(enginePicker);
  }
  root.append(engineHelp, configStatus);
  if (ctx.demo) {
    root.append(note('The public demo is read-only. Sign in as a team operator to investigate registered device records.'));
    const signIn = node('a', 'Operator sign-in', 'kit-btn'); signIn.href = '/login'; root.append(signIn);
  } else {
    actions.append(runButton, stopButton, configButton); root.append(actions);
  }
  root.append(status, errorBox, resultBox);

  function paint() {
    if (dead) return;
    const denied = cfg?.known === false && [401, 403].includes(cfg.status);
    const modelReady = cfg?.known && cfg.configured;
    engineHelp.textContent = engine === 'simulator'
      ? 'Scripted exercise run. Uses the same tools and validation without calling NVIDIA.'
      : 'Nemotron chooses the four bounded tools. Its interpretation requires human review.';
    engineHelp.hidden = !!ctx.demo;
    configStatus.hidden = !!ctx.demo || engine === 'simulator';
    configStatus.textContent = configBusy ? 'Checking model configuration…' : !cfg ? '' : denied ? 'A team operator session is required. Sign in again.'
      : !cfg.known ? (cfg.error || (cfg.status === 0 ? 'Could not reach the server to check model configuration.' : `Model configuration check failed (HTTP ${cfg.status}).`))
      : !cfg.configured ? 'Nemotron is not configured on this server.' : 'NVIDIA is configured. A successful investigation verifies a model call.';
    configButton.hidden = ctx.demo || engine === 'simulator' || (modelReady && !error);
    configButton.disabled = busy || configBusy;
    runButton.disabled = busy || configBusy || denied || (engine === 'nemotron' && !modelReady);
    runButton.textContent = busy ? 'Investigation running…' : currentRun?.state === 'running' ? 'Check run status'
      : pendingRequest ? 'Retry request' : currentRun ? 'Run again with fresh evidence' : 'Run investigation';
    stopButton.hidden = !busy;
    if (enginePicker) for (const radio of enginePicker.querySelectorAll('[role=radio]')) radio.disabled = busy;
    resultBox.setAttribute('aria-busy', String(busy));
    status.textContent = busy ? (currentRun?.id ? 'Waiting for this run to finish. Only reported tool steps are shown below.' : 'Waiting for the server. Tool activity appears when results arrive.') : currentRun?.state === 'completed' ? 'Investigation complete. Review the checkpoint and its evidence.' : '';
    errorBox.textContent = error; errorBox.hidden = !error;
  }

  function fold(key, label, children) {
    const el = node('details', null, 'ex-details'); el.dataset.exDetail = key;
    const summary = node('summary', label); summary.dataset.exFocus = key;
    el.append(summary, ...children); return el;
  }

  function evidenceDetail(run, checkpoint) {
    const records = new Map(list(run.citedEvidence).map(record => [record.id, record]));
    const entries = list(checkpoint.evidenceIds).map(id => {
      const item = node('li'); const record = records.get(id);
      item.append(node('code', id));
      if (!record) { item.append(note('Individual observation time was not returned.')); return item; }
      const label = record.sensor || record.type || record.sourceId || record.kind || 'Evidence';
      item.append(node('strong', label));
      const times = node('dl', null, 'ex-meta');
      if (record.kind === 'reading') times.append(row('Recorded value', typeof record.value === 'boolean' ? String(record.value) : number(record.value) ? String(record.value) : typeof record.value === 'string' ? record.value : 'Unknown'));
      if (record.kind === 'context') times.append(row('Context fetched', when(record.fetchedAt)));
      else if (record.kind === 'incident') times.append(row('Detected', when(record.detectedAt)), row('Last observed', when(record.lastObservedAt)));
      else times.append(row('Observed', when(record.observedAt)), row('Received', when(record.receivedAt)));
      if (record.stale === true) times.append(row('Freshness', 'Stale at the evidence snapshot'));
      else if (record.stale === false) times.append(row('Freshness', 'Recent at the evidence snapshot; not a current guarantee'));
      if (record.delayed === true) times.append(row('Delivery', 'Received after a delay'));
      item.append(times); return item;
    });
    const ul = node('ul', null, 'ex-evidence'); ul.append(...entries);
    return fold('evidence', `Cited evidence · ${entries.length}`, [entries.length ? ul : note('No evidence was cited.')]);
  }

  function policyDetail(checkpoint) {
    const budget = checkpoint.budget || {};
    const body = node('div');
    const basis = budget.basis === 'bench_measurement' ? 'Bench measurement' : budget.basis === 'assumption' ? 'Operator assumption' : 'Unknown';
    const meta = node('dl', null, 'ex-meta ex-budget');
    meta.append(row('Runtime target', number(budget.goalHours) ? `${budget.goalHours} hours` : '24 hours requested; result not returned'), row('Budget basis', basis));
    body.append(meta);
    if (basis === 'Unknown') body.append(note('Runtime is unknown. Usable battery energy and average power draw have not been supplied. The 24-hour target is not verified endurance.'));
    list(checkpoint.policies).forEach(policy => {
      const el = node('section', null, 'ex-policy');
      el.append(node('h4', policy.deviceId === deviceId ? 'This device' : 'Same-home device'), node('code', policy.deviceId || 'Unknown device'));
      const projection = list(budget.devices).find(item => item.deviceId === policy.deviceId);
      const detail = node('dl', null, 'ex-meta ex-policy-grid');
      detail.append(row('Policy', ['normal', 'saver', 'critical'].includes(policy.mode) ? policy.mode : 'Unknown'), row('External power', policy.mains === true ? 'Available' : policy.mains === false ? 'Lost' : 'Unknown'),
        row('Connectivity', LINK_TEXT[policy.link] || 'Unknown'), row('Sample interval', interval(policy.sampleMs)), row('Report interval', interval(policy.reportMs)),
        row('Wi-Fi retry interval', interval(policy.wifiRetryMs)), row('Camera enabled', yesNo(policy.camera)), row('Display enabled', yesNo(policy.display)),
        row('Projected runtime', number(projection?.projectedHours) ? `${projection.projectedHours} hours` : 'Unknown'), row('Target met', yesNo(projection?.goalMet)));
      el.append(note(policy.reason || 'No policy reason returned.'), detail);
      if (list(policy.preserve).length) el.append(note('Preserved: ' + policy.preserve.map(item => PRESERVE_TEXT[item] || item).join(', ') + '.'));
      if (policy.transport) el.append(note(policy.transport));
      if (projection?.action) el.append(note(projection.action));
      body.append(el);
    });
    if (!list(checkpoint.policies).length) body.append(note('No device policy was returned.'));
    if (budget.formula) body.append(note(budget.formula));
    body.append(note('These are server-computed proposals. No hardware setting has been applied by this investigation.'));
    return fold('policy', 'Power, connectivity and 24-hour target', [body]);
  }

  function renderResult() {
    if (dead) return;
    const open = new Set([...resultBox.querySelectorAll('details[open]')].map(el => el.dataset.exDetail));
    const focused = resultBox.contains(document.activeElement) ? document.activeElement.dataset.exFocus : null;
    resultBox.replaceChildren();
    const run = currentRun;
    if (!run) return;
    const sim = run.engine === 'simulator';
    const stamp = node('dl', null, 'ex-meta ex-run-meta');
    stamp.append(row('Run', run.state), row('Started', when(run.createdAt)));
    if (run.completedAt) stamp.append(row('Finished', when(run.completedAt)));
    if (run.model && !sim) stamp.append(row('Model', run.model));
    resultBox.append(stamp);
    if (run.checkpoint && run.state === 'completed') {
      const c = run.checkpoint;
      const card = node('div', null, 'ex-card' + (sim ? ' is-sim' : ''));
      const title = node('div', null, 'ex-card-head');
      title.append(node('strong', 'Review checkpoint'), node('span', sim ? 'Simulator · not AI' : 'Model interpretation', 'ex-chip is-warn'));
      card.append(title, node('p', c.interpretation || 'No interpretation was returned.', 'ex-big'), node('p', 'Next review: ' + (ACTION_TEXT[c.nextAction] || 'No supported follow-up was returned.'), 'ex-sub'));
      card.append(note('Evidence snapshot: ' + when(c.sourceGeneratedAt) + '. Individual readings may be older. Run again to refresh the snapshot.'));
      const coverage = c.modelCoverage;
      if (coverage?.modelProjection) {
        const parts = ['Model input is a bounded snapshot, not full device history.'];
        if (number(coverage.observationsAvailable) && number(coverage.observationsOmitted)) parts.push(`${coverage.observationsAvailable - coverage.observationsOmitted} of ${coverage.observationsAvailable} snapshot observations supplied; ${coverage.observationsOmitted} omitted.`);
        if (number(coverage.eventsOmitted) && coverage.eventsOmitted > 0) parts.push(`${coverage.eventsOmitted} snapshot events omitted.`);
        const contextOmitted = list(c.externalContext?.sources).reduce((sum, source) => sum + (number(source.modelOmittedRecordCount) ? source.modelOmittedRecordCount : 0), 0);
        if (contextOmitted) parts.push(`${contextOmitted} cached context records omitted.`);
        if (coverage.devicesTruncated || list(coverage.source).some(source => source.historyTruncated || source.eventsTruncated || source.incidentsTruncated)) parts.push('The source snapshot is also limited; additional records may exist.');
        card.append(note(parts.join(' ')));
      }
      card.append(node('p', 'Human review required. This does not confirm damage, occupancy or safe entry.', 'ex-review'));
      resultBox.append(card);
    }
    const trace = node('ol', null, 'ex-trace');
    for (const step of list(run.trace)) {
      const item = node('li');
      item.append(node('strong', TOOL_TEXT[step.tool] || text(step.tool) || 'Unknown tool'), node('span', text(step.status) || 'Status not returned'));
      if (step.at || step.completedAt) item.append(node('time', when(step.at || step.completedAt)));
      trace.append(item);
    }
    resultBox.append(fold('trace', `Tool activity · ${list(run.trace).length} reported steps`, [trace.children.length ? trace : note('No tool steps have been reported.')]));
    if (run.checkpoint && run.state === 'completed') {
      const c = run.checkpoint;
      resultBox.append(evidenceDetail(run, c), policyDetail(c));
      if (list(c.relations).length) {
        const relations = node('ul', null, 'ex-evidence');
        for (const relation of c.relations) { const item = node('li'); item.append(node('p', relation.conclusion || 'Related observations; cause is unverified.')); const ids = node('dl', null, 'ex-meta'); ids.append(row('Evidence', codeList(relation.evidenceIds))); item.append(ids); if (relation.stale) item.append(note('Includes stale evidence.')); relations.append(item); }
        resultBox.append(fold('relations', `Related observations · ${c.relations.length}`, [relations]));
      }
    }
    resultBox.append(note('No message sent. No vendor contacted. No response team dispatched.'));
    for (const el of resultBox.querySelectorAll('details')) {
      const key = el.dataset.exDetail;
      el.open = detailPreferences.has(key) ? detailPreferences.get(key) : key === 'trace' && ['completed', 'failed'].includes(run.state) ? true : open.has(key);
    }
    if (focused) resultBox.querySelector(`[data-ex-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  async function loadConfig() {
    if (dead || ctx.demo || configBusy) return;
    configBusy = true; paint();
    const next = await agentConfig({ signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(12_000)]) });
    if (dead) return;
    cfg = next; configBusy = false; paint();
  }

  function acceptRun(data) {
    if (!data?.id || !['running', 'completed', 'failed'].includes(data.state)) return false;
    if (data.deviceId !== deviceId || data.mode !== mode || data.engine !== engine) {
      error = 'The server returned a different device, data mode or engine. That result was not displayed.';
      return false;
    }
    currentRun = data; renderResult(); return true;
  }

  async function go() {
    if (dead || busy || ctx.demo || runButton.disabled) return;
    const token = ++generation;
    controller = new AbortController(); const signal = controller.signal;
    const timeout = setTimeout(() => controller?.abort('timeout'), 90_000);
    let runId = currentRun?.state === 'running' ? currentRun.id : null;
    if (!runId && !pendingRequest) {
      pendingRequest = { requestId: requestId(deviceId), deviceId, engine, goalHours: 24 };
      currentRun = null; detailPreferences.clear(); renderResult();
    }
    busy = true; error = ''; paint();
    try {
      while (!dead && token === generation && !signal.aborted) {
        const response = runId ? await api('/api/ops/agent?run_id=' + encodeURIComponent(runId), { signal })
          : await api('/api/ops/agent', { method: 'POST', body: pendingRequest, signal });
        if (dead || token !== generation || signal.aborted) return;
        const accepted = acceptRun(response.data);
        if (error) break;
        if (accepted && currentRun.state === 'completed') { pendingRequest = null; break; }
        if (accepted && currentRun.state === 'failed') { pendingRequest = null; error = text(currentRun.error) || 'The investigation failed. No completed checkpoint was saved.'; break; }
        if (!response.ok) {
          error = text(response.error) || (response.status === 0 ? 'The connection was interrupted. The server may still be working. Retry checks the same request.' : `Investigation request failed (HTTP ${response.status}).`);
          if (response.status !== 0 && response.status < 500) pendingRequest = null;
          break;
        }
        if (!accepted || !currentRun.id) { error = 'The server did not return a usable run ID. No checkpoint was displayed.'; break; }
        if (response.status !== 202 && currentRun.state !== 'running') { error = 'The server returned an incomplete investigation result.'; break; }
        runId = currentRun.id; paint();
        if (!await pause(1500, signal)) return;
      }
    } finally {
      clearTimeout(timeout);
      if (!dead && token === generation) {
        if (signal.aborted) error = signal.reason === 'timeout' ? 'Stopped waiting after 90 seconds. The server may still finish. Check the run or retry this request.' : 'Stopped waiting. This does not cancel the server run. Check its status when ready.';
        busy = false; controller = null; paint();
      }
    }
  }

  function clicked(event) {
    const summary = event.target.closest('.ex-details > summary');
    if (summary && root.contains(summary)) detailPreferences.set(summary.parentElement.dataset.exDetail, !summary.parentElement.open);
    const target = event.target.closest('[data-ex]');
    if (!target || !root.contains(target)) return;
    if (target.dataset.ex === 'run') void go();
    else if (target.dataset.ex === 'config') void loadConfig();
    else if (target.dataset.ex === 'stop') controller?.abort('user');
  }
  root.addEventListener('click', clicked);
  paint();
  if (!ctx.demo) void loadConfig();
  return { destroy() {
    dead = true; generation++; lifetime.abort(); controller?.abort('destroyed');
    root.removeEventListener('click', clicked); root.replaceChildren(); root.classList.remove('ex'); root.removeAttribute('aria-busy');
  } };
}
