// Explicit administrative operations only; never run automatically on requests.
import { withDb, ensureIndexes, ObjectId } from '../src/db.js';
import { setupBeacon, ingestTelemetry, parseTelemetry, reconcileReceipt } from '../src/beacon.js';
import { sha256Hex } from '../src/auth.js';

const command = process.argv[2];
try {
  if (!['setup', 'seed', 'reconcile'].includes(command)) throw new Error('Usage: beacon-db.mjs setup|seed|reconcile [receipt-id]');
  await withDb(process.env, null, async db => {
    await db.command({ ping: 1 });
    if (command === 'setup') {
      await ensureIndexes(db);
      await setupBeacon(db);
      console.log('Safe Home collections and indexes verified.');
    } else if (command === 'reconcile') {
      if (!process.argv[3] || process.env.BEACON_INGESTION_PAUSED !== 'true') throw new Error('Pause ingestion and set BEACON_INGESTION_PAUSED=true first');
      await reconcileReceipt(db, process.argv[3]);
      console.log('Receipt reconciled; resubmit the original event to finish processing.');
    } else {
      // Caller supplies a local demo key; it is never printed or committed.
      if (!process.env.BEACON_DEMO_DEVICE_KEY || process.env.BEACON_DEMO_DEVICE_KEY.length < 24) throw new Error('Set BEACON_DEMO_DEVICE_KEY to a random local demo-only secret (24+ chars)');
      await ensureIndexes(db);
      await setupBeacon(db);
      for (let i = 1; i <= 3; i++) {
        const homeId = new ObjectId(`beac0000000000000000000${i}`);
        const deviceId = new ObjectId(`beac1000000000000000000${i}`);
        const now = new Date();
        await db.collection('homes').updateOne({ _id: homeId }, { $setOnInsert: {
          label: `Fictional Demo Home ${i}`, simulated: true,
          location: { type: 'Point', coordinates: [-96.75 + i * 0.001, 32.98 + i * 0.001] }, createdAt: now, updatedAt: now,
        } }, { upsert: true });
        await db.collection('devices').updateOne({ _id: deviceId }, { $setOnInsert: {
          name: i === 1 ? 'ESP32 placeholder (not connected)' : `Simulated beacon ${i}`, homeId,
          type: 'esp32', disabled: false, createdAt: now, lastSeen: null,
          keyHash: await sha256Hex(`${process.env.BEACON_DEMO_DEVICE_KEY}-${i}`),
          meta: { exercise: true, propertyId: `DEMO-${i}`, longitude: -96.75 + i * 0.001, latitude: 32.98 + i * 0.001 },
        } }, { upsert: true });
        // All synthetic devices are exercise-only and excluded from the live dashboard.
        if (i > 1) {
          const device = await db.collection('devices').findOne({ _id: deviceId });
          await ingestTelemetry(db, device, parseTelemetry({ device_id: String(deviceId), event_id: 'seed-v1', sequence: 1, water_detected: i === 2, main_power_available: i !== 3 }), String(deviceId));
        }
      }
      console.log('Seeded three fictional homes/devices and two simulated incidents. Repeated runs preserve existing data.');
    }
  });
} catch (e) {
  // Driver messages may contain server addresses or credentials.
  console.error('Database operation failed:', e.name);
  process.exitCode = 1;
}
