// Read-only acceptance check: API dashboard values must exist in Atlas at the same time/value.
// Uses local operator tooling credentials, never board/browser credentials or synthetic writes.
import { ObjectId } from 'mongodb';
import { env } from './env.mjs';
import { withDatabase } from '../lib/mongodb.js';

const ids = process.argv.slice(2);
const base = new URL(env.API_BASE || 'https://utd-hackathon-26.pages.dev');
const maxAge = Number(env.LIVE_CHECK_MAX_AGE_SECONDS || 120);
if (!ids.length || ids.length > 20 || ids.some(id => !/^[a-f0-9]{24}$/.test(id))) {
  console.error('Usage: node scripts/check-live-devices.mjs <device-id> [device-id ...]');
  process.exit(1);
}
if (base.protocol !== 'https:' || base.username || base.password || !Number.isFinite(maxAge) || maxAge <= 0) {
  console.error('Use an HTTPS API_BASE and a positive LIVE_CHECK_MAX_AGE_SECONDS.');
  process.exit(1);
}
if (!env.API_ADMIN_KEY || !env.MONGODB_URI) {
  console.error('Local API_ADMIN_KEY and MONGODB_URI are required. Do not put them on boards.');
  process.exit(1);
}
try {
  await withDatabase(env, async db => {
    for (const id of ids) {
      const response = await fetch(new URL(`/api/ops/live?device_id=${id}`, base), {
        headers: { Authorization: `Bearer ${env.API_ADMIN_KEY}` },
        redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        console.log(JSON.stringify({ deviceId: id, apiStatus: response.status, passed: false }));
        process.exitCode = 1;
        continue;
      }
      const snapshot = await response.json();
      const device = snapshot.devices?.find(d => d.id === id);
      const entries = Object.entries(device?.latest || {});
      let matched = 0;
      for (const [sensor, reading] of entries) {
        if (!Number.isFinite(Date.parse(reading.ts))) continue;
        const stored = await db.collection('readings').findOne({ deviceId: new ObjectId(id), sensor, ts: new Date(reading.ts), value: reading.value }, { projection: { _id: 1 } });
        if (stored) matched++;
      }
      const latest = Math.max(...entries.map(([, r]) => Date.parse(r.ts)).filter(Number.isFinite));
      const ageSeconds = Number.isFinite(latest) ? Math.round((Date.now() - latest) / 1000) : null;
      const fresh = ageSeconds !== null && ageSeconds >= -300 && ageSeconds <= maxAge;
      const passed = snapshot.mode === 'live' && entries.length > 0 && matched === entries.length && fresh;
      console.log(JSON.stringify({ deviceId: id, mode: snapshot.mode, sensors: entries.map(([s]) => s), matchedInMongo: matched, newestAgeSeconds: ageSeconds, passed }));
      if (!passed) process.exitCode = 1;
    }
  });
} catch {
  console.error('Live connection check failed. Connection details are hidden. Check API availability and private local configuration.');
  process.exitCode = 1;
}
