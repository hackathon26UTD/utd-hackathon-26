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

// A rule may add `forMin`: it then matches only when the sensor's `sustain` condition has held
// continuously for at least that many minutes, measured up to the latest report.
const R = (id, level, hazard, test, say, cust, forMin) => ({ id, level, hazard, test, say, cust, ...(forMin ? { forMin } : {}) });
// Predicates carry a plain label so the dashboard can list every threshold.
const labelled = (fn, label) => Object.assign(fn, { label });
const ge = (n) => labelled((v) => v >= n, `at or above ${n}`);
const le = (n) => labelled((v) => v <= n, `at or below ${n}`);
const isTrue = labelled((v) => v === true, 'active');
const isFalse = labelled((v) => v === false, 'off');
const TRUE_VALUES = [true, 1, 'true'], FALSE_VALUES = [false, 0, 'false'];
// sustain: the condition whose duration is tracked. `bad` is the same condition as a MongoDB filter
// on the stored reading, so the loader can find when it started. Tests check the two agree.
const sustain = (test, bad) => ({ test, bad });

/** "45 minutes", "2 hours 10 minutes", "3 days". */
export function durationText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'under a minute';
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}${r && h < 6 ? ` ${r} minute${r === 1 ? '' : 's'}` : ''}`;
  return `${Math.floor(h / 24)} days`;
}

// kind: bool | num | enum. staleMin: reading is "stale" after this many minutes.
// rules are checked highest level first; the first match is the sensor's reason.
// Sensor names match what the boxes send: /api/beacon/ingest fields are projected to mains_power,
// temp_c, water_detected, battery_pct and humidity_pct; /api/ingest carries the raw board readings
// (water_raw, flame, tilt, accel_dev_mg, sound_hits, battery_mv).
export const SENSORS = {
  mains_power: { label: 'Mains power', kind: 'bool', staleMin: 10, sustain: sustain(isFalse, { value: { $in: FALSE_VALUES } }), rules: [
    // Four hours: USDA guidance for how long a closed refrigerator keeps food safe without power,
    // and a common runtime for home medical equipment batteries.
    R('mains_off_4h', 'critical', 'power', isFalse, (v, u, d) => `Mains power has been reported off for ${d}`, 'Your box has reported no mains power for several hours', 240),
    R('mains_off_1h', 'elevated', 'power', isFalse, (v, u, d) => `Mains power has been reported off for ${d}`, 'Your box has reported no mains power for over an hour', 60),
    R('mains_off', 'watch', 'power', isFalse, () => 'Mains power was reported off', 'Your box reported that mains power is off'),
  ] },
  battery_mv: { label: 'Backup battery voltage', kind: 'num', unit: 'mV', min: 3000, max: 12000, staleMin: 15, rules: [
    // 9 V pack of six AA cells: about 1.1 V per cell is nearly empty, 1.2 V is getting low.
    R('battery_mv_very_low', 'elevated', 'power', le(6600), (v) => `Backup battery was reported at ${v} mV`, 'Your box battery is very low'),
    R('battery_mv_low', 'watch', 'power', le(7200), (v) => `Backup battery was reported at ${v} mV`, 'Your box battery is getting low'),
  ] },
  battery_pct: { label: 'Backup battery', kind: 'num', unit: '%', min: 0, max: 100, staleMin: 15, rules: [
    R('battery_very_low', 'elevated', 'power', le(20), (v) => `Backup battery was reported at ${v} percent`, 'Your box battery is very low'),
    R('battery_low', 'watch', 'power', le(40), (v) => `Backup battery was reported at ${v} percent`, 'Your box battery is getting low'),
  ] },
  power_mode: { label: 'Power mode', kind: 'enum', values: ['normal', 'saver', 'critical'], staleMin: 15, rules: [
    R('power_critical', 'elevated', 'power', (v) => v === 'critical', () => 'The box reported its lowest power mode', 'Your box is running in its lowest power mode'),
    R('power_saver', 'watch', 'power', (v) => v === 'saver', () => 'The box reported power save mode', 'Your box is in power save mode'),
  ] },
  temp_c: { label: 'Temperature', kind: 'num', unit: 'C', min: -40, max: 85, staleMin: 15, sustain: sustain(le(0), { value: { $lte: 0 } }), rules: [
    R('temp_critical', 'critical', 'fire', ge(55), (v) => `Temperature at the box was reported at ${v} C`, 'Your box reported a very high temperature'),
    R('temp_high', 'elevated', 'fire', ge(48), (v) => `Temperature at the box was reported at ${v} C`, 'Your box reported a high temperature'),
    R('temp_cold_2h', 'elevated', 'cold', le(0), (v, u, d) => `Temperature at the box has been at or below freezing for ${d}, now ${v} C`, 'Your box has reported freezing temperatures for hours; pipes may freeze', 120),
    R('temp_watch_hot', 'watch', 'fire', ge(40), (v) => `Temperature at the box was reported at ${v} C`, 'Your box reported a warm reading'),
    R('temp_watch_cold', 'watch', 'cold', le(0), (v) => `Temperature at the box was reported at ${v} C`, 'Your box reported a freezing temperature'),
  ] },
  humidity_pct: { label: 'Humidity', kind: 'num', unit: '%', min: 0, max: 100, staleMin: 30, rules: [
    R('humidity_high', 'elevated', 'water', ge(90), (v) => `Humidity was reported at ${v} percent`, 'Your box reported very high humidity'),
    R('humidity_watch', 'watch', 'water', ge(75), (v) => `Humidity was reported at ${v} percent`, 'Your box reported high humidity'),
  ] },
  moisture_pct: { label: 'Moisture', kind: 'num', unit: '%', min: 0, max: 100, staleMin: 30, sustain: sustain(ge(60), { value: { $gte: 60 } }), rules: [
    R('moisture_high', 'elevated', 'water', ge(80), (v) => `Moisture at the sensor was reported at ${v} percent`, 'Your box reported a lot of moisture'),
    R('moisture_30m', 'elevated', 'water', ge(60), (v, u, d) => `Moisture at the sensor has stayed at or above 60 percent for ${d}, now ${v} percent`, 'Your box has reported moisture for a while', 30),
    R('moisture_watch', 'watch', 'water', ge(60), (v) => `Moisture at the sensor was reported at ${v} percent`, 'Your box reported some moisture'),
  ] },
  water_detected: { label: 'Water detected', kind: 'bool', staleMin: 5, rules: [
    R('water_detected', 'critical', 'water', isTrue, () => 'Water was reported at the sensor', 'Your box reported water at its sensor'),
  ] },
  // Uncalibrated 12-bit reading from box A. 1500 matches WATER_WET_RAW in firmware/box_a/config.h:
  // recalibrate both together (read dry, then in a cup of water, and pick the midpoint).
  water_raw: { label: 'Water sensor (raw)', kind: 'num', unit: 'raw', min: 0, max: 4095, staleMin: 5, sustain: sustain(ge(1500), { value: { $gte: 1500 } }), rules: [
    R('water_raw_wet_2m', 'critical', 'water', ge(1500), (v, u, d) => `The water sensor has read wet for ${d}, now ${v} raw`, 'Your box has detected water at its sensor for several minutes', 2),
    R('water_raw_wet', 'elevated', 'water', ge(1500), (v) => `The water sensor read wet at ${v} raw`, 'Your box detected water at its sensor'),
    R('water_raw_damp', 'watch', 'water', ge(800), (v) => `The water sensor read damp at ${v} raw`, 'Your box detected dampness at its sensor'),
  ] },
  water_level_mm: { label: 'Water depth', kind: 'num', unit: 'mm', min: 0, max: 500, staleMin: 5, rules: [
    R('water_level_critical', 'critical', 'water', ge(20), (v) => `Water depth at the sensor was reported at ${v} mm`, 'Your box reported water depth at its sensor'),
    R('water_level_high', 'elevated', 'water', ge(10), (v) => `Water depth at the sensor was reported at ${v} mm`, 'Your box reported water depth at its sensor'),
    R('water_level_watch', 'watch', 'water', ge(5), (v) => `Water depth at the sensor was reported at ${v} mm`, 'Your box reported a little water at its sensor'),
  ] },
  smoke_alarm: { label: 'Smoke alarm input', kind: 'bool', staleMin: 5, rules: [
    R('smoke_alarm', 'critical', 'fire', isTrue, () => 'The smoke alarm input was reported active', 'Your box reported a smoke alarm signal'),
  ] },
  fire_flame: { label: 'Flame sensor', kind: 'bool', staleMin: 5, rules: [
    R('fire_flame', 'critical', 'fire', isTrue, () => 'The flame sensor was reported active', 'Your box reported a flame sensor signal'),
  ] },
  // Box B's IR flame module. Sunlight and IR remotes can trigger it, but a missed fire costs more
  // than a false one, so a single report is critical.
  flame: { label: 'Flame sensor (box)', kind: 'bool', staleMin: 5, rules: [
    R('flame', 'critical', 'fire', isTrue, () => 'The flame sensor was reported active', 'Your box reported a flame sensor signal'),
  ] },
  // Loud-sound triggers in the box's sampling window. SOUND_HITS_ALARM (6) in firmware/box_a/config.h
  // is the count that looks like a beeping smoke or CO alarm. Sound is a proxy, not certified smoke sensing.
  sound_hits: { label: 'Alarm sound', kind: 'num', unit: 'hits', min: 0, max: 1000, staleMin: 5, sustain: sustain(ge(6), { value: { $gte: 6 } }), rules: [
    R('alarm_sound_2m', 'critical', 'fire', ge(6), (v, u, d) => `A beeping alarm pattern has been heard for ${d}`, 'Your box has heard an alarm beeping for several minutes', 2),
    R('alarm_sound', 'elevated', 'fire', ge(6), (v) => `A beeping alarm pattern was heard (${v} sound triggers)`, 'Your box heard what sounds like an alarm'),
  ] },
  co_ppm: { label: 'Carbon monoxide', kind: 'num', unit: 'ppm', min: 0, max: 1000, staleMin: 5, rules: [
    R('co_critical', 'critical', 'co', ge(150), (v) => `Carbon monoxide was reported at ${v} ppm`, 'Your box reported a high carbon monoxide reading'),
    R('co_high', 'elevated', 'co', ge(70), (v) => `Carbon monoxide was reported at ${v} ppm`, 'Your box reported a raised carbon monoxide reading'),
    R('co_watch', 'watch', 'co', ge(35), (v) => `Carbon monoxide was reported at ${v} ppm`, 'Your box reported a slightly raised carbon monoxide reading'),
  ] },
  pm25_ugm3: { label: 'Fine particles', kind: 'num', unit: 'ug/m3', min: 0, max: 1000, staleMin: 30, rules: [
    R('pm25_critical', 'critical', 'air', ge(250), (v) => `Fine particles in the air were reported at ${v} ug/m3`, 'Your box reported very poor air quality'),
    R('pm25_high', 'elevated', 'air', ge(150), (v) => `Fine particles in the air were reported at ${v} ug/m3`, 'Your box reported poor air quality'),
    R('pm25_watch', 'watch', 'air', ge(55), (v) => `Fine particles in the air were reported at ${v} ug/m3`, 'Your box reported reduced air quality'),
  ] },
  voc_index: { label: 'Gas index', kind: 'num', unit: 'index', min: 0, max: 500, staleMin: 30, rules: [
    R('voc_high', 'elevated', 'air', ge(350), (v) => `The gas index was reported at ${v}`, 'Your box reported a high gas index'),
    R('voc_watch', 'watch', 'air', ge(200), (v) => `The gas index was reported at ${v}`, 'Your box reported a raised gas index'),
  ] },
  wan_connected: { label: 'Internet connection', kind: 'bool', staleMin: 10, rules: [
    R('wan_down', 'watch', 'connectivity', isFalse, () => 'The box reported no internet connection', 'Your box reported that its internet connection is down'),
  ] },
  rssi_dbm: { label: 'Wi-Fi signal', kind: 'num', unit: 'dBm', min: -120, max: 0, staleMin: 15, rules: [
    R('rssi_weak', 'watch', 'connectivity', le(-85), (v) => `Wi-Fi signal was reported weak at ${v} dBm`, 'Your box has a weak Wi-Fi signal'),
  ] },
  tilt_deg: { label: 'Tilt angle', kind: 'num', unit: 'deg', min: 0, max: 90, staleMin: 15, rules: [
    R('tilt_high', 'elevated', 'motion', ge(25), (v) => `The box was reported tilted ${v} degrees`, 'Your box reported that it has been tilted'),
    R('tilt_watch', 'watch', 'motion', ge(10), (v) => `The box was reported tilted ${v} degrees`, 'Your box reported a slight tilt'),
  ] },
  // Box B's tilt switch: a brief bump is noise, staying tipped suggests the box was knocked over or moved by water.
  tilt: { label: 'Tilt switch', kind: 'bool', staleMin: 15, sustain: sustain(isTrue, { value: { $in: TRUE_VALUES } }), rules: [
    R('tilt_10m', 'elevated', 'motion', isTrue, (v, u, d) => `The box has been reported tipped over for ${d}`, 'Your box has been tipped over for a while', 10),
    R('tilt_switch', 'watch', 'motion', isTrue, () => 'The box was reported tipped over', 'Your box reported that it was tipped over'),
  ] },
  shock_g: { label: 'Jolt', kind: 'num', unit: 'g', min: 0, max: 16, staleMin: 15, rules: [
    R('shock_high', 'elevated', 'motion', ge(4), (v) => `The box reported a jolt of ${v} g`, 'Your box reported a strong jolt'),
  ] },
  // GY-521 deviation from 1 g, in milli-g (docs/HARDWARE.md suggests 1.5 g as the alert line).
  accel_dev_mg: { label: 'Shaking', kind: 'num', unit: 'mg', min: 0, max: 16000, staleMin: 15, rules: [
    R('shake_high', 'elevated', 'motion', ge(1500), (v) => `The box reported strong shaking of ${v} mg`, 'Your box reported strong shaking'),
    R('shake_watch', 'watch', 'motion', ge(500), (v) => `The box reported shaking of ${v} mg`, 'Your box reported some shaking'),
  ] },
};

export const SENSOR_NAMES = Object.keys(SENSORS);
export const SUSTAIN_SENSORS = SENSOR_NAMES.filter((s) => SENSORS[s].sustain);

// Rules that need two sensors together.
export const COMPOUND = [
  {
    id: 'mains_off_battery_low', level: 'elevated', hazard: 'power', needs: ['mains_power', 'battery_pct'],
    label: 'Mains power off and backup battery at or below 30 percent',
    test: (v) => v.mains_power === false && v.battery_pct <= 30,
    say: (v) => `Mains power is off and the backup battery was reported at ${v.battery_pct} percent`,
    cust: 'Mains power is off and your box battery is getting low',
  },
  {
    id: 'mains_off_cold', level: 'elevated', hazard: 'cold', needs: ['mains_power', 'temp_c'],
    label: 'Mains power off and temperature at or below 5 C',
    test: (v) => v.mains_power === false && v.temp_c <= 5,
    say: (v) => `Mains power is off and the temperature at the box was reported at ${v.temp_c} C, so heating may be out`,
    cust: 'Mains power is off and your home is getting cold',
  },
];

/** Plain rows for the dashboard's threshold reference: one per rule, highest level first per sensor. */
export function thresholdTable() {
  const rows = [];
  for (const [sensor, c] of Object.entries(SENSORS)) {
    for (const r of c.rules) {
      const cond = c.kind === 'enum' ? `reports ${r.id.replace(/^power_/, '')} mode` : r.test.label ? `${r.test.label}${c.unit && c.kind === 'num' ? ' ' + c.unit : ''}` : 'matches';
      rows.push({ sensor, label: c.label || sensor, ruleId: r.id, level: r.level, hazard: r.hazard, when: cond, forMin: r.forMin || 0, staleMin: c.staleMin });
    }
  }
  for (const c of COMPOUND) rows.push({ sensor: c.needs.join(' + '), label: 'Combined', ruleId: c.id, level: c.level, hazard: c.hazard, when: c.label, forMin: 0, staleMin: null });
  return rows;
}

export const HAZARD_LABEL = {
  power: 'Power', fire: 'Fire and heat', cold: 'Temperature', water: 'Water', co: 'Air', air: 'Air',
  connectivity: 'Connection', motion: 'Movement', trend: 'Water',
};

// Overlay correlation settings.
export const NWS_EVENT = /flood|fire|red flag/i;
export const ZONE_TYPES_EVAC = ['evacuation'];
