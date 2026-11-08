import { WORLD_VIEWS, worldView, viewSourceState, viewSourceNeedsAttention, selectedSourceState, gridSummary } from './world-views.js';
import { allowsMotion } from '../display-settings.js';
import { OVERLAYS, ageText } from './core.js';
import { setOverlay } from './overlays.js';

const KEY = 'homebeacon-world-view';
const BASELINE_KEY = 'homebeacon-world-baseline';
const SOURCE_LINKS = { atmosphere:'https://open-meteo.com/', faults:'https://www.usgs.gov/programs/earthquake-hazards/earthquake-geology' };
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; };

export function mountWorldControls({ root, map, ctx }) {
  let active = worldView('street'), baseline = null, changing = false;
  const legend = node('section', '', 'world-legend'); legend.setAttribute('aria-label', 'Map view legend'); legend.hidden = true;
  root.append(legend);
  const select = window.Kit.toolbarDropdown({ id:'map-world-view', ariaLabel:'Map view', options:WORLD_VIEWS.map(v => ({value:v.id,label:v.label})), value:'street', onChange:choose });

  function remember() {
    return { base:map.styleKey, overlays:new Set(ctx.S.ovOn), visible:new Set(map.visible), raster:{...map.rasterOn}, highlights:{...map.highlights} };
  }
  function saveBaseline() {
    try {
      if (baseline) localStorage.setItem(BASELINE_KEY,JSON.stringify({...baseline,overlays:[...baseline.overlays],visible:[...baseline.visible]}));
      else localStorage.removeItem(BASELINE_KEY);
    } catch { /* optional preference */ }
  }
  function restore() {
    if (!baseline) return;
    for (const id of new Set([...ctx.S.ovOn, ...baseline.overlays])) setOverlay(ctx,id,baseline.overlays.has(id));
    for (const id of new Set([...map.visible, ...baseline.visible])) map.setVisible(id,baseline.visible.has(id));
    map.setBase(baseline.base);
    for (const [id,on] of Object.entries(baseline.raster)) map.setOverlayVisible(id,on);
    for (const [id,on] of Object.entries(baseline.highlights)) map.setHighlight(id,on);
  }
  function choose(id) {
    if (changing || !ctx.overlays) return;
    changing = true;
    const next = worldView(id);
    if (!baseline && next.id !== 'street') { baseline = remember(); saveBaseline(); }
    restore();
    active = next;
    map.setWorldView(next.id);
    if (next.id !== 'street') {
      map.setBase(next.base || 'street');
      // Focus the geography without hiding any device alerts.
      for (const layer of OVERLAYS) setOverlay(ctx,layer.id,false);
      setOverlay(ctx,'regions',false);
      map.setVisible('exerciseWind',false);
      map.setOverlayVisible('hillshade',!!next.hillshade);
      map.setOverlayVisible('hydro',!!next.hydro);
      map.setHighlight('power',!!next.power);
      map.setHighlight('water',next.id === 'flood');
      for (const layer of next.layers) if(!(ctx.demo&&next.id==='wind'&&layer==='atmosphere'))setOverlay(ctx,layer,true);
      ctx.overlays.loadFeeds();
    } else { baseline = null; saveBaseline(); }
    select.kitSet(next.id);
    root.dataset.worldView = next.id;
    try { localStorage.setItem(KEY,next.id); } catch { /* optional preference */ }
    changing = false; sync(); ctx.toolbar?.sync();
  }

  function sync() {
    if (changing) return;
    legend.hidden = active.id === 'street' || !!ctx.embed;
    if (legend.hidden) return;
    const fragment = document.createDocumentFragment();
    const restoreWindFocus=document.activeElement===legend.querySelector('.world-wind-playback');
    const restoreFocus = document.activeElement === legend.querySelector('summary');
    const focusedLink = legend.contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
    const heading = node('div','','world-legend-heading');
    heading.append(node('strong',active.label),node('span',active.unit || (ctx.demo&&active.id==='wind' ? 'Simulation' : 'Source layers')));
    fragment.append(heading);
    if(active.id==='wind'){
      const playback=node('button',map.windFlow.paused?'Play wind':'Pause wind','world-wind-playback');playback.type='button';
      playback.disabled=!allowsMotion();if(playback.disabled)playback.textContent='Motion reduced';
      playback.addEventListener('click',()=>{map.windFlow.setPaused(!map.windFlow.paused);playback.textContent=map.windFlow.paused?'Play wind':'Pause wind';});fragment.append(playback);
    }
    const colors = ctx.demo&&active.id==='wind'?[]:active.stops?.map(([n,color]) => [color,String(n)]) || active.swatches || [];
    if (colors.length) {
      const scale = node('div','','world-scale');
      for (const [color,label] of colors) {
        const item = node('span','','world-scale-item'), swatch = node('i'); swatch.style.backgroundColor = color; swatch.setAttribute('aria-hidden','true');
        item.append(swatch,node('span',label)); scale.append(item);
      }
      fragment.append(scale);
    }
    fragment.append(node('p',ctx.demo&&active.id==='wind'?'Illustrated wind speeds and flow. Simulation only.':active.note,'world-note'));
    if (active.layers.length) {
      const sources = node('details','','world-sources');
      const summary = node('summary','Sources & coverage'); sources.append(summary);
      const states = [];
      for (const id of active.layers) {
        const def = OVERLAYS.find(v => v.id === id), state = ctx.S.ov?.[id], feed = ctx.S.feeds?.get(id);
        const metricState = selectedSourceState(id,state,active.field);
        const input = { demo:ctx.demo&&active.id==='wind',view:active,id,state:metricState,feed,zoom:map.zoom,minZoom:def?.minZoom,enabled:ctx.S.ovOn?.has(id) };
        const status = viewSourceState(input);
        states.push({text:status,attention:viewSourceNeedsAttention(input)});
        const row = node('div','','world-source'); row.append(node('strong',def?.name || id),node('p',status));
        if (state?.hb?.attribution) {
          const attribution = node(SOURCE_LINKS[id] ? 'a' : 'p',state.hb.attribution);
          if (SOURCE_LINKS[id]) { attribution.href=SOURCE_LINKS[id]; attribution.target='_blank'; attribution.rel='noopener noreferrer'; }
          row.append(attribution);
        }
        if (state?.hb?.fetchedAt) row.append(node('p',`Retrieved ${ageText(state.hb.fetchedAt)}`));
        if (state?.validAt) row.append(node('p',`Forecast valid ${new Date(state.validAt).toLocaleString()}`));
        if (state?.hb?.coverage?.area) row.append(node('p',`Coverage: ${state.hb.coverage.area}`));
        const reading = gridSummary(id,state);
        if (reading) row.append(node('p',reading));
        sources.append(row);
      }
      const problem = states.find(s => s.attention);
      fragment.append(node('p',problem?.text || 'Source layers loaded. Select a feature for details.','world-status'));
      // Preserve disclosure while asynchronous source statuses update.
      sources.open = !!legend.querySelector('details')?.open;
      fragment.append(sources);
    }
    legend.replaceChildren(fragment);
    if(restoreWindFocus)legend.querySelector('.world-wind-playback')?.focus({preventScroll:true});
    else if (restoreFocus) legend.querySelector('summary')?.focus({preventScroll:true});
    else if (focusedLink) [...legend.querySelectorAll('a')].find(a => a.getAttribute('href') === focusedLink)?.focus({preventScroll:true});
  }
  // Toolbar is created before overlay handlers. Restore only once they exist.
  queueMicrotask(() => {
    if (ctx.embed) return;
    let saved;
    try {
      saved = localStorage.getItem(KEY);
      const b = JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null');
      const allowed = new Set(['regions','exerciseWind',...OVERLAYS.map(o=>o.id)]);
      if (worldView(saved).id !== 'street' && b && ['street','topo','streetTerrain'].includes(b.base) && Array.isArray(b.overlays) && Array.isArray(b.visible)) {
        baseline = {base:b.base,overlays:new Set(b.overlays.filter(v=>allowed.has(v))),visible:new Set(b.visible.filter(v=>allowed.has(v))),raster:{hillshade:b.raster?.hillshade===true,hydro:b.raster?.hydro===true},highlights:{power:b.highlights?.power===true,water:b.highlights?.water===true}};
      }
    } catch { /* invalid saved preference is ignored */ }
    if (saved) choose(saved);
  });
  map.map.on('moveend',sync);
  document.addEventListener('homebeacon:motion',sync);
  return { select, sync, choose, destroy:() => { map.map.off('moveend',sync); document.removeEventListener('homebeacon:motion',sync); legend.remove(); } };
}
