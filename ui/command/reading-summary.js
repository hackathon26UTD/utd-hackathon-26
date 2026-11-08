import {ageText} from './core.js';

// Describe measured inputs only. This does not infer power/Wi-Fi from an upload,
// clear latched incidents, or turn a raw ADC value into a calibrated reading.
export function readingSummary(latest = {}, now = Date.now(), freshMs = 120000) {
  const fields = [
    [['cpu_temp_c'], 'Controller temperature', v => Number.isFinite(v) ? `${Math.round(v * 10) / 10} °C` : null],
    [['mem_avail_mb'], 'Available memory', v => Number.isFinite(v) ? `${Math.round(v)} MB` : null],
    [['wifi_connected'], 'Box Wi-Fi', v => v === true ? 'connected' : v === false ? 'disconnected' : null],
    [['water_detected'], 'Water', v => v === true || v === 1 ? 'detected' : v === false || v === 0 ? 'not detected' : null],
    [['flame', 'fire_flame'], 'Flame sensor', v => v === true || v === 1 ? 'active' : v === false || v === 0 ? 'inactive' : null],
    [['tilt'], 'Tilt switch', v => v === true || v === 1 ? 'triggered' : v === false || v === 0 ? 'not triggered' : null],
    [['temp_c'], 'Temperature', v => Number.isFinite(v) ? `${Math.round(v * 10) / 10} °C` : null],
    [['humidity_pct'], 'Humidity', v => Number.isFinite(v) && v >= 0 && v <= 100 ? `${Math.round(v)}%` : null],
  ];
  return fields.flatMap(([keys, label, format]) => {
    const reading = keys.map(k => latest[k]).find(r => r?.value !== null && r?.value !== undefined);
    if (!reading) return [];
    const value = format(reading.value), at = Date.parse(reading.ts);
    if (value === null) return [];
    const stale = !Number.isFinite(at) || now - at > freshMs || at > now + 30000;
    return [{label, value, stale, note: stale ? Number.isFinite(at) ? `Last reported ${ageText(reading.ts, now)}` : 'Report time unknown' : 'Latest reading'}];
  });
}
