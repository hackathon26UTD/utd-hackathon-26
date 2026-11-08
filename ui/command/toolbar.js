// Map top bar: one row of real ARGUS kit parts under the main top bar, inside the map area.
// View, Go to, Layers, Hazards, Reports, Zones and Ask. It never fetches data; it calls overlays.js and the map.
import { OVERLAYS, SOURCE_STATUS_TEXT, ageText } from './core.js';
import { BASE_OPTIONS } from './map.js';
import { setOverlay } from './overlays.js';

const VIEW_KEY = 'homebeacon-map-view', AREA_KEY = 'homebeacon-map-area';
const glyph = {
  map: ['m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z', 'M9 3v16M15 5v16'],
  pin: ['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', 'M12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z'],
  layers: ['M12 3 3 8l9 5 9-5z', 'M3 12.5l9 5 9-5', 'M3 16.5l9 5 9-5'],
  hazard: ['M12 3.5 2.8 19.5h18.4z', 'M12 10v4.5', 'M12 17.2v.01'],
  zones: ['M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z'],
  ask: ['M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', 'M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'],
};

// Visible names for the hazard rows. Anything not listed keeps its catalog name.
const HAZARD_NAMES = { nws: 'Weather alerts', nfhl: 'Flood zones', gauges: 'River gauges', quakes: 'Earthquakes', firms: 'Fire hotspots', airnow: 'Air quality', eia: 'Power grid demand', declarations: 'Disaster declarations' };
const HAZARD_GROUPS = [
  ['Alerts and declarations', ['nws', 'declarations']],
  ['Water', ['nfhl', 'gauges', 'nwps', 'river_forecast', 'tides']],
  ['Earth and fire', ['quakes', 'firms']],
  ['Air and power', ['airnow', 'eia', 'ercot']],
  ['Forecasts and shelters', ['weather', 'nws_forecast', 'shelters']],
];
const KEY_NAMES = { firms: 'FIRMS_MAP_KEY', airnow: 'AIRNOW_API_KEY', eia: 'EIA_API_KEY' };

const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* per-viewer preference only */ } };

// Per-viewer map view from the last visit. Always a known base key; never anything else.
export function loadSavedView() {
  const v = read(VIEW_KEY) || {};
  return { base: BASE_OPTIONS.some(o => o.value === v.base) ? v.base : 'street', hillshade: v.hillshade === true, hydro: v.hydro === true };
}

export function mountToolbar({ root, map, ctx }) {
  const Kit = window.Kit, { S } = ctx;
  const bar = document.createElement('div');
  bar.id = 'map-bar'; bar.className = 'kit mapbar';
  bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Map views and layers');
  root.prepend(bar);

  const saved = loadSavedView();
  if (!ctx.embed) {
    if (saved.hillshade) map.setOverlayVisible('hillshade', true);
    if (saved.hydro) map.setOverlayVisible('hydro', true);
  }
  const persist = () => { if (!ctx.embed) write(VIEW_KEY, { base: map.styleKey, ...map.getViewState().overlays }); };

  const group = (label, ...kids) => { const g = document.createElement('div'); g.className = 'mapbar-group'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', label); g.append(...kids.filter(Boolean)); return g; };
  const caption = text => { const c = document.createElement('div'); c.className = 'kit-filter-button__caption'; c.textContent = text; return c; };

  // ---- View ----
  const view = Kit.toolbarDropdown({ id: 'map-view', ariaLabel: 'Base map', icon: glyph.map, options: BASE_OPTIONS, value: map.styleKey, onChange: value => { map.setBase(value); sync(); } });

  // ---- Go to ----
  const area = () => read(AREA_KEY);
  const goTo = Kit.buttonMenu({ id: 'map-goto', label: 'Go to', text: 'Go to', icon: glyph.pin, items: [] });
  goTo.setAttribute('aria-label', 'Go to');
  const goItems = () => {
    const a = area();
    return [
      { key: 'conus', label: 'Lower 48 states', onSelect: () => ctx.fitNational?.({ animate: true }) },
      { key: 'devices', label: 'Find devices', onSelect: () => ctx.fitHomes?.() },
      a ? { key: 'area', label: 'My area', onSelect: () => map.map.flyTo({ center: a.center, zoom: a.zoom, padding: map.pad, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500 }) } : null,
      { divider: true },
      { key: 'save-area', label: 'Save this view as my area', onSelect: () => { const c = map.map.getCenter(); write(AREA_KEY, { center: [Number(c.lng.toFixed(4)), Number(c.lat.toFixed(4))], zoom: Number(map.zoom.toFixed(2)) }); ctx.toast?.('Saved as your area. It stays in this browser.'); goTo.kitSetItems(goItems()); } },
    ].filter(Boolean);
  };
  goTo.kitSetItems(goItems());

  // ---- Layers ----
  const layerRows = [];
  const layerDefs = () => [
    { id: 'regions', label: 'Risk areas', help: 'Grouped by area, colored by the worst reported condition. Grey means unknown.' },
    { id: 'zones', label: 'Operator zones', help: ctx.demo ? 'Fictional exercise zones.' : 'Drawn by your team.' },
    { id: 'hillshade', label: 'Hillshade', help: 'USGS shaded relief over the base map.' },
    { id: 'hydro', label: 'Hydrography', help: 'USGS rivers and lakes.' },
    ctx.demo ? { id: 'exerciseWind', label: 'Exercise wind', help: 'Fictional wind circles. Not a forecast.' } : null,
  ].filter(Boolean);
  const isOn = id => id === 'hillshade' || id === 'hydro' ? map.rasterOn[id] : id === 'exerciseWind' ? map.visible.has(id) : S.ovOn?.has(id);
  const layers = Kit.filterButton({
    id: 'map-layers', label: 'Layers', icon: glyph.layers, popLabel: 'Map layers',
    content: () => {
      const box = document.createElement('div');
      box.className = 'mapbar-pop';
      box.append(caption('On the map'));
      layerRows.length = 0;
      for (const d of layerDefs()) {
        const t = Kit.tickBox({ label: d.label, help: d.help, checked: !!isOn(d.id), onChange: on => { setOverlay(ctx, d.id, on); if (d.id === 'hillshade' || d.id === 'hydro') persist(); } });
        layerRows.push([d.id, t]); box.append(t);
      }
      return box;
    },
  });

  // ---- Hazards ----
  const hazardRows = new Map();
  const hazardName = o => HAZARD_NAMES[o.id] || o.name;
  const hazardState = o => {
    const src = S.feeds?.get(o.id), m = S.ov?.[o.id] || {};
    const needsKey = src?.status === 'needs_key';
    let help;
    if (ctx.demo) help = 'Sign in as an operator to load public layers.';
    else if (needsKey) help = `Needs ${KEY_NAMES[o.id] || 'a server key'}`;
    else {
      const parts = [o.note];
      if (src) parts.push(SOURCE_STATUS_TEXT[src.status] || src.status);
      const age = src?.fetchedAt ? `Updated ${ageText(src.fetchedAt)}` : m.hb?.fetchedAt ? `Updated ${ageText(m.hb.fetchedAt)}` : '';
      if (age) parts.push(age);
      if (m.hb?.stale) parts.push('Out of date, showing last saved data');
      if (S.ovOn?.has(o.id) && o.minZoom && map.zoom < o.minZoom) parts.push(`Zoom in to see this layer (zoom ${o.minZoom} or closer)`);
      if (m.error) parts.push(m.error);
      help = parts.filter(Boolean).join(' · ');
    }
    return { help, disabled: ctx.demo || needsKey };
  };
  const hazards = Kit.filterButton({
    id: 'map-hazards', label: 'Hazards', icon: glyph.hazard, popLabel: 'Hazard and data layers',
    content: () => {
      const box = document.createElement('div');
      box.className = 'mapbar-pop mapbar-pop--tall';
      hazardRows.clear();
      if (!ctx.demo) ctx.overlays?.loadFeeds();
      for (const [title, ids] of HAZARD_GROUPS) {
        box.append(caption(title));
        for (const id of ids) {
          const o = OVERLAYS.find(x => x.id === id);
          if (!o) continue;
          const st = hazardState(o);
          const t = Kit.tickBox({ label: hazardName(o), help: st.help, checked: !!S.ovOn?.has(o.id), disabled: st.disabled, onChange: on => setOverlay(ctx, o.id, on) });
          hazardRows.set(o.id, t); box.append(t);
        }
      }
      const note = document.createElement('p');
      note.className = 'mapbar-note';
      note.textContent = 'Layers show regional context. They do not confirm damage to a home. Unknown is not the same as safe.';
      box.append(note);
      return box;
    },
  });

  // ---- Reports ----
  const power = Kit.toggle({ label: 'Power loss', checked: map.highlights.power, onChange: on => map.setHighlight('power', on) });
  const water = Kit.toggle({ label: 'Water reports', checked: map.highlights.water, onChange: on => map.setHighlight('water', on) });
  power.id = 'quick-power'; water.id = 'quick-water';
  power.title = 'Highlight homes reporting power loss'; water.title = 'Highlight homes reporting water';

  // ---- Zones panel (existing panel, opened from here) ----
  const zones = Kit.filterButton({ id: 'overlay-toggle', label: 'Zones', icon: glyph.zones });
  zones.setAttribute('aria-controls', 'overlay-panel'); zones.setAttribute('aria-expanded', 'false');

  // ---- Ask / Views ----
  let modelState = ctx.demo ? 'demo' : 'unknown';
  const ask = Kit.buttonMenu({ id: 'map-ask', label: 'Ask and views', text: 'Ask', icon: glyph.ask, items: [], align: 'end' });
  ask.setAttribute('aria-label', 'Ask');
  const askItems = () => [
    { key: 'ask', label: 'Ask about this map', onSelect: () => { ctx.builderReturnOverride = ask; document.querySelector('#build-layer')?.click(); } },
    S.layerIds ? { key: 'clear', label: 'Clear the current view', onSelect: () => ctx.resetViewBuilder?.() } : null,
    modelState === 'off' ? { note: 'Model not configured. Views are built from fixed rules.' } : null,
    modelState === 'demo' ? { note: 'Exercise mode. Model help needs an operator sign-in.' } : null,
  ].filter(Boolean);
  let askSig = '';
  const refreshAsk = () => { const items = askItems(), sig = JSON.stringify(items.map(i => [i.key, i.note])); if (sig !== askSig) { askSig = sig; ask.kitSetItems(items); } };
  refreshAsk();
  if (!ctx.demo) {
    ctx.api('/api/ops/agent').then(r => {
      if (!r.ok) return;
      modelState = (r.data?.configured ?? r.data?.nvidia?.configured) ? 'on' : 'off';
      refreshAsk();
    });
  }

  bar.append(group('Base map', view), group('Navigate', goTo), group('Layers', layers, hazards, zones), group('Homes', power, water), group('Assistance', ask));

  // ---- state mirror ----
  function sync() {
    if (view.kitValue() !== map.styleKey) view.kitSet(map.styleKey);
    const layerCount = layerDefs().filter(d => isOn(d.id)).length;
    layers.kitSet({ label: layerCount ? `Layers · ${layerCount}` : 'Layers', on: layerCount > 0 });
    const hz = OVERLAYS.filter(o => S.ovOn?.has(o.id)).length;
    hazards.kitSet({ label: hz ? `Hazards · ${hz}` : 'Hazards', on: hz > 0 });
    for (const [id, t] of layerRows) t.kitSet(!!isOn(id));
    for (const o of OVERLAYS) {
      const t = hazardRows.get(o.id); if (!t) continue;
      t.kitSet(!!S.ovOn?.has(o.id));
      const help = t.querySelector('.kit-tick-box__help'), st = hazardState(o);
      if (help && help.textContent !== st.help) help.textContent = st.help;
    }
    power.kitSet(map.highlights.power); water.kitSet(map.highlights.water);
    zones.classList.toggle('is-on', !!document.querySelector('#overlay-panel.open'));
    refreshAsk();
    persist();
  }
  map.handlers.base = () => sync();
  sync();

  const setBusy = busy => { bar.setAttribute('aria-busy', String(!!busy)); };
  return { destroy: () => { bar.remove(); delete map.handlers.base; }, sync, setBusy };
}
