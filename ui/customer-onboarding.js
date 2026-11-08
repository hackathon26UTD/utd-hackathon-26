// Customer onboarding: tie a box we built to this account, wait for its first report, manage it afterwards.
// Pure helpers are exported for unit tests. Every string reaches the page through textContent (the injected `h`), never innerHTML.
// Contract: docs/ONBOARDING.md sections 3 and 6. Only /api/customer/* endpoints are called.

export const SERIAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // No I, L, O, 0, 1; derive the modulus from this string.
export const WAITING_HELP_AFTER_MS = 10 * 60 * 1000;

// ---------- serial and code helpers ----------
// Check character: sum of (position 1..7 times alphabet index) mod alphabet length, as the alphabet character.
// The server never rejects on this (older boxes have 8 random characters); it only drives a typo hint here.
export function serialCheckChar(body7) {
  const body = String(body7 ?? '').toUpperCase();
  if (body.length !== 7 || [...body].some(c => !SERIAL_ALPHABET.includes(c))) return null;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += (i + 1) * SERIAL_ALPHABET.indexOf(body[i]);
  return SERIAL_ALPHABET[sum % SERIAL_ALPHABET.length];
}

export function normalizeSerial(raw) {
  let s = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (s.startsWith('HB') && s.length === 10) s = s.slice(2);
  if (s.length !== 8) return '';
  return `HB-${s.slice(0, 4)}-${s.slice(4)}`;
}
// 'ok' | 'mismatch' | 'invalid' (invalid = empty, wrong length, or a character cards never use)
export function serialCheck(raw) {
  const s = normalizeSerial(raw);
  if (!s) return 'invalid';
  const body = s.slice(3).replace(/-/g, '');
  if ([...body].some(c => !SERIAL_ALPHABET.includes(c))) return 'invalid';
  return serialCheckChar(body.slice(0, 7)) === body[7] ? 'ok' : 'mismatch';
}
// Accepts the legacy 6 digits or the 8 character code with or without the dash. Returns '' when it is neither.
export function normalizeCode(raw) {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (/^\d{6}$/.test(s)) return s;
  if (s.length === 8 && [...s].every(c => SERIAL_ALPHABET.includes(c))) return `${s.slice(0, 4)}-${s.slice(4)}`;
  return '';
}
export function serialProblem(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Enter the serial from the card.';
  if (!normalizeSerial(s)) return 'A serial has 8 letters and numbers, like HB-7K3Q-9XMD.';
  if (serialCheck(s) === 'invalid') return 'That serial has a character cards never use (0, 1, I, L or O). Check it against the card.';
  return '';
}
export function codeProblem(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Enter the pairing code from the card.';
  if (normalizeCode(s)) return '';
  if (/[01ILOilo]/.test(s) && !/^\d+$/.test(s)) return 'That code has a character cards never use (0, 1, I, L or O). Check it against the card.';
  return 'The code is 8 letters and numbers like K4M7-XP2R, or 6 digits on older cards.';
}
// Reads a scanned QR string, a pasted link, or a URL fragment. Returns {serial, code} or null. Never navigates anywhere.
export function parseClaimText(text) {
  const raw = String(text ?? '').trim();
  const fragment = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw;
  const m = /^(?:claim=)?(HB-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})\.([A-Za-z0-9]{6}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/i.exec(fragment);
  if (!m) return null;
  const serial = normalizeSerial(m[1]), code = normalizeCode(m[2]);
  return serial && serialCheck(serial) !== 'invalid' && code ? { serial, code } : null;
}
export function readClaimFragment(win = globalThis) {
  const hash = win.location.hash;
  if (!hash.startsWith('#claim=')) return null;
  // Strip even malformed claims before the first authentication request. Never persist the code.
  win.history.replaceState(null, '', win.location.pathname + win.location.search);
  return parseClaimText(hash);
}

// ---------- state and time helpers ----------
export function lastSeenOf(d) { return d?.lastSeenAt || d?.lastSeen || null; }
// Reporting is connectivity only. It never implies that conditions in the home are normal.
export function boxStatus(d) {
  const fleet = d?.fleetStatus;
  if (fleet?.state === 'active') return { kind: 'active', label: 'Reporting', pill: 'reporting' };
  if (fleet?.state === 'inactive') {
    switch (fleet.reason) {
      case 'awaiting_first_report': return { kind: 'awaiting', label: 'Waiting for first report', pill: 'no_recent_signal' };
      case 'silent': return { kind: 'silent', label: 'No recent signal', pill: 'no_recent_signal' };
      case 'disabled': return { kind: 'disabled', label: 'Paused by the team', pill: 'no_recent_signal' };
      default: return { kind: 'other', label: 'Not reporting', pill: 'no_recent_signal' };
    }
  }
  if (!lastSeenOf(d) && !d?.firstReportAt) return { kind: 'awaiting', label: 'Waiting for first report', pill: 'no_recent_signal' };
  return { kind: 'other', label: 'Reporting status unavailable', pill: 'no_recent_signal' };
}
export function agoShort(iso, now = Date.now()) {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}
export const silentWindowText = seconds => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const m = Math.round(seconds / 60);
  return m < 90 ? `${m} minutes` : `${Math.round(m / 60)} hours`;
};
// Waiting box needs the Wi-Fi checklist once it has been waiting 10 minutes.
export function needsWifiHelp(d, linkedAtMs, now = Date.now()) {
  if (boxStatus(d).kind !== 'awaiting') return false;
  const since = d?.linkedAt ? new Date(d.linkedAt).getTime() : linkedAtMs;
  return Number.isFinite(since) && now - since >= WAITING_HELP_AFTER_MS;
}
export function pauseUntil(choice, now = Date.now()) {
  if (choice === 'on') return null;
  if (choice === '24h') return new Date(now + 24 * 3600e3).toISOString();
  if (choice === '7d') return new Date(now + 7 * 24 * 3600e3).toISOString();
  return undefined;
}
export function pauseChoiceOf(iso, now = Date.now()) {
  if (!iso) return 'on';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= now) return 'on';
  return t - now > 2 * 24 * 3600e3 ? '7d' : '24h';
}
// Only supported claim fields. No speculative privacy or email controls.
export function claimBody(f, user) {
  const consent = !!f.consent, address = String(f.address || '').trim();
  const body = { serial: normalizeSerial(f.serial), code: normalizeCode(f.code), consent };
  const nickname = String(f.nickname || '').trim(), room = String(f.room || '').trim(), name = String(f.contactName || user?.contactName || '').trim();
  if (nickname) body.nickname = nickname;
  if (room) body.room = room;
  if (address) body.address = address;
  if (consent && name) body.contactName = name;
  return body;
}

// ---------- camera scanner (BarcodeDetector, optional) ----------
export function scanSupport(g = globalThis) {
  const detector = typeof g.BarcodeDetector === 'function';
  return { detector, camera: detector && !!g.navigator?.mediaDevices?.getUserMedia };
}
async function qrDetector(g = globalThis) {
  try {
    const formats = typeof g.BarcodeDetector.getSupportedFormats === 'function' ? await g.BarcodeDetector.getSupportedFormats() : ['qr_code'];
    return formats.includes('qr_code') ? new g.BarcodeDetector({ formats: ['qr_code'] }) : null;
  } catch { return null; }
}
// Starts the camera in `video`; calls onText(rawValue) once for the first QR found, then stops. Returns {stop}.
export function startCameraScan(video, { onText, onError, g = globalThis }) {
  let stopped = false, stream = null, raf = 0;
  const stop = () => { stopped = true; if (raf) (g.cancelAnimationFrame || clearTimeout)(raf); stream?.getTracks().forEach(t => t.stop()); stream = null; try { video.srcObject = null; } catch { /* detached */ } };
  (async () => {
    const detector = await qrDetector(g);
    if (stopped) return;
    if (!detector) return onError('This browser cannot read QR codes. Type the serial and code instead.');
    try { stream = await g.navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
    catch { if (stopped) return; return onError('The camera is not available or was blocked. Type the serial and code instead.'); }
    if (stopped) return stop();
    video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
    try { await video.play(); } catch { /* autoplay can be refused; frames still arrive once visible */ }
    const loop = async () => {
      if (stopped) return;
      try { const hits = await detector.detect(video); const hit = hits.find(x => x.rawValue); if (hit) { stop(); return onText(hit.rawValue); } } catch { /* a frame can fail; try the next */ }
      if (stopped) return;
      raf = (g.requestAnimationFrame || (fn => setTimeout(fn, 200)))(loop);
    };
    loop();
  })();
  return { stop };
}
export async function scanImageFile(file, g = globalThis) {
  const detector = await qrDetector(g);
  if (!detector) return null;
  let bitmap;
  try { bitmap = await g.createImageBitmap(file); const hits = await detector.detect(bitmap); return hits.find(x => x.rawValue)?.rawValue || null; } catch { return null; } finally { bitmap?.close?.(); }
}

// ---------- copy ----------
export const COPY = {
  consentContact: 'The response team may contact me about this box. This shares my name and email with them.',
  wifi: [
    'Your installer sets up Wi-Fi for now. A box cannot join a new network from this page yet.',
    'Keep the box powered and close to your router, then wait a few minutes. This page checks every 10 seconds.',
    'If you move or change your router, the team has to update the box. Tell us before you move it.',
  ],
  reset: 'There is no reset button yet. To wipe a box and start over, ask the team to reflash it. Unlinking here does not erase the box.',
  unlink: 'This removes the box from your account and deletes the contact name and box name you gave. Past readings stay with the box for the team and stop showing here. To link it again you need a new pairing code.',
};

// ---------- views ----------
export function onboardingUI({ h, api, state, refresh, renderDevices, say, msgEl, field, submit, win = globalThis }) {
  state.add ||= { step: state.prefill ? 'confirm' : 'find', serial: state.prefill?.serial || '', code: state.prefill?.code || '', hinted: '', scan: false };
  state.claimedAt ||= {}; state.serials ||= {}; state.reporting ||= null;
  const manageNodes = new Map();
  let scanner = null;
  const support = scanSupport(win);

  const stopScan = () => { scanner?.stop(); scanner = null; state.add.scan = false; };
  const slot = () => win.document?.getElementById('add-box');
  function redraw() { const el = slot(); if (el) { el.replaceChildren(...addBody()); el.querySelector('input:not([type=checkbox]),button')?.focus(); } }
  const checkbox = (name, text, extra = {}) => h('label', { class: 'check', for: 'f-' + name }, h('input', { type: 'checkbox', id: 'f-' + name, name, ...extra }), h('span', null, text));

  // Fills the form from a scanned or pasted value and moves on to the confirm step.
  function accept(text) {
    const hit = parseClaimText(text);
    stopScan();
    if (!hit) { state.add.scanError = 'That QR code is not a Safe Home pairing card. Type the serial and code instead.'; return redraw(); }
    Object.assign(state.add, { serial: hit.serial, code: hit.code, hinted: '', scanError: '', step: 'confirm' });
    redraw();
  }
  function scanPanel() {
    const video = h('video', { class: 'scan-video', 'aria-label': 'Camera view for scanning the QR code', muted: true, playsinline: true });
    scanner = startCameraScan(video, { onText: accept, onError: msg => { stopScan(); state.add.scanError = msg; redraw(); }, g: win });
    return h('div', { class: 'scan-box' }, video, h('p', { class: 'fine' }, 'Hold the QR code on your pairing card inside the frame. Nothing is recorded.'), h('button', { type: 'button', onclick: () => { stopScan(); redraw(); } }, 'Stop scanning'));
  }

  function findStep() {
    const a = state.add;
    const photo = h('input', { type: 'file', accept: 'image/*', class: 'scan-file', 'aria-label': 'Choose a photo of the QR code', onchange: async e => { const f = e.target.files?.[0]; if (!f) return; const text = await scanImageFile(f, win); if (text) accept(text); else { a.scanError = 'No QR code found in that photo. Type the serial and code instead.'; redraw(); } } });
    const form = h('form', { novalidate: true, onsubmit: e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const sp = serialProblem(f.serial), cp = codeProblem(f.code);
      if (sp || cp) return say('find', sp || cp);
      const serial = normalizeSerial(f.serial);
      if (serialCheck(serial) === 'mismatch' && a.hinted !== serial) { a.hinted = serial; return say('find', 'Check the last character of the serial. It may have a typo. If it matches the card, press Continue again.', 'ok'); }
      Object.assign(a, { serial, code: normalizeCode(f.code), step: 'confirm', scanError: '' }); say('find', ''); redraw();
    } },
    field('Serial', 'serial', { mono: true, hint: 'Printed on the case and on the card, like HB-7K3Q-9XMD', value: a.serial, max: 16, auto: 'off' }),
    field('Pairing code', 'code', { mono: true, hint: 'On the card inside the box. 8 characters like K4M7-XP2R, or 6 digits on older cards', value: a.code, max: 12, auto: 'off' }),
    h('button', { class: 'primary', type: 'submit' }, 'Continue'), msgEl('find'));
    return [
      h('p', { class: 'muted' }, 'Scan the QR code on the pairing card, or type the serial and code to add your box.'),
      (support.camera || support.detector) ? h('div', { class: 'row scan-actions' },
        support.camera && h('button', { type: 'button', onclick: () => { a.scan = true; a.scanError = ''; redraw(); } }, 'Scan the QR code'),
        support.detector && h('label', { class: 'scan-photo' }, 'Or scan a photo', photo)) : h('p', { class: 'fine' }, 'This browser cannot scan QR codes, so type the serial and code.'),
      a.scan && scanPanel(),
      a.scanError && h('p', { class: 'msg err', role: 'alert' }, a.scanError),
      form,
      h('p', { class: 'fine' }, 'The serial and code are sent only when you choose Link my box.'),
    ];
  }

  function confirmStep() {
    const a = state.add;
    const contactName = field('Your name', 'contactName', { auto: 'name', value: state.user?.contactName, hint: 'Shared if you allow contact below', max: 60, optional: true });
    const nameWrap = h('div', { class: 'consent-name', hidden: true }, contactName);
    const contact = checkbox('consent', COPY.consentContact, { onchange: e => { nameWrap.hidden = !e.target.checked; contactName.querySelector('input').required = e.target.checked; } });
    const addrInput = field('Address (optional)', 'address', { auto: 'street-address', optional: true, max: 300, hint: 'Street, city, state and ZIP. It is sent to the U.S. Census address service to place your box on the map.' });
    const form = h('form', { onsubmit: e => { e.preventDefault(); submit(e.target, 'confirm', async f => {
      const r = await api('/api/customer/claim', 'POST', claimBody({ ...f, serial: a.serial, code: a.code, consent: !!f.consent }, state.user));
      if (!r.ok) return say('confirm', r.data.error || 'Something went wrong. Try again.');
      const id = r.data.id; if (id) { state.claimedAt[id] = Date.now(); state.serials[id] = a.serial; }
      state.prefill = null;
      if (id && f.room?.trim()) {
        const roomSave = await api('/api/customer/devices/' + encodeURIComponent(id), 'PATCH', { room: f.room.trim() });
        if (!roomSave.ok) say('linked', 'Your box is linked, but the room could not be saved. Open Manage this box to try again.');
      }
      Object.assign(a, { step: 'done', code: '', linkId: id, hinted: '' });
      say('confirm', ''); redraw(); await refresh();
    }); } },
    h('div', { class: 'row picked' }, h('div', null, h('strong', null, 'Box ', a.serial), h('p', { class: 'fine' }, 'We will check the code when you choose Link my box.')), h('button', { type: 'button', class: 'link', onclick: () => { a.step = 'find'; a.code = ''; redraw(); } }, 'Change')),
    field('Box name (optional)', 'nickname', { optional: true, hint: 'Like Garage or Back door', max: 40 }),
    field('Room (optional)', 'room', { optional: true, hint: 'Like Kitchen', max: 40 }),
    addrInput,
    h('fieldset', { class: 'consents' }, h('legend', null, 'Contact permission (optional)'), contact, nameWrap),
    h('button', { class: 'primary', type: 'submit' }, 'Link my box'), msgEl('confirm'));
    return [h('p', { class: 'muted' }, 'Last step. Name the box if you like, then choose what the response team may see. Your address is optional.'), form];
  }

  function doneStep() {
    return [msgEl('linked'), h('p', { class: 'banner', role: 'status' }, 'Box linked. Look for it in your list above. It shows as waiting until it reports for the first time.'), h('button', { type: 'button', onclick: () => { Object.assign(state.add, { step: 'find', serial: '', code: '' }); redraw(); } }, 'Add another box')];
  }
  function addBody() {
    const a = state.add;
    return a.step === 'confirm' && a.serial && a.code ? confirmStep() : a.step === 'done' ? doneStep() : findStep();
  }
  function addView() {
    const open = !!state.prefill || state.devices?.length === 0 || state.add.step !== 'find';
    const box = h('section', { id: 'add-box', class: 'add-box' }, ...addBody());
    return h('details', { class: 'card', open, ontoggle: e => { if (!e.target.open) stopScan(); } }, h('summary', null, 'Add my box'), box);
  }

  // ---------- per-box ----------
  function waitingView(d) {
    const st = boxStatus(d), seen = lastSeenOf(d), serial = d.serial || state.serials[d.id];
    if (st.kind === 'other') return h('p', { class: 'fine' }, 'We cannot confirm whether this box is reporting. Missing information does not mean your home is safe.');
    if (st.kind === 'disabled') return h('div', { class: 'wait' }, h('p', null, 'The team has paused this box. It will not report until they turn it back on.'), h('p', { class: 'fine' }, 'Contact the team if you did not expect this.'));
    if (st.kind === 'awaiting') {
      const help = needsWifiHelp(d, state.claimedAt[d.id]);
      return h('div', { class: 'wait', role: 'status' },
        h('p', { class: 'wait-title' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Waiting for your box to report'),
        h('p', { class: 'fine' }, 'We have not heard from it yet. A report cannot tell you whether your home is safe. Checked every 10 seconds while this page is open.'),
        help && h('div', { class: 'wifi-help' }, h('strong', null, 'Still nothing after 10 minutes'), h('ul', { class: 'plain' }, COPY.wifi.map(t => h('li', null, t))), serial && h('p', { class: 'fine' }, 'If you contact the team, give them this serial: ', h('code', null, serial), '. Never share the pairing code.')));
    }
    if (st.kind === 'silent') {
      const win_ = silentWindowText(d.silentAfterSeconds);
      return h('div', { class: 'wait', role: 'status' }, h('p', null, 'We have not heard from this box recently. Last heard: ', h('span', { 'data-ago': seen || '' }, agoShort(seen)), '.'),
        h('p', { class: 'fine' }, (win_ ? `A box counts as quiet after about ${win_} without a report. ` : '') + 'Check that it has power and Wi-Fi. This does not tell you anything about your home.'));
    }
    return null;
  }
  const reportingBanner = d => (state.reporting?.has(d.id) && boxStatus(d).kind === 'active' ? h('p', { class: 'banner', role: 'status' }, 'Your box is reporting. ', h('button', { type: 'button', class: 'link', onclick: () => { state.reporting.delete(d.id); renderDevices(); } }, 'Dismiss')) : null);
  const lastHeard = d => { const s = boxStatus(d); return s.kind === 'awaiting' ? null : h('p', { class: 'fine' }, 'Heard from your box: ', h('span', { 'data-ago': lastSeenOf(d) || '' }, agoShort(lastSeenOf(d)))); };

  function manageView(d) {
    let m = manageNodes.get(d.id);
    if (m) { m.update(d); return m.node; }
    let current = d, busy = false;
    const path = '/api/customer/devices/' + encodeURIComponent(d.id);
    const note = msgEl('manage-' + d.id);
    const nameField = field('Box name', 'nickname-' + d.id, { value: d.nickname, max: 40 });
    const roomField = field('Room (optional)', 'room-' + d.id, { value: d.room || '', max: 40, optional: true });
    const nameInput = nameField.querySelector('input'), roomInput = roomField.querySelector('input');
    nameInput.name = 'nickname'; roomInput.name = 'room';
    const send = async (patch, okText) => {
      if (busy) return;
      busy = true; setBusy(true); say('manage-' + d.id, 'Saving...', 'ok');
      try {
        const r = await api(path, 'PATCH', patch);
        if (!r.ok) { say('manage-' + d.id, r.data.error || 'Could not save. Try again.'); return; }
        current = { ...current, ...patch };
        say('manage-' + d.id, okText, 'ok'); await refresh();
      } finally { busy = false; update(current); setBusy(false); }
    };
    const nameForm = h('form', { onsubmit: e => {
      e.preventDefault();
      if (!nameInput.value.trim()) return say('manage-' + d.id, 'Enter a box name.');
      send({ nickname: nameInput.value.trim(), room: roomInput.value.trim() }, 'Box details saved.');
    } }, nameField, roomField, h('button', { class: 'primary', type: 'submit' }, 'Save'));
    const pauseActions = h('div', { class: 'row pause-actions' },
      [['24h', 'Pause for 24 hours'], ['7d', 'Pause for 7 days'], ['on', 'Resume alerts']].map(([choice, label]) =>
        h('button', { type: 'button', onclick: () => send({ notificationsPausedUntil: pauseUntil(choice) }, choice === 'on' ? 'Pause removed. Email delivery is still off during testing.' : 'Email alerts paused. Reports still appear here.') }, label)));
    const pauseNote = h('p', { class: 'fine' });
    const contactNote = h('p', { class: 'fine' });
    const confirmBox = h('div', { class: 'confirm-box', hidden: true });
    const leave = async () => {
      if (busy) return;
      busy = true; setBusy(true);
      try {
        const r = await api(path, 'DELETE');
        if (r.ok || r.status === 404) {
          state.devices = (state.devices || []).filter(x => x.id !== d.id);
          manageNodes.delete(d.id); state.reporting?.delete(d.id); state.kinds?.delete(d.id);
          renderDevices(); await refresh();
          win.document?.querySelector('#add-box')?.closest('details')?.querySelector('summary')?.focus();
        } else say('manage-' + d.id, r.data.error || 'Could not remove the box. Try again.');
      } finally { busy = false; setBusy(false); }
    };
    const remove = h('button', { type: 'button', class: 'danger', onclick: () => {
      confirmBox.hidden = false;
      confirmBox.replaceChildren(h('p', null, COPY.unlink), h('div', { class: 'row' },
        h('button', { type: 'button', class: 'danger', onclick: leave }, 'Yes, unlink and remove'),
        h('button', { type: 'button', onclick: () => { confirmBox.hidden = true; remove.focus(); } }, 'Keep this box')));
      confirmBox.querySelector('button')?.focus();
    } }, 'Unlink and remove this box');
    const node = h('details', { class: 'manage' }, h('summary', null, 'Manage this box'),
      h('div', { class: 'settings-stack' }, nameForm,
        h('fieldset', { class: 'consents' }, h('legend', null, 'Email alerts'), h('p', { class: 'fine' }, 'Pausing affects emails only. Reports and team updates remain here. Email delivery is off during testing.'), pauseActions, pauseNote),
        contactNote, note, remove, confirmBox,
        h('details', { class: 'reset' }, h('summary', null, 'Wi-Fi and reset help'), h('p', { class: 'fine' }, COPY.wifi[0]), h('p', { class: 'fine' }, COPY.reset))));
    function setBusy(value) {
      node.querySelectorAll('input,select,button').forEach(el => { el.disabled = value; });
      node.setAttribute('aria-busy', String(value));
    }
    function update(fresh) {
      if (!busy) {
        // Keep unsaved edits during the ten-second refresh.
        if (nameInput.value === (current.nickname || '')) nameInput.value = fresh.nickname || '';
        if (roomInput.value === (current.room || '')) roomInput.value = fresh.room || '';
        current = fresh;
      }
      pauseNote.textContent = pauseChoiceOf(current.notificationsPausedUntil) === 'on' ? 'No pause is set.' : 'Paused until ' + new Date(current.notificationsPausedUntil).toLocaleString() + '.';
      contactNote.textContent = current.consent ? 'You allowed the response team to contact you about this box.' : 'You have not allowed the response team to contact you about this box.';
    }
    m = { node, update }; manageNodes.set(d.id, m); update(d);
    return node;
  }
  function pruneManage(devices) { const live = new Set(devices.map(x => x.id)); for (const id of manageNodes.keys()) if (!live.has(id)) manageNodes.delete(id); }

  // Notes devices that moved from waiting to reporting, so the page can say so once.
  function trackReporting(devices) {
    state.reporting ||= new Set(); state.kinds ||= new Map();
    for (const d of devices) {
      if (!state.claimedAt[d.id]) state.claimedAt[d.id] = Date.now();
      const kind = boxStatus(d).kind, prev = state.kinds.get(d.id);
      if (prev === 'awaiting' && kind === 'active') state.reporting.add(d.id);
      state.kinds.set(d.id, kind);
    }
    pruneManage(devices);
  }
  function tick() {
    win.document?.querySelectorAll?.('[data-ago]').forEach(el => { if (el.dataset.ago) el.textContent = agoShort(el.dataset.ago); });
  }
  function reset() { stopScan(); manageNodes.clear(); state.add = { step: 'find', serial: '', code: '', hinted: '' }; state.prefill = null; state.claimedAt = {}; state.serials = {}; state.reporting = new Set(); state.kinds = new Map(); }
  return { reset, addView, manageView, waitingView, reportingBanner, lastHeard, trackReporting, tick, stopScan };
}
