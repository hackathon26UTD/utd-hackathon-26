// Workflow view for one device: the checkpoints a report travels through, drawn as a node and edge canvas,
// with the history of events playable underneath. DOM nodes plus one SVG layer for edges. No graph library.
// Unknown stays unknown: the local record and relay nodes are drawn dashed and never green.
import { NODE_DEFS, NODE_IDS, NODE_STATUS_TEXT, NODE_STATUS_GLYPH, SOURCE_TEXT, normalizeTimeline, stateAtCursor } from './conditions.js';
import { ageText } from './core.js';
import { timeText, dateTimeText } from './dom.js';

export const NODE_W = 232, NODE_H = 118, GAP_X = 68, GAP_Y = 76, PAD = 44;
export const MIN_SCALE = 0.4, MAX_SCALE = 2.5;
const DEF = Object.fromEntries(NODE_DEFS.map(d => [d.id, d]));

// Two or four boxes per row, snaking so each hand-off is a short edge. Row direction flips every row.
export function layoutNodes(ids = NODE_IDS, perRow = 4) {
  const pos = {};
  ids.forEach((id, i) => {
    const row = Math.floor(i / perRow), at = i % perRow, dir = row % 2 === 0 ? 1 : -1;
    const col = dir === 1 ? at : perRow - 1 - at;
    pos[id] = { id, row, col, dir, x: PAD + col * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) };
  });
  const rows = Math.ceil(ids.length / perRow);
  return { pos, perRow, width: PAD * 2 + perRow * NODE_W + (perRow - 1) * GAP_X, height: PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y + 28 };
}

const port = (p, side) => ({ x: side === 'r' ? p.x + NODE_W : p.x, y: p.y + NODE_H / 2, side });

// A curved edge between two nodes. Flow edges leave the output side and enter the input side;
// the human-only edge leaves the bottom of one node and enters the bottom (same row) or top of the other.
export function edgeGeometry(a, b, kind = 'flow') {
  if (kind === 'human_only') {
    const sameRow = a.row === b.row;
    const p0 = { x: a.x + NODE_W / 2, y: a.y + NODE_H }, p1 = sameRow ? { x: b.x + NODE_W / 2, y: b.y + NODE_H } : { x: b.x + NODE_W / 2, y: b.y };
    const lift = sameRow ? 58 : (p1.y - p0.y) / 2;
    const c0 = { x: p0.x, y: p0.y + lift }, c1 = { x: p1.x, y: sameRow ? p1.y + lift : p1.y - lift };
    return finish(p0, c0, c1, p1);
  }
  const p0 = port(a, a.dir === 1 ? 'r' : 'l'), p1 = port(b, b.dir === 1 ? 'l' : 'r');
  const dx = Math.abs(p1.x - p0.x), same = a.row === b.row;
  const k = same ? Math.max(30, dx / 2) : 78;
  const d0 = p0.side === 'r' ? 1 : -1, d1 = p1.side === 'r' ? 1 : -1;
  return finish(p0, { x: p0.x + d0 * k, y: p0.y }, { x: p1.x + d1 * k, y: p1.y }, p1);
}
function finish(p0, c0, c1, p1) {
  const mid = { x: (p0.x + 3 * c0.x + 3 * c1.x + p1.x) / 8, y: (p0.y + 3 * c0.y + 3 * c1.y + p1.y) / 8 };
  return { d: `M${p0.x} ${p0.y} C${c0.x} ${c0.y} ${c1.x} ${c1.y} ${p1.x} ${p1.y}`, p0, p1, mid };
}

export function fitTransform(vw, vh, world, { max = 1.1 } = {}) {
  const s = Math.max(MIN_SCALE, Math.min(max, vw / world.width, vh / world.height));
  return { s, x: (vw - world.width * s) / 2, y: Math.max(0, (vh - world.height * s) / 2) };
}
export const clampScale = s => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

const LEVEL_TEXT = { info: 'Info', warn: 'Attention', critical: 'Critical' };

export function mountWorkflow({ root, ctx }) {
  const esc = ctx.esc;
  const K = window.Kit;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const M = { raw: null, tl: null, nodes: [], events: [], cursor: 0, selected: null, playing: false, speed: 1, timer: null, view: { s: 1, x: 0, y: 0 }, perRow: 4, userMoved: false, state: 'loading', message: '', onRetry: null, banner: '' };

  root.classList.add('wf');
  root.innerHTML = `<div class="wf-banner" role="note" hidden></div>
<div class="wf-state" role="status" hidden></div>
<div class="wf-body">
<div class="wf-canvas-wrap">
<p class="wf-pan-tip">Drag to explore checkpoints. Use Fit to see the whole path.</p>
<div class="wf-viewport" tabindex="0" role="application" aria-roledescription="workflow canvas" aria-label="Checkpoints for this device. Arrow keys move the view. Plus and minus zoom. Zero fits the view. Tab to a checkpoint to read it.">
<div class="wf-world"><svg class="wf-edges" aria-hidden="true"></svg><div class="wf-nodes"></div><svg class="wf-ports" aria-hidden="true"></svg></div>
</div>
<div class="wf-tools" role="group" aria-label="Canvas zoom"><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="fit" aria-label="Fit all checkpoints in view">Fit</button></div>
<div class="wf-legend" aria-hidden="true"><span><i class="wf-key wf-k-ok"></i>Normal</span><span><i class="wf-key wf-k-warn"></i>Needs attention</span><span><i class="wf-key wf-k-critical"></i>Critical</span><span><i class="wf-key wf-k-unknown"></i>Unknown or not reported (dashed)</span></div>
</div>
<div class="wf-play" role="group" aria-label="History playback"><div class="wf-play-row"><button type="button" data-p="live">Back to now</button><button type="button" data-p="back" aria-label="Step back one event">Back</button><button type="button" data-p="play" aria-label="Play history">Play</button><button type="button" data-p="fwd" aria-label="Step forward one event">Next</button><div class="wf-speed"></div></div><div class="wf-scrub"></div><p class="wf-now" aria-hidden="true"></p><p class="sr-only" role="status" aria-live="polite" id="wf-live"></p></div>
<div class="wf-lower"><section class="wf-node-panel" aria-label="Selected checkpoint"></section><section class="wf-log" aria-label="Event history"></section></div>
</div>`;
  const q = s => root.querySelector(s);
  const viewport = q('.wf-viewport'), world = q('.wf-world'), nodesEl = q('.wf-nodes'), edgesEl = q('.wf-edges'), portsEl = q('.wf-ports');
  const stateEl = q('.wf-state'), bannerEl = q('.wf-banner'), playRow = q('.wf-play'), nowEl = q('.wf-now'), liveEl = q('#wf-live');
  const speedBox = q('.wf-speed'), scrubBox = q('.wf-scrub');

  const speedSegs = K.segs({ label: 'Playback speed', value: '1', options: [{ id: '1', label: '1x' }, { id: '4', label: '4x' }], onChange: v => { M.speed = Number(v); if (M.playing) { stop(); play(); } } });
  speedBox.append(speedSegs);
  const slider = K.slider({ label: 'History position', max: 0, value: 0, step: 1, bigStep: 5, format: v => String(Math.round(v)), onInput: v => { stop(); setCursor(Math.round(v), { announce: true }); } });
  scrubBox.append(slider.el || slider);

  const layout = () => layoutNodes(NODE_IDS, M.perRow);
  const apply = () => { world.style.transform = `translate(${M.view.x}px, ${M.view.y}px) scale(${M.view.s})`; };
  const size = () => ({ w: viewport.clientWidth || 600, h: viewport.clientHeight || 340 });
  function fitAll() { const { w, h } = size(); M.view = fitTransform(w, h, layout()); M.userMoved = true; apply(); }
  function fit() {
    const { w, h } = size();
    // On phones, an all-nodes fit shrinks labels below readable size. Start at the first checkpoint.
    M.view = w < 640 ? { s: 0.82, x: 8, y: 8 } : fitTransform(w, h, layout());
    M.userMoved = false; apply();
  }
  function zoomAt(f, cx, cy) {
    const s = clampScale(M.view.s * f), k = s / M.view.s;
    M.view = { s, x: cx - (cx - M.view.x) * k, y: cy - (cy - M.view.y) * k }; M.userMoved = true; apply();
  }
  const center = () => { const { w, h } = size(); return [w / 2, h / 2]; };

  // ---- model ----
  const stateNow = () => stateAtCursor(M.nodes, M.events, M.cursor);
  const isLive = () => M.cursor >= M.events.length;

  function update(raw) {
    const tl = normalizeTimeline(raw);
    if (!tl) return;
    const wasLive = !M.tl || isLive();
    M.raw = raw; M.tl = tl; M.nodes = tl.nodes; M.events = tl.events;
    M.cursor = wasLive ? M.events.length : Math.min(M.cursor, M.events.length);
    if (M.selected && !NODE_IDS.includes(M.selected)) M.selected = null;
    M.state = 'ready';
    const notes = [];
    if (tl.derived) notes.push(tl.mode === 'exercise' ? 'Exercise history. Events are simulated from the fictional scenario and are not a live record.' : 'The timeline service did not answer, so this view is built from the device summary in your browser. Receipt and ingest detail is missing.');
    else if (tl.mode === 'exercise') notes.push('Exercise data. Nothing here is a real event.');
    if (tl.coverage?.truncated) notes.push(`Showing the most recent ${M.events.length} events.`);
    M.banner = notes.join(' ');
    paint(); if (!M.userMoved) requestAnimationFrame(fit);
  }
  function setState(state, { message = '', onRetry = null } = {}) { M.state = state; M.message = message; M.onRetry = onRetry; if (state !== 'ready') paint(); else paint(); }

  function setCursor(k, { announce = false } = {}) {
    M.cursor = Math.max(0, Math.min(M.events.length, k));
    paint({ keepFocus: true });
    if (announce) say();
  }
  function say() {
    const n = M.events.length;
    if (!n) { liveEl.textContent = 'No events in this history.'; return; }
    if (M.cursor === 0) { liveEl.textContent = `Start of history. ${n} events.`; return; }
    const e = M.events[M.cursor - 1];
    liveEl.textContent = `Event ${M.cursor} of ${n}: ${(NODE_DEFS.find(d => d.id === e.nodeId) || {}).label || ''}. ${e.text}`;
  }

  function play() {
    if (!M.events.length) return;
    if (isLive()) M.cursor = 0;
    M.playing = true;
    const tick = () => {
      if (M.cursor >= M.events.length) { stop(); say(); return; }
      setCursor(M.cursor + 1, { announce: true });
      if (M.cursor >= M.events.length) stop();
    };
    tick();
    if (M.playing) M.timer = setInterval(tick, M.speed === 4 ? 350 : 1400);
    paint({ keepFocus: true });
  }
  function stop() { M.playing = false; clearInterval(M.timer); M.timer = null; paint({ keepFocus: true }); }

  // ---- drawing ----
  const evCount = id => M.events.filter(e => e.nodeId === id).length;

  function nodeHtml(n, st, i) {
    const p = layout().pos[n.id], live = st.live, def = DEF[n.id];
    const dashed = n.source === 'not_recorded' || n.status === 'not_reported' || (live ? n.status : st.status) === 'unknown';
    const status = live ? n.status : st.status;
    const ev = st.events, evid = (n.evidence || []).length;
    const last = st.lastAt ? `${timeText(st.lastAt)} · ${ageText(st.lastAt)}` : n.status === 'not_reported' ? 'Not reported to the cloud' : 'No timestamp';
    const label = `${i + 1}. ${n.label}. ${NODE_STATUS_TEXT[status]}${live ? '' : ' at this point'}. ${st.lastAt ? 'Last update ' + ageText(st.lastAt) : 'No update recorded'}. ${ev} event${ev === 1 ? '' : 's'}.`;
    const active = !live && M.events[M.cursor - 1]?.nodeId === n.id;
    return `<div class="wf-node wf-s-${esc(status)}${dashed ? ' is-dashed' : ''}${M.selected === n.id ? ' is-selected' : ''}${active ? ' is-active' : ''}" role="button" tabindex="0" aria-pressed="${M.selected === n.id}" aria-label="${esc(label)}" data-id="${esc(n.id)}" style="left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px">
<div class="wf-n-head"><span class="wf-n-num" aria-hidden="true">${i + 1}</span><span class="wf-n-title">${esc(n.label)}</span><span class="wf-n-src">${esc(SOURCE_TEXT[n.source] || 'Derived')}</span></div>
<div class="wf-n-status"><span class="wf-glyph" aria-hidden="true">${esc(NODE_STATUS_GLYPH[status] || '?')}</span><b>${esc(NODE_STATUS_TEXT[status] || 'Unknown')}</b>${live ? '' : '<small>at this point</small>'}</div>
<div class="wf-n-meta">${esc(last)}</div>
<div class="wf-n-counts"><span>${ev} event${ev === 1 ? '' : 's'}</span><span>${evid} evidence</span></div></div>`;
  }

  function edgesSvg() {
    const L = layout(), { w } = { w: L.width };
    const sts = Object.fromEntries(stateNow().map(s => [s.id, s]));
    let defsOut = '<defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="wf-arrow"/></marker></defs>';
    let out = '', labels = '';
    const activeNode = !isLive() && M.events[M.cursor - 1]?.nodeId;
    for (const e of M.tl?.edges || []) {
      const a = L.pos[e.from], b = L.pos[e.to]; if (!a || !b) continue;
      const g = edgeGeometry(a, b, e.kind);
      const human = e.kind === 'human_only';
      const from = M.nodes.find(n => n.id === e.from);
      const hot = activeNode === e.from;
      out += `<path class="wf-edge${human ? ' is-human' : ''}${hot ? ' is-hot' : ''}${(sts[e.to]?.status === 'unknown' || sts[e.to]?.status === 'not_reported') ? ' is-faint' : ''}" d="${g.d}" ${human ? '' : 'marker-end="url(#wf-arrow)"'}/>`;
      if (human) labels += `<g class="wf-edge-label" transform="translate(${g.mid.x} ${g.mid.y})"><rect x="-42" y="-11" width="84" height="22" rx="11"/><text text-anchor="middle" dy="4">human only</text></g>`;
      else if (from) {
        const c = evCount(e.from);
        if (c && L.pos[e.from].row === L.pos[e.to].row) labels += `<g class="wf-edge-label is-count" transform="translate(${g.mid.x} ${g.mid.y - 14})"><text text-anchor="middle">${c}</text></g>`;
      }
    }
    edgesEl.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`); edgesEl.setAttribute('width', L.width); edgesEl.setAttribute('height', L.height);
    edgesEl.innerHTML = defsOut + out + labels;
    // Status ports sit on top of the node borders so the colour and shape read as connectors.
    let ports = '';
    for (const n of M.nodes) {
      const p = L.pos[n.id], st = sts[n.id]; const status = st.live ? n.status : st.status;
      const inP = port(p, p.dir === 1 ? 'l' : 'r'), outP = port(p, p.dir === 1 ? 'r' : 'l');
      const first = n.id === NODE_IDS[0], lastN = n.id === NODE_IDS[NODE_IDS.length - 1];
      if (!first) ports += `<circle class="wf-port wf-s-${esc(status)}" cx="${inP.x}" cy="${inP.y}" r="6"/>`;
      if (!lastN) ports += `<circle class="wf-port wf-s-${esc(status)}" cx="${outP.x}" cy="${outP.y}" r="6"/>`;
    }
    portsEl.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`); portsEl.setAttribute('width', L.width); portsEl.setAttribute('height', L.height);
    portsEl.innerHTML = ports;
    world.style.width = L.width + 'px'; world.style.height = L.height + 'px';
    return w;
  }

  function panelHtml() {
    const id = M.selected;
    if (!id) return `<h3>Checkpoints</h3><p class="wf-hint">Select a checkpoint to see what it records, when it last updated and the evidence behind it. Selecting one also filters the event history.</p><ul class="wf-plain">${NODE_DEFS.map((d, i) => `<li><b>${i + 1}. ${esc(d.label)}</b> ${esc(d.what)}</li>`).join('')}</ul>`;
    const n = M.nodes.find(x => x.id === id), def = DEF[id], st = stateNow().find(x => x.id === id);
    if (!n) return '';
    const live = st.live;
    const ev = (n.evidence || []);
    return `<div class="wf-np-head"><h3>${esc(n.label)}</h3><span class="wf-pill wf-s-${esc(n.status)}"><span aria-hidden="true">${esc(NODE_STATUS_GLYPH[n.status])}</span> ${esc(NODE_STATUS_TEXT[n.status])}</span></div>
<p>${esc(def.what)}</p>
<dl class="wf-facts"><div><dt>Now</dt><dd>${esc(NODE_STATUS_TEXT[n.status])}${n.note ? '. ' + esc(n.note) : ''}</dd></div>${live ? '' : `<div><dt>At this point</dt><dd>${esc(NODE_STATUS_TEXT[st.status])}, ${st.events} event${st.events === 1 ? '' : 's'} so far</dd></div>`}<div><dt>Last update</dt><dd>${n.lastAt ? esc(dateTimeText(n.lastAt)) + ' (' + esc(ageText(n.lastAt)) + ')' : 'None recorded'}</dd></div><div><dt>Source</dt><dd>${esc(SOURCE_TEXT[n.source] || 'Derived')}</dd></div><div><dt>Counts</dt><dd>${esc(evCount(id))} events${n.counts?.delayed ? ', ' + esc(n.counts.delayed) + ' delayed' : ''}</dd></div></dl>
<h4>Evidence</h4>${ev.length ? `<ul class="wf-evidence">${ev.map(e => `<li><code>${esc(e.id)}</code> <small>${esc(e.kind || '')}${e.at ? ' · ' + esc(timeText(e.at)) : ''}</small></li>`).join('')}</ul>` : '<p class="wf-hint">No evidence records for this checkpoint.</p>'}
<h4>What this cannot tell you</h4><p class="wf-hint">${esc(def.limit)}</p>
<button type="button" data-clear>Show every checkpoint</button>`;
  }

  function logHtml() {
    const sel = M.selected;
    const upto = M.events.slice(0, M.cursor);
    const rows = upto.map((e, i) => ({ e, i })).filter(r => !sel || r.e.nodeId === sel).reverse();
    const hidden = M.events.length - M.cursor;
    const head = `<div class="wf-log-head"><h3>Event history</h3>${sel ? `<span class="wf-chip">Filtered: ${esc(DEF[sel].label)}</span><button type="button" data-clear>Show all</button>` : ''}</div>`;
    if (!M.events.length) return head + '<p class="wf-hint">No events in this time window. An empty history is not a sign that nothing happened. It means nothing was recorded.</p>';
    return head + (hidden > 0 ? `<p class="wf-hint">${hidden} later event${hidden === 1 ? ' is' : 's are'} hidden while you look back. Use Back to now to see them.</p>` : '')
      + (rows.length ? `<ol class="wf-events" reversed>${rows.slice(0, 80).map(({ e, i }) => `<li class="wf-ev wf-l-${esc(e.level)}${i === M.cursor - 1 ? ' is-current' : ''}"><button type="button" data-go="${i + 1}" aria-label="Go to event ${i + 1}: ${esc(e.text)}"><time datetime="${esc(e.at)}">${esc(timeText(e.at))}</time><span class="wf-ev-node">${esc(DEF[e.nodeId].label)}</span><span class="wf-ev-text">${esc(e.text)}</span>${e.level !== 'info' ? `<span class="wf-chip wf-l-${esc(e.level)}">${esc(LEVEL_TEXT[e.level] || e.level)}</span>` : ''}${e.simulated ? '<span class="wf-chip">Exercise</span>' : ''}</button></li>`).join('')}</ol>` : '<p class="wf-hint">No events at this checkpoint up to this point.</p>');
  }

  function paint({ keepFocus = false } = {}) {
    const active = keepFocus ? document.activeElement : null;
    const nodeFocus = active && root.contains(active) ? active.closest('.wf-node')?.dataset.id : null;
    bannerEl.hidden = !M.banner; bannerEl.textContent = M.banner;
    const loading = M.state === 'loading', err = M.state === 'error';
    stateEl.hidden = M.state === 'ready';
    stateEl.className = 'wf-state' + (err ? ' is-error' : '');
    stateEl.replaceChildren();
    if (!stateEl.hidden) {
      const p = document.createElement('p'); p.textContent = loading ? (M.message || 'Loading the checkpoints and history.') : (M.message || 'The workflow could not load.'); stateEl.append(p);
      if (err && M.onRetry) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Try again'; b.addEventListener('click', M.onRetry); stateEl.append(b); }
    }
    q('.wf-body').classList.toggle('is-loading', M.state !== 'ready' && !M.tl);
    if (!M.tl) return;
    edgesSvg();
    const sts = stateNow();
    nodesEl.innerHTML = M.nodes.map((n, i) => nodeHtml(n, sts[i], i)).join('');
    q('.wf-node-panel').innerHTML = panelHtml();
    q('.wf-log').innerHTML = logHtml();
    const n = M.events.length;
    slider.setMax?.(n); slider.set?.(M.cursor);
    const playBtn = q('[data-p=play]'); playBtn.textContent = M.playing ? 'Pause' : 'Play'; playBtn.setAttribute('aria-label', M.playing ? 'Pause history' : 'Play history');
    q('[data-p=back]').disabled = M.cursor <= 0 || !n; q('[data-p=fwd]').disabled = M.cursor >= n; q('[data-p=live]').disabled = M.cursor >= n; playBtn.disabled = !n;
    const e = M.events[M.cursor - 1];
    nowEl.textContent = !n ? 'No events to play.' : M.cursor >= n ? `Showing now. ${n} events in history.` : M.cursor === 0 ? `Start of history. ${n} events ahead.` : `Event ${M.cursor} of ${n} · ${timeText(e.at)} · ${e.text}`;
    if (nodeFocus) nodesEl.querySelector(`[data-id="${CSS.escape(nodeFocus)}"]`)?.focus({ preventScroll: true });
  }

  function select(id, { toggle = true } = {}) {
    M.selected = toggle && M.selected === id ? null : id;
    paint({ keepFocus: true });
    q('.wf-node-panel').setAttribute('aria-live', 'polite');
  }

  // ---- interaction ----
  root.addEventListener('click', e => {
    const t = e.target.closest('button,[data-id]'); if (!t || !root.contains(t)) return;
    if (M.suppressClick) { M.suppressClick = false; return; }
    if (t.dataset.z) { const [cx, cy] = center(); if (t.dataset.z === 'fit') fitAll(); else zoomAt(t.dataset.z === 'in' ? 1.25 : 0.8, cx, cy); return; }
    if (t.dataset.p) { const a = t.dataset.p; if (a === 'play') return M.playing ? stop() : play(); stop(); if (a === 'live') setCursor(M.events.length, { announce: true }); else if (a === 'back') setCursor(M.cursor - 1, { announce: true }); else if (a === 'fwd') setCursor(M.cursor + 1, { announce: true }); return; }
    if (t.dataset.clear !== undefined) { M.selected = null; return paint(); }
    if (t.dataset.go) { stop(); return setCursor(Number(t.dataset.go), { announce: true }); }
    if (t.dataset.id) select(t.dataset.id);
  });

  viewport.addEventListener('keydown', e => {
    const onNode = e.target.closest?.('.wf-node');
    if (onNode) {
      const i = NODE_IDS.indexOf(onNode.dataset.id);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return select(onNode.dataset.id); }
      const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? NODE_IDS.length - 1 : null;
      if (to !== null) { e.preventDefault(); const el = nodesEl.querySelector(`[data-id="${NODE_IDS[Math.max(0, Math.min(NODE_IDS.length - 1, to))]}"]`); el?.focus(); reveal(el); return; }
    } else {
      const step = 48, k = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (k) { e.preventDefault(); M.view.x += k[0]; M.view.y += k[1]; M.userMoved = true; return apply(); }
    }
    const [cx, cy] = center();
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.2, cx, cy); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(1 / 1.2, cx, cy); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
  });
  // Keep a focused checkpoint inside the viewport.
  function reveal(el) {
    if (!el) return; const id = el.dataset.id, p = layout().pos[id], { w, h } = size(), s = M.view.s;
    const l = p.x * s + M.view.x, t = p.y * s + M.view.y, r = l + NODE_W * s, b = t + NODE_H * s;
    let dx = 0, dy = 0; if (l < 12) dx = 12 - l; else if (r > w - 12) dx = w - 12 - r; if (t < 12) dy = 12 - t; else if (b > h - 12) dy = h - 12 - b;
    if (dx || dy) { M.view.x += dx; M.view.y += dy; M.userMoved = true; apply(); }
  }
  nodesEl.addEventListener('focusin', e => reveal(e.target.closest('.wf-node')));

  // Pan by dragging, pinch with two fingers, zoom with Ctrl or Command and the wheel. A plain wheel scrolls the page.
  const ptr = new Map(); let pan = null, pinch = null;
  viewport.addEventListener('pointerdown', e => {
    if (e.button && e.pointerType === 'mouse') return;
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: M.view.s }; pan = null; }
    else pan = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: M.view.x, vy: M.view.y, moved: false };
  });
  viewport.addEventListener('pointermove', e => {
    if (!ptr.has(e.pointerId)) return; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptr.size >= 2) { const [a, b] = [...ptr.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const r = viewport.getBoundingClientRect(); const s = clampScale(pinch.s * d / pinch.d); const f = s / M.view.s; const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top; zoomAt(f, cx, cy); M.suppressClick = true; return; }
    if (!pan || pan.id !== e.pointerId) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 5) return;
    if (!pan.moved) { pan.moved = true; viewport.setPointerCapture?.(e.pointerId); viewport.classList.add('is-panning'); }
    M.view.x = pan.vx + dx; M.view.y = pan.vy + dy; M.userMoved = true; apply();
  });
  const up = e => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = null; if (pan && pan.id === e.pointerId) { if (pan.moved) { M.suppressClick = true; setTimeout(() => { M.suppressClick = false; }, 0); } pan = null; viewport.classList.remove('is-panning'); } };
  viewport.addEventListener('pointerup', up); viewport.addEventListener('pointercancel', up);
  viewport.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); const r = viewport.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  const ro = new ResizeObserver(() => {
    const { w } = size(); const per = w < 640 ? 2 : 4;
    if (per !== M.perRow) { M.perRow = per; M.userMoved = false; if (M.tl) paint(); }
    if (!M.userMoved && w > 0) fit();
  });
  ro.observe(viewport);

  function selectNode(id) { if (NODE_IDS.includes(id)) select(id, { toggle: false }); }
  function destroy() { stop(); ro.disconnect(); root.replaceChildren(); }
  paint();
  return { update, setState, destroy, selectNode, fit, get cursor() { return M.cursor; }, get playing() { return M.playing; } };
}
