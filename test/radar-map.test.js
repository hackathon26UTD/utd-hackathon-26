import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapView } from '../ui/command/map.js';

function fixture() {
  const layers = new Map([['dev-groups', {}]]), sources = new Map([['devices', {}]]), handlers = new Map();
  const map = {
    getLayer: id => layers.get(id), getSource: id => sources.get(id),
    removeLayer: id => layers.delete(id), removeSource: id => sources.delete(id),
    addSource: (id, source) => sources.set(id, source), addLayer: layer => layers.set(layer.id, layer),
    setPaintProperty: (id, key, value) => { layers.get(id).paint[key] = value; },
    isSourceLoaded: id => sources.get(id)?.ready === true,
    on: (event, fn) => { const set = handlers.get(event) || new Set(); set.add(fn); handlers.set(event, set); },
    off: (event, fn) => handlers.get(event)?.delete(fn),
  };
  const view = Object.create(MapView.prototype); view.map = map;
  const emit = (event, detail) => { for (const fn of [...(handlers.get(event) || [])]) fn(detail); };
  const ready = id => { sources.get(id).ready = true; emit('sourcedata', { sourceId: id }); };
  return { view, layers, sources, ready, emit };
}
test('radar holds current image while next frame loads, then crossfades', async () => {
  const f = fixture();
  const first = f.view.setRadar('2026-11-08T03:00:00Z'); f.ready('weather-radar-'+Date.parse('2026-11-08T03:00:00Z')); await first;
  const next = f.view.setRadar('2026-11-08T03:02:00Z');
  assert.equal(f.layers.get('weather-radar-'+Date.parse('2026-11-08T03:00:00Z')).paint['raster-opacity'], 0.68);
  assert.equal(f.layers.get('weather-radar-'+Date.parse('2026-11-08T03:02:00Z')).paint['raster-opacity'], 0);
  f.ready('weather-radar-'+Date.parse('2026-11-08T03:02:00Z')); await next;
  assert.equal(f.layers.get('weather-radar-'+Date.parse('2026-11-08T03:00:00Z')).paint['raster-opacity'], 0);
  assert.equal(f.layers.get('weather-radar-'+Date.parse('2026-11-08T03:02:00Z')).paint['raster-opacity'], 0.68);
});
test('failed frame preserves current radar; disabling cancels loading and removes both buffers', async () => {
  const f = fixture();
  const first = f.view.setRadar('2026-11-08T03:00:00Z'); f.ready('weather-radar-'+Date.parse('2026-11-08T03:00:00Z')); await first;
  const failed = f.view.setRadar('2026-11-08T03:02:00Z'); f.emit('error', { sourceId: 'weather-radar-'+Date.parse('2026-11-08T03:02:00Z') });
  assert.equal(await failed, false);
  assert.equal(f.layers.get('weather-radar-'+Date.parse('2026-11-08T03:00:00Z')).paint['raster-opacity'], 0.68);
  const pending = f.view.setRadar('2026-11-08T03:04:00Z'); await f.view.setRadar(null);
  assert.equal(await pending, false);
  assert.equal(f.layers.has('weather-radar-'+Date.parse('2026-11-08T03:00:00Z')), false); assert.equal(f.layers.has('weather-radar-'+Date.parse('2026-11-08T03:02:00Z')), false);
});

test('prefetch keeps the visible frame and cache stays bounded', async () => {
 const f=fixture(),stamp=i=>new Date(Date.parse('2026-11-08T03:00:00Z')+i*120000).toISOString(),id=i=>'weather-radar-'+Date.parse(stamp(i));
 const first=f.view.setRadar(stamp(0));f.ready(id(0));await first;
 for(let i=1;i<10;i++){const pending=f.view.prepareRadar(stamp(i));f.ready(id(i));assert.equal(await pending,true);}
 assert.equal(f.view.radarCache.size,6);assert.equal(f.layers.get(id(0)).paint['raster-opacity'],.68);
 await f.view.setRadar(null);assert.equal(f.view.radarCache.size,0);
});
