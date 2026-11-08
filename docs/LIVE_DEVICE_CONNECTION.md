# Real boxes to the live dashboard

Verified November 8, 2026, Ayan integration workstream. No fictional observations were submitted.

## Physical path

Box A and Box B use Dhruv's laptop gateway (`scripts/boxes-to-dashboard.mjs`). It reads serial frames, selects each box's own private key and sends HTTPS requests to production. Do not start competing uploaders. Box B currently supplies mesh presence, not environmental measurements.

The Uno Q hub uses `scripts/uno-to-dashboard.mjs --hub-adb` to sample its Linux controller over USB. CPU temperature is not room temperature. The Mac must remain awake, attached and online. Standalone Q internet access is not verified.

Each uploader sends its own X-Device-Key. The API stores readings in MongoDB Atlas. An authenticated operator opens `/dashboard`, which routes to `/command-center` and polls `/api/ops/live`. Customer pairing remains separate. Master API credentials and MongoDB credentials must never go on boards or into browser code.

| Device | Registered ID | Received measurements |
| --- | --- | --- |
| Box A | `6af078ec0c50e80b3a8af30c` | Water, flame, mains power, mesh; older tilt/raw readings retain their own times |
| Box B | `6af078ee0c50e80b3a8af30e` | Mesh presence only |
| Uno Q hub | `6af08de410eb36e804a787ed` | CPU temperature, load, available memory, uptime, Wi-Fi state |

The Q has its registered UT Dallas location. Existing Connected Wi-Fi cards are labeled presentation previews. Actual Q Wi-Fi was false. Inspect Sensors and timestamps for measured evidence.

## Repeatable read-only check

Use approved private local API_ADMIN_KEY, MONGODB_URI and MONGODB_DB:

```sh
node scripts/check-live-devices.mjs 6af078ec0c50e80b3a8af30c 6af078ee0c50e80b3a8af30e 6af08de410eb36e804a787ed
```

Every dashboard reading must match a stored row with the same device, sensor, timestamp and value. The command writes no telemetry and prints no secrets or measured values. Exit zero requires live mode, matching rows and at least one observation within 120 seconds for every requested device. LIVE_CHECK_MAX_AGE_SECONDS changes this diagnostic window, not product thresholds. A fresh heartbeat does not make every sensor fresh. Also verify rendering and automatic polling in a signed-in browser.

For new boxes, use [onboarding](ONBOARDING.md) and [dashboard rollout](DASHBOARD_ONBOARDING.md): one private key and serial per box, intended home assignment, measured uploads, then this check with the new ID. No duplicate database adapter is required.

## Open delivery issue

Production Cloudflare tail directly recorded `exceededCpu` and HTTP503 on both `/api/ingest` and `/api/beacon/ingest`. Account subscriptions show no Workers Paid subscription. The [free CPU limit is 10ms per request](https://developers.cloudflare.com/workers/platform/limits/). [Workers Paid starts at $5/month plus usage above its allowance](https://developers.cloudflare.com/workers/platform/pricing/). Pages Functions use Workers billing. Approval for a recurring charge was requested; no subscription change was made.

The Q accepted 15 consecutive fresh samples, then returned503 at 16:48:58 UTC and stopped. A/B continued reporting, but uninterrupted delivery is not established. Readiness success does not prove ingestion continuity.

Never blindly retry legacy `/api/ingest`: unacknowledged writes may already exist. Never assign a new event ID to retry canonical telemetry. Reserved receipts need paused-ingestion reconciliation described in [MongoDB architecture](mongodb-architecture.md). Inspect stored rows/receipts before resuming with fresh observations. Do not clear critical history or rotate keys to fix CPU limits.

After the CPU issue is resolved, verify sustained physical uploads, repeat the check and observe signed-in dashboard refreshes. Record provider changes and runtime evidence in WORKLOG. Until then, the Q uploader remains stopped instead of replaying uncertain writes.
