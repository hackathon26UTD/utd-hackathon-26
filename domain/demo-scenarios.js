import { exerciseProperties } from './exercise.js';

// Public, fictional snapshots only. This module has no I/O or application credentials.
export const DEFAULT_DEMO_SCENARIO = 'water-hurricane';
export const DEMO_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'normal', label: 'Normal day', description: 'Fictional homes are reporting without active sensor alerts.' }),
  Object.freeze({ id: 'power-outage', label: 'Power outage', description: 'Some fictional homes lose mains power or stop reporting. Missing observations remain unknown.' }),
  Object.freeze({ id: 'water-hurricane', label: 'Water and hurricane', description: 'Fictional water reports and power loss appear alongside an illustrative storm exposure area.' }),
  Object.freeze({ id: 'recovery', label: 'Recovery', description: 'Reporting returns, but earlier water alerts still require human review.' }),
]);

export function isDemoScenario(id) {
  return DEMO_SCENARIOS.some(scenario => scenario.id === id);
}

function circle(center, km, properties) {
  const [lon, lat] = center.map(n => n * Math.PI / 180), distance = km / 6371;
  const ring = [];
  for (let i = 0; i < 96; i++) {
    const bearing = i / 96 * Math.PI * 2;
    const phi = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
    const lambda = lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(phi));
    ring.push([lambda * 180 / Math.PI, phi * 180 / Math.PI]);
  }
  ring.push([...ring[0]]);
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function homes(now) {
  const dallas = exerciseProperties(now).map(home => ({
    id: home.id, name: home.name, area: home.area, coordinates: home.coordinates,
    loss: !home.values.mains_power, water: home.values.water_detected,
    unknown: home.stale, battery: home.values.battery_pct, temperature: home.values.temp_c,
  }));
  // Same 63 Florida locations and event assignments as the approved ui/command/exercise.js fixtures.
  const florida = Array.from({ length: 63 }, (_, i) => ({
    id: `HB-${2001 + i}`, name: `Home ${2001 + i}`, area: 'Florida · hurricane exercise',
    coordinates: [-82.64 + i % 9 * 0.042, 27.83 + Math.floor(i / 9) * 0.043],
    loss: i % 4 === 0 || i % 7 === 0, water: i % 9 === 0, unknown: i % 11 === 0,
    battery: 24 + i * 13 % 72, temperature: 26 + i % 5,
  }));
  return [...dallas, ...florida];
}

export function createDemoScenario(id = DEFAULT_DEMO_SCENARIO, now = Date.now()) {
  if (!isDemoScenario(id)) throw new RangeError('Unknown demo scenario.');
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new RangeError('Invalid demo clock.');
  const issuedAt = new Date(now).toISOString();
  const storm = id === 'water-hurricane', recovering = id === 'recovery', normal = id === 'normal';
  const properties = homes(now).map((home, i) => {
    const stale = !normal && !recovering && home.unknown;
    const powerLost = !normal && !recovering && (home.loss || home.unknown);
    const wet = storm && home.water;
    const reviewRequired = recovering && home.water;
    // A stale critical report stays critical. Reconnection alone never clears the earlier water incident.
    const severity = wet ? 'critical' : reviewRequired ? 'elevated' : stale ? 'unknown' : powerLost ? 'elevated' : 'normal';
    const reasons = [];
    if (wet) reasons.push('Water sensor reported water');
    if (reviewRequired) reasons.push('Water reading is now dry; prior alert still needs review');
    if (powerLost) reasons.push('Mains power lost; backup active');
    if (stale) reasons.push('No recent observations; shown readings are last known');
    if (!reasons.length) reasons.push(recovering ? 'Reporting restored; no active sensor alerts' : 'No active sensor alerts');
    const battery = normal ? 88 + i % 13 : recovering ? Math.min(100, home.battery + 15) : home.battery;
    const observedAt = new Date(now - (stale ? 38 : i % 5 + 1) * 60000).toISOString();
    const values = {
      mains_power: !powerLost, wan_connected: !powerLost, battery_pct: battery,
      water_detected: wet, temp_c: home.temperature,
    };
    return {
      id: home.id, name: home.name, area: home.area, coordinates: [...home.coordinates],
      synthetic: true, source: 'synthetic-demo', scenario: id,
      severity, reasons, observedAt, stale, offline: stale, reviewRequired,
      values,
      sensors: { mains: values.mains_power, wan: values.wan_connected, battery_pct: battery, water: wet, temperature_c: home.temperature },
      risk: { status: severity, priority: { tier: wet ? 'P1' : severity === 'elevated' || stale ? 'P2' : 'P3', label: 'Exercise priority' } },
      incidents: wet || reviewRequired ? [{
        id: `demo-water-${home.id}`, type: 'water', status: 'open', synthetic: true,
        observedAt: new Date(now - 60 * 60000).toISOString(),
        reviewRequired: true,
        note: reviewRequired ? 'A later dry reading does not resolve this exercise incident.' : 'A fictional water report needs review.',
      }] : [],
    };
  });
  const features = storm ? [
    circle([-83.1, 27.7], 180, { name: 'Elevated exposure · exercise', tone: '#ffc86b' }),
    circle([-82.85, 27.8], 95, { name: 'High exposure · exercise', tone: '#ed8f53' }),
    circle([-82.64, 27.9], 38, { name: 'Severe exposure · exercise', tone: '#e56366' }),
  ].map(feature => ({ ...feature, properties: { ...feature.properties, synthetic: true, source: 'synthetic-demo', scenario: id, issuedAt } })) : [];
  const summary = { total: properties.length, normal: 0, elevated: 0, critical: 0, unknown: 0, notReporting: 0 };
  for (const home of properties) {
    summary[home.severity]++;
    if (home.stale) summary.notReporting++;
  }
  return {
    mode: 'synthetic', synthetic: true, issuedAt,
    scenario: { ...DEMO_SCENARIOS.find(scenario => scenario.id === id) },
    scenarios: DEMO_SCENARIOS.map(scenario => ({ ...scenario })),
    properties, summary,
    overlays: { exerciseWind: { type: 'FeatureCollection', features } },
    note: 'All homes, observations and storm areas are fictional. This read-only demo does not contact households, send device commands or access live account data.',
  };
}
