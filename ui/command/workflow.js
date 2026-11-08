// Workflow view for one device: the checkpoints a report travels through, drawn as a node and edge canvas,
// with a left history rail and a scrollable static canvas. DOM nodes plus one SVG layer for edges. No graph library.
// Unknown stays unknown: the local record and relay nodes are drawn dashed and never green.
import { NODE_DEFS, NODE_IDS, NODE_STATUS_TEXT, NODE_STATUS_GLYPH, SOURCE_TEXT, normalizeTimeline, stateAtCursor } from './conditions.js';
import { ageText } from './core.js';
import { timeText, dateTimeText } from './dom.js';

export const NODE_W = 232, NODE_H = 118, GAP_X = 68, GAP_Y = 92, PAD = 88;
export const MIN_SCALE = 0.4, MAX_SCALE = 2.5;
const DEF = Object.fromEntries(NODE_DEFS.map(d => [d.id, d]));

// One, two or four boxes per row, snaking so each hand-off is a short edge. Row direction flips every row.
export function layoutNodes(ids = NODE_IDS, perRow = 4) {
  const pos = {};
  ids.forEach((id, i) => {
    const row = Math.floor(i / perRow), at = i % perRow, dir = perRow === 1 ? 0 : row % 2 === 0 ? 1 : -1;
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
    if (a.dir === 0) {
      const p0 = port(a, 'r'), p1 = port(b, 'r');
      return finish(p0, { x: p0.x + 72, y: p0.y }, { x: p1.x + 72, y: p1.y }, p1);
    }
    const sameRow = a.row === b.row;
    const p0 = { x: a.x + NODE_W / 2, y: a.y + NODE_H }, p1 = sameRow ? { x: b.x + NODE_W / 2, y: b.y + NODE_H } : { x: b.x + NODE_W / 2, y: b.y };
    const lift = sameRow ? 58 : (p1.y - p0.y) / 2;
    const c0 = { x: p0.x, y: p0.y + lift }, c1 = { x: p1.x, y: sameRow ? p1.y + lift : p1.y - lift };
    return finish(p0, c0, c1, p1);
  }
  if (a.dir === 0) {
    const p0 = { x: a.x + NODE_W / 2, y: a.y + NODE_H }, p1 = { x: b.x + NODE_W / 2, y: b.y - 8 };
    return finish(p0, { x: p0.x, y: p0.y + 40 }, { x: p1.x, y: p1.y - 40 }, p1);
  }
  const p0 = port(a, a.dir === 1 ? 'r' : 'l'), p1 = port(b, b.dir === 1 ? 'l' : 'r');
  const dx = Math.abs(p1.x - p0.x), same = a.row === b.row;
  const k = same ? Math.max(30, dx / 2) : 78;
  const d0 = p0.side === 'r' ? 1 : -1, d1 = p1.side === 'r' ? 1 : -1;
  return finish(p0, { x: p0.x + d0 * k, y: p0.y }, { x: p1.x + d1 * k, y: p1.y }, { x: p1.x + d1 * 8, y: p1.y });
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

export function mountWorkflow({ root, ctx }) {
  const esc = ctx.esc;
  const M = { raw: null, tl: null, nodes: [], events: [], cursor: 0, selected: null, view: { s: 1, x: 0, y: 0 }, perRow: 4, userMoved: false, state: 'loading', message: '', onRetry: null, banner: '', visible: new Set(NODE_IDS) };

  root.classList.add('wf');
  root.innerHTML = `<div class="wf-banner" role="note" hidden></div>
<div class="wf-state" role="status" hidden></div>
<div class="wf-body">
<div class="wf-canvas-wrap">
<p class="wf-pan-tip">Scroll to explore. Select a checkpoint for details.</p>
<div class="wf-viewport" tabindex="0" role="application" aria-roledescription="workflow canvas" aria-label="Checkpoints for this device. Arrow keys scroll. Plus and minus zoom. Zero fits the width. Tab to a checkpoint to read it.">
<div class="wf-scroll-space"><div class="wf-world"><svg class="wf-edges" aria-hidden="true"></svg><div class="wf-nodes"></div><svg class="wf-ports" aria-hidden="true"></svg><section class="wf-node-panel" aria-label="Checkpoint explanation" hidden></section></div></div>
</div>
<div class="wf-tools" role="group" aria-label="Canvas zoom"><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="fit" aria-label="Fit checkpoint width">Fit</button></div>
<div class="wf-legend" aria-hidden="true"><span><i class="wf-key wf-k-ok"></i>Normal</span><span><i class="wf-key wf-k-warn"></i>Needs attention</span><span><i class="wf-key wf-k-critical"></i>Critical</span><span><i class="wf-key wf-k-unknown"></i>Not reported</span></div>
</div>
<section class="wf-log" aria-label="Event history"></section>
</div>`;
  const q = s => root.querySelector(s);
  const viewport = q('.wf-viewport'), world = q('.wf-world'), nodesEl = q('.wf-nodes'), edgesEl = q('.wf-edges'), portsEl = q('.wf-ports');
  const stateEl = q('.wf-state'), bannerEl = q('.wf-banner');
  const layout = () => {
    const L = layoutNodes(NODE_IDS, M.perRow);
    // Reserve space below the expanded checkpoint, including the row-turn arrows.
    const chosen = M.selected && M.visible.has(M.selected) && L.pos[M.selected];
    if (chosen) {
      for (const p of Object.values(L.pos)) if (p.row > chosen.row) p.y += 300;
      L.height += 300;
    }
    return L;
  };
  const size = () => ({ w: viewport.clientWidth || 600, h: viewport.clientHeight || 340 });
  const apply = () => {
    const L=layout(), {w}=size(), s=M.view.s;
    const x=Math.max(0,(w-L.width*s)/2);
    world.style.transform=`translateX(${x}px) scale(${s})`;
    q('.wf-scroll-space').style.width=Math.max(w,L.width*s)+'px';
    q('.wf-scroll-space').style.height=(L.height*s+24)+'px';
  };
  function fitAll() { fit(); }
  function fit() {
    const {w}=size(); M.view.s=Math.max(0.72,Math.min(1.1,w/layout().width));
    M.userMoved=false;apply();
  }
  function zoomAt(f) {
    M.view.s=clampScale(M.view.s*f);M.userMoved=true;apply();
  }

  // ---- model ----
  const stateNow = () => stateAtCursor(M.nodes, M.events, M.cursor);

  function update(raw) {
    if (M.destroyed) return;
    const tl = normalizeTimeline(raw);
    if (!tl) return;
    M.raw=raw;M.tl=tl;M.nodes=tl.nodes;M.events=tl.events;M.cursor=M.events.length;
    if (M.selected && !NODE_IDS.includes(M.selected)) M.selected = null;
    M.state = 'ready';
    const notes = [];
    if (tl.derived && tl.mode !== 'exercise') notes.push('Summary only. Detailed history unavailable.');
    if (tl.coverage?.truncated) notes.push(`Showing the most recent ${M.events.length} events.`);
    M.banner = notes.join(' ');
    paint({ keepFocus: true }); if (!M.userMoved) fit();
  }
  function setState(state, { message = '', onRetry = null } = {}) { M.state = state; M.message = message; M.onRetry = onRetry; if (state !== 'ready') paint(); else paint(); }

  // ---- drawing ----
  function nodeHtml(n, st, i) {
    const p = layout().pos[n.id], live = st.live;
    const dashed = n.source === 'not_recorded' || n.status === 'not_reported' || (live ? n.status : st.status) === 'unknown';
    const status = live ? n.status : st.status;
    const ev = st.events;
    const last = st.lastAt ? `${timeText(st.lastAt)} · ${ageText(st.lastAt)}` : n.status === 'not_reported' ? 'Not reported to the cloud' : 'No timestamp';
    return `<div class="wf-node wf-s-${esc(status)}${dashed ? ' is-dashed' : ''}${M.selected === n.id ? ' is-selected' : ''}" role="button" tabindex="0" aria-expanded="${M.selected === n.id}" aria-controls="wf-explanation" data-id="${esc(n.id)}" style="left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px">
<div class="wf-n-head"><span class="wf-n-num" aria-hidden="true">${i + 1}</span><span class="wf-n-title">${esc(n.label)}</span><span class="wf-n-src">${esc(SOURCE_TEXT[n.source] || 'Derived')}</span></div>
<div class="wf-n-status"><span class="wf-glyph" aria-hidden="true">${esc(NODE_STATUS_GLYPH[status] || '?')}</span><b>${esc(NODE_STATUS_TEXT[status] || 'Unknown')}</b></div>
<div class="wf-n-meta">${esc(last)}</div>
<div class="wf-n-counts"><span>${ev} event${ev === 1 ? '' : 's'}</span><span>${M.selected === n.id ? "Hide details ↑" : "Why? ↓"}</span></div></div>`;
  }

  function edgesSvg() {
    const L = layout(), { w } = { w: L.width };
    const sts = Object.fromEntries(stateNow().map(s => [s.id, s]));
    let defsOut = '<defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="wf-arrow"/></marker></defs>';
    let out = '', labels = '';
    for (const e of M.tl?.edges || []) {
      const a = L.pos[e.from], b = L.pos[e.to]; if (!a || !b || !M.visible.has(e.from) || !M.visible.has(e.to)) continue;
      const g = edgeGeometry(a, b, e.kind);
      const human = e.kind === 'human_only';
      out += `<path class="wf-edge${human ? ' is-human' : ''}${(sts[e.to]?.status === 'unknown' || sts[e.to]?.status === 'not_reported') ? ' is-faint' : ''}" d="${g.d}" ${human ? '' : 'marker-end="url(#wf-arrow)"'}/>`;
      if (human) labels += `<g class="wf-edge-label" transform="translate(${g.mid.x} ${g.mid.y})"><rect x="-42" y="-11" width="84" height="22" rx="11"/><text text-anchor="middle" dy="4">human only</text></g>`;

    }
    edgesEl.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`); edgesEl.setAttribute('width', L.width); edgesEl.setAttribute('height', L.height);
    edgesEl.innerHTML = defsOut + out + labels;
    // Status ports sit on top of the node borders so the colour and shape read as connectors.
    let ports = '';
    for (const n of M.nodes) {
      if (!M.visible.has(n.id)) continue;
      const p = L.pos[n.id], st = sts[n.id]; const status = st.live ? n.status : st.status;
      const inP = p.dir === 0 ? { x: p.x + NODE_W / 2, y: p.y } : port(p, p.dir === 1 ? 'l' : 'r'), outP = p.dir === 0 ? { x: p.x + NODE_W / 2, y: p.y + NODE_H } : port(p, p.dir === 1 ? 'r' : 'l');
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
    const id = M.selected, n = M.nodes.find(x => x.id === id);
    if (!n) return '';
    const st = stateNow().find(x => x.id === id), def = DEF[id];
    const events = M.events.slice(0, M.cursor).filter(e => e.nodeId === id);
    const refs = new Set(events.flatMap(e => e.refs || []));
    const cursorTime = Date.parse(M.events[M.cursor - 1]?.at || '');
    const evidence = (n.evidence || []).filter(e => st.live || (refs.has(e.id) && Date.parse(e.at || '') <= cursorTime));
    const reason = st.live && n.note ? n.note : events.at(-1)?.text || 'No event recorded at this point.';
    return `<div class="wf-np-head"><h3>Why this status?</h3><button type="button" data-clear aria-label="Close checkpoint explanation">×</button></div>
<p class="wf-rule-kind">${id === 'rules_latch' || id === 'risk_ladder' ? 'Fixed rules' : 'Recorded evidence'} · ${esc(NODE_STATUS_TEXT[st.status] || 'Unknown')}</p>
<p>${esc(reason)}</p><details><summary>Rule and evidence</summary><p>${esc(def.what)}</p>
${evidence.length ? `<ul class="wf-evidence">${evidence.map(e => `<li><code>${esc(e.id)}</code>${e.at ? `<br><time>${esc(dateTimeText(e.at))}</time>` : ''}</li>`).join('')}</ul>` : '<p>No supporting record available.</p>'}
<p class="wf-hint">${esc(def.limit)}</p></details>`;
  }

  function logHtml() {
    const head = `<div class="wf-log-head"><h3>History</h3><span>${M.events.length} events</span></div>`;
    if (!M.events.length) return head + '<p class="wf-hint">No recorded events in this window.</p>';
    return head + `<ol class="wf-events">${M.events.map((e, i) => `<li class="wf-ev wf-l-${esc(e.level)}"><button type="button" data-go="${i + 1}"><time datetime="${esc(e.at)}">${esc(timeText(e.at))}</time><span class="wf-ev-node">${esc(DEF[e.nodeId].label)}</span><span class="wf-ev-text">${esc(e.text)}</span></button></li>`).join('')}</ol>`;
  }

  function paint({ keepFocus = false } = {}) {
    if (M.destroyed) return;
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
    nodesEl.innerHTML = M.nodes.map((n, i) => M.visible.has(n.id) ? nodeHtml(n, sts[i], i) : '').join('');
    const panel = q('.wf-node-panel'); panel.id = 'wf-explanation'; panel.hidden = !M.selected;
    if (M.selected) { const p = layout().pos[M.selected]; panel.style.left = p.x + 'px'; panel.style.top = (p.y + NODE_H + 10) + 'px'; }
    const historyScroll = q('.wf-events')?.scrollTop || 0;
    const focusGo = active?.closest('[data-go]')?.dataset.go;
    const detailOpen = panel.dataset.node === M.selected && panel.querySelector('details')?.open;
    const panelScroll = panel.scrollTop;
    const panelFocus = panel.contains(active) ? active?.tagName : null;
    panel.innerHTML = panelHtml(); panel.dataset.node = M.selected || '';
    if (detailOpen) panel.querySelector('details').open = true;
    panel.scrollTop = panelScroll;
    if (panelFocus) panel.querySelector(panelFocus.toLowerCase())?.focus({ preventScroll: true });
    q('.wf-log').innerHTML = logHtml();
    const history=q('.wf-events');if(history)history.scrollTop=historyScroll;
    if(focusGo)q(`[data-go="${focusGo}"]`)?.focus({preventScroll:true});
    apply();
    if (nodeFocus) nodesEl.querySelector(`[data-id="${CSS.escape(nodeFocus)}"]`)?.focus({ preventScroll: true });
  }

  function select(id, { toggle = true } = {}) {
    M.selected = toggle && M.selected === id ? null : id;
    paint({ keepFocus: true });
    q('.wf-node-panel').setAttribute('aria-live', 'polite');
    reveal(nodesEl.querySelector(`[data-id="${id}"]`));
  }

  // ---- interaction ----
  root.addEventListener('click', e => {
    const t = e.target.closest('button,[data-id]'); if (!t || !root.contains(t)) return;
    if (M.suppressClick) { M.suppressClick = false; return; }
    if (t.dataset.z) { if (t.dataset.z === 'fit') fitAll(); else zoomAt(t.dataset.z === 'in' ? 1.25 : 0.8); return; }
    if (t.dataset.clear !== undefined) { const id = M.selected; M.selected = null; paint(); nodesEl.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true }); return; }
    if (t.dataset.go) { const event=M.events[Number(t.dataset.go)-1];if(event)select(event.nodeId,{toggle:false});return; }
    if (t.dataset.id) select(t.dataset.id);
  });

  viewport.addEventListener('keydown', e => {
    if (e.target.closest('.wf-node-panel')) return;
    const onNode = e.target.closest?.('.wf-node');
    if (onNode) {
      const ids = NODE_IDS.filter(id => M.visible.has(id)), i = ids.indexOf(onNode.dataset.id);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return select(onNode.dataset.id); }
      const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : null;
      if (to !== null) { e.preventDefault(); const el = nodesEl.querySelector(`[data-id="${ids[Math.max(0, Math.min(ids.length - 1, to))]}"]`); el?.focus(); reveal(el); return; }
    } else {
      const step = 48, k = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (k) { e.preventDefault(); viewport.scrollBy(-k[0],-k[1]);return; }
    }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.2); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(1 / 1.2); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
  });
  // Native scrolling makes every checkpoint and expanded explanation reachable.
  function reveal(el) {
    if(!el)return;
    el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    if(M.selected===el.dataset.id)q('.wf-node-panel').scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  }
  nodesEl.addEventListener('focusin',e=>reveal(e.target.closest('.wf-node')));
  viewport.addEventListener('wheel',e=>{
    if(!(e.ctrlKey||e.metaKey))return;
    e.preventDefault();zoomAt(Math.exp(-e.deltaY*0.0025));
  },{passive:false});

  const ro = new ResizeObserver(() => {
    const { w } = size(); const per = w < 540 ? 1 : w < 1000 ? 2 : 4;
    if (per !== M.perRow) { M.perRow = per; M.userMoved = false; if (M.tl) paint(); }
    if (!M.userMoved && w > 0) fit();
  });
  ro.observe(viewport);

  function selectNode(id) { if (NODE_IDS.includes(id)) select(id, { toggle: false }); }
  function destroy() { M.destroyed = true; ro.disconnect(); root.replaceChildren(); }
  paint();
  return { update, setState, destroy, selectNode, fit, pause() {}, get cursor() { return M.cursor; }, get playing() { return false; } };
}
