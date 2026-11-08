import {backupRuntime} from './backup-runtime.js';
import {previewDevice} from './customer-preview.js';
import {emailConfirmation} from './household-email-confirm.js';
import {householdUI} from './households.js';
import {openDeviceHistory} from './device-history.js';
import {mountProfilePhoto} from './profile-photo.js';
import {customerSettings} from './customer-settings.js';
import {startProductKit} from './product-kit.js';
startProductKit();
// Customer side of Safe Home. All text is set with textContent; the server returns an allowlisted view only.
const root = document.getElementById('customer');
let photoCleanup = null, modelCleanup = null, modelGeneration = 0;
const preview = new URLSearchParams(location.search).get('preview') === '1';
let selectedDevice = null;
const STATUS = { normal: 'Reporting normally', needs_attention: 'Needs attention', urgent: 'Urgent', no_recent_signal: 'No recent signal' };
const POLL_MS = 10000;
const state = { user: null, devices: null, tab: new URLSearchParams(location.search).get('mode') === 'signin' ? 'signin' : 'link', msg: {}, prefill: readClaimFragment(), seen: new Set(), confirm: null, failures: 0, timer: null };

function h(tag, attrs, ...kids) {
  const el = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.setAttribute('class', v); else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
// QR links look like /customer#claim=HB-7K3Q-9XMD.482913. Read the code, then remove it from the address bar.
function readClaimFragment() {
  const m = /^#claim=([A-Za-z0-9-]{8,16})\.(\d{6})$/.exec(location.hash);
  if (m) history.replaceState(null, '', location.pathname + location.search);
  return m ? { serial: m[1].toUpperCase(), code: m[2] } : null;
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
function deviceFields(prefix) {
  return [
    field('Device serial', 'serial', { mono: true, hint: 'On the label, like HB-7K3Q-9XMD', value: state.prefill?.serial, max: 16 }),
    field('Pairing code', 'code', { mono: true, mode: 'numeric', hint: '6 digits from the label or your installer', value: state.prefill?.code, max: 8 }),
    field('Device name', 'nickname', { optional: true, hint: 'Optional, like Garage', max: 40 }),
    field('Your name', 'contactName', { auto: 'name', value: state.user?.contactName, hint: 'Shown to the response team', max: 60 }),
    h('label', { class: 'check', for: 'f-consent' }, h('input', { type: 'checkbox', id: 'f-consent', name: 'consent' }), h('span', null, 'The response team may use my name and email to contact me about this device. I can unlink it at any time.')),
  ];
}
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
    link && h('p', { class: 'fine' }, 'Create your profile. Then choose Add device to connect your Safe Home.'),
    h('section', { class: 'card' }, link ? regForm : inForm),
    link && h('p', { class: 'fine' }, 'No device yet? ', h('a', { href: '/simulations' }, 'Explore simulations'), '. Team operators use ', h('a', { href: '/login?role=operator' }, 'operator sign in'), '.'),
  ];
}

function deviceCard(d) {
  const msgs = (d.messages || []).filter(m => !state.seen.has(m.id));
  return h('article', { class: 'card', 'aria-label': d.nickname },
    h('div', { class: 'row' }, h('h2', null, d.nickname), h('span', { class: 'pill ' + d.status }, STATUS[d.status] || STATUS.no_recent_signal)),
    d.exercise && h('p', { class: 'banner' }, 'Exercise device. This is practice data, not a real event.'),
    h('p', null, d.statusText),
    h('p', { class: 'fine' }, 'Last heard from: ', ago(d.lastSeen)),
    d.conditions?.length ? h('ul', { class: 'plain' }, d.conditions.map(c => h('li', null, h('strong', null, c.label), c.text))) : null,
    msgs.map(m => h('div', { class: 'box ' + (m.severity || 'info'), role: m.severity === 'urgent' ? 'alert' : 'note' },
      h('h3', null, m.title), m.body && h('p', null, m.body),
      h('button', { type: 'button', onclick: () => ack(d, m) }, 'Got it'))),
    h('div', { class: 'help ' + d.help.status }, h('strong', null, 'Help status'), h('p', null, d.help.text), d.help.note && h('p', null, d.help.note), d.help.updatedAt && h('p', { class: 'fine' }, 'Updated ', ago(d.help.updatedAt))),
    !d.exercise && h('button',{type:'button',onclick:()=>openDeviceHistory(d.id,{customer:true})},'History and usual readings'),
    state.confirm === d.id
      ? h('div', { class: 'row' }, h('span', null, 'Unlink this device and delete your contact name from it?'), h('button', { type: 'button', class: 'danger', onclick: () => unlink(d) }, 'Yes, unlink'), h('button', { type: 'button', onclick: () => { state.confirm = null; renderDevices(); } }, 'Keep'))
      : h('button', { type: 'button', class: 'link', onclick: () => { state.confirm = d.id; renderDevices(); } }, 'Unlink this device'));
}
function devicesView() {
  if (state.devices === null) return h('p', { class: 'muted', role: 'status' }, 'Loading your devices...');
  if (!state.devices.length) return h('p', { class: 'card' }, 'No devices are linked to this account yet.');
  return h('div', { style: 'display:grid;gap:16px' }, state.devices.map(deviceCard));
}
function addView() {
  const form = h('form', { onsubmit: e => { e.preventDefault(); submit(e.target, 'add', async f => {
    const r = await api('/api/customer/claim', 'POST', { serial: f.serial, code: f.code, address:f.address, contactName: f.contactName, consent: !!f.consent, ...(f.nickname ? { nickname: f.nickname } : {}) });
    if (!r.ok) return say('add', r.data.error || 'Something went wrong. Try again.');
    state.prefill = null; say('add', 'Device linked.', 'ok'); e.target.reset(); await refresh();
  }); } }, ...deviceFields(), field('Device address', 'address', { auto:'street-address', max:300, hint:'Street, city, state and ZIP. Sent to the U.S. Census address service to place your device on the map.' }), h('button', { class: 'primary', type: 'submit' }, 'Link device'), msgEl('add'));
  return h('details', { class: 'card', id:'add-device', open: !!state.prefill || state.devices?.length === 0 }, h('summary', null, 'Add device'), form);
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
    h('div',{class:'device-health'},h('span',{class:'pill '+d.status},STATUS[d.status] || STATUS.no_recent_signal),h('small',null,'Last report: '+(d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'Not reported')),
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
  return [h('div',{class:'portal-heading'},h('p',{class:'box-kicker'},'CUSTOMER PORTAL'),h('h1', null, connecting ? 'Connect your assistant' : 'Your home. In view.'),h('p',{class:'muted'},'Your box, its latest observations, and updates from your team.')), boxOverview(), ...(connecting ? [settings] : []), h('div', { id: 'devices', 'aria-live': 'polite' }, devicesView()), addView(), h('div',{id:'household-tools'},households.node()), ...(!connecting ? [settings] : [])];
}

// ---------- actions ----------
async function ack(d, m) {
  const r = await api('/api/customer/messages?id=' + encodeURIComponent(d.id), 'POST', { messageId: m.id });
  if (r.ok || r.status === 404) { state.seen.add(m.id); renderDevices(); }
}
async function unlink(d) {
  const r = await api('/api/customer/devices?id=' + encodeURIComponent(d.id), 'DELETE');
  state.confirm = null;
  if (r.ok || r.status === 404) await refresh(); else renderDevices();
}
async function refresh() {
  const r = await api('/api/customer/devices');
  if (r.status === 401) { stop(); state.user = null; state.devices = null; return render(); }
  if (r.ok) { state.devices = r.data.devices || []; state.failures = 0; } else state.failures++;
  renderDevices();
  households.sync();
}
function renderDevices() { updateOverview(); const el = document.getElementById('devices'); if (el) el.replaceChildren(devicesView()); }
function stop() { clearTimeout(state.timer); state.timer = null; }
function schedule() {
  stop();
  const wait = Math.min(120000, POLL_MS * 2 ** Math.min(state.failures, 3)) + Math.random() * 2000;
  state.timer = setTimeout(async () => { if (!document.hidden) await refresh(); schedule(); }, wait);
}
async function enter() {
  const me = await api('/api/customer/me');
  state.user = me.ok ? me.data : null;
  render();
  if (state.user) { await refresh(); schedule(); }
}
async function signOut() { stop(); await api('/api/customer/logout', 'POST'); state.user = null; state.devices = null; state.tab = 'signin'; render(); }

function render() {
  modelGeneration++; modelCleanup?.(); modelCleanup = null;
  photoCleanup?.(); photoCleanup = null;
  const top = h('div', { class: 'top' }, h('a', { class: 'brand', href: '/' }, 'Safe Home'), !state.user && h('a', { href: '/login' }, 'Account type'), state.user && h('button', { type: 'button', onclick: signOut }, 'Sign out'));
  const foot = h('footer', null,
    h('p', { class: 'fine' }, 'Safe Home shows what your device last reported. It cannot tell you whether your home is safe, and it does not know if anyone is inside. In an emergency call 911.'),
    h('p', { class: 'fine' }, 'Your name is shared with the response team. Your email is shared only if you allowed contact.'), h('nav', { class: 'footer-links', 'aria-label': 'Policies' }, h('a', { href: '/privacy' }, 'Privacy'), h('a', { href: '/terms' }, 'Terms'), h('a', { href: '/accessibility' }, 'Accessibility'), h('button', { type: 'button', 'data-theme-toggle': '' }, 'Switch theme')));
  root.replaceChildren(h('div', { class: 'shell' }, top, h('main', { id: 'main' }, emailConfirmation({h,api}), ...(preview ? [h('div',{class:'banner'},'Design preview · fictional device data. ',h('a',{href:'/customer?mode=signin'},'Sign in to see your own box')), boxOverview()] : state.user ? appView() : guestView())), foot));
  if (state.user || preview) { startBox(); updateOverview(); }
  if (!preview) households.sync();
  if(state.user){const photo=h('details',{class:'card',id:'profile',open:location.hash==='#profile'},h('summary',null,'Profile photo'));root.querySelector('main').append(photo);photoCleanup=mountProfilePhoto(photo,{kind:'customer'});}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) refresh(); });
if (preview) { state.devices = [previewDevice]; render(); }
const first = preview ? {ok:false} : await api('/api/customer/me');
if (first.ok) { state.user = first.data; render(); await refresh(); schedule(); } else if (!preview) render();
