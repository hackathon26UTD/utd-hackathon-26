import { api, exerciseMode } from './api.js';
import { dateTimeText } from './dom.js';
import './fleet-review.css';

const rows = value => Array.isArray(value) ? value : [];
const words = value => typeof value === 'string' ? value : '';
const count = value => Number.isFinite(value) ? value : 0;
const when = value => value && Number.isFinite(Date.parse(value)) ? dateTimeText(value) : 'Unknown';
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = String(text); if (cls) el.className = cls; return el; };
const button = (label, action) => { const el = node('button', label, 'kit-btn'); el.type = 'button'; if (action) el.dataset.review = action; return el; };
const note = text => node('p', text, 'rv-note');
const endpoint = '/api/ops/review-queue';
const requestId = () => `fleet-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const toolText = { read_fleet_shortlist: 'Read the home shortlist', check_review_gaps: 'Check missing and stale evidence', save_fleet_checkpoint: 'Save a review checkpoint' };
const priorityText = { urgent_review: 'Urgent review', observation_review: 'Observation review', visibility_review: 'Visibility review', routine_review: 'Routine review' };
const pause = (ms, signal) => new Promise(resolve => {
  const done = result => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(result); };
  const abort = () => done(false), timer = setTimeout(() => done(true), ms);
  if (signal.aborted) done(false); else signal.addEventListener('abort', abort, { once: true });
});

export function mountFleetReview(ctx, root) {
  const mode = exerciseMode ? 'exercise' : 'live';
  let loaded = false, dead = false, loading = false, busy = false, snapshot = null, currentRun = null, engine = 'nemotron';
  let cfg = null, error = '', pending = null, controller = null, loadController = null, generation = 0;
  const lifetime = new AbortController();
  const canUse = !ctx.demo && !!ctx.role;
  const toolbar = node('div', null, 'rv-toolbar');
  const scope = node('span', exerciseMode ? 'Exercise records' : 'Live device records', 'rv-mode');
  const refreshButton = button('Refresh observations', 'refresh');
  const modeLink = node('a', exerciseMode ? 'Switch to live records' : 'Switch to exercise records', 'rv-mode-link');
  modeLink.href = exerciseMode ? '/command-center?view=review' : '/command-center?mode=exercise&view=review';
  toolbar.append(scope, modeLink, refreshButton);
  const status = node('p', '', 'rv-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const errorBox = node('p', '', 'rv-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
  const columns = node('div', null, 'rv-columns'), queueArea = node('section', null, 'rv-queue-area');
  queueArea.setAttribute('aria-label', 'Homes awaiting review');
  const coverage = node('p', '', 'rv-coverage'), queue = node('ol', null, 'rv-queue');
  queueArea.append(coverage, queue);
  const agentArea = node('section', null, 'rv-agent'); agentArea.setAttribute('aria-label', 'Nemotron fleet review');
  agentArea.append(node('h3', 'Review the shortlist'), note('Nemotron reads this bounded queue, checks its evidence gaps and prepares a review checkpoint.'));
  let picker = null;
  if (exerciseMode && canUse) {
    picker = window.Kit.pickOne({ label: 'Fleet review engine', value: engine,
      options: [{ value: 'nemotron', label: 'Nemotron', help: 'NVIDIA model' }, { value: 'simulator', label: 'Simulator', help: 'Scripted, not AI' }],
      onChange: value => {
        if (dead || busy || !['nemotron', 'simulator'].includes(value)) return;
        engine = value; currentRun = null; pending = null; error = ''; render();
      },
    });
    picker.classList.add('rv-engine'); agentArea.append(picker);
  }
  const modelInfo = note(''), sendInfo = note(''), actions = node('div', null, 'rv-actions');
  const runButton = button('Run Nemotron review', 'run'); runButton.classList.add('rv-primary');
  const stopButton = button('Stop waiting', 'stop'); stopButton.hidden = true;
  actions.append(runButton, stopButton);
  const result = node('div', null, 'rv-result');
  agentArea.append(modelInfo, sendInfo, actions, result);
  columns.append(queueArea, agentArea);
  root.classList.add('rv'); root.replaceChildren(toolbar, status, errorBox, columns);
  if (!canUse) {
    root.replaceChildren(node('h3', 'Review registered device records'), note('Fleet review is available to team operators. Public simulation frames are separate from registered exercise records.'));
    const login = node('a', 'Operator sign-in', 'kit-btn'); login.href = '/login'; root.append(login);
  }

  function currentSnapshot() { return currentRun?.snapshot || snapshot; }
  function snapshotMatches(data) { return data?.mode === mode && Array.isArray(data.queue); }
  function renderEvidence(entry) {
    const detail = node('details', null, 'rv-evidence'); detail.dataset.reviewEntry = entry.id;
    detail.append(node('summary', `Evidence and gaps · ${rows(entry.evidence).length} records`));
    if (rows(entry.unknowns).length) {
      detail.append(node('h4', 'Unknown or unverified'));
      const ul = node('ul'); rows(entry.unknowns).forEach(text => ul.append(node('li', text))); detail.append(ul);
    }
    const records = node('ul', null, 'rv-records');
    for (const evidence of rows(entry.evidence)) {
      const item = node('li');
      const value = typeof evidence.value === 'boolean' || Number.isFinite(evidence.value) || typeof evidence.value === 'string' ? `: ${evidence.value}` : '';
      item.append(node('strong', (words(evidence.sensor) || words(evidence.type) || words(evidence.kind) || 'Observation') + value));
      item.append(note(`Observed ${when(evidence.observedAt)}${evidence.stale ? ' · stale at snapshot' : ''}`));
      if (evidence.receivedAt) item.append(note('Received ' + when(evidence.receivedAt)));
      item.append(node('code', evidence.id)); records.append(item);
    }
    detail.append(records.childElementCount ? records : note('No individual observations were returned. Current home conditions are unknown.'));
    const omitted = count(entry.coverage?.evidenceOmitted);
    if (omitted) detail.append(note(`${omitted} additional evidence records are outside this summary.`));
    detail.append(note(`${count(entry.coverage?.deviceCount) || rows(entry.deviceIds).length || 1} device(s) included in this home summary.`));
    return detail;
  }
  function renderQueue(data) {
    const expanded = new Set([...queue.querySelectorAll('details[open]')].map(el => el.dataset.reviewEntry));
    const focused = queue.contains(document.activeElement) ? document.activeElement.dataset.reviewFocus : null;
    queue.replaceChildren();
    for (const entry of rows(data?.queue)) {
      const item = node('li', null, 'rv-home'); item.dataset.priority = entry.priority; item.dataset.queueId = entry.id;
      const head = node('div', null, 'rv-home-head'), name = node('div');
      name.append(node('span', priorityText[entry.priority] || 'Review needed', 'rv-priority'), node('h3', words(entry.label) || 'Registered home'));
      const open = button('Inspect home'); open.dataset.reviewFocus = entry.id;
      open.onclick = () => { if (entry.deviceId) ctx.drawer?.openDevice(entry.deviceId, { tab: 'conditions' }); };
      open.disabled = !entry.deviceId;
      head.append(node('span', count(entry.rank) || queue.childElementCount + 1, 'rv-rank'), name, open); item.append(head);
      const reasons = node('ul', null, 'rv-reasons');
      for (const reason of rows(entry.reasons)) {
        const li = node('li', words(reason.label) || words(reason.code) || 'Review the observations');
        if (rows(reason.evidenceIds).length) li.title = 'Evidence: ' + reason.evidenceIds.join(', ');
        reasons.append(li);
      }
      item.append(reasons, note(`Latest condition observation: ${when(entry.lastConditionObservedAt)}${count(entry.staleEvidenceCount) ? ` · ${count(entry.staleEvidenceCount)} stale record(s) in the evidence` : ''}`));
      if (entry.lastObservedAt !== entry.lastConditionObservedAt) item.append(note(`Latest included reading (any sensor): ${when(entry.lastObservedAt)}. A recent heartbeat or battery reading does not establish home conditions.`));
      const detail = renderEvidence(entry); detail.open = expanded.has(entry.id); item.append(detail); queue.append(item);
    }
    if (!queue.childElementCount) queue.append(node('li', loading ? 'Loading recorded observations…' : loaded ? 'No registered homes were returned for this data mode.' : 'Open Review to load the current queue.', 'rv-empty'));
    const c = data?.coverage;
    coverage.textContent = c ? `${count(c.homesReturned)} of ${count(c.homesExamined)} examined homes shown · ${count(c.devicesExamined)} of ${count(c.totalDevices)} devices examined${c.partial ? ' · Partial coverage' : ''}.` : '';
    if (c?.homesOmitted || c?.devicesOmitted) coverage.textContent += ` ${count(c.homesOmitted)} home(s) and ${count(c.devicesOmitted)} device(s) omitted from this bounded review.`;
    if (focused) [...queue.querySelectorAll('[data-review-focus]')].find(el => el.dataset.reviewFocus === focused)?.focus({ preventScroll: true });
  }
  function renderResult() {
    result.replaceChildren();
    if (!currentRun) { result.append(note('The list uses observation rules. A model review adds an interpretation and a saved checkpoint; it does not dispatch help.')); return; }
    result.append(note(`Run ${currentRun.state} · Started ${when(currentRun.createdAt)}`));
    const c = currentRun.checkpoint;
    if (currentRun.state === 'completed' && c) {
      const summary = node('div', null, 'rv-checkpoint');
      summary.append(node('h4', engine === 'simulator' ? 'Scripted review · not AI' : 'Nemotron review'), node('p', words(c.interpretation) || 'No interpretation was returned.'));
      summary.append(note('Human review required. This is not a damage assessment or dispatch order.'));
      const citations = node('div', null, 'rv-citations');
      for (const id of rows(c.evidenceIds)) {
        const entry = rows(currentRun.snapshot?.queue).find(item => item.id === id);
        const link = button(entry?.label || id); link.onclick = () => {
          const home = [...queue.children].find(el => el.dataset.queueId === id);
          if (!home) return;
          const detail = home.querySelector('details'); if (detail) detail.open = true;
          home.scrollIntoView({ block: 'nearest', behavior: 'instant' }); home.querySelector('summary')?.focus({ preventScroll: true });
        };
        citations.append(link);
      }
      if (citations.childElementCount) summary.append(node('h4', 'Cited homes'), citations);
      result.append(summary);
    }
    const trace = node('details', null, 'rv-evidence'); trace.open = ['completed', 'failed'].includes(currentRun.state);
    trace.append(node('summary', `Tool activity · ${rows(currentRun.trace).length} reported steps`));
    const list = node('ol', null, 'rv-trace');
    for (const step of rows(currentRun.trace)) {
      const li = node('li'); li.append(node('strong', toolText[step.tool] || words(step.tool).replaceAll('_', ' ') || 'Tool step'), node('span', words(step.status) || 'Unknown status')); list.append(li);
    }
    trace.append(list.childElementCount ? list : note('No completed tool steps reported.')); result.append(trace);
    result.append(note('No messages sent. No hardware settings changed.'));
  }
  function render() {
    if (dead || !canUse) return;
    const data = currentSnapshot(), denial = cfg?.denied;
    status.textContent = loading ? 'Loading observations…' : busy ? 'Review running. Tool steps appear when the server reports them.'
      : data ? `${currentRun?.snapshot ? 'Review snapshot' : 'Observation snapshot'}: ${when(data.generatedAt)}. Refresh to request a new snapshot.` : 'Load observations to review the fleet.';
    refreshButton.disabled = loading || busy || !!pending || currentRun?.state === 'running';
    runButton.disabled = loading || busy || !rows(data?.queue).length || denial || (engine === 'nemotron' && cfg?.configured !== true);
    runButton.textContent = busy ? 'Review running…' : currentRun?.state === 'running' ? 'Check run status' : pending ? 'Retry request'
      : currentRun ? 'Review fresh observations' : engine === 'simulator' ? 'Run scripted review' : 'Run Nemotron review';
    stopButton.hidden = !busy;
    if (picker) for (const radio of picker.querySelectorAll('[role=radio]')) radio.disabled = busy || !!pending || currentRun?.state === 'running';
    modelInfo.textContent = engine === 'simulator' ? 'Scripted exercise. No model is called.' : denial ? 'Sign in as a team operator to continue.' : cfg?.configured ? `Model: ${cfg.model || 'Configured NVIDIA model'}` : loaded ? 'Nemotron is not configured on this server.' : '';
    sendInfo.textContent = engine === 'nemotron' ? 'Run review sends a fresh shortlist of observation summaries to your configured Nemotron server.' : 'Uses the same bounded review workflow with a clearly labeled scripted result.';
    errorBox.textContent = error; errorBox.hidden = !error;
    root.setAttribute('aria-busy', String(loading || busy));
    renderQueue(data); renderResult();
  }
  async function load() {
    if (dead || !canUse || loading || busy || pending || currentRun?.state === 'running') return;
    loading = true; error = ''; loadController?.abort(); loadController = new AbortController(); render();
    const response = await api(endpoint, { signal: AbortSignal.any([lifetime.signal, loadController.signal, AbortSignal.timeout(20_000)]) });
    if (dead) return;
    loading = false;
    if (!response.ok) {
      cfg = { denied: [401, 403].includes(response.status) };
      error = response.error || 'The review queue is unavailable. Refresh to try again.';
    } else if (!snapshotMatches(response.data)) error = 'The server returned a different data mode or an incomplete queue. That result was not displayed.';
    else { snapshot = response.data; currentRun = null; cfg = response.data.nvidia || {}; loaded = true; }
    render();
  }
  function acceptRun(data) {
    if (!data?.id || !['running', 'completed', 'failed'].includes(data.state)) return false;
    if (data.mode !== mode || data.engine !== engine || !snapshotMatches(data.snapshot)) {
      error = 'The returned review does not match this data mode or engine. That result was not displayed.'; return false;
    }
    currentRun = data; return true;
  }
  async function run() {
    if (dead || !canUse || busy || runButton.disabled) return;
    const token = ++generation; controller = new AbortController(); const signal = controller.signal;
    const timer = setTimeout(() => controller?.abort('timeout'), 90_000);
    let id = currentRun?.state === 'running' ? currentRun.id : null;
    if (!id && !pending) { pending = { requestId: requestId(), engine }; currentRun = null; }
    busy = true; error = ''; render();
    try {
      while (!dead && token === generation && !signal.aborted) {
        const response = await api(id ? endpoint + '?run_id=' + encodeURIComponent(id) : endpoint, id ? { signal } : { method: 'POST', body: pending, signal });
        if (dead || token !== generation || signal.aborted) return;
        const accepted = acceptRun(response.data);
        if (error) break;
        if (accepted && currentRun.state === 'completed') { pending = null; break; }
        if (accepted && currentRun.state === 'failed') { pending = null; error = words(currentRun.error) || 'The review did not finish. Try a new run.'; break; }
        if (!response.ok) {
          error = response.error || (response.status === 0 ? 'Connection interrupted. Retry retrieves the same request.' : `Review failed (HTTP ${response.status}).`);
          if (response.status > 0 && response.status < 500) pending = null;
          break;
        }
        if (!accepted) { error = 'No usable run was returned. Retry retrieves the same request.'; break; }
        id = currentRun.id; render();
        if (!await pause(1500, signal)) return;
      }
    } finally {
      clearTimeout(timer);
      if (!dead && token === generation) {
        if (signal.aborted) error = signal.reason === 'timeout' ? 'Stopped waiting after 90 seconds. Retry checks the same server run.' : 'Stopped waiting. The server may still finish; retry to retrieve the result.';
        busy = false; controller = null; render();
      }
    }
  }
  function clicked(event) {
    const target = event.target.closest('[data-review]'); if (!target || !root.contains(target)) return;
    if (target.dataset.review === 'refresh') void load();
    else if (target.dataset.review === 'run') void run();
    else if (target.dataset.review === 'stop') controller?.abort('user');
  }
  root.addEventListener('click', clicked); render();
  return { open() { if (!loaded && !loading) void load(); }, refresh: load, destroy() {
    dead = true; generation++; lifetime.abort(); controller?.abort('destroyed'); loadController?.abort(); root.removeEventListener('click', clicked); root.replaceChildren();
  } };
}
