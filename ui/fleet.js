// Operator inventory only. Provisioning stays in the CLI; secrets never enter list state.
const REASONS = {
  not_linked: 'Not linked', awaiting_first_report: 'Waiting for first report',
  silent: 'No recent signal', disabled: 'Paused by the team', unlinked: 'Released by customer or team',
};
const ACTIONS = {
  disable: ['Disable box', 'The box will stop accepting reports until it is enabled again.'],
  enable: ['Enable box', 'The box can submit reports again. This does not confirm it is online.'],
  rotate_key: ['Rotate key', 'The old key stops working immediately. Install the new key on the box over USB or in its local agent configuration before reports can resume. Never send it through device messages.'],
  reassign_home: ['Reassign home', 'Move this unlinked box to an existing home. Customer-linked boxes must be released first.'],
  force_unlink: ['Force unlink', 'Release the box from its customer. Their access to its history and messages will end.'],
};
const el = (tag, text = '', cls = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const button = (text, handler, cls = 'kit-everyday') => {
  const node = el('button', text, cls); node.type = 'button'; node.onclick = handler; return node;
};
const stamp = value => value ? Date.parse(value) : NaN;
const absolute = value => Number.isFinite(stamp(value)) ? new Date(value).toLocaleString() : 'Unknown';
function relative(value) {
  const time = stamp(value);
  if (!Number.isFinite(time)) return 'Unknown';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 0) return 'Timestamp is in the future';
  if (minutes < 1) return 'Less than a minute ago';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}
function stateOf(device) {
  return ['active', 'inactive'].includes(device.fleetStatus?.state) ? device.fleetStatus.state : 'unknown';
}
function reasonOf(device) {
  const reason = device.fleetStatus?.reason;
  if (reason === 'silent' && Number.isFinite(stamp(device.lastSeenAt))) return `No recent signal · last report ${relative(device.lastSeenAt)}`;
  return REASONS[reason] || (stateOf(device) === 'active' ? 'Linked and reporting' : 'Reason unknown');
}
function sharedCustomer(link) {
  // The fleet endpoint returns linkedCustomer only with consent; an explicit denial still wins.
  return !!link && typeof link === 'object' && link.linked !== false && link.consent !== false;
}
function isLinked(device) { return device.linked === true || !!device.linkedCustomer && device.linkedCustomer.linked !== false; }
function customerOf(device) {
  const link = device.linkedCustomer;
  if (!isLinked(device)) return 'No customer linked';
  if (!sharedCustomer(link)) return 'Customer linked · contact not shared';
  return [link.contactName || link.name || 'Customer linked', link.email, 'Contact sharing allowed'].filter(Boolean).join(' · ');
}
function field(labelText, control) {
  const label = el('label', labelText, 'fleet-field'); label.append(control); return label;
}
function input(name, maxLength) {
  const node = el('input', '', 'kit-text-box'); node.name = name; node.type = 'text';
  node.autocomplete = 'off'; node.spellcheck = false; if (maxLength) node.maxLength = maxLength; return node;
}

export function mountFleet(container, { api, role, onClose = () => {} }) {
  const Kit = window.Kit;
  const demo = role === 'demo';
  const writable = !demo && ['operator', 'admin'].includes(role);
  let devices = [], loaded = false, loading = false, stopped = false, pending = false;
  let sheet = null, popup = null, generation = 0;
  let search = '', state = 'all', reason = 'all', consent = 'all', firmware = '', sort = 'serial';
  container.classList.add('kit', 'full-view', 'fleet-view');
  container.setAttribute('aria-labelledby', 'fleet-title');
  const head = el('div', '', 'panel-title'), titleBox = el('div');
  const title = el('h2', 'Fleet'); title.id = 'fleet-title'; title.tabIndex = -1;
  titleBox.append(title, el('p', demo ? 'Exercise records only. Read-only fleet.' : 'Built boxes, reporting state and key history.', 'view-lead'));
  head.append(titleBox, button('Back to map', onClose));
  const body = el('div', '', 'full-view-body fleet-body');
  const summary = el('div', '', 'fleet-summary'); summary.setAttribute('aria-label', 'Fleet counts');
  const tools = el('div', '', 'fleet-tools');
  const query = input('fleetSearch', 100); query.placeholder = 'Serial, box or shared customer';
  query.addEventListener('input', () => { search = query.value.toLowerCase().trim(); render(); });
  tools.append(field('Search fleet', query));
  function filter(label, options, value, change) {
    const id = 'fleet-' + label.toLowerCase().replaceAll(' ', '-');
    const wrap = el('div', '', 'fleet-field'), labelNode = el('label', label);
    labelNode.htmlFor = id;
    const control = Kit.select({ id, options, value, onChange: value => { change(value); render(); } });
    wrap.append(labelNode, control); tools.append(wrap);
  }
  filter('State', [{ value: 'all', label: 'All states' }, ...['active', 'inactive', 'unknown'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))], state, value => { state = value; });
  filter('Reason', [{ value: 'all', label: 'All reasons' }, ...Object.entries(REASONS).map(([value, label]) => ({ value, label }))], reason, value => { reason = value; });
  filter('Contact consent', [{ value: 'all', label: 'All boxes' }, { value: 'yes', label: 'Sharing allowed' }, { value: 'no', label: 'Not shared' }], consent, value => { consent = value; });
  filter('Sort', [{ value: 'serial', label: 'Serial' }, { value: 'lastSeen', label: 'Most recently seen' }, { value: 'state', label: 'State' }, { value: 'keyAge', label: 'Oldest key first' }], sort, value => { sort = value; });
  const firmwareInput = input('fleetFirmware', 100); firmwareInput.placeholder = 'Version or unknown';
  firmwareInput.addEventListener('input', () => { firmware = firmwareInput.value.toLowerCase().trim(); render(); });
  tools.append(field('Firmware', firmwareInput));
  const refreshButton = button('Refresh fleet', () => refresh()); tools.append(refreshButton);
  const status = el('p', 'Open Fleet to load records.', 'fleet-status'); status.setAttribute('role', 'status');
  const result = el('div', '', 'fleet-results');
  body.append(el('p', 'New boxes are provisioned through the CLI. Reporting is checked when this panel loads or refreshes. Missing data means unknown.', 'fleet-note'), summary, tools, status, result);
  container.replaceChildren(head, body);

  function render() {
    summary.replaceChildren();
    if (!loaded) { result.replaceChildren(); return; }
    for (const [label, count] of [
      ['Active', devices.filter(d => stateOf(d) === 'active').length],
      ['Inactive', devices.filter(d => stateOf(d) === 'inactive').length],
      ['Unknown', devices.filter(d => stateOf(d) === 'unknown').length],
    ]) {
      const item = el('div', '', 'fleet-count'); item.append(el('strong', String(count)), el('span', label)); summary.append(item);
    }
    const reasons = el('p', '', 'fleet-reasons');
    reasons.textContent = Object.entries(REASONS).map(([key, label]) => `${label}: ${devices.filter(d => d.fleetStatus?.reason === key).length}`).join(' · ');
    summary.append(reasons);
    const rows = devices.filter(d => (!search || [d.serial, d.name, customerOf(d)].join(' ').toLowerCase().includes(search))
      && (state === 'all' || stateOf(d) === state) && (reason === 'all' || d.fleetStatus?.reason === reason)
      && (consent === 'all' || sharedCustomer(d.linkedCustomer) === (consent === 'yes'))
      && (!firmware || String(d.firmwareVersion || 'unknown').toLowerCase().includes(firmware)));
    rows.sort((a, b) => {
      if (sort === 'lastSeen') return (stamp(b.lastSeenAt) || 0) - (stamp(a.lastSeenAt) || 0);
      if (sort === 'state') return stateOf(a).localeCompare(stateOf(b));
      if (sort === 'keyAge') return (stamp(a.keyRotatedAt || a.keyCreatedAt) || Infinity) - (stamp(b.keyRotatedAt || b.keyCreatedAt) || Infinity);
      return String(a.serial || '').localeCompare(String(b.serial || ''));
    });
    result.replaceChildren();
    const count = el('p', `${rows.length} of ${devices.length} boxes`, 'fleet-note'); count.setAttribute('role', 'status'); result.append(count);
    if (!rows.length) { result.append(el('p', devices.length ? 'No boxes match these filters.' : demo ? 'No exercise boxes returned.' : 'No boxes have been provisioned yet.', 'kit-notice')); return; }
    const surface = el('div', '', 'kit-table'), scroll = el('div', '', 'kit-table__wrap');
    scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Fleet table, scroll for more columns');
    const table = el('table'); table.append(el('caption', demo ? 'Exercise fleet' : 'Operator fleet', 'sr-only'));
    const thead = el('thead'), tr = el('tr');
    const columns = ['Serial / name', 'State / reason', 'Linked customer', 'Last seen', 'Firmware', 'Key created', 'Key rotated', ...(writable ? ['Actions'] : [])];
    for (const text of columns) { const th = el('th', text); th.scope = 'col'; tr.append(th); }
    thead.append(tr); table.append(thead);
    const tbody = el('tbody');
    for (const device of rows) {
      const row = el('tr');
      const identity = el('th'); identity.scope = 'row'; identity.append(el('strong', device.serial || 'Unknown', 'fleet-serial'), el('small', device.name || 'Unknown'));
      const stateCell = el('td'), deviceState = stateOf(device);
      stateCell.append(Kit.pill(deviceState[0].toUpperCase() + deviceState.slice(1), deviceState === 'active' ? 'ok' : 'mut'), el('small', reasonOf(device)));
      const last = el('td'); last.append(el('span', relative(device.lastSeenAt)), el('small', absolute(device.lastSeenAt)));
      row.append(identity, stateCell, el('td', customerOf(device)), last, el('td', device.firmwareVersion || 'Unknown'), el('td', absolute(device.keyCreatedAt)), el('td', absolute(device.keyRotatedAt)));
      if (writable) {
        const cell = el('td'), manage = button('Manage', () => openManage(device));
        manage.setAttribute('aria-label', `Manage ${device.serial || device.name || 'box'}`);
        manage.disabled = pending || !device.id || !device.serial; cell.append(manage); row.append(cell);
      }
      tbody.append(row);
    }
    table.append(tbody); scroll.append(table); surface.append(scroll); result.append(surface);
  }

  async function refresh() {
    if (loading || stopped || pending) return;
    sheet?.close();
    loading = true; refreshButton.disabled = true; container.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading fleet…';
    let response;
    try { response = await api('/api/ops/fleet'); } catch { response = { ok: false }; }
    loading = false; refreshButton.disabled = false; container.removeAttribute('aria-busy');
    if (stopped) return;
    if (!response.ok || !Array.isArray(response.data?.devices)) {
      // Remove stale identities and controls when authorization or consent may have changed.
      devices = []; loaded = false; hide(); render();
      status.textContent = response.status === 401 ? 'Sign in again to load the fleet.' : response.status === 403 ? 'Your account cannot view this fleet.' : 'Could not load fleet. Try Refresh fleet.';
      return;
    }
    // Pick only the public list fields. Never retain an accidental secret in response state.
    devices = response.data.devices.map(d => ({
      id: d.id, serial: d.serial, name: d.name, fleetStatus: d.fleetStatus,
      linked: d.linked === true,
      linkedCustomer: d.linkedCustomer ? { linked: d.linkedCustomer.linked, consent: sharedCustomer(d.linkedCustomer),
        ...(sharedCustomer(d.linkedCustomer) ? { name: d.linkedCustomer.name, contactName: d.linkedCustomer.contactName, email: d.linkedCustomer.email } : {}) } : null,
      lastSeenAt: d.lastSeenAt, firmwareVersion: d.firmwareVersion, keyCreatedAt: d.keyCreatedAt,
      keyRotatedAt: d.keyRotatedAt, homeId: d.homeId, disabled: d.disabled,
    }));
    loaded = true; render(); status.textContent = `${demo ? 'Read-only exercise fleet' : 'Fleet updated'} · ${new Date().toLocaleTimeString()}`;
  }

  function openManage(device) {
    if (!writable || pending || loading || stopped) return;
    hide();
    const body = el('div', '', 'fleet-manage');
    body.append(el('p', reasonOf(device)), el('p', customerOf(device)));
    const actions = [device.disabled ? 'enable' : 'disable', 'rotate_key', 'reassign_home', 'force_unlink'];
    for (const action of actions) {
      const control = button(ACTIONS[action][0], () => confirmAction(device, action), action === 'force_unlink' ? 'kit-danger-warning' : 'kit-everyday');
      if (action === 'reassign_home' && isLinked(device)) control.disabled = true;
      body.append(control);
    }
    if (isLinked(device)) body.append(el('p', 'Release the customer link before reassigning its home.', 'fleet-note'));
    sheet = Kit.sideSheet({ title: device.serial, kicker: device.name || 'Box', body,
      fields: [{ term: 'Home ID', def: device.homeId || 'Unassigned' }, { term: 'Last seen', def: absolute(device.lastSeenAt) }, { term: 'Firmware', def: device.firmwareVersion || 'Unknown' }],
      onClose: () => { body.replaceChildren(); sheet = null; },
    });
  }

  function confirmAction(device, action) {
    if (!writable || pending || loading || stopped) return;
    sheet?.close();
    const body = el('form', '', 'fleet-confirm'); body.autocomplete = 'off';
    body.append(el('p', ACTIONS[action][1]));
    const serial = input('confirmSerial', 100), reason = el('textarea', '', 'kit-text-box');
    serial.required = true; reason.name = 'reason'; reason.required = true; reason.minLength = 3; reason.maxLength = 200;
    reason.placeholder = 'Why is this needed? Do not include private customer details.';
    body.append(field(`Type serial ${device.serial}`, serial), field('Reason (3–200 characters)', reason));
    let home = null;
    if (action === 'reassign_home') { home = input('homeId', 200); home.required = true; body.append(field('New home ID', home)); }
    const error = el('p', '', 'fleet-error'); error.setAttribute('role', 'alert');
    const submit = button(ACTIONS[action][0], () => {}, 'kit-danger-warning'); submit.type = 'submit'; submit.onclick = null;
    body.append(error, submit);
    let closed = false;
    popup = Kit.popUpWindow({ title: ACTIONS[action][0], body, close: true, scrimClose: false,
      onClose: () => { closed = true; body.reset(); body.replaceChildren(); popup = null; },
    });
    body.onsubmit = async event => {
      event.preventDefault();
      if (pending || closed || stopped || !writable) return;
      if (serial.value !== device.serial) { error.textContent = 'Type the exact serial shown above.'; serial.focus(); return; }
      const words = reason.value.trim();
      if (words.length < 3 || words.length > 160) { error.textContent = 'Enter a reason between 3 and 160 characters.'; reason.focus(); return; }
      if (home && !home.value.trim()) { error.textContent = 'Enter the destination home ID.'; home.focus(); return; }
      const request = { action, confirmSerial: serial.value, reason: words, ...(home ? { homeId: home.value.trim() } : {}) };
      pending = true; submit.disabled = true; error.textContent = 'Applying change…'; render();
      const token = generation;
      let response;
      try { response = await api(`/api/ops/fleet/${encodeURIComponent(device.id)}/action`, { method: 'POST', body: request }); }
      catch { response = { ok: false, status: 0 }; }
      pending = false;
      if (!response.ok) {
        const message = response.status === 409 ? 'The box changed or is still linked. Refresh Fleet before trying again.'
          : response.status === 401 || response.status === 403 ? 'Your session cannot make this change. Sign in with an operator account.'
          : response.status === 0 ? 'The result could not be confirmed. Refresh Fleet before retrying; the change may have completed.'
          : 'The change was refused. Check the serial, reason and current box state.';
        if (!closed) { error.textContent = message; submit.disabled = response.status === 0; }
        status.textContent = message; render(); return;
      }
      const mayShowKey = !closed && !closedByNavigation(token) && !document.hidden;
      if (!closed) popup?.close();
      status.textContent = 'Change applied.';
      if (action === 'rotate_key') {
        let key = response.data?.deviceKey;
        if (response.data) delete response.data.deviceKey;
        if (typeof key === 'string' && key && mayShowKey) showKey(key);
        else if (!stopped) status.textContent = 'Key rotated, but its one-time display is unavailable. Use the CLI to rotate again and install a new key.';
        key = null;
      }
      // Do not retain an action response or put it into the device list.
      response = null;
      const message = status.textContent;
      await refresh();
      if (!stopped && loaded) status.textContent = message;
    };
  }
  const closedByNavigation = token => stopped || token !== generation;

  function showKey(key) {
    const body = el('div', '', 'fleet-key');
    const secret = input('newDeviceKey'); secret.type = 'password'; secret.readOnly = true; secret.value = key;
    key = null;
    secret.setAttribute('data-lpignore', 'true'); secret.setAttribute('data-1p-ignore', 'true');
    const reveal = button('Show key', () => {
      secret.type = secret.type === 'password' ? 'text' : 'password'; reveal.textContent = secret.type === 'password' ? 'Show key' : 'Hide key';
    });
    body.append(el('p', 'Shown once. Install this key on the box now. Closing this display or hiding this page clears it. The old key no longer works.'), field('New device key', secret), reveal);
    popup = Kit.popUpWindow({ title: 'Save the new device key', body, close: true, scrimClose: false,
      actions: [{ label: 'Done, clear key', onClick: handle => handle.close() }],
      onClose: () => { secret.value = ''; secret.type = 'password'; body.replaceChildren(); reveal.onclick = null; popup = null; },
    });
  }

  function hide() { generation++; popup?.close(); sheet?.close(); }
  const visibility = () => { if (document.hidden) hide(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', hide);
  return { refresh, hide, destroy() {
    stopped = true; hide(); devices = []; container.replaceChildren();
    document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide);
  } };
}
