// Deterministic guardrails: cloud inference cannot disable local sensing or alarms.
export const FRESH_MS = 120_000;
export const POWER_PROFILES = Object.freeze({
  normal: { sampleMs: 2000, reportMs: 30_000, wifiRetryMs: 60_000, camera: true, display: true },
  saver: { sampleMs: 2000, reportMs: 120_000, wifiRetryMs: 300_000, camera: false, display: false },
  critical: { sampleMs: 2000, reportMs: 30_000, wifiRetryMs: 60_000, camera: false, display: false },
});

export function freshValue(reading, now) {
  const age = now.getTime() - Date.parse(reading?.observedAt);
  return Number.isFinite(age) && age >= 0 && age <= FRESH_MS ? reading.value : null;
}
const bool = (v) => v === true || v === 1 ? true : v === false || v === 0 ? false : null;

export function devicePolicy(device, now = new Date()) {
  const latest = device.latest || {};
  const value = (k) => freshValue(latest[k], now);
  const mains = device.mainsObservationConflict === true ? null : bool(value('mains_power'));
  const water = bool(value('water_detected'));
  const flame = bool(value('flame'));
  const air = bool(value('smoke_alarm'));
  const oldValue = k => {
    const age = now.getTime() - Date.parse(latest[k]?.observedAt);
    return Number.isFinite(age) && age >= 0 ? latest[k].value : null;
  };
  const lastKnownCritical = bool(oldValue('water_detected')) === true || bool(oldValue('flame')) === true ||
    bool(oldValue('smoke_alarm')) === true || oldValue('sound_hits') >= 6 ||
    (typeof oldValue('temp_c') === 'number' && oldValue('temp_c') >= 55);
  const critical = lastKnownCritical || water === true || flame === true || air === true || value('sound_hits') >= 6 ||
    (typeof value('temp_c') === 'number' && value('temp_c') >= 55) || device.latchedCritical === true || device.criticalObservationConflict === true;
  const mode = critical ? 'critical' : mains === true ? 'normal' : 'saver';
  const wifi = bool(value('wifi_connected'));
  const wan = bool(value('wan_connected'));
  const api = bool(value('api_reachable'));
  const link = wan === true || api === true ? 'uplink_reported' :
    wifi === false ? 'wifi_unavailable' : wifi === true ? 'wifi_only_uplink_unverified' : 'unknown';
  return {
    deviceId: device.id, mode, mains, link,
    reason: device.criticalObservationConflict === true ? 'Latest same-time reports disagree and include a critical observation. Preserve critical functions pending source review.' :
      critical ? 'Current/last-known critical observation or unresolved critical incident; preserve sensing and reporting. Stale evidence needs review.' :
      device.mainsObservationConflict === true ? 'Latest same-time external-power reports disagree; power is unknown. Conserve optional loads pending source review.' :
      mains === true ? 'Recent external-power observation.' : 'External power is lost or unverified; conserve optional loads.',
    ...POWER_PROFILES[mode],
    preserve: ['local_sensor_sampling', 'local_alarm', 'help_button', 'durable_event_log', 'esp_now_receive'],
    transport: link === 'uplink_reported' ? 'Try authenticated delivery; keep until acknowledged.' :
      'Keep recording locally; relay only to a reachable peer. Cloud delivery waits for a working uplink.',
    appliedToHardware: false,
  };
}

// remainingWh must come from a stated estimate/measurement, not an uncalibrated voltage-to-percent map.
export function powerBudget(policies, input = {}, goalHours = 24) {
  if (!Number.isFinite(goalHours) || goalHours < 1 || goalHours > 168) throw new Error('goalHours must be between 1 and 168');
  const budget = input || {};
  const valid = Number.isFinite(budget.remainingWh) && budget.remainingWh > 0 && budget.remainingWh <= 10_000 &&
    ['assumption', 'bench_measurement'].includes(budget.basis) &&
    Object.keys(POWER_PROFILES).every(m => Number.isFinite(budget.loadsWatts?.[m]) && budget.loadsWatts[m] > 0 && budget.loadsWatts[m] <= 1000);
  const reserveFraction = budget.reserveFraction ?? 0.15;
  if (!Number.isFinite(reserveFraction) || reserveFraction < 0 || reserveFraction >= 1) throw new Error('reserveFraction must be in [0, 1)');
  return {
    goalHours, reserveFraction, basis: valid ? budget.basis : 'unknown',
    formula: 'projected hours = remaining Wh × (1 − reserve fraction) / measured or assumed average W',
    warning: 'A projection, not verified endurance. Preserve critical functions even when the goal cannot be met.',
    devices: policies.map(p => {
      // A pack belongs to one box. Never count the same energy separately for every peer.
      const assigned = budget.deviceId ? budget.deviceId === p.deviceId : policies.length === 1;
      const hours = valid && assigned ? budget.remainingWh * (1 - reserveFraction) / budget.loadsWatts[p.mode] : null;
      return { deviceId: p.deviceId, mode: p.mode, projectedHours: hours === null ? null : Math.round(hours * 10) / 10,
        goalMet: hours === null ? null : hours >= goalHours,
        action: hours === null ? 'Measure usable energy and profile current draw.' : hours < goalHours ? 'Add usable battery capacity or reduce optional loads; keep alarms, logging and relay.' : 'Validate this projection with an unplugged endurance test.' };
    }),
  };
}
