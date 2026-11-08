// MapLibre wrapper: street-level base maps plus the command center layers. Rebuilds layers after every style switch.
import { STATUS_COLOR as C, ZONE_TYPES } from './core.js';

export const STYLES = {
  satellite: { version: 8, sources: { imagery: { type: 'raster', tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USDA, USGS The National Map: Orthoimagery</a>' } }, layers: [{ id: 'canvas', type: 'background', paint: { 'background-color': '#192027' } }, { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.85, 'raster-fade-duration': 0 } }] },
  street: 'https://tiles.openfreemap.org/styles/liberty',
  light: 'https://tiles.openfreemap.org/styles/positron',
};
const EMPTY = { type: 'FeatureCollection', features: [] };
const statusColor = ['match', ['get', 'status'], 'critical', C.critical, 'elevated', C.elevated, 'watch', C.watch, 'normal', C.normal, C.unknown];
const worstColor = ['match', ['get', 'worst'], 'critical', C.critical, 'elevated', C.elevated, 'watch', C.watch, 'normal', C.normal, C.unknown];
const zoneColor = ['match', ['get', 'type'], ...Object.entries(ZONE_TYPES).flatMap(([k, v]) => [k, v.color]), '#526974'];
const aqiColor = ['step', ['to-number', ['get', 'aqi'], 0], '#2f9e44', 51, '#e0b400', 101, '#f08c00', 151, '#e03131', 201, '#862e9c'];

// Paint per external layer: fill+line for areas, pt for points. Layers not listed use the default point style.
const EXT_STYLE = {
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
};
const AREA = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']];

export const GROUP_LAYERS = {
  regions: ['risk-fill', 'risk-line', 'risk-outage', 'risk-hot'],
  zones: ['zones-fill', 'zones-line', 'zones-pt', 'zones-sel'],
};

export class MapView {
  constructor(maplibregl, container, { center, zoom, styleKey = 'street', deviceMinZoom = 11, showGroups = true }) {
    this.gl = maplibregl;
    this.styleKey = styleKey;
    this.deviceMinZoom = deviceMinZoom; this.showGroups = showGroups;
    this.data = { devices: EMPTY, overview: EMPTY, regions: EMPTY, zones: EMPTY, draw: EMPTY };
    this.ext = {};
    this.radarTime = null;
    this.visible = new Set(['regions', 'zones']);
    this.selectedZone = '';
    this.highlights = { power: false, water: false };
    this.handlers = {};
    this.map = new maplibregl.Map({ container, style: STYLES[styleKey], center, zoom, attributionControl: { compact: true }, renderWorldCopies: false, maxZoom: 18 });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
    this.map.on('style.load', () => this.install());
    this.map.on('error', e => this.handlers.error?.(e));
    this.map.on('click', e => this.handlers.click?.(e, this.hit(e.point)));
    this.map.on('moveend', () => this.handlers.moveend?.());
    for (const layer of ['dev-circle', 'dev-groups', 'zones-fill', 'zones-pt', 'risk-fill']) {
      this.map.on('mouseenter', layer, () => { if (!this.drawing) this.map.getCanvas().style.cursor = 'pointer'; });
      this.map.on('mouseleave', layer, () => { this.map.getCanvas().style.cursor = this.drawing ? 'crosshair' : ''; });
    }
  }

  on(name, fn) { this.handlers[name] = fn; return this; }
  get zoom() { return this.map.getZoom(); }
  bbox() { const b = this.map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }

  setRadar(time) {
    this.radarTime = time;
    const m = this.map;
    if (!m.getSource('devices')) return;
    if (m.getLayer('weather-radar')) m.removeLayer('weather-radar');
    if (m.getSource('weather-radar')) m.removeSource('weather-radar');
    if (!time) return;
    const base = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';
    const query = `service=WMS&version=1.1.1&request=GetMap&layers=conus_bref_qcd&styles=&format=image%2Fpng&transparent=true&srs=EPSG%3A3857&width=256&height=256&time=${encodeURIComponent(time)}&bbox={bbox-epsg-3857}`;
    m.addSource('weather-radar', { type: 'raster', tiles: [`${base}?${query}`], tileSize: 256, attribution: '<a href="https://opengeo.ncep.noaa.gov/geoserver/www/index.html">NOAA MRMS radar</a>' });
    m.addLayer({ id: 'weather-radar', type: 'raster', source: 'weather-radar', paint: { 'raster-opacity': 0.68, 'raster-fade-duration': 0 } }, m.getLayer('dev-groups') ? 'dev-groups' : undefined);
  }

  setDrawing(on) { this.drawing = on; this.map.getCanvas().style.cursor = on ? 'crosshair' : ''; this.map.doubleClickZoom[on ? 'disable' : 'enable'](); }

  setStyleKey(key) {
    if (!STYLES[key] || key === this.styleKey) return;
    this.styleKey = key;
    this.map.setStyle(STYLES[key]);
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
    this.ext[id] = fc || EMPTY;
    this.map.getSource('ov-' + id)?.setData(this.ext[id]);
  }

  setVisible(name, on) {
    on ? this.visible.add(name) : this.visible.delete(name);
    this.applyVisibility(name);
  }

  extLayerIds(id) { return [`ov-${id}-fill`, `ov-${id}-line`, `ov-${id}-pt`]; }

  applyVisibility(name) {
    const ids = GROUP_LAYERS[name] || this.extLayerIds(name);
    for (const l of ids) if (this.map.getLayer(l)) this.map.setLayoutProperty(l, 'visibility', this.visible.has(name) ? 'visible' : 'none');
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
    m.addLayer({ id: `ov-${id}-line`, type: 'line', source: src, filter: AREA, paint: { 'line-color': s.line?.[0] || '#526974', 'line-width': s.line?.[1] ?? 1 } });
    m.addLayer({ id: `ov-${id}-pt`, type: 'circle', source: src, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': s.pt?.[0] || '#526974', 'circle-radius': s.pt?.[1] || 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.92 } });
  }

  install() {
    const m = this.map;
    const add = (name, data) => { if (!m.getSource(name)) m.addSource(name, { type: 'geojson', data }); };
    try {
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
      m.addLayer({ id: 'dev-circle', type: 'circle', source: 'devices', minzoom: this.deviceMinZoom, paint: { 'circle-radius': ['match', ['get', 'status'], 'critical', 9, 'elevated', 8, 7], 'circle-color': statusColor, 'circle-stroke-color': ['case', ['==', ['get', 'lastKnown'], true], '#8a9aa2', '#ffffff'], 'circle-stroke-width': ['case', ['==', ['get', 'lastKnown'], true], 3, 2], 'circle-opacity': ['case', ['==', ['get', 'lastKnown'], true], 0.75, 1] } });
      m.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#1676c4', 'fill-opacity': 0.15 } });
      m.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#1676c4', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
      m.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#1676c4', 'circle-stroke-width': 2.5 } });
      if (this.radarTime) this.setRadar(this.radarTime);
      for (const name of [...Object.keys(GROUP_LAYERS), ...Object.keys(EXT_STYLE)]) this.applyVisibility(name);
    } catch (error) {
      this.handlers.error?.(error);
    }
  }

  // Topmost feature under the pointer, in priority order.
  hit(point) {
    const order = [['device', 'dev-circle'], ['group', 'dev-groups'], ['zone', 'zones-pt'], ['zone', 'zones-fill'], ['region', 'risk-fill'], ...Object.keys(EXT_STYLE).flatMap(id => [['overlay:' + id, `ov-${id}-pt`], ['overlay:' + id, `ov-${id}-fill`]])];
    for (const [kind, layer] of order) {
      if (!this.map.getLayer(layer)) continue;
      const [f] = this.map.queryRenderedFeatures([[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]], { layers: [layer] });
      if (f) return { kind, layer, properties: f.properties || {}, geometry: f.geometry };
    }
    return null;
  }

  fitTo(bbox, { maxZoom = 14 } = {}) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: { top: innerWidth < 700 ? 175 : 150, right: 60, bottom: innerWidth < 700 ? 120 : 60, left: 60 }, maxZoom, duration: reduce ? 0 : 500 });
  }

  flyTo(center, zoom = 15) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.map.flyTo({ center, zoom: Math.max(this.map.getZoom(), zoom), duration: reduce ? 0 : 500 });
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
