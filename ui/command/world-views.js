// A view changes cartography and context, never device assessments.
export const WORLD_VIEWS = [
  { id: 'street', label: 'Overview', palette: null, layers: [], note: 'Devices and reported conditions.' },
  { id: 'wind', label: 'Wind', palette: 'wind', layers: ['atmosphere'], field: 'wind_kph', unit: 'km/h', stops: [[0,'#a9d6e1'],[15,'#5caabf'],[35,'#247c9b'],[65,'#245487'],[100,'#473c7c']], note: 'Forecast wind speeds. Trails show direction at each sample; gaps are unknown.' },
  { id:'rain',label:'Rain forecast',palette:'water',layers:['atmosphere'],field:'rain_mm',unit:'mm/hour',stops:[[0,'#a7d8ee'],[1,'#4eadd2'],[5,'#277eb5'],[15,'#525bb5'],[30,'#84378d']],note:'Forecast rain and showers in the hour ending at the selected time. Sample points, not flood boundaries.' },
  { id: 'sunshine', label: 'Sunshine', palette: 'sun', layers: ['atmosphere'], field: 'solar_wm2', unit: 'W/m²', stops: [[0,'#c5ccd5'],[200,'#e8d9a0'],[400,'#e9b84e'],[700,'#d48314'],[1000,'#a5520a']], note: 'Forecast sunlight, averaged over the preceding hour at sample points.' },
  { id: 'uv', label: 'UV index', palette: 'uv', layers: ['atmosphere'], field: 'uv_index', unit: 'UV index', stops: [[0,'#6aa96c'],[3,'#d4b73b'],[6,'#dc8739'],[8,'#d34e60'],[11,'#8651a0']], discrete: true, note: 'Forecast UV at sample points. Shade and indoor exposure differ.' },
  { id: 'temperature', label: 'Temperature', palette: 'heat', layers: ['atmosphere'], field: 'temperature_c', unit: '°C', stops: [[-20,'#596eb4'],[0,'#79b4c8'],[15,'#c6d5b4'],[30,'#e69b50'],[45,'#bd4b45']], note: 'Forecast outdoor temperature. Indoor box readings stay separate.' },
  { id: 'terrain', label: 'Terrain', palette: 'earth', base: 'topo', layers: [], note: 'USGS topography. Contours, elevation and landforms.' },
  { id: 'flood', label: 'Flood zones', palette: 'water', layers: ['nfhl'], swatches: [['#2f6db5','Special hazard'],['#8fb4d9','Other mapped zone']], note: 'FEMA mapped flood risk, not today’s flood extent. Zoom into a neighborhood.' },
  { id: 'rivers', label: 'Rivers & coast', palette: 'water', layers: ['gauges','nwps','river_forecast','tides'], hydro: true, swatches: [['#1a7f9c','Gauge'],['#1c7ed6','Forecast']], note: 'Select a gauge for its reading, time and native units.' },
  { id: 'air', label: 'Air quality', palette: 'air', layers: ['airnow'], swatches: [['#2f9e44','0–50'],['#e0b400','51–100'],['#f08c00','101–150'],['#e03131','151–200'],['#862e9c','201+']], note: 'AirNow AQI reporting areas. No interpolation between stations.' },
  { id: 'fire', label: 'Fire', palette: 'fire', layers: ['firms'], swatches: [['#e8590c','Satellite detection']], note: 'NASA heat detections. Points are not fire boundaries or confirmed damage.' },
  { id: 'earth', label: 'Faults & earthquakes', palette: 'earth', layers: ['faults','quakes'], hillshade: true, swatches: [['#86593c','Mapped fault'],['#8a5a2b','Recent quake']], note: 'USGS fault traces and last-day earthquakes. Larger circles mean higher magnitude.' },
  { id: 'power', label: 'Power', palette: 'power', layers: ['eia','ercot'], power: true, swatches: [['#e9ae47','Box reported power loss']], note: 'Device reports show power loss. Regional grid demand is not an outage map.' },
  { id: 'alerts', label: 'Weather alerts', palette: 'sky', layers: ['nws','nws_forecast','weather'], swatches: [['#c4601f','Weather alert'],['#4c6ef5','Forecast point']], note: 'Official NWS alerts with point forecasts and predicted rain.' },
  { id: 'disasters', label: 'Declared disasters', palette: 'uv', layers: ['declarations'], swatches: [['#7a4fb5','Declared county']], note: 'FEMA declarations cover counties, not confirmed damage at each address.' },
  { id: 'shelters', label: 'Shelters', palette: 'air', layers: ['shelters'], swatches: [['#1c5fa8','Listed shelter']], note: 'FEMA shelter listings. Confirm availability before travel.' },
];

export const WORLD_PALETTES = {
  wind: { ground:'#2068a8', water:'#124c86', park:'#286da1', road:'#78a5ce', ink:'#ffffff' },
  sky: { ground:'#edf7fa', water:'#b9dce6', park:'#d7e8e4', road:'#ffffff', ink:'#32566a' },
  sun: { ground:'#fff8df', water:'#d5e4e7', park:'#e6e8bc', road:'#ffffff', ink:'#775726' },
  uv: { ground:'#f6effb', water:'#d6d6ee', park:'#e0e5d9', road:'#ffffff', ink:'#665078' },
  heat: { ground:'#fcf1e8', water:'#d0e3ec', park:'#e4e6d1', road:'#ffffff', ink:'#775b4d' },
  water: { ground:'#eef6fc', water:'#abcce5', park:'#dae9e3', road:'#ffffff', ink:'#355b77' },
  earth: { ground:'#f1eee7', water:'#cadde0', park:'#dce0ce', road:'#ffffff', ink:'#665847' },
  air: { ground:'#eef6f0', water:'#c8e1e4', park:'#d6e6d3', road:'#ffffff', ink:'#3d6359' },
  fire: { ground:'#fff2eb', water:'#cadfe2', park:'#e2e3ce', road:'#ffffff', ink:'#805746' },
  power: { ground:'#edf0f4', water:'#cbd7df', park:'#dce2da', road:'#ffffff', ink:'#46556b' },
};

export const worldView = id => WORLD_VIEWS.find(v => v.id === id) || WORLD_VIEWS[0];
const gridNumber = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
export function gridRows(id,state) {
  const keys = id === 'ercot' ? ['demand','capacity','forecast'] : id === 'eia' ? ['value'] : [];
  return Array.isArray(state?.extra?.series) ? state.extra.series.filter(row => row && keys.some(key => gridNumber(row[key]))) : [];
}
export function selectedSourceState(id,state,field) {
  if (!state) return state;
  if (id === 'atmosphere' && field && state.metrics) {
    const count = state.metrics[field] || 0;
    return {...state,count,hb:state.hb ? {...state.hb,truncated:!!state.hb.truncated || count < state.count} : state.hb};
  }
  if (id === 'eia' || id === 'ercot') return {...state,count:gridRows(id,state).length,sourceKind:'series'};
  return state;
}
export function gridSummary(id,state) {
  const rows = gridRows(id,state);
  if (!rows.length) return null;
  if (id === 'eia') {
    const row=rows[0]; return `${row.region || 'Regional'} demand: ${row.value} ${row.unit || 'units unavailable'} (${row.period || 'time unavailable'})`;
  }
  const row=rows.findLast(row=>gridNumber(row.demand)) || rows.at(-1);
  const readings = [['Demand','demand'],['Capacity','capacity'],['Forecast demand','forecast']].filter(([,key])=>gridNumber(row[key])).map(([label,key])=>`${label}: ${row[key]} ${row.unit || 'units unavailable'}`);
  return `${readings.join(' · ')} (${row.at || 'time unavailable'})`;
}
export function metricColor(view) {
  if (!view.field || !view.stops) return '#147d92';
  const value = ['get', view.field];
  const scale = view.discrete
    ? ['step', value, view.stops[0][1], ...view.stops.slice(1).flat()]
    : ['interpolate', ['linear'], value, ...view.stops.flat()];
  return ['case', ['==', value, null], '#87949c', scale];
}

// Only layer paint from the original base style is eligible. Device and hazard layers never enter here.
export function basePaint(layer, palette) {
  const id = layer.id.toLowerCase();
  if (layer.type === 'background') return { 'background-color': palette.ground };
  if (layer.type === 'fill' && !layer.paint?.['fill-pattern']) return { 'fill-color': /water|ocean/.test(id) ? palette.water : /park|wood|grass|landcover/.test(id) ? palette.park : palette.ground };
  if (layer.type === 'line' && /road|highway|transport/.test(id)) return { 'line-color': /casing|outline/.test(id) ? palette.water : palette.road };
  if (layer.type === 'symbol' && layer.layout?.['text-field']) return { 'text-color': palette.ink, 'text-halo-color': palette.ground };
  return {};
}

export function viewSourceState({ demo, view, id, state, feed, zoom, minZoom = 0, enabled = true }) {
  if (demo) return id === 'atmosphere' && view.id === 'wind' ? 'Illustrated wind, not a forecast. No live weather is loaded.' : 'Live layer not loaded in simulations.';
  if (!enabled) return 'Layer hidden';
  if (zoom < minZoom) return 'Zoom in to load this layer';
  if (feed?.status === 'needs_key') return 'Source key not configured';
  if (state?.loading) return 'Loading…';
  if (state?.error) return state.error;
  if (!state?.hb) return 'Waiting for data';
  const parts = [state.hb.stale ? 'Out of date' : state.hb.refreshStatus === 'error' ? 'Refresh failed; showing saved data' : 'Cached source', `${state.count ?? 0} ${state.sourceKind === 'series' ? 'regional readings' : 'mapped features'}`];
  if (state.hb.truncated) parts.push('Partial coverage');
  if (state.count === 0) parts.push(state.sourceKind === 'series' ? 'No regional readings available' : 'No mapped coverage here');
  return parts.join(' · ');
}

export function viewSourceNeedsAttention({demo,state,feed,zoom,minZoom=0,enabled=true}) {
  return !!(demo || !enabled || zoom < minZoom || feed?.status === 'needs_key' || state?.loading || state?.error || !state?.hb || state.hb.stale || state.hb.refreshStatus === 'error' || state.hb.truncated || !state.count);
}
