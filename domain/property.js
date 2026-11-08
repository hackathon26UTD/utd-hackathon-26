export const PRIORITIES = { critical: 'Immediate review', warning: 'Watch', normal: 'Reporting', unknown: 'No recent signal' };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
export function summarizeProperty(device, readings = [], alerts = [], now = Date.now()) {
  const id = String(device._id || device.id);
  const meta = device.meta || {};
  const values = Object.fromEntries(readings.map(r => [r.sensor, r.value]));
  const timestamps = readings.map(r => new Date(r.ts).getTime()).filter(Number.isFinite);
  const observed = timestamps.length ? Math.max(...timestamps) : null;
  const lastSeen = device.lastSeen ? new Date(device.lastSeen).getTime() : null;
  const age = observed === null ? Infinity : Math.max(0, (now - observed) / 1000);
  const stale = age > 300;
  const reasons = [];
  let severity = 'normal';
  if (values.water_detected === true || (finite(values.water_level_mm) && values.water_level_mm >= 20)) { severity = 'critical'; reasons.push('Water detected indoors'); }
  if (values.smoke_alarm === true || values.air_alarm === true) { severity = 'critical'; reasons.push('Air sensor alarm reported'); }
  if (finite(values.temp_c) && values.temp_c >= 55) { severity = 'critical'; reasons.push('Temperature above the prototype threshold'); }
  if (alerts.some(a => a.severity === 'critical' && a.status !== 'resolved')) { severity = 'critical'; reasons.push('Unresolved critical alert'); }
  if (values.mains_power === false) { if(severity !== 'critical') severity = 'warning'; reasons.push('External power lost'); }
  if (values.wan_connected === false) { if(severity !== 'critical') severity = 'warning'; reasons.push('Internet connection interrupted'); }
  if (finite(values.battery_pct) && values.battery_pct <= 20) { if(severity !== 'critical') severity = 'warning'; reasons.push('Battery reserve is low'); }
  const lastKnownSeverity = severity;
  if ((!timestamps.length || stale) && severity !== 'critical') severity = 'unknown';
  if (stale) reasons.push(observed ? 'Last observation is over five minutes old' : 'No observations received');
  const lng = meta.longitude ?? meta.lng ?? meta.location?.coordinates?.[0];
  const lat = meta.latitude ?? meta.lat ?? meta.location?.coordinates?.[1];
  const coordinates = finite(lng) && finite(lat) && Math.abs(lng)<=180 && Math.abs(lat)<=90 ? [lng,lat] : null;
  return { id, selfBuilt: meta.selfBuilt === true, name: device.name || 'Unnamed box', propertyId: meta.propertyId || id.slice(-6).toUpperCase(), neighborhood: meta.neighborhood || (coordinates ? 'Area not labeled' : 'Location not assigned'), address: meta.address || 'Address not provided', coordinates, severity, priority: PRIORITIES[severity], lastKnownSeverity, stale, confidence: !observed ? 'Unknown' : stale ? 'Last known' : age > 120 ? 'Delayed' : 'Current', observedAt: observed ? new Date(observed).toISOString() : null, lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null, values, reasons: [...new Set(reasons)], evacuation: meta.evacuation || { status: 'unknown' }, type: device.type || 'black-box' };
}
export function areaSummary(properties) {
  return { total:properties.length, critical:properties.filter(p=>p.severity==='critical').length, warning:properties.filter(p=>p.severity==='warning').length, unknown:properties.filter(p=>p.severity==='unknown').length, stale:properties.filter(p=>p.stale).length, reporting:properties.filter(p=>!p.stale).length, powerLost:properties.filter(p=>p.values.mains_power===false).length, water:properties.filter(p=>p.values.water_detected===true || Number(p.values.water_level_mm)>=20).length };
}
