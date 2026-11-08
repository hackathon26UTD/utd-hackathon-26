// Map layers panel, public feeds, operator zones and the zone drawing tool.
import { OVERLAYS, SOURCE_STATUS_TEXT, ZONE_TYPES, POINT_TYPES, overlayUrl, overlayNote, ageText, failText, validateZoneDraft, drawPreview, parsePoints, formatPoints } from './core.js';
import { describeOverlayFeature } from './map.js';
import { setHtml, toast, debounce } from './dom.js';
import { api } from './api.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const localInput = iso => { const d = new Date(iso || ''); if (Number.isNaN(d.getTime())) return ''; const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };

// Sample zones for exercise mode so the overlay tools have something to show. Fictional.
export function exerciseZones() {
  const poly = [[-96.79, 32.955], [-96.74, 32.955], [-96.74, 32.99], [-96.79, 32.99], [-96.79, 32.955]];
  return [
    { type: 'Feature', properties: { id: 'ex-1', type: 'evacuation', name: 'Exercise evacuation area', note: 'Fictional zone for the exercise.', active: true, version: 1 }, geometry: { type: 'Polygon', coordinates: [poly] } },
    { type: 'Feature', properties: { id: 'ex-2', type: 'shelter', name: 'Exercise shelter', note: 'Fictional shelter pin.', active: true, version: 1 }, geometry: { type: 'Point', coordinates: [-96.725, 32.972] } },
  ];
}

export function normalizeZones(fc) {
  const features = (fc?.features || []).filter(f => f?.geometry).map(f => {
    const props = { ...f.properties };
    props.id = String(props.id ?? props._id ?? f.id ?? '');
    if (props.active === undefined) props.active = true;
    return { type: 'Feature', id: undefined, geometry: f.geometry, properties: props };
  }).filter(f => f.properties.id);
  return features;
}

export function mountOverlays(ctx) {
  const { S, $, esc, mv } = ctx;
  S.zones = []; S.zoneState = 'idle'; S.ov = {}; S.ovOn = new Set(); S.feedState = 'idle'; S.zoneSel = null;
  const canWrite = !ctx.demo;

  // ---- panel ----

  function render() {
    const zonesRows = S.zones.map(f => {
      const p = f.properties, t = ZONE_TYPES[p.type] || ZONE_TYPES.custom;
      return `<li class="zone-row${S.zoneSel === p.id ? ' sel' : ''}"><span class="swatch" style="background:${t.color}"></span><div><strong>${esc(p.name)}</strong><small>${esc(t.label)}${p.active === false ? ' · hidden' : ''}</small></div><div class="row-actions"><button class="small" data-zoom-zone="${esc(p.id)}" data-key="z-${esc(p.id)}">Show</button>${canWrite ? `<button class="small" data-edit-zone="${esc(p.id)}">Edit</button><button class="small" data-del-zone="${esc(p.id)}">Delete</button>` : ''}</div></li>`;
    }).join('');
    const zoneNote = S.zoneState === 'unavailable' ? '<p class="soft-note">Operator zones are not available yet.</p>' : S.zoneState === 'auth' ? '<p class="soft-note">Sign in as an operator to load and draw zones.</p>' : '';
    const legend = Object.entries(ZONE_TYPES).map(([k, t]) => `<li><span class="swatch" style="background:${t.color}"></span>${esc(t.label)}</li>`).join('');
    setHtml($('#overlay-body'), `<h3>Zones</h3>${zoneNote}<div class="actions"><button id="draw-area"${canWrite ? '' : ' disabled title="Exercise mode is read only"'}>Draw area</button><button id="draw-pin"${canWrite ? '' : ' disabled title="Exercise mode is read only"'}>Place pin</button></div><ul class="zone-list">${zonesRows || '<li class="muted">No zones yet.</li>'}</ul>
<details class="zone-legend"><summary>Zone colors</summary><ul class="zone-legend-list">${legend}</ul></details>
<p class="attrib"><small>Zones are drawn by your team. Data layers and base map are chosen from the bar above the map. Layers show regional context. They do not confirm damage to a home.</small></p>`);
    ctx.toolbar?.sync();
  }

  $('#overlay-panel').addEventListener('change', e => {
    const t = e.target;
  });
  $('#overlay-panel').addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'draw-area') return startDraw({ pin: false });
    if (t.id === 'draw-pin') return startDraw({ pin: true });
    if (t.dataset.zoomZone) return selectZone(t.dataset.zoomZone, { fit: true });
    if (t.dataset.editZone) return openZoneDialog(S.zones.find(f => f.properties.id === t.dataset.editZone));
    if (t.dataset.delZone) return removeZone(t.dataset.delZone);
  });
  $('#overlay-toggle').onclick = () => {
    const panel = $('#overlay-panel'), open = panel.classList.toggle('open');
    $('#overlay-toggle').setAttribute('aria-expanded', String(open));
    if (open) { ctx.closeViewBuilder?.({ focus: false }); if (S.detailOpen) ctx.closeDetail({ restoreFocus: false }); ctx.closeWorkspace({ focus: false }); render(); loadFeeds(); $('#overlay-close').focus(); }
  };
  $('#overlay-close').onclick = () => { $('#overlay-panel').classList.remove('open'); $('#overlay-toggle').setAttribute('aria-expanded', 'false'); $('#overlay-toggle').focus(); };

  function toggle(id, on) {

    on ? S.ovOn.add(id) : S.ovOn.delete(id);
    mv.setVisible(id, on);
    if (id === 'regions') ctx.loadRegions();
    else if (id !== 'zones') { if (on) loadOverlay(id); }
    render();
  }

  // ---- public layers ----

  async function loadFeeds() {

    const r = await api('/api/public/feeds');
    S.feedState = r.ok ? 'ok' : 'unavailable';
    if (r.ok) S.feeds = new Map((r.data?.sources || []).map(s => [s.id, s]));
    render();
  }

  async function loadOverlay(id) {
    const def = OVERLAYS.find(o => o.id === id);
    S.ov[id] = S.ov[id] || {};
    if (def?.minZoom && mv.zoom < def.minZoom) { render(); return; }
    const box = mv.apiBbox();
    if (!box) { S.ov[id] = { ...S.ov[id], error: 'Move the map over the lower 48 states to load this layer.' }; render(); return; }
    const request = (S.ov[id].request || 0) + 1;
    S.ov[id] = { ...S.ov[id], request, loading:true };
    render();
    const r = await api(overlayUrl(id, box).replace('/api/overlays','/api/public/overlays'));
    if (S.ov[id].request !== request) return;
    if (r.ok && r.data) {
      mv.setExt(id, r.data);
      S.ov[id] = { request, hb: r.data.hb || null, count: (r.data.features || []).length, extra:r.data.extra||null, error: '' };
      if (id === 'atmosphere') {
        S.ov[id].metrics = Object.fromEntries(['rain_mm','wind_kph','solar_wm2','uv_index','temperature_c'].map(key => [key,(r.data.features || []).filter(f => Number.isFinite(f.properties?.[key])).length]));
        S.ov[id].validAt = (r.data.features || []).map(f => f.properties?.validAt).filter(t => Number.isFinite(Date.parse(t))).sort()[0] || null;
      }
    } else if (r.status === 401) {
      S.ov[id] = { ...S.ov[id], error: ctx.demo ? 'Sign in to load public layers.' : failText(401) };
    } else {
      S.ov[id] = { ...S.ov[id], error: failText(r.status, 'This layer', r.error) + (S.ov[id].count ? ' Showing the last saved view.' : '') };
    }
    S.ov[id].loading = false;
    if(id==='atmosphere')ctx.weatherPlayback?.setData(r.ok?r.data:null);
    render();
  }

  const reloadVisible = debounce(() => { for (const id of S.ovOn) if (OVERLAYS.some(o => o.id === id)) loadOverlay(id); }, 700);

  // ---- zones ----

  async function loadZones() {
    if (ctx.demo) {
      S.zones = exerciseZones();
      S.zoneState = 'ok';
    } else {
      const r = await api('/api/overlays?layer=zones');
      if (r.ok) { S.zones = normalizeZones(r.data); S.zoneState = 'ok'; }
      else S.zoneState = r.status === 401 || r.status === 403 ? 'auth' : 'unavailable';
    }
    mv.setData('zones', { type: 'FeatureCollection', features: S.zones });
    render();
  }

  function selectZone(id, { fit = false } = {}) {
    S.zoneSel = id;
    mv.selectZone(id);
    const f = S.zones.find(z => z.properties.id === id);
    if (f && fit) {
      const g = f.geometry;
      if (g.type === 'Point') mv.flyTo(g.coordinates, 14);
      else { const pts = g.coordinates.flat(g.type === 'MultiPolygon' ? 2 : 1); mv.fitTo([Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]); }
    }
    if (f) {
      const p = f.properties, t = ZONE_TYPES[p.type] || ZONE_TYPES.custom;
      const at = f.geometry.type === 'Point' ? f.geometry.coordinates : (f.geometry.coordinates.flat(f.geometry.type === 'MultiPolygon' ? 2 : 1)[0]);
      mv.popup(at, p.name, [t.label + (p.active === false ? ' (hidden)' : ''), p.note]);
    }
    render();
  }

  async function removeZone(id) {
    const f = S.zones.find(z => z.properties.id === id);
    if (!f || !canWrite) return;
    if (!await window.Kit.confirm({title:'Delete zone?',message:'The zone '+f.properties.name+' will be hidden from the map and the change is recorded.',confirmText:'Delete zone',danger:true})) return;
    const r = await api(`/api/overlays?layer=zones&id=${encodeURIComponent(id)}`, { method: 'DELETE', body: { version: f.properties.version } });
    toast(r.ok ? 'Zone deleted.' : r.status === 409 ? 'Someone else changed this zone. Reloaded.' : failText(r.status, 'Zones', r.error), { error: !r.ok });
    loadZones();
  }

  // ---- drawing ----

  function startDraw({ pin = false, editId = null } = {}) {
    if (!canWrite) return;
    S.drawing = { pin, points: [], editId };
    $('#overlay-panel').classList.remove('open'); $('#overlay-toggle').setAttribute('aria-expanded', 'false');
    mv.setDrawing(true);
    $('#draw-bar').classList.remove('hidden');
    $('#draw-help').textContent = pin ? 'Click the map to place the pin, then choose Finish.' : 'Click the map to add corners. Choose Finish, press Enter, or double-click to close the shape. Backspace removes the last point. Escape cancels.';
    $('#draw-bar').querySelector('button')?.focus();
    ctx.announce(pin ? 'Pin mode. Click the map to place it.' : 'Drawing mode. Click the map to add corners.');
    preview();
  }

  function preview() { mv.setData('draw', S.drawing ? drawPreview(S.drawing.points, S.drawing.pin) : EMPTY); $('#draw-count').textContent = S.drawing ? `${S.drawing.points.length} point${S.drawing.points.length === 1 ? '' : 's'}` : ''; }

  function addPoint(lngLat) {
    if (!S.drawing) return;
    const c = [Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))];
    S.drawing.pin ? (S.drawing.points = [c]) : S.drawing.points.push(c);
    preview();
  }

  function endDraw() { S.drawing = null; mv.setDrawing(false); $('#draw-bar').classList.add('hidden'); preview(); }

  function finishDraw() {
    if (!S.drawing) return;
    const d = S.drawing;
    const type = d.pin ? 'staging' : 'evacuation';
    const v = validateZoneDraft({ type, name: 'x', points: d.points, pin: d.pin });
    if (v.errors.shape) { $('#draw-help').textContent = v.errors.shape; return; }
    const keep = { ...d };
    endDraw();
    if (keep.editId) saveShape(keep.editId, v.geometry);
    else openZoneDialog(null, { points: keep.points, pin: keep.pin });
  }

  async function saveShape(id, geometry) {
    const f = S.zones.find(z => z.properties.id === id);
    const r = await api(`/api/overlays?layer=zones&id=${encodeURIComponent(id)}`, { method: 'PATCH', body: { geometry, version: f?.properties.version } });
    toast(r.ok ? 'Shape updated.' : r.status === 409 ? 'Someone else changed this zone. Reloaded.' : failText(r.status, 'Zones', r.error), { error: !r.ok });
    loadZones();
  }

  $('#draw-finish').onclick = finishDraw;
  $('#draw-undo').onclick = () => { S.drawing?.points.pop(); preview(); };
  $('#draw-cancel').onclick = () => { endDraw(); ctx.announce('Drawing cancelled.'); };
  document.addEventListener('keydown', e => {
    if (!S.drawing || e.target.closest?.('input,textarea,select,dialog')) return;
    if (e.key === 'Enter') { e.preventDefault(); finishDraw(); }
    else if (e.key === 'Escape') endDraw();
    else if (e.key === 'Backspace') { e.preventDefault(); S.drawing.points.pop(); preview(); }
  });

  // ---- zone dialog (create and edit) ----

  function openZoneDialog(feature, draft = null) {
    const d = $('#zone-dialog'), p = feature?.properties || {};
    S.zoneDraft = { id: p.id || null, version: p.version, points: draft?.points || [], pin: draft ? draft.pin : feature?.geometry.type === 'Point' };
    const type = p.type || (S.zoneDraft.pin ? 'staging' : 'evacuation');
    const types = S.zoneDraft.pin ? POINT_TYPES : Object.keys(ZONE_TYPES);
    $('#zone-title').textContent = feature ? 'Edit zone' : S.zoneDraft.pin ? 'Save pin' : 'Save area';
    $('#zone-fields').innerHTML = `<label>Type<select name="type">${types.map(k => `<option value="${k}"${k === type ? ' selected' : ''}>${esc(ZONE_TYPES[k].label)}</option>`).join('')}</select></label>
<label><span class="labrow">Name <small id="zname-count" class="count"></small></span><input name="name" maxlength="80" required value="${esc(p.name || '')}"></label>
<label>Note <small>Visible to operators only</small><textarea name="note" maxlength="300" rows="3">${esc(p.note || '')}</textarea></label>
<label class="check inline"><input type="checkbox" name="active"${p.active === false ? '' : ' checked'}> Show on the map</label>
<div class="two"><label>Starts <small>optional</small><input type="datetime-local" name="startsAt" value="${esc(localInput(p.startsAt))}"></label><label>Ends <small>optional</small><input type="datetime-local" name="endsAt" value="${esc(localInput(p.endsAt))}"></label></div>
${feature ? `<div class="actions"><button type="button" id="zone-redraw">Redraw shape</button></div>` : `<details><summary>Enter points as text</summary><label>Latitude, longitude per line<textarea name="pointsText" rows="4" placeholder="32.9800, -96.7500">${esc(formatPoints(S.zoneDraft.points))}</textarea></label></details>`}`;
    $('#zone-error').textContent = '';
    d.showModal();
  }

  $('#zone-fields').addEventListener('click', e => {
    if (e.target.id !== 'zone-redraw') return;
    const id = S.zoneDraft.id, pin = S.zoneDraft.pin;
    $('#zone-dialog').close();
    startDraw({ pin, editId: id });
  });
  $('#zone-cancel').onclick = () => $('#zone-dialog').close();
  $('#zone-form').onsubmit = async e => {
    e.preventDefault();
    if (!canWrite) return;
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const z = S.zoneDraft;
    let points = z.points;
    if (!z.id && f.pointsText?.trim()) {
      const parsed = parsePoints(f.pointsText);
      if (parsed.errors.length) { $('#zone-error').textContent = parsed.errors[0]; return; }
      points = parsed.points;
    }
    const body = { type: f.type, name: String(f.name).trim(), note: String(f.note || '').trim(), active: f.active === 'on' };
    if (f.startsAt) body.startsAt = new Date(f.startsAt).toISOString();
    if (f.endsAt) body.endsAt = new Date(f.endsAt).toISOString();
    if (!z.id) {
      const v = validateZoneDraft({ ...body, points, pin: z.pin, startsAt: body.startsAt, endsAt: body.endsAt });
      if (!v.ok) { $('#zone-error').textContent = Object.values(v.errors)[0]; return; }
      body.geometry = v.geometry;
    } else {
      const v = validateZoneDraft({ ...body, points: z.pin ? [[0, 0]] : [[0, 0], [0, 1], [1, 0]], pin: z.pin, startsAt: body.startsAt, endsAt: body.endsAt });
      const err = v.errors.name || v.errors.note || v.errors.endsAt || v.errors.type;
      if (err) { $('#zone-error').textContent = err; return; }
      body.version = z.version;
    }
    const btn = e.submitter; if (btn) btn.disabled = true;
    const url = '/api/overlays?layer=zones' + (z.id ? '&id=' + encodeURIComponent(z.id) : '');
    const r = await api(url, { method: z.id ? 'PATCH' : 'POST', body });
    if (btn) btn.disabled = false;
    if (!r.ok) { $('#zone-error').textContent = r.status === 409 ? 'Someone else changed this zone. It has been reloaded, try again.' : failText(r.status, 'Zones', r.error); if (r.status === 409) loadZones(); return; }
    $('#zone-dialog').close();
    toast(z.id ? 'Zone updated.' : 'Zone saved.');
    S.ovOn.add('zones'); mv.setVisible('zones', true);
    loadZones();
  };
  $('#zone-fields').addEventListener('input', e => { if (e.target.name === 'name') $('#zname-count').textContent = `${e.target.value.length}/80`; });

  setInterval(()=>{if(!document.hidden&&!ctx.demo){loadFeeds();for(const id of S.ovOn)if(OVERLAYS.some(o=>o.id===id))loadOverlay(id);}},60000);
  ctx.overlays = { render, toggle, loadFeeds };
  return { render, toggle, loadZones, loadFeeds, selectZone, addPoint, reloadVisible, isDrawing: () => !!S.drawing, reloadAll: () => { for (const id of S.ovOn) if (OVERLAYS.some(o => o.id === id)) loadOverlay(id); } };
}

// One entry point for every layer switch in the top bar: risk areas, zones, public feeds and the raster layers.
export function setOverlay(ctx, id, on) {
  if (id === 'hillshade' || id === 'hydro') ctx.mv.setOverlayVisible(id, on);
  else if (id === 'exerciseWind') ctx.mv.setVisible('exerciseWind', on);
  else ctx.overlays?.toggle(id, on);
  ctx.toolbar?.sync();
}

export function onOverlayClick(ctx, hit, lngLat) {
  const layer = hit.kind.slice('overlay:'.length);
  const d = describeOverlayFeature(layer, hit.properties);
  if (['nws', 'exerciseWind'].includes(layer) && hit.geometry?.type?.includes('Polygon')) {
    const pairs = [];
    const visit = c => { if (typeof c?.[0] === 'number') pairs.push(c); else if (Array.isArray(c)) c.forEach(visit); };
    visit(hit.geometry.coordinates);
    if (pairs.length) ctx.mv.fitTo([Math.min(...pairs.map(p => p[0])), Math.min(...pairs.map(p => p[1])), Math.max(...pairs.map(p => p[0])), Math.max(...pairs.map(p => p[1]))], { maxZoom: 9 });
    if (layer === 'exerciseWind') d.lines.push('Fictional exercise exposure. Not a forecast or official storm radius.');
  }
  ctx.mv.popup(lngLat, d.title, d.lines);
}
