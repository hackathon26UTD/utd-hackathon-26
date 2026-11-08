import stylesheet from './households.css' with { type: 'text' };
// The CSS is embedded to avoid colliding with the existing customer.css build entry.
const style = document.createElement('style'); style.textContent = stylesheet; document.head.append(style);
let pendingInvite = null;
if (location.hash.startsWith('#household=')) {
  const token = location.hash.slice('#household='.length);
  pendingInvite = /^[a-f\d]{64}$/.test(token) ? token : 'invalid';
  history.replaceState(null, '', location.pathname + location.search);
}
const STATUS = { normal: 'Reporting normally', needs_attention: 'Needs attention', urgent: 'Urgent', no_recent_signal: 'No recent signal' };
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unknown time';
const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } };

export function householdUI({ h, api, state }) {
  const root = h('section', { class: 'card households', 'aria-label': 'Household sharing' });
  const notice = h('p', { role: 'status', 'aria-live': 'polite' });
  const picker = h('div'), detail = h('div', { class: 'hh-panel' }), inviteBox = h('div'), createBox = h('div');
  root.append(h('h2', { tabindex: '-1' }, 'Households'), h('p', { class: 'fine' }, 'Share selected live devices. Shared access is read-only.'), notice, inviteBox, picker, detail, createBox);
  let email = null, households = [], selected = null, current = null, timer = null, stopped = true, listReady = false, version = 0, contextAt = 0, contextId = null, snapshotsNode, contextNode, membersNode, emailNode, copyToken = null, copyHousehold = null;
  const button = (label, fn, attrs = {}) => h('button', { type: 'button', onclick: fn, ...attrs }, label);
  const say = text => { notice.textContent = text || ''; };
  const focus = () => root.querySelector('h2')?.focus();
  const choice = (label, value, options, onChange) => {
    const control = window.Kit.select({ value, options, onChange });
    const trigger = control.querySelector('button'), labelId = 'household-label-' + crypto.randomUUID();
    // Include the visible selection in the name; Kit updates its own text on pick.
    trigger.setAttribute('aria-labelledby', labelId + ' ' + trigger.id);
    return h('div', { class: 'hh-panel' }, h('span', { class: 'fine', id: labelId }, label), control);
  };
  async function perform(body) {
    const ownVersion = version;
    const r = await api('/api/customer/households', 'POST', body);
    if (stopped || ownVersion !== version) return null;
    if (!r.ok) { say(r.data.error || 'Household could not be updated.'); return null; }
    return r.data;
  }
  function devicesField(linkIds = []) {
    const devices = (state.devices || []).filter(d => !d.exercise);
    return h('fieldset', { class: 'hh-devices' }, h('legend', null, 'Devices to share (up to 20)'), devices.length ? devices.map(d => h('label', { class: 'hh-check' }, h('input', { type: 'checkbox', name: 'linkIds', value: d.id, checked: linkIds.includes(d.id) }), d.nickname)) : h('p', { class: 'fine' }, 'Link a live device above to share it. You can create an empty household now.'));
  }
  function form(children, fn) {
    return h('form', { class: 'hh-panel', onsubmit: async e => {
      e.preventDefault(); const b = e.target.querySelector('[type=submit]'); b.disabled = true;
      try { await fn(new FormData(e.target)); } catch { say('Could not complete that change. Try again.'); }
      finally { b.disabled = false; }
    } }, children);
  }
  const nameField = value => h('label', null, 'Household name', h('input', { name: 'name', maxlength: 60, required: true, value: value || '', autocomplete: 'off' }));
  const submit = text => h('button', { type: 'submit', class: 'primary' }, text);
  function drawCreate() {
    createBox.replaceChildren(h('details', null, h('summary', null, 'Create a household'), form([nameField(), devicesField(), submit('Create household')], async data => {
      const r = await perform({ action: 'create', name: data.get('name'), linkIds: data.getAll('linkIds') });
      if (r) { selected = r.household.id; say('Household created.'); await refreshList(); focus(); }
    })));
  }
  function drawInvite() {
    inviteBox.replaceChildren();
    if (!pendingInvite) return;
    const accept = button('Accept invitation', async () => {
      accept.disabled = true;
      const r = await perform({ action: 'accept', token: pendingInvite });
      if (r) { pendingInvite = null; selected = r.householdId; say('Invitation accepted. Email updates are off until you verify and opt in.'); drawInvite(); await refreshList(); focus(); }
      accept.disabled = false;
    });
    inviteBox.append(h('div', { class: 'hh-panel' }, h('p', null, 'An invitation is ready. Accept using the email it was addressed to.'), accept, button('Dismiss invitation', () => { pendingInvite = null; drawInvite(); })));
  }
  async function refreshList() {
    const ownVersion = version;
    const r = await api('/api/customer/households');
    if (stopped || ownVersion !== version) return;
    if (!r.ok) { say(r.data.error || 'Households are unavailable.'); return; }
    if (!listReady) say('');
    listReady = true;
    households = r.data.households || [];
    if (!households.some(x => x.id === selected)) selected = households[0]?.id || null;
    picker.replaceChildren(households.length ? choice('Household', selected, households.map(x => ({ value: x.id, label: x.name })), async value => {
      selected = value; version++; copyToken = null; copyHousehold = null; contextAt = 0; current = null; detail.replaceChildren(); await loadDetail(true);
    }) : h('p', { class: 'fine' }, 'No households yet. Create one or open a private invitation.'));
    drawCreate();
    if (selected) await loadDetail(true); else { current = null; detail.replaceChildren(); }
  }
  function renderSnapshots(devices) {
    snapshotsNode?.replaceChildren(h('h3', null, 'Shared device reports'), ...(devices.length ? devices.map(d => h('article', { class: 'hh-readonly' }, h('h3', null, d.nickname), h('strong', null, STATUS[d.status] || STATUS.no_recent_signal), h('p', null, d.statusText), h('p', { class: 'fine' }, 'Last report: ', time(d.lastSeen)), (d.conditions || []).map(c => h('p', null, h('strong', null, c.label + ' '), c.text)), (d.messages || []).map(m => h('p', null, h('strong', null, m.title + ' '), m.body)), h('p', null, d.help?.text || 'No follow-up has been set up.'))) : [h('p', null, 'No live devices are currently shared. Missing reports do not mean the home is safe.')]), h('p', { class: 'fine' }, 'Read-only. Reports refresh about every 10 seconds.'));
  }
  function drawMembers(members) {
    if (!membersNode) return;
    membersNode.replaceChildren(h('h3', null, 'Members and invitations'), ...members.filter(m => m.status !== 'revoked').map(m => {
      const expired = m.status === 'pending' && Date.parse(m.inviteExpiresAt) <= Date.now();
      return h('div', { class: 'hh-member' }, h('span', null, `${m.email} · ${m.role === 'owner' ? 'Owner' : m.role === 'alerts' ? 'Email updates only' : 'Read-only viewer'} · ${expired ? 'Expired' : m.status === 'pending' ? 'Pending · Not emailed' : 'Active'}`), m.role !== 'owner' && button('Revoke', async () => {
        if (await perform({ action: 'revoke', householdId: selected, memberId: m.id })) { copyToken = null; copyHousehold = null; say('Access revoked.'); await loadDetail(true); focus(); }
      }, { 'aria-label': 'Revoke access for ' + m.email }));
    }));
  }
  function drawDetails(data) {
    const household = data.household, owner = household.member.role === 'owner';
    snapshotsNode = h('div', { class: 'hh-panel', 'aria-label': 'Shared reports' });
    contextNode = h('div', { class: 'hh-panel hh-context' }); membersNode = h('div'); emailNode = h('div', { class: 'hh-panel' });
    detail.replaceChildren(h('h3', null, household.name));
    if (owner) {
      let role = 'viewer';
      const copyBox = h('div', { class: 'hh-panel' });
      function drawCopy() {
        copyBox.replaceChildren();
        if (!copyToken || copyHousehold !== selected) return;
        copyBox.append(h('p', null, 'Not emailed. Copy this private link and share it with the invited person. It expires in 7 days.'), button('Copy private invitation link', async () => {
          try { await navigator.clipboard.writeText(location.origin + '/customer#household=' + copyToken); say('Private invitation link copied. Not emailed.'); }
          catch { say('Clipboard is unavailable. Allow clipboard access, then try again.'); }
        }));
      }
      const inviteForm = form([h('label', null, 'Invitation email', h('input', { name: 'email', type: 'email', maxlength: 254, required: true, autocomplete: 'off' })), choice('Access', role, [{ value: 'viewer', label: 'Read-only viewer' }, { value: 'alerts', label: 'Email updates only' }], value => { role = value; }), h('p', { class: 'fine' }, 'Email-only members cannot see device reports. Everyone chooses their own email preferences.'), submit('Create private invitation')], async fields => {
        const r = await perform({ action: 'invite', householdId: selected, email: fields.get('email'), role });
        if (r) { copyToken = r.token; copyHousehold = selected; say('Invitation created. Not emailed.'); await loadDetail(true); }
      });
      drawCopy();
      detail.append(h('details', null, h('summary', null, 'Household settings'), form([nameField(household.name), devicesField(household.linkIds), submit('Save household')], async fields => {
        if (await perform({ action: 'update', householdId: selected, name: fields.get('name'), linkIds: fields.getAll('linkIds') })) { contextAt = 0; say('Household saved.'); await refreshList(); focus(); }
      })), inviteForm, copyBox, membersNode);
    }
    detail.append(h('details', null, h('summary', null, 'Email updates (optional)'), emailNode));
    if (household.member.role !== 'alerts') { detail.append(snapshotsNode, contextNode); renderSnapshots(data.devices || []); }
    else detail.append(h('p', null, 'You have email-only access. Device reports and local context are not shared with this role.'));
    const danger = h('div', { class: 'hh-actions' });
    const action = owner ? 'delete' : 'leave';
    const drawDanger = () => danger.replaceChildren(button(owner ? 'Delete household' : 'Leave household', () => {
      danger.replaceChildren(h('span', null, owner ? 'Remove this household and everyone’s access?' : 'Leave and stop this household’s emails?'), button(owner ? 'Yes, delete' : 'Yes, leave', async () => {
        if (await perform({ action, householdId: selected })) { copyToken = null; copyHousehold = null; selected = null; contextAt = 0; say(owner ? 'Household deleted.' : 'You left the household.'); await refreshList(); focus(); }
      }), button('Cancel', drawDanger));
    }));
    drawDanger(); detail.append(danger); drawMembers(data.members || []);
  }
  async function loadEmail() {
    if (!current || !emailNode) return;
    const ownVersion = version, memberId = current.household.member.id, node = emailNode;
    const r = await api('/api/customer/household-email?id=' + encodeURIComponent(memberId));
    if (stopped || ownVersion !== version || current?.household.member.id !== memberId || emailNode !== node) return;
    if (!r.ok) { node.replaceChildren(h('p', { role: 'status' }, r.data.error || 'Email settings unavailable.')); return; }
    const config = r.data;
    const device = h('input', { type: 'checkbox', name: 'device', checked: config.preferences?.device, disabled: !config.verified || config.suppressed });
    const weather = h('input', { type: 'checkbox', name: 'weather', checked: config.preferences?.weather, disabled: !config.verified || config.suppressed });
    const status = h('p', { role: 'status' });
    const prefs = form([h('label', { class: 'hh-check' }, device, 'Device updates'), h('label', { class: 'hh-check' }, weather, 'Official weather alerts'), submit('Save email preferences')], async () => {
      const result = await api('/api/customer/household-email', 'POST', { action: 'preferences', memberId, device: device.checked, weather: weather.checked });
      status.textContent = result.ok ? 'Email preferences saved.' : result.data.error || 'Could not save preferences.';
    });
    node.replaceChildren(h('h3', null, 'Your email updates'), h('p', { class: 'fine' }, config.configured ? (config.verified ? 'Your email is verified.' : 'Verify your address, then choose updates. Accepting an invitation does not verify it.') : 'Email delivery is not connected yet. No email has been sent.'), config.suppressed ? h('p', null, 'Email stopped after a delivery problem. Contact the team.') : h('span'), prefs, status);
    if (!config.verified && !config.suppressed) {
      const verify = button('Verify my email', async () => {
        verify.disabled = true;
        const result = await api('/api/customer/household-email', 'POST', { action: 'verify', memberId });
        status.textContent = result.data.message || result.data.error || 'Email delivery could not be confirmed.';
        verify.disabled = !config.configured;
      }, { disabled: !config.configured });
      node.append(verify);
    }
  }
  async function loadContext(force = false) {
    if (!current || current.household.member.role === 'alerts') return;
    if (!force && contextId === selected && Date.now() - contextAt < 300000) return;
    const ownVersion = version, householdId = selected, node = contextNode;
    contextAt = Date.now(); contextId = householdId;
    const r = await api('/api/customer/household-context?id=' + encodeURIComponent(householdId));
    if (stopped || ownVersion !== version || selected !== householdId || node !== contextNode) return;
    node.replaceChildren(h('h3', null, 'Nearby weather and news'), h('p', { class: 'fine' }, 'Local context only. These sources do not change your device reports or request a response.'));
    if (!r.ok) { node.append(h('p', null, r.data.error || 'Local context is unavailable.')); return; }
    const sourceLink = (label, url) => safeUrl(url) ? h('a', { href: safeUrl(url), target: '_blank', rel: 'noopener noreferrer' }, label) : h('span', null, label);
    const locations = r.data.locations || [];
    if (r.data.truncated) node.append(h('p', { class: 'fine' }, 'Showing the first 5 distinct registered locations.'));
    if (!locations.length) node.append(h('p', null, 'No location context is available for the selected devices.'));
    for (const loc of locations) {
      const weather = loc.weather || {}, news = loc.news || {};
      node.append(h('article', { class: 'hh-panel' }, h('h3', null, loc.label || 'Shared home area'), h('div', { class: 'hh-context-grid' },
        h('div', { class: 'hh-panel' }, h('strong', null, 'Official weather'), h('p', { class: 'fine' }, `Alerts: ${weather.alertsStatus || weather.status || 'unavailable'} · Forecast: ${weather.forecastStatus || weather.status || 'unavailable'}`), h('p', { class: 'fine' }, 'Checked: ', time(weather.checkedAt)), weather.forecastIssuedAt && h('p', { class: 'fine' }, 'Forecast issued: ', time(weather.forecastIssuedAt)), (weather.alerts || []).map(a => h('div', null, sourceLink(a.title, a.url), h('p', { class: 'fine' }, `${a.severity || 'Unknown severity'} · Issued ${time(a.sent)} · Expires ${time(a.expires)}`))), (weather.forecast || []).slice(0, 3).map(f => h('p', null, `${time(f.startTime)}: ${f.summary || 'Forecast unavailable'}${f.temperature != null ? ` · ${f.temperature}°${f.temperatureUnit || ''}` : ''}${f.windSpeed ? ` · Wind ${f.windSpeed}` : ''}${f.rainChance != null ? ` · Rain ${f.rainChance}%` : ''}`)), sourceLink('Weather source', weather.url)),
        h('div', { class: 'hh-panel' }, h('strong', null, 'Regional news'), h('p', { class: 'fine' }, `${news.source || 'Publisher not configured'} · ${news.scope || 'Coverage unavailable'} · ${news.status || 'unavailable'}`), (news.items || []).slice(0, 5).map(n => h('div', null, sourceLink(n.title, n.url), h('p', { class: 'fine' }, time(n.publishedAt))))))));
    }
    node.append(h('p', { class: 'fine' }, 'Context checked: ', time(r.data.checkedAt), '. Refreshes about every five minutes.'));
  }
  async function loadDetail(redraw = false) {
    if (!selected || stopped) return;
    const ownVersion = version, householdId = selected;
    const r = await api('/api/customer/households?id=' + encodeURIComponent(householdId));
    if (stopped || ownVersion !== version || selected !== householdId) return;
    if (!r.ok) {
      if ([401, 403, 404].includes(r.status)) { current = null; listReady = false; selected = null; detail.replaceChildren(); copyToken = null; copyHousehold = null; }
      else snapshotsNode?.replaceChildren(h('p', { role: 'status' }, 'Shared reports could not refresh. Current conditions are unknown.'));
      say(r.data.error || 'Household could not refresh.'); return;
    }
    if (!current || !detail.childElementCount || current.household.member.id !== r.data.household.member.id || current.household.member.role !== r.data.household.member.role || JSON.stringify(current.household.linkIds) !== JSON.stringify(r.data.household.linkIds)) redraw = true;
    current = r.data;
    if (redraw) { drawDetails(r.data); await loadEmail(); }
    else { renderSnapshots(r.data.devices || []); if (!membersNode?.contains(document.activeElement)) drawMembers(r.data.members || []); }
    await loadContext(redraw);
  }
  async function poll() {
    if (stopped) return;
    try {if (!document.hidden) {if (!listReady) await refreshList(); else await loadDetail();}}
    catch {say('Household could not refresh. Retrying shortly.');}
    finally {if (!stopped) timer = setTimeout(poll, 10000);}
  }
  function reset() { stopped = true; listReady = false; version++; clearTimeout(timer); email = null; current = null; selected = null; households = []; copyToken = null; copyHousehold = null; contextAt = 0; picker.replaceChildren(); detail.replaceChildren(); createBox.replaceChildren(); say(''); }
  document.addEventListener('household-email-updated', () => { if (!stopped) loadEmail(); });
  return {
    node() { return root; },
    guestNotice() { return pendingInvite ? h('p', { class: 'card', role: 'status' }, 'A household invitation is ready. Sign in or create an account with the invited email to accept it. Keep this page open.') : null; },
    sync() {
      if (!state.user) { if (email) reset(); return; }
      if (email !== state.user.email) {
        reset(); email = state.user.email; stopped = false; drawInvite();
        refreshList().finally(() => { if (!stopped) { clearTimeout(timer); timer = setTimeout(poll, 10000); } });
      } else if (!createBox.contains(document.activeElement) && !createBox.querySelector('details[open]')) drawCreate();
    },
  };
}
