import {backupRuntime} from './backup-runtime.js';
import {previewDevice} from './customer-preview.js';
import {onboardingUI, readClaimFragment, boxStatus} from './customer-onboarding.js';
import {emailConfirmation} from './household-email-confirm.js';
import {householdUI} from './households.js';
import {openDeviceHistory} from './device-history.js';
import {mountProfilePhoto} from './profile-photo.js';
import {customerSettings} from './customer-settings.js';
import {startProductKit} from './product-kit.js';
// Customer side of Safe Home. All text is set with textContent; the server returns an allowlisted view only.
const root = document.getElementById('customer');
let photoCleanup = null, modelCleanup = null, modelGeneration = 0;
const preview = new URLSearchParams(location.search).get('preview') === '1';
let selectedDevice = null;
const STATUS = { needs_attention: 'Needs attention', urgent: 'Urgent', no_recent_signal: 'No recent signal' };
const POLL_MS = 10000;
const state = { user: null, devices: null, tab: new URLSearchParams(location.search).get('mode') === 'signin' ? 'signin' : 'link', msg: {}, prefill: readClaimFragment(window), seen: new Set(), failures: 0, timer: null, refreshSequence: 0 };

startProductKit();

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.setAttribute('class', v); else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
async function api(path, method = 'GET', body) {
  try {
    const res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, data: data || {} };
  } catch { return { ok: false, status: 0, data: { error: 'Could not reach Safe Home. Check your connection and try again.' } }; }
}
const households = householdUI({h,api,state});
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  if (m < 2880) { const hrs = Math.round(m / 60); return `${hrs} hour${hrs === 1 ? '' : 's'} ago`; }
  return `${Math.round(m / 1440)} days ago`;
}
const say = (key, text, kind = 'err') => { state.msg[key] = text ? { text, kind } : null; const el = document.querySelector(`[data-msg="${key}"]`); if (el) { el.textContent = text || ''; el.className = 'msg ' + (text ? kind : ''); } };
const msgEl = key => h('p', { class: 'msg' + (state.msg[key] ? ' ' + state.msg[key].kind : ''), 'data-msg': key, role: 'status', 'aria-live': 'polite' }, state.msg[key]?.text || '');

function field(label, name, opts = {}) {
  const input = h('input', { type: opts.type || 'text', name, id: 'f-' + name, required: !opts.optional, autocomplete: opts.auto, inputmode: opts.mode, maxlength: opts.max, class: opts.mono ? 'mono' : false, value: opts.value, autocapitalize: opts.mono ? 'characters' : false, spellcheck: 'false' });
  return h('label', { for: 'f-' + name }, label, opts.hint && h('small', null, opts.hint), input);
}
async function submit(form, key, fn) {
  const btn = form.querySelector('button.primary'); btn.disabled = true; say(key, 'Working...', 'ok');
  try { await fn(Object.fromEntries(new FormData(form))); } finally { btn.disabled = false; }
}

// ---------- screens ----------
const onboarding = onboardingUI({h, api, state, refresh, renderDevices, say, msgEl, field, submit, win: window});

function guestView() {
  const link = state.tab === 'link';
  const regForm = h('form', { onsubmit: e => { e.preventDefault(); submit(e.target, 'reg', async f => {
    const r = await api('/api/customer/register', 'POST', { email: f.email, password: f.password, contactName: f.contactName, consent: !!f.consent, acceptTerms: !!f.acceptTerms, ...(f.nickname ? { nickname: f.nickname } : {}) });
    if (!r.ok) return say('reg', r.data.error || 'Something went wrong. Try again.');
    say('reg', ''); await enter();
  }); } },
  field('Your name', 'contactName', { auto: 'name', max: 60 }), field('Email', 'email', { type: 'email', auto: 'email', max: 254 }), field('Choose a password', 'password', { type: 'password', auto: 'new-password', hint: 'At least 10 characters', max: 512 }),
  h('label', { class: 'check', for: 'f-terms' }, h('input', { type: 'checkbox', id: 'f-terms', name: 'acceptTerms', required: true }), h('span', null, 'I agree to the ', h('a', { href: '/terms', target: '_blank', rel: 'noopener' }, 'prototype terms'), ' and have read the ', h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'privacy policy'), '.')),
  h('button', { class: 'primary', type: 'submit' }, 'Create account'), msgEl('reg'));
  const inForm = h('form', { onsubmit: e => { e.preventDefault(); submit(e.target, 'login', async f => {
    const r = await api('/api/customer/login', 'POST', { email: f.email, password: f.password });
    if (!r.ok) return say('login', r.data.error || 'Something went wrong. Try again.');
    say('login', ''); await enter();
  }); } }, field('Email', 'email', { type: 'email', auto: 'email', max: 254 }), field('Password', 'password', { type: 'password', auto: 'current-password', max: 512 }), h('button', { class: 'primary', type: 'submit' }, 'Sign in'), msgEl('login'));
  const tab = (id, text) => h('button', { type: 'button', id: 'customer-tab-' + id, 'aria-pressed': String(state.tab === id), onclick: () => { state.tab = id; render(); document.getElementById('customer-tab-' + id)?.focus(); } }, text);
  return [
    h('h1', null, link ? 'Create your Safe Home account' : 'Sign in'),
    h('p', { class: 'muted' }, 'See your device reports and updates from the response team.'),
    households.guestNotice(),
    h('div', { class: 'tabs', role: 'group', 'aria-label': 'Choose' }, tab('link', 'Sign up'), tab('signin', 'Sign in')),
    link && h('p', { class: 'fine' }, 'Create your profile. Then choose Add my box to connect your Safe Home.'),
    h('section', { class: 'card' }, link ? regForm : inForm),
    link && h('p', { class: 'fine' }, 'No device yet? ', h('a', { href: '/simulations' }, 'Explore simulations'), '. Team operators use ', h('a', { href: '/login?role=operator' }, 'operator sign in'), '.'),
  ];
}

function deviceCard(d) {
  const connection = boxStatus(d);
  const msgs = (d.messages || []).filter(m => !state.seen.has(m.id));
  return h('article', { class: 'card', 'aria-label': d.nickname },
    h('div', { class: 'row' }, h('h2', null, d.nickname), h('span', { class: 'pill ' + connection.pill }, connection.label)),
    d.exercise && h('p', { class: 'banner' }, 'Exercise device. This is practice data, not a real event.'),
    d.room && h('p', { class: 'fine' }, 'Room: ', d.room),
    d.serial && h('p', { class: 'fine' }, 'Serial: ', h('code', null, d.serial)),
    onboarding.reportingBanner(d), onboarding.waitingView(d), onboarding.lastHeard(d),
    ['urgent', 'needs_attention'].includes(d.status) && h('span', { class: 'pill ' + d.status }, STATUS[d.status]),
    d.statusText && h('p', null, d.statusText),
    d.conditions?.length ? h('ul', { class: 'plain' }, d.conditions.map(c => h('li', null, h('strong', null, c.label), c.text))) : null,
    msgs.map(m => h('div', { class: 'box ' + (m.severity || 'info'), role: m.severity === 'urgent' ? 'alert' : 'note' },
      h('h3', null, m.title), m.body && h('p', null, m.body),
      h('button', { type: 'button', onclick: () => ack(d, m) }, 'Got it'))),
    d.help && h('div', { class: 'help ' + d.help.status }, h('strong', null, 'Help status'), h('p', null, d.help.text), d.help.note && h('p', null, d.help.note), d.help.updatedAt && h('p', { class: 'fine' }, 'Updated ', ago(d.help.updatedAt))),
    !d.exercise && h('button',{type:'button',onclick:()=>openDeviceHistory(d.id,{customer:true})},'History and usual readings'),
    onboarding.manageView(d));
}

function devicesView() {
  if (state.devices === null) return h('p', { class: 'muted', role: 'status' }, state.failures ? 'Could not load your boxes. Trying again in 10 seconds.' : 'Loading your boxes...');
  if (!state.devices.length) return h('p', { class: 'card' }, 'No devices are linked to this account yet.');
  return h('div', { class: 'device-list' }, state.failures > 0 && h('p', { class: 'banner', role: 'status' }, 'Could not update your boxes. These are the last details we received. Trying again in 10 seconds.'), state.devices.map(deviceCard));
}
function boxOverview() {
  const icons={Power:'ϟ','Wi-Fi':'⌁',Conditions:'◉'};
  return h('section', {class:'box-overview', 'aria-label':'Your box overview'},
    h('div',{id:'box-summary',class:'box-summary'}),
    h('div', {class:'box-visual'},h('div',{id:'enclosure-view',class:'enclosure-stage'}),h('p',{'data-model-status':'',class:'model-status'},'Loading enclosure…')),
    h('div',{class:'vital-shortcuts','aria-label':'Device vitals'},Object.entries(icons).map(([name,icon])=>h('button',{type:'button',class:'vital-shortcut','data-vital':name,'aria-expanded':'false',onclick:e=>{
      const detail=document.getElementById('vital-detail');const was=e.currentTarget.getAttribute('aria-expanded')==='true';
      root.querySelectorAll('.vital-shortcut').forEach(b=>b.setAttribute('aria-expanded','false'));
      e.currentTarget.setAttribute('aria-expanded',String(!was));detail.hidden=was;if(!was)showVitalDetail(e.currentTarget);
    }},h('span',{class:'vital-circle','aria-hidden':'true'},icon),h('strong',null,name),h('small',{'data-vital-value':name},'Not reported')))),
    h('section',{id:'vital-detail',class:'vital-detail',role:'region','aria-label':'Selected device report','aria-live':'polite',hidden:true}),
    backupRuntime(h),
    h('nav',{class:'customer-quicklinks','aria-label':'Quick links'},[
      ['Add household member','household-tools','♧'],['Add device','add-device','+'],['Device history','devices','↗'],['Account settings','account-settings','⚙']
    ].map(([name,id,icon])=>h('a',{href:preview?'/customer?mode=signin#'+id:'#'+id,onclick:e=>{if(preview)return;
      const target=document.getElementById(id);if(target){e.preventDefault();if(target.tagName==='DETAILS')target.open=true;target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
    }},h('span',{'aria-hidden':'true'},icon),h('strong',null,name),h('span',{class:'quick-arrow','aria-hidden':'true'},'›')))));
}
function showVitalDetail(button) {
  const detail=document.getElementById('vital-detail'); if(!detail)return;
  const name=button.dataset.vital, rows=JSON.parse(button.dataset.readings || '[]');
  detail.dataset.kind=name.toLowerCase().replace(/[^a-z]/g,'');
  detail.replaceChildren(h('div',{class:'vital-detail-heading'},h('span',{class:'detail-symbol','aria-hidden':'true'},name==='Power'?'ϟ':name==='Wi-Fi'?'⌁':'◉'),h('div',null,h('h3',null,name+' report'),h('p',null,preview?'Fictional sample readings':'Last reported by your device'))),
    h('dl',{class:'vital-detail-readings'},rows.length?rows.map(c=>h('div',null,h('dt',null,c.label),h('dd',null,c.text))):h('div',null,h('dt',null,name),h('dd',null,'Not reported'))));
}
function updateOverview() {
  const el = document.getElementById('box-summary'); if (!el) return;
  const devices = state.devices || [];
  const d = devices.find(d=>d.id===selectedDevice) || devices[0]; selectedDevice = d?.id;
  if (!d) { el.replaceChildren(h('h2',null,'Your Safe Home'),h('p',{class:'muted'},'Add a device to see its reports.')); return; }
  const select = devices.length > 1 ? h('label',null,'Your box', h('select',{'aria-label':'Your box',onchange:e=>{selectedDevice=e.target.value;updateOverview();}},devices.map(item=>h('option',{value:item.id,selected:item.id===d.id},item.nickname)))) : '';
  el.replaceChildren(h('div',null,h('p',{class:'box-kicker'},preview?'PREVIEW · SAMPLE DATA':'YOUR BOX'),h('h2',null,d.nickname),select),
    h('div',{class:'device-health'},h('span',{class:'pill '+(['urgent','needs_attention'].includes(d.status)?d.status:boxStatus(d).pill)},STATUS[d.status] || boxStatus(d).label),h('small',null,'Last report: '+((d.lastSeenAt || d.lastSeen) ? new Date(d.lastSeenAt || d.lastSeen).toLocaleString() : 'Not reported')),
    state.failures > 0 ? h('p',{role:'status'},'Refresh unavailable.') : ''));
  const groups={Power:/power|mains|battery/i,'Wi-Fi':/connect|internet|wi-fi|network/i,Conditions:/water|flood|temp|air|smoke|humid/i};
  for(const [name,pattern] of Object.entries(groups)){
    const rows=(d.conditions||[]).filter(c=>pattern.test(c.label));
    const button=root.querySelector('[data-vital="'+name+'"]');if(!button)continue;
    const primary=rows[0]?.text || 'Not reported';
    button.querySelector('small').textContent=primary;
    button.dataset.readings=JSON.stringify(rows);button.setAttribute('aria-controls','vital-detail');button.setAttribute('aria-label',name+': '+primary);
    if(button.getAttribute('aria-expanded')==='true')showVitalDetail(button);
  }
}
async function startBox() {
  const host = document.getElementById('enclosure-view'); if (!host) return;
  const generation = ++modelGeneration;
  const {mountEnclosure} = await import('./enclosure-viewer.js');
  if (generation !== modelGeneration || !host.isConnected) return;
  const cleanup = await mountEnclosure(host);
  if (generation !== modelGeneration || !host.isConnected) cleanup(); else modelCleanup = cleanup;
}
function appView() {
  const settings = customerSettings({h,api,state,refresh,enter});
  const connecting = new URLSearchParams(location.search).has('connect');
  return [h('h1', {class:'portal-heading'}, connecting ? 'Connect your assistant' : 'Your devices'), boxOverview(), ...(connecting ? [settings] : []), h('div', { id: 'devices', 'aria-live': 'polite' }, devicesView()), h('div',{id:'add-device'},onboarding.addView()), h('div',{id:'household-tools'},households.node()), ...(!connecting ? [settings] : [])];
}

// ---------- actions ----------
async function ack(d, m) {
  const r = await api('/api/customer/messages?id=' + encodeURIComponent(d.id), 'POST', { messageId: m.id });
  if (r.ok || r.status === 404) { state.seen.add(m.id); renderDevices(); }
}
async function refresh() {
  const user = state.user, sequence = ++state.refreshSequence;
  const r = await api('/api/customer/devices');
  if (!user || state.user !== user || sequence !== state.refreshSequence) return;
  if (r.status === 401) { stop(); onboarding.stopScan(); state.user = null; state.devices = null; return render(); }
  if (r.ok) { state.devices = r.data.devices || []; onboarding.trackReporting(state.devices); state.failures = 0; } else state.failures++;
  renderDevices();
  households.sync();
}
function renderDevices() {
  updateOverview();
  const el = document.getElementById('devices');
  if (!el) return;
  // Cached management forms keep draft values, expansion, and keyboard focus across polling.
  const active = el.contains(document.activeElement) ? document.activeElement : null;
  const selection = active?.tagName === 'INPUT' && active.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
  el.replaceChildren(devicesView());
  if (active?.isConnected) { active.focus({ preventScroll: true }); if (selection) active.setSelectionRange(...selection); }
  const add = document.getElementById('add-box')?.closest('details');
  if (add && state.devices?.length === 0) add.open = true;
}
function stop() { clearTimeout(state.timer); state.timer = null; }
function schedule() {
  stop();
  if (!state.user) return;
  state.timer = setTimeout(async () => { if (!document.hidden) await refresh(); if (state.user) schedule(); }, POLL_MS);
}
async function enter() {
  const me = await api('/api/customer/me');
  state.user = me.ok ? me.data : null;
  render();
  if (state.user) { await refresh(); schedule(); }
}
async function signOut() { stop(); onboarding.stopScan(); const r = await api('/api/customer/logout', 'POST'); if (!r.ok) { say('session', 'Could not sign out. Try again.'); schedule(); return; } onboarding.reset(); state.seen.clear(); state.msg = {}; state.user = null; state.devices = null; state.tab = 'signin'; render(); }

function render() {
  onboarding.stopScan();
  modelGeneration++; modelCleanup?.(); modelCleanup = null;
  photoCleanup?.(); photoCleanup = null;
  const top = h('div', { class: 'top' }, h('a', { class: 'brand', href: '/' }, 'Safe Home'), !state.user && h('a', { href: '/login' }, 'Account type'), state.user && h('button', { type: 'button', onclick: signOut }, 'Sign out'));
  const foot = h('footer', null,
    h('p', { class: 'fine' }, 'Safe Home shows what your device last reported. It cannot tell you whether your home is safe, and it does not know if anyone is inside. In an emergency call 911.'),
    h('p', { class: 'fine' }, 'Contact permission is shown under Manage this box.'), h('nav', { class: 'footer-links', 'aria-label': 'Policies' }, h('a', { href: '/privacy' }, 'Privacy'), h('a', { href: '/terms' }, 'Terms'), h('a', { href: '/accessibility' }, 'Accessibility'), h('button', { type: 'button', 'data-theme-toggle': '' }, 'Switch theme')));
  root.replaceChildren(h('div', { class: 'shell' }, top, h('main', { id: 'main' }, emailConfirmation({h,api}), msgEl('session'), ...(preview ? [boxOverview()] : state.user ? appView() : guestView())), foot));
  if (state.user || preview) {startBox();updateOverview();}
  if (!preview) households.sync();
  if(state.user){const photo=h('details',{class:'card',id:'profile',open:location.hash==='#profile'},h('summary',null,'Profile photo'));root.querySelector('main').append(photo);photoCleanup=mountProfilePhoto(photo,{kind:'customer'});}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) refresh(); });
if (preview) {state.devices=[previewDevice];render();}
const first = preview ? {ok:false} : await api('/api/customer/me');
if (first.ok) { state.user = first.data; render(); await refresh(); schedule(); } else if(!preview) render();
