// The one place for risk thresholds, units, ranges and staleness (spec section 5).
// Pure data plus tiny predicates. Nothing here does I/O.

export const LEVELS = ['unknown', 'normal', 'watch', 'elevated', 'critical'];
export const levelIndex = (l) => Math.max(0, LEVELS.indexOf(l));
export const maxLevel = (a, b) => (levelIndex(b) > levelIndex(a) ? b : a);

export const OFFLINE_MIN = 15; // silent longer than this means offline (never critical on its own)
export const TREND = { windowMin: 10, waterRiseMm: 5 };
export const REGION = { minDevices: 3, defaultPrecision: 5, precisions: [4, 5, 6], outageSpreadMin: 15, worsenedWindowMin: 30 };
export const SERIES_SENSORS = ['water_level_mm'];
export const LOOKBACK_DAYS = 14; // how far back "last known" evidence is searched

export const ADVISORY = 'Advisory only. A person must review this before any action. It says nothing about who is home, whether a building is safe to enter, damage, coverage or dispatch.';

// Priority scoring.
export const PRIORITY_BASE = { critical: 100, elevated: 60, watch: 30, unknown: 20, normal: 0 };
export const UNKNOWN_STALE_HAZARD = 70;
export const BOOST = { evacuationZone: 15, floodZone: 10, weatherAlert: 10, heavyRain: 10, neighborsOffline: 5 };
export const TIERS = [
  { tier: 'P1', min: 80, label: 'Review now' },
  { tier: 'P2', min: 40, label: 'Check soon' },
  { tier: 'P3', min: 0, label: 'Routine' },
];

const R = (id, level, hazard, test, say, cust) => ({ id, level, hazard, test, say, cust });
const ge = (n) => (v) => v >= n;
const le = (n) => (v) => v <= n;
const isTrue = (v) => v === true;
const isFalse = (v) => v === false;

// kind: bool | num | enum. staleMin: reading is "stale" after this many minutes.
// rules are checked highest level first; the first match is the sensor's reason.
export const SENSORS = {
  mains_power: { kind: 'bool', staleMin: 10, rules: [
    R('mains_off', 'watch', 'power', isFalse, () => 'Mains power was reported off', 'Your box reported that mains power is off'),
  ] },
  battery_pct: { kind: 'num', unit: '%', min: 0, max: 100, staleMin: 15, rules: [
    R('battery_very_low', 'elevated', 'power', le(20), (v) => `Backup battery was reported at ${v} percent`, 'Your box battery is very low'),
    R('battery_low', 'watch', 'power', le(40), (v) => `Backup battery was reported at ${v} percent`, 'Your box battery is getting low'),
  ] },
  power_mode: { kind: 'enum', values: ['normal', 'saver', 'critical'], staleMin: 15, rules: [
    R('power_critical', 'elevated', 'power', (v) => v === 'critical', () => 'The box reported its lowest power mode', 'Your box is running in its lowest power mode'),
    R('power_saver', 'watch', 'power', (v) => v === 'saver', () => 'The box reported power save mode', 'Your box is in power save mode'),
  ] },
  temp_c: { kind: 'num', unit: 'C', min: -40, max: 85, staleMin: 15, rules: [
    R('temp_critical', 'critical', 'fire', ge(55), (v) => `Temperature at the box was reported at ${v} C`, 'Your box reported a very high temperature'),
    R('temp_high', 'elevated', 'fire', ge(48), (v) => `Temperature at the box was reported at ${v} C`, 'Your box reported a high temperature'),
    R('temp_watch_hot', 'watch', 'fire', ge(40), (v) => `Temperature at the box was reported at ${v} C`, 'Your box reported a warm reading'),
    R('temp_watch_cold', 'watch', 'cold', le(0), (v) => `Temperature at the box was reported at ${v} C`, 'Your box reported a freezing temperature'),
  ] },
  humidity_pct: { kind: 'num', unit: '%', min: 0, max: 100, staleMin: 30, rules: [
    R('humidity_high', 'elevated', 'water', ge(90), (v) => `Humidity was reported at ${v} percent`, 'Your box reported very high humidity'),
    R('humidity_watch', 'watch', 'water', ge(75), (v) => `Humidity was reported at ${v} percent`, 'Your box reported high humidity'),
  ] },
  moisture_pct: { kind: 'num', unit: '%', min: 0, max: 100, staleMin: 30, rules: [
    R('moisture_high', 'elevated', 'water', ge(80), (v) => `Moisture at the sensor was reported at ${v} percent`, 'Your box reported a lot of moisture'),
    R('moisture_watch', 'watch', 'water', ge(60), (v) => `Moisture at the sensor was reported at ${v} percent`, 'Your box reported some moisture'),
  ] },
  water_detected: { kind: 'bool', staleMin: 5, rules: [
    R('water_detected', 'critical', 'water', isTrue, () => 'Water was reported at the sensor', 'Your box reported water at its sensor'),
  ] },
  water_level_mm: { kind: 'num', unit: 'mm', min: 0, max: 500, staleMin: 5, rules: [
    R('water_level_critical', 'critical', 'water', ge(20), (v) => `Water depth at the sensor was reported at ${v} mm`, 'Your box reported water depth at its sensor'),
    R('water_level_high', 'elevated', 'water', ge(10), (v) => `Water depth at the sensor was reported at ${v} mm`, 'Your box reported water depth at its sensor'),
    R('water_level_watch', 'watch', 'water', ge(5), (v) => `Water depth at the sensor was reported at ${v} mm`, 'Your box reported a little water at its sensor'),
  ] },
  smoke_alarm: { kind: 'bool', staleMin: 5, rules: [
    R('smoke_alarm', 'critical', 'fire', isTrue, () => 'The smoke alarm input was reported active', 'Your box reported a smoke alarm signal'),
  ] },
  fire_flame: { kind: 'bool', staleMin: 5, rules: [
    R('fire_flame', 'critical', 'fire', isTrue, () => 'The flame sensor was reported active', 'Your box reported a flame sensor signal'),
  ] },
  co_ppm: { kind: 'num', unit: 'ppm', min: 0, max: 1000, staleMin: 5, rules: [
    R('co_critical', 'critical', 'co', ge(150), (v) => `Carbon monoxide was reported at ${v} ppm`, 'Your box reported a high carbon monoxide reading'),
    R('co_high', 'elevated', 'co', ge(70), (v) => `Carbon monoxide was reported at ${v} ppm`, 'Your box reported a raised carbon monoxide reading'),
    R('co_watch', 'watch', 'co', ge(35), (v) => `Carbon monoxide was reported at ${v} ppm`, 'Your box reported a slightly raised carbon monoxide reading'),
  ] },
  pm25_ugm3: { kind: 'num', unit: 'ug/m3', min: 0, max: 1000, staleMin: 30, rules: [
    R('pm25_critical', 'critical', 'air', ge(250), (v) => `Fine particles in the air were reported at ${v} ug/m3`, 'Your box reported very poor air quality'),
    R('pm25_high', 'elevated', 'air', ge(150), (v) => `Fine particles in the air were reported at ${v} ug/m3`, 'Your box reported poor air quality'),
    R('pm25_watch', 'watch', 'air', ge(55), (v) => `Fine particles in the air were reported at ${v} ug/m3`, 'Your box reported reduced air quality'),
  ] },
  voc_index: { kind: 'num', unit: 'index', min: 0, max: 500, staleMin: 30, rules: [
    R('voc_high', 'elevated', 'air', ge(350), (v) => `The gas index was reported at ${v}`, 'Your box reported a high gas index'),
    R('voc_watch', 'watch', 'air', ge(200), (v) => `The gas index was reported at ${v}`, 'Your box reported a raised gas index'),
  ] },
  wan_connected: { kind: 'bool', staleMin: 10, rules: [
    R('wan_down', 'watch', 'connectivity', isFalse, () => 'The box reported no internet connection', 'Your box reported that its internet connection is down'),
  ] },
  rssi_dbm: { kind: 'num', unit: 'dBm', min: -120, max: 0, staleMin: 15, rules: [
    R('rssi_weak', 'watch', 'connectivity', le(-85), (v) => `Wi-Fi signal was reported weak at ${v} dBm`, 'Your box has a weak Wi-Fi signal'),
  ] },
  tilt_deg: { kind: 'num', unit: 'deg', min: 0, max: 90, staleMin: 15, rules: [
    R('tilt_high', 'elevated', 'motion', ge(25), (v) => `The box was reported tilted ${v} degrees`, 'Your box reported that it has been tilted'),
    R('tilt_watch', 'watch', 'motion', ge(10), (v) => `The box was reported tilted ${v} degrees`, 'Your box reported a slight tilt'),
  ] },
  shock_g: { kind: 'num', unit: 'g', min: 0, max: 16, staleMin: 15, rules: [
    R('shock_high', 'elevated', 'motion', ge(4), (v) => `The box reported a jolt of ${v} g`, 'Your box reported a strong jolt'),
  ] },
};

export const SENSOR_NAMES = Object.keys(SENSORS);

// Rules that need two sensors together.
export const COMPOUND = [
  {
    id: 'mains_off_battery_low', level: 'elevated', hazard: 'power', needs: ['mains_power', 'battery_pct'],
    test: (v) => v.mains_power === false && v.battery_pct <= 30,
    say: (v) => `Mains power is off and the backup battery was reported at ${v.battery_pct} percent`,
    cust: 'Mains power is off and your box battery is getting low',
  },
];

export const HAZARD_LABEL = {
  power: 'Power', fire: 'Fire and heat', cold: 'Temperature', water: 'Water', co: 'Air', air: 'Air',
  connectivity: 'Connection', motion: 'Movement', trend: 'Water',
};

// Overlay correlation settings.
export const NWS_EVENT = /flood|fire|red flag/i;
export const ZONE_TYPES_EVAC = ['evacuation'];
