import { ObjectId } from 'mongodb';

// Used only by the disposable local demo/QA runner. No provider or production access.
export async function seedNemotronReviewFixture(db, now = new Date()) {
  const scenarios = [
    { key: 'water', label: 'Exercise · water and power', values: { water_detected: true, mains_power: false, wifi_connected: false, queue_depth: 12, battery_mv: 8000 }, secondsAgo: 20 },
    { key: 'flame', label: 'Exercise · unconfirmed flame signal', values: { flame: true, temp_c: 22, mains_power: true, wifi_connected: true, api_reachable: true }, secondsAgo: 15 },
    { key: 'stale', label: 'Exercise · old critical observation', values: { water_detected: true, mains_power: false }, secondsAgo: 3600 },
    { key: 'routine', label: 'Exercise · recent reports', values: { water_detected: false, flame: false, mains_power: true, wifi_connected: true, api_reachable: true }, secondsAgo: 10 },
    { key: 'unknown', label: 'Exercise · no sensor reports', values: {}, secondsAgo: null },
  ];
  const devices = {}, homeIds = {};
  for (const [index, scenario] of scenarios.entries()) {
    const deviceId = new ObjectId(`beac1000000000000000000${index + 1}`);
    const homeId = new ObjectId(`beac0000000000000000000${index + 1}`);
    devices[scenario.key] = String(deviceId); homeIds[scenario.key] = String(homeId);
    const observedAt = scenario.secondsAgo === null ? null : new Date(now.getTime() - scenario.secondsAgo * 1000);
    const coordinates = [-96.75 + index * .005, 32.98 + index * .002];
    await db.collection('homes').insertOne({ _id: homeId, label: scenario.label, simulated: true, location: { type: 'Point', coordinates }, createdAt: now });
    await db.collection('devices').insertOne({ _id: deviceId, homeId, name: scenario.label, type: 'esp32', disabled: false,
      lastSeen: observedAt, keyHash: crypto.randomUUID(), meta: { exercise: true, propertyId: `NEMOTRON-QA-${index + 1}`, longitude: coordinates[0], latitude: coordinates[1] } });
    const readings = Object.entries(scenario.values).map(([sensor, value]) => ({ deviceId, sensor, value, ts: observedAt,
      receivedAt: scenario.key === 'stale' ? new Date(now.getTime() - 5_000) : observedAt }));
    if (readings.length) await db.collection('readings').insertMany(readings);
    if (['water', 'stale'].includes(scenario.key)) await db.collection('incidents').insertOne({ deviceId, homeId, type: 'flood', severity: 'critical', status: 'open', simulated: true, detectedAt: observedAt, lastObservedAt: observedAt });
  }
  return { devices, homeIds, label: 'SYNTHETIC EXERCISE — no physical measurements' };
}
