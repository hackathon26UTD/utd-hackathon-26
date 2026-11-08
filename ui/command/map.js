import { mountWindFlow } from './wind-flow.js';
import { allowsMotion } from '../display-settings.js';
// MapLibre wrapper: street-level base maps plus the command center layers. Rebuilds layers after every style switch.
import { STATUS_COLOR as C, ZONE_TYPES } from './core.js';
import { CONUS_BOUNDS, CONUS_FIT, CONUS_API_BOX, MIN_ZOOM, MAX_ZOOM, FIT_TO_MAX_ZOOM, clampBbox } from './geo.js';
import { worldView, WORLD_PALETTES, basePaint, metricColor } from './world-views.js';

// Base maps. The default is a near-white street map. There is no photo imagery base: topography and
// shaded relief are the only terrain views, and they are chosen from the top bar.
const POSITRON = 'https://tiles.openfreemap.org/styles/positron';
const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services';
const USGS_ATTR = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>';
const rasterSource = name => ({ type: 'raster', tiles: [`${USGS}/${name}/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 16, attribution: USGS_ATTR });
export const STYLES = {
  street: POSITRON,
  streetTerrain: POSITRON,
  topo: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: { topo: rasterSource('USGSTopo') }, layers: [{ id: 'canvas', type: 'background', paint: { 'background-color': '#f4f3ee' } }, { id: 'topo', type: 'raster', source: 'topo', paint: { 'raster-fade-duration': 0 } }] },
};
export const BASE_OPTIONS = [
  { value: 'street', label: 'Street' },
  { value: 'topo', label: 'Topographic' },
  { value: 'streetTerrain', label: 'Streets and terrain' },
];
// Optional raster layers, drawn under map labels and hidden until chosen.
const RASTER_OVERLAYS = {
  hillshade: { source: 'ov-hillshade-src', layer: 'ov-hillshade', name: 'USGSShadedReliefOnly', opacity: 0.45 },
  hydro: { source: 'ov-hydro-src', layer: 'ov-hydro', name: 'USGSHydroCached', opacity: 0.85 },
};
const EMPTY = { type: 'FeatureCollection', features: [] };
const statusColor = ['match', ['get', 'status'], 'critical', C.critical, 'elevated', C.elevated, 'watch', C.watch, 'normal', C.normal, C.unknown];
const worstColor = ['match', ['get', 'worst'], 'critical', C.critical, 'elevated', C.elevated, 'watch', C.watch, 'normal', C.normal, C.unknown];
const zoneColor = ['match', ['get', 'type'], ...Object.entries(ZONE_TYPES).flatMap(([k, v]) => [k, v.color]), '#526974'];
const aqiColor = ['step', ['to-number', ['get', 'aqi'], 0], '#2f9e44', 51, '#e0b400', 101, '#f08c00', 151, '#e03131', 201, '#862e9c'];

// Paint per external layer: fill+line for areas, pt for points. Layers not listed use the default point style.
const EXT_STYLE = {
  atmosphere: { pt: ['#147d92', 9] },
  faults: { line: ['#86593c', 2] },
  exerciseWind: { fill: [['get', 'tone'], 0.17], line: [['get', 'tone'], 2] },
  nws: { fill: ['#c4601f', 0.16], line: ['#b9413b', 2] },
  nfhl: { fill: [['match', ['to-string', ['get', 'SFHA_TF']], ['T', 'true'], '#2f6db5', '#8fb4d9'], 0.22], line: ['#2f6db5', 1] },
  declarations: { fill: ['#7a4fb5', 0.12], line: ['#7a4fb5', 1.5] },
  gauges: { pt: ['#1a7f9c', 6] },
  quakes: { pt: ['#8a5a2b', ['interpolate', ['linear'], ['to-number', ['get', 'mag'], 1], 1, 3, 6, 14]] },
  shelters: { pt: ['#1c5fa8', 7] },
  firms: { pt: ['#e8590c', 4] },
  airnow: { pt: [aqiColor, 8] },
  eia: { pt: ['#495057', 6] },
  nwps: { pt: ['#0b7285', 7] },
  weather: { pt: ['#4c6ef5', 5] },
  ercot: { pt: ['#495057', 6] },
  river_forecast: { pt: ['#1c7ed6', 6] },
  nws_forecast: { pt: ['#e67700', 5] },
  tides: { pt: ['#0c8599', 6] },
};
const AREA = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']];

export const GROUP_LAYERS = {
  regions: ['risk-fill', 'risk-line', 'risk-outage', 'risk-hot'],
  zones: ['zones-fill', 'zones-line', 'zones-pt', 'zones-sel'],
};

const reduced = () => !allowsMotion();
const HOVER_DWELL_MS = 120, HOVER_LEAVE_PX = 24;

// A feature is kept when any part of it can fall inside the lower 48 box. Alaska, Hawaii and open ocean are dropped.
export function featureInConus(f) {
  const st = String(f?.properties?.state ?? f?.properties?.STATE ?? '').toUpperCase();
  if (st === 'AK' || st === 'HI') return false;
  const g = f?.geometry;
  if (!g) return false;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = c => { if (typeof c?.[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else if (Array.isArray(c)) c.forEach(visit); };
  visit(g.coordinates);
  const b = CONUS_API_BOX;
  return w <= b.maxLon && e >= b.minLon && s <= b.maxLat && n >= b.minLat;
}
const conusOnly = fc => fc?.features ? { ...fc, features: fc.features.filter(featureInConus) } : fc;

export class MapView {
  constructor(maplibregl, container, { styleKey = 'street', interactive = true, deviceMinZoom = MIN_ZOOM, showGroups = false, padding } = {}) {
    this.gl = maplibregl;
    this.worldKey = 'street';
    this.styleKey = STYLES[styleKey] ? styleKey : 'street';
    this.deviceMinZoom = deviceMinZoom; this.showGroups = showGroups;
    this.data = { devices: EMPTY, overview: EMPTY, regions: EMPTY, zones: EMPTY, draw: EMPTY };
    this.ext = {};
    this.radarTime = null;
    this.visible = new Set(['regions', 'zones']);
    this.rasterOn = { hillshade: this.styleKey === 'streetTerrain', hydro: false };
    this.selectedZone = '';
    this.highlights = { power: false, water: false };
    this.handlers = {};
    this.cb = {};
    this.pad = padding || { top: 64, right: 40, bottom: 56, left: 40 };
    this.pointerType = 'mouse';
    this.map = new maplibregl.Map({
      container, interactive, style: STYLES[this.styleKey], attributionControl: { compact: true }, renderWorldCopies: false,
      maxBounds: CONUS_BOUNDS, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
      // Constrain the center, not the viewport size: narrow screens must still fit all 48 states.
      transformConstrain: (center, zoom) => ({center: new maplibregl.LngLat(Math.max(CONUS_BOUNDS[0][0],Math.min(CONUS_BOUNDS[1][0],center.lng)),Math.max(CONUS_BOUNDS[0][1],Math.min(CONUS_BOUNDS[1][1],center.lat))),zoom:Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,zoom))}),
      bounds: CONUS_FIT, fitBoundsOptions: { padding: this.pad, duration: 0 },
    });
    this.windFlow = mountWindFlow(this);
    if (interactive) {
      this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
    }
    this.map.on('style.load', () => this.install());
    this.map.on('error', e => this.handlers.error?.(e));
    this.map.on('click', e => this.onClick(e));
    this.map.on('moveend', () => this.handlers.moveend?.());
    this.map.on('movestart', () => { this.clearHover(); this.cb.moveStart?.(); });
    this.map.on('mousemove', e => this.onMouseMove(e));
    const box = this.map.getCanvasContainer();
    for (const type of ['pointerdown', 'pointermove']) box.addEventListener(type, e => { if (e.pointerType) this.pointerType = e.pointerType; }, { capture: true, passive: true });
    box.addEventListener('mouseleave', () => { if (this.pointerType === 'mouse') this.clearHover(); });
    box.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target !== this.map.getCanvas() || this.drawing) return;
      const lngLat = this.map.getCenter(), point = this.map.project(lngLat);
      this.cb.placeClick?.({ lngLat, point, hit: null, keyboard: true });
    });
    for (const layer of ['dev-circle', 'dev-groups', 'zones-fill', 'zones-pt', 'risk-fill']) {
      this.map.on('mouseenter', layer, () => { if (!this.drawing) this.map.getCanvas().style.cursor = 'pointer'; });
      this.map.on('mouseleave', layer, () => { this.map.getCanvas().style.cursor = this.drawing ? 'crosshair' : ''; });
    }
  }

  on(name, fn) { this.handlers[name] = fn; return this; }
  onPlaceHover(fn) { this.cb.placeHover = fn; return this; }
  onPlaceLeave(fn) { this.cb.placeLeave = fn; return this; }
  onPlaceClick(fn) { this.cb.placeClick = fn; return this; }
  onDeviceClick(fn) { this.cb.deviceClick = fn; return this; }
  onMoveStart(fn) { this.cb.moveStart = fn; return this; }
  get zoom() { return this.map.getZoom(); }
  bbox() { const b = this.map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
  // The visible box limited to the lower 48, for data requests. Null when nothing visible is inside it.
  apiBbox() { return clampBbox(this.bbox()); }
  projectToScreen(lngLat) { const p = this.map.project(lngLat); return { x: p.x, y: p.y }; }

  async setRadar(time) {
    this.radarTime = time;
    const m = this.map, token = this.radarToken = (this.radarToken || 0) + 1;
    this.cancelRadarLoad?.();
    if (!m.getSource('devices')) return false;
    const remove = id => { if (m.getLayer(id)) m.removeLayer(id); if (m.getSource(id)) m.removeSource(id); };
    if (!time) {
      for (const id of ['weather-radar-a', 'weather-radar-b']) remove(id);
      this.radarCurrent = null; return false;
    }
    const old = m.getLayer(this.radarCurrent || '') ? this.radarCurrent : null;
    const id = old === 'weather-radar-a' ? 'weather-radar-b' : 'weather-radar-a';
    remove(id);
    const base = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';
    const query = `service=WMS&version=1.1.1&request=GetMap&layers=conus_bref_qcd&styles=&format=image%2Fpng&transparent=true&srs=EPSG%3A3857&width=256&height=256&time=${encodeURIComponent(time)}&bbox={bbox-epsg-3857}`;
    m.addSource(id, { type: 'raster', tiles: [`${base}?${query}`], tileSize: 256, maxzoom: 8, bounds: [-126, 23, -65, 51], attribution: '<a href="https://opengeo.ncep.noaa.gov/geoserver/www/index.html">NOAA MRMS radar</a>' });
    // Keep the previous image until every visible tile of the incoming frame is ready.
    m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 450 }, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, m.getLayer('dev-groups') ? 'dev-groups' : undefined);
    const ready = await new Promise(resolve => {
      const finish = ok => { clearTimeout(timeout); m.off('sourcedata', loaded); m.off('error', failed); if (this.cancelRadarLoad === cancel) this.cancelRadarLoad = null; resolve(ok); };
      const loaded = e => { if (e.sourceId === id && m.getSource(id) && m.isSourceLoaded(id)) finish(true); };
      const failed = e => { if (e.sourceId === id) finish(false); };
      const cancel = () => finish(false);
      const timeout = setTimeout(() => finish(false), 15000);
      this.cancelRadarLoad = cancel;
      m.on('sourcedata', loaded); m.on('error', failed);
      if (m.isSourceLoaded(id)) finish(true);
    });
    if (token !== this.radarToken) return false;
    if (!ready) { remove(id); return false; }
    this.radarCurrent = id;
    m.setPaintProperty(id, 'raster-opacity', 0.68);
    if (old && m.getLayer(old)) m.setPaintProperty(old, 'raster-opacity', 0);
    await new Promise(resolve => setTimeout(resolve, 470));
    if (token === this.radarToken && old) remove(old);
    return true;
  }

  setDrawing(on) { this.drawing = on; this.clearHover(); this.map.getCanvas().style.cursor = on ? 'crosshair' : ''; this.map.doubleClickZoom[on ? 'disable' : 'enable'](); }

  // ---- hover, click and place events ----

  clearHover() {
    clearTimeout(this.dwellTimer); this.dwellTimer = null;
    if (this.anchor) { this.anchor = null; this.cb.placeLeave?.(); }
  }

  onMouseMove(e) {
    if (this.drawing || this.pointerType !== 'mouse' || !this.cb.placeHover) return;
    if (this.raf) { this.pending = e; return; }
    this.pending = e;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.handleMove(this.pending); });
  }

  handleMove(e) {
    const a = this.anchor, dist = a ? Math.hypot(e.point.x - a.x, e.point.y - a.y) : 0;
    const hit = this.hit(e.point);
    const sameDevice = a?.deviceId && hit?.kind === 'device' && hit.properties.id === a.deviceId;
    if (a) {
      if (a.deviceId ? sameDevice : hit?.kind !== 'device' && dist <= HOVER_LEAVE_PX) return;
      this.clearHover();
    }
    clearTimeout(this.dwellTimer);
    const fire = () => {
      this.dwellTimer = null;
      this.anchor = { x: e.point.x, y: e.point.y, hit, deviceId: hit?.kind === 'device' ? hit.properties.id : null };
      this.cb.placeHover?.({ lngLat: hit?.kind === 'device' && hit.geometry?.coordinates ? { lng: hit.geometry.coordinates[0], lat: hit.geometry.coordinates[1] } : e.lngLat, point: e.point, hit });
    };
    if (hit?.kind === 'device') fire(); else this.dwellTimer = setTimeout(fire, HOVER_DWELL_MS);
  }

  onClick(e) {
    let hit = this.hit(e.point);
    this.clearHover();
    if (!this.drawing && hit?.kind === 'state') {
      const bounds = JSON.parse(hit.properties.bounds || 'null');
      if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite)) {
        // Already zoomed to this state (common on phones, where a state fits below zoom 5.5): a second click is a place click.
        const cam = this.map?.cameraForBounds?.(bounds, { padding: this.pad, maxZoom: 7 });
        if (!cam || this.map.getZoom() < cam.zoom - 0.4) { this.fitTo(bounds, { maxZoom: 7 }); return; }
        hit = null;
      } else return;
    }
    this.handlers.click?.(e, hit);
    if (this.drawing) return;
    if (hit?.kind === 'device') this.cb.deviceClick?.(hit.properties.id);
    else this.cb.placeClick?.({ lngLat: e.lngLat, point: e.point, hit, touch: this.pointerType === 'touch' });
  }

  // ---- base map and raster overlays ----

  getViewState() {
    return { base: this.styleKey, overlays: { hillshade: this.rasterOn.hillshade, hydro: this.rasterOn.hydro } };
  }

  setBase(key) {
    if (!STYLES[key] || key === this.styleKey) return;
    const sameStyle = STYLES[key] === STYLES[this.styleKey];
    const wasTerrain = this.styleKey === 'streetTerrain';
    this.styleKey = key;
    if (key === 'streetTerrain') this.rasterOn.hillshade = true;
    else if (wasTerrain && !this.hillshadeChosen) this.rasterOn.hillshade = false;
    if (sameStyle) this.applyRaster(); else this.map.setStyle(STYLES[key]);
    this.handlers.base?.(key);
  }
  setStyleKey(key) { this.setBase(key); }

  setWorldView(key) {
    this.worldKey = worldView(key).id;
    this.applyWorldStyle();
  }

  applyWorldStyle() {
    const m = this.map, view = worldView(this.worldKey), palette = WORLD_PALETTES[view.palette];
    for (const layer of this.baseLayers || []) {
      if (!m.getLayer(layer.id)) continue;
      // Restore original properties before applying the next view, including Overview.
      const changed = this.basePaintKeys?.get(layer.id) || new Set();
      const paint = palette ? basePaint(layer, palette) : {};
      for (const prop of new Set([...changed, ...Object.keys(paint)])) {
        m.setPaintProperty(layer.id, prop, paint[prop] ?? layer.paint?.[prop] ?? null);
      }
      this.basePaintKeys.set(layer.id, new Set(Object.keys(paint)));
    }
    this.windFlow?.update();
    if (!m.getLayer('ov-atmosphere-pt')) return;
    const field = view.field || 'wind_kph';
    const valid = ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', field], null]];
    m.setFilter('ov-atmosphere-pt', valid);
    m.setPaintProperty('ov-atmosphere-pt', 'circle-color', metricColor(view));
    m.setPaintProperty('ov-atmosphere-pt', 'circle-radius', ['interpolate',['linear'],['zoom'],3,view.id === 'wind' ? 10 : 7,8,12,12,14]);
    m.setFilter('ov-atmosphere-label', valid);
    m.setLayerZoomRange?.('ov-atmosphere-label',view.id==='wind'?2:5,24);
    m.setPaintProperty('ov-atmosphere-label','text-color',view.id==='wind'?'#ffffff':'#253f50');
    m.setPaintProperty('ov-atmosphere-label','text-halo-color',view.id==='wind'?'#123e6e':'#ffffff');
    m.setLayoutProperty('ov-atmosphere-label', 'text-field', ['concat', ['to-string', ['round', ['get', field]]], view.unit === '°C' ? '°' : view.id === 'wind' ? ' km/h' : '']);
    m.setFilter('ov-atmosphere-arrow', ['all', ...valid.slice(1), ['!=',['get','wind_direction'],null], ['>', ['get','wind_kph'],0]]);
    this.applyVisibility('atmosphere');
  }

  setOverlayVisible(id, on) {
    if (!RASTER_OVERLAYS[id]) return;
    this.rasterOn[id] = !!on;
    if (id === 'hillshade') this.hillshadeChosen = !!on;
    this.applyRaster();
  }

  applyRaster() {
    for (const [id, def] of Object.entries(RASTER_OVERLAYS)) {
      if (this.map.getLayer(def.layer)) this.map.setLayoutProperty(def.layer, 'visibility', this.rasterOn[id] ? 'visible' : 'none');
    }
  }

  installRaster() {
    const m = this.map;
    const before = m.getStyle().layers.find(l => l.type === 'symbol')?.id;
    for (const [id, def] of Object.entries(RASTER_OVERLAYS)) {
      if (!m.getSource(def.source)) m.addSource(def.source, rasterSource(def.name));
      if (!m.getLayer(def.layer)) m.addLayer({ id: def.layer, type: 'raster', source: def.source, layout: { visibility: this.rasterOn[id] ? 'visible' : 'none' }, paint: { 'raster-opacity': def.opacity, 'raster-fade-duration': 0 } }, before);
    }
  }

  setHighlight(key, on) {
    this.highlights[key] = on;
    if (this.map.getLayer('dev-' + key)) this.map.setLayoutProperty('dev-' + key, 'visibility', on ? 'visible' : 'none');
  }

  setData(name, fc) {
    this.data[name] = fc || EMPTY;
    this.map.getSource(name)?.setData(this.data[name]);
  }

  setExt(id, fc) {
    this.ext[id] = conusOnly(fc) || EMPTY;
    this.map.getSource('ov-' + id)?.setData(this.ext[id]);
    if(id==='atmosphere')this.windFlow?.update();
  }

  setVisible(name, on) {
    on ? this.visible.add(name) : this.visible.delete(name);
    this.applyVisibility(name);
    if(name==='atmosphere')this.windFlow?.update();
  }

  extLayerIds(id) { return [`ov-${id}-fill`, `ov-${id}-line`, `ov-${id}-pt`, ...(id === 'atmosphere' ? ['ov-atmosphere-arrow','ov-atmosphere-label'] : [])]; }

  applyVisibility(name) {
    const ids = GROUP_LAYERS[name] || this.extLayerIds(name);
    for (const l of ids) if (this.map.getLayer(l)) this.map.setLayoutProperty(l, 'visibility', this.visible.has(name) && (l !== 'ov-atmosphere-arrow' || this.worldKey === 'wind') ? 'visible' : 'none');
  }

  selectZone(id) {
    this.selectedZone = id || '';
    if (this.map.getLayer('zones-sel')) this.map.setFilter('zones-sel', ['==', ['get', 'id'], this.selectedZone]);
  }

  addExtLayers(id) {
    const m = this.map, s = EXT_STYLE[id] || {};
    if (!m.getSource('ov-' + id)) m.addSource('ov-' + id, { type: 'geojson', data: this.ext[id] || EMPTY });
    const src = 'ov-' + id;
    m.addLayer({ id: `ov-${id}-fill`, type: 'fill', source: src, filter: AREA, paint: { 'fill-color': s.fill?.[0] || '#526974', 'fill-opacity': s.fill?.[1] ?? 0.1 } });
    m.addLayer({ id: `ov-${id}-line`, type: 'line', source: src, filter: id === 'faults' ? ['==', ['geometry-type'], 'LineString'] : AREA, paint: { 'line-color': s.line?.[0] || '#526974', 'line-width': s.line?.[1] ?? 1 } });
    m.addLayer({ id: `ov-${id}-pt`, type: 'circle', source: src, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': s.pt?.[0] || '#526974', 'circle-radius': s.pt?.[1] || 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.92 } });
    if (id === 'atmosphere') {
      if (!m.hasImage('wind-vector')) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40;
        const c = canvas.getContext('2d'); c.strokeStyle = '#fff'; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(20,33); c.lineTo(20,7); c.moveTo(12,15); c.lineTo(20,7); c.lineTo(28,15); c.stroke();
        m.addImage('wind-vector', c.getImageData(0,0,40,40));
      }
      m.addLayer({ id:'ov-atmosphere-arrow',type:'symbol',source:src,layout:{'icon-image':'wind-vector','icon-size':0.7,'icon-rotate':['+', ['coalesce',['get','wind_direction'],0],180],'icon-rotation-alignment':'map','icon-allow-overlap':true},paint:{'icon-opacity':0.95} });
      m.addLayer({ id:'ov-atmosphere-label',type:'symbol',source:src,minzoom:5,layout:{'text-field':'','text-font':['Noto Sans Regular'],'text-size':12,'text-offset':[0,1.7],'text-anchor':'top'},paint:{'text-color':'#253f50','text-halo-color':'#ffffff','text-halo-width':2} });
    }
  }

  install() {
    const m = this.map;
    const add = (name, data) => { if (!m.getSource(name)) m.addSource(name, { type: 'geojson', data }); };
    try {
      this.baseLayers = structuredClone(m.getStyle().layers);
      this.basePaintKeys = new Map();
      this.installRaster();
      add('us-states', '/data/us-states.geojson');
      m.addLayer({id:'state-fill',type:'fill',source:'us-states',paint:{'fill-color':'#ffffff','fill-opacity':0.01}});
      m.addLayer({id:'state-lines',type:'line',source:'us-states',paint:{'line-color':'#7d8b88','line-width':['interpolate',['linear'],['zoom'],3,1,8,1.8]}});
      for (const id of Object.keys(EXT_STYLE)) this.addExtLayers(id);
      add('zones', this.data.zones); add('regions', this.data.regions); add('devices', this.data.devices); add('overview', this.data.overview); add('draw', this.data.draw);
      m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', filter: AREA, paint: { 'fill-color': zoneColor, 'fill-opacity': ['case', ['==', ['get', 'active'], false], 0.05, 0.2] } });
      m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', filter: AREA, paint: { 'line-color': zoneColor, 'line-width': 2, 'line-dasharray': [3, 1.5] } });
      m.addLayer({ id: 'zones-pt', type: 'circle', source: 'zones', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': zoneColor, 'circle-radius': 8, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'zones-sel', type: 'line', source: 'zones', filter: ['==', ['get', 'id'], this.selectedZone], paint: { 'line-color': '#182f3b', 'line-width': 4 } });
      m.addLayer({ id: 'risk-fill', type: 'fill', source: 'regions', paint: { 'fill-color': worstColor, 'fill-opacity': ['match', ['get', 'worst'], 'normal', 0.04, 'unknown', 0.07, 0.11] } });
      m.addLayer({ id: 'risk-line', type: 'line', source: 'regions', paint: { 'line-color': worstColor, 'line-width': 1.2, 'line-opacity': 0.7 } });
      m.addLayer({ id: 'risk-outage', type: 'line', source: 'regions', filter: ['==', ['get', 'outage'], 'possible_grid_or_isp_outage'], paint: { 'line-color': '#2b3a42', 'line-width': 3, 'line-dasharray': [1, 2] } });
      m.addLayer({ id: 'risk-hot', type: 'line', source: 'regions', filter: ['==', ['get', 'hotspot'], true], paint: { 'line-color': '#b9413b', 'line-width': 4, 'line-opacity': 0.9 } });
      m.addLayer({ id: 'dev-groups-ring', type: 'circle', source: 'overview', maxzoom: 11, layout: { visibility: this.showGroups ? 'visible' : 'none' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 11, 30, 16, 100, 21], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#b5d9f5', 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'dev-groups', type: 'circle', source: 'overview', maxzoom: 11, layout: { visibility: this.showGroups ? 'visible' : 'none' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 7, 30, 12, 100, 17], 'circle-color': '#386f9b', 'circle-stroke-color': '#f7faf8', 'circle-stroke-width': 2.5, 'circle-opacity': 0.95 } });
      m.addLayer({ id: 'dev-power', type: 'circle', source: 'devices', minzoom: 10, filter: ['==', ['get', 'powerLoss'], true], layout: { visibility: this.highlights.power ? 'visible' : 'none' }, paint: { 'circle-radius': 20, 'circle-color': '#e9ae47', 'circle-opacity': 0.3, 'circle-stroke-color': '#e9ae47', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'dev-water', type: 'circle', source: 'devices', minzoom: 10, filter: ['==', ['get', 'water'], true], layout: { visibility: this.highlights.water ? 'visible' : 'none' }, paint: { 'circle-radius': 23, 'circle-color': '#65bded', 'circle-opacity': 0.25, 'circle-stroke-color': '#65bded', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'dev-halo-linked', type: 'circle', source: 'devices', minzoom: this.deviceMinZoom, filter: ['==', ['get', 'linked'], true], paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#64aef6', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'dev-sel', type: 'circle', source: 'devices', minzoom: this.deviceMinZoom, filter: ['==', ['get', 'selected'], true], paint: { 'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
      m.addLayer({ id: 'dev-circle', type: 'circle', source: 'devices', minzoom: this.deviceMinZoom, layout: { 'circle-sort-key': ['match',['get','status'],'critical',4,'elevated',3,'watch',2,'normal',1,0] }, paint: { 'circle-radius': ['interpolate',['linear'],['zoom'],3,2.5,7,4,12,8], 'circle-color': statusColor, 'circle-stroke-color': ['case', ['==', ['get', 'lastKnown'], true], '#8a9aa2', '#ffffff'], 'circle-stroke-width': ['case', ['==', ['get', 'lastKnown'], true], 3, 2], 'circle-opacity': ['case', ['==', ['get', 'lastKnown'], true], 0.75, 1] } });
      m.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#1676c4', 'fill-opacity': 0.15 } });
      m.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#1676c4', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
      m.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#1676c4', 'circle-stroke-width': 2.5 } });
      if (this.radarTime) this.setRadar(this.radarTime);
      for (const name of [...Object.keys(GROUP_LAYERS), ...Object.keys(EXT_STYLE)]) this.applyVisibility(name);
      this.applyWorldStyle();
    } catch (error) {
      this.handlers.error?.(error);
    }
  }

  // Topmost feature under the pointer, in priority order.
  hit(point) {
    const order = [['device', 'dev-circle'], ['group', 'dev-groups'], ['zone', 'zones-pt'], ...Object.keys(EXT_STYLE).map(id => ['overlay:' + id, `ov-${id}-pt`])];
    if (this.map.getZoom() < 5.5) order.push(['state','state-fill']);
    order.push(['zone', 'zones-fill'], ['region', 'risk-fill'], ...Object.keys(EXT_STYLE).map(id => ['overlay:' + id, `ov-${id}-fill`]), ['overlay:faults','ov-faults-line']);
    for (const [kind, layer] of order) {
      if (!this.map.getLayer(layer)) continue;
      const hits = this.map.queryRenderedFeatures(point, { layers: [layer] });
      if (kind === 'device') hits.sort((a,b) => { const pa=this.map.project(a.geometry.coordinates), pb=this.map.project(b.geometry.coordinates); return Math.hypot(pa.x-point.x,pa.y-point.y)-Math.hypot(pb.x-point.x,pb.y-point.y); });
      const [f] = hits;
      if (f) return { kind, layer, properties: f.properties || {}, geometry: f.geometry };
    }
    return null;
  }

  fitTo(bbox, { maxZoom = 14 } = {}) {
    const mobile = innerWidth < 700;
    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: { ...this.pad, top: Math.max(this.pad.top, 72), bottom: mobile ? 100 : this.pad.bottom }, maxZoom: Math.min(maxZoom, FIT_TO_MAX_ZOOM), duration: reduced() ? 0 : 500 });
  }

  fitConus({ animate = false } = {}) {
    this.map.fitBounds(CONUS_FIT, { padding: this.pad, duration: animate && !reduced() ? 500 : 0 });
  }

  // Room reserved by panels over the map (the device drawer sets `right`), so fits and flights center in the open part.
  setPadding(p = {}) {
    this.pad = { ...this.pad, ...p };
  }

  flyTo(center, zoom = 15) {
    this.map.flyTo({ center, zoom: Math.min(MAX_ZOOM, Math.max(this.map.getZoom(), zoom)), padding: this.pad, duration: reduced() ? 0 : 500 });
  }

  // Small popup built with text nodes only, so third-party feed text can never inject markup.
  popup(lngLat, title, lines = []) {
    this.popupRef?.remove();
    const box = document.createElement('div');
    box.className = 'map-popup';
    const h = document.createElement('strong');
    h.textContent = title;
    box.append(h);
    for (const line of lines.filter(Boolean)) { const p = document.createElement('p'); p.textContent = line; box.append(p); }
    this.popupRef = new this.gl.Popup({ closeButton: true, maxWidth: '280px' }).setLngLat(lngLat).setDOMContent(box).addTo(this.map);
  }
}

// Plain-language title and lines for an external feature. Unknown layers still get something readable.
export function describeOverlayFeature(layer, p = {}) {
  if (layer === 'atmosphere') {
    const values = [['Wind', 'wind_kph','km/h'],['Wind from','wind_direction','°'],['Sunshine','solar_wm2','W/m²'],['UV index','uv_index',''],['Temperature','temperature_c','°C']];
    return { title:p.name ? `${String(p.name).slice(0,80)} forecast` : 'Weather forecast sample', lines:[...values.map(([label,key,unit]) => `${label}: ${p[key] == null ? 'Not available' : `${p[key]} ${unit}`.trim()}`), p.validAt ? `Forecast valid ${new Date(p.validAt).toLocaleString()}` : 'Forecast time unavailable', 'Open-Meteo model data. Not a box measurement.'] };
  }
  if (layer === 'faults') return { title: String(p.name || 'Mapped fault').slice(0,120), lines:[p.age || 'Quaternary fault trace', 'USGS geological mapping. This does not predict an earthquake.'] };
  const pick = (...keys) => keys.map(k => p[k]).find(v => v !== undefined && v !== null && v !== '');
  const title = pick('event', 'headline', 'name', 'title', 'place', 'site_name', 'siteName', 'FLD_ZONE') || layer;
  const lines = [];
  if(p.observed!=null)lines.push('Observed: '+p.observed+' '+(p.observedUnit||''));
  if(p.forecast!=null)lines.push('Forecast: '+p.forecast+' '+(p.forecastUnit||''));
  if(p.water_level_m!=null)lines.push('Water level: '+p.water_level_m+' m relative to '+p.datum);
  if(p.observedAt)lines.push('Observed '+new Date(p.observedAt).toLocaleString());
  if(p.river_discharge)lines.push('Forecast discharge: '+p.river_discharge.join(', ')+' '+p.unit);
  if(p.periods?.length){const rows=typeof p.periods==='string'?JSON.parse(p.periods):p.periods;lines.push(...rows.slice(0,3).map(r=>r.startTime+': '+r.temperature+' '+r.temperatureUnit+', '+r.shortForecast));}
  if (layer === 'nfhl') lines.push(p.SFHA_TF === 'T' || p.SFHA_TF === true ? 'Special flood hazard area' : 'Lower mapped flood risk', 'Flood zones describe mapped risk, not damage to a home.');
  if (pick('severity')) lines.push('Severity: ' + pick('severity'));
  if (pick('areaDesc', 'area')) lines.push(String(pick('areaDesc', 'area')).slice(0, 160));
  if (pick('stage', 'value')) lines.push('Reading: ' + pick('stage', 'value'));
  if (pick('mag')) lines.push('Magnitude ' + pick('mag'));
  if (pick('expires', 'ends')) lines.push('Until ' + new Date(pick('expires', 'ends')).toLocaleString());
  return { title: String(title).slice(0, 120), lines };
}
