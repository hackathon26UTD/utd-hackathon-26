// Lower 48 geography constants shared by the map, place card and drawer. Server code duplicates the API box.
export const CONUS_BOUNDS = [[-126.5, 23.5], [-65, 50.5]];
export const CONUS_FIT = [[-124.9, 24.4], [-66.8, 49.5]];
export const CONUS_API_BOX = { minLat: 24.3, maxLat: 49.6, minLon: -125.1, maxLon: -66.8 };
export const MIN_ZOOM = 1.5, MAX_ZOOM = 18, FIT_TO_MAX_ZOOM = 16;
export const PLACE_ENDPOINT = '/api/ops/place';
export const TIMELINE_ENDPOINT = '/api/ops/device-timeline';

// Intersect a [west, south, east, north] box with the lower 48 API box. Null when nothing is left.
export function clampBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4 || bbox.slice(0, 4).some(n => !Number.isFinite(Number(n)))) return null;
  const [w, s, e, n] = bbox.map(Number);
  const b = CONUS_API_BOX;
  const out = [Math.max(w, b.minLon), Math.max(s, b.minLat), Math.min(e, b.maxLon), Math.min(n, b.maxLat)];
  return out[0] < out[2] && out[1] < out[3] ? out : null;
}

export function inConus(lat, lon) {
  const b = CONUS_API_BOX;
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

// Keep the national fit as the farthest view, even on a resized or collapsed workspace.
export function constrainConus(center,zoom,width,height,minZoom=MIN_ZOOM){
  zoom=Math.max(minZoom,Math.min(MAX_ZOOM,zoom));
  const merc=lat=>(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2;
  const lat=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;
  const scale=512*2**zoom,halfX=width/(2*scale),halfY=height/(2*scale);
  const clamp=(v,lo,hi,half)=>hi-lo<2*half?(lo+hi)/2:Math.max(lo+half,Math.min(hi-half,v));
  return {lng:clamp((center.lng+180)/360,(CONUS_BOUNDS[0][0]+180)/360,(CONUS_BOUNDS[1][0]+180)/360,halfX)*360-180,
    lat:lat(clamp(merc(center.lat),merc(CONUS_BOUNDS[1][1]),merc(CONUS_BOUNDS[0][1]),halfY)),zoom};
}
