# Live updates, downlink messages, logs and simulator (module C)

Spec: `docs/SYSTEM_SPEC.md` sections 1 to 3 and 8. Advisory only; missing data is unknown.

## Live polling

`GET /api/ops/live?since=<cursor>&region=gh5:9vgm0|bbox=w,s,e,n&device_id=<id>` (operator or demo). No `since`, or one older than 30 minutes, returns a snapshot with `reset:true` (up to 500 devices, `limited:true` beyond). Later polls return only devices, help changes, deliveries, incidents, logs and audit rows changed at or after the cursor, which is server time minus 2 seconds. Clients dedupe by `id` plus `updatedAt`, poll every 4 s, pause when hidden and back off to 30 s on errors.

A device that goes silent changes nothing in the database, so devices that crossed the 15 minute offline line inside the window are included too.

Extras beyond the spec: `sources.risk` is `ok` or `unavailable` (risk is `null` when module A is not deployed or fails); operators may add `mode=exercise` to read exercise data; demo is always exercise and read-only.

`GET /api/ops/device?id=` returns the device in full: latest values, 60 minute series (120 points per sensor), risk, link, help with history, last 50 logs, last 20 messages, open incidents.

## Downlink

Operators: `POST /api/ops/messages`, `GET /api/ops/messages?device_id=&state=&limit=`, `DELETE /api/ops/messages?id=`. Devices: `GET|POST /api/device/messages`, `POST /api/device/logs` (see `clients/esp32/DOWNLINK.md`).

- States: queued, delivered, acked, expired (computed when read, written lazily), cancelled.
- Limits: title 20, body 80, printable ASCII, no links, no secret-looking text, 5 live per device, 30 sends per minute per operator (429 with `Retry-After: 60`), region or box sends cap at 200 devices (`truncated:true`). Devices with 5 live messages are skipped and listed in `skipped`.
- Exercise and live are separate: an operator in live mode cannot message an exercise device and the reverse.
- Customer side: `customerMessages(db, deviceId, now)` and `markCustomerSeen(db, deviceId, messageId)` in `src/messages.js`. Only `customerVisible` messages. A read confirms the message only when the operator asked for confirmation.

## Logs and audit

`device_logs` (14 days) and `audit_log` (180 days). `GET /api/ops/logs?kind=device|audit|all&device_id=&region=&level=&since=&until=&limit=` newest first. Other modules call `writeAudit(db, entry)` and `writeDeviceLog(db, entry)` from `src/live.js`; both never throw and strip credential-looking keys and text. Rejected device keys are only counted per hour in `audit_log` (`device.key_rejected`).

## Ingest hooks (the additive change)

`src/beacon.js` and `test/beacon.test.js` are untouched. Two new Pages Functions, `functions/api/beacon/ingest.js` and `functions/api/ingest.js`, call the unchanged `handle()` and, on a 202, add `messages_pending` and `poll_after_s` to the JSON. They also write server device logs for first report, return after 15 minutes of silence, and power mode changes (legacy `power_mode` readings). Other statuses and bodies pass through unchanged. `functions/api/ingest.js` goes beyond the spec's single wrapper because power mode only arrives through legacy ingest.

## Simulator

`API_ADMIN_KEY=... node scripts/simulate-device.mjs --base http://localhost:8788 --devices 40 --center 32.98,-96.75 --scenario mixed --interval 5`
Scenarios: quiet, flood, fire, outage, storm, aqi, mixed. Exercise data by default; `--live --yes-this-is-live` is required for live data. `--once` or `--ticks N` stops after N rounds. It prints a pairing serial and code for device 1 when `/api/ops/pairing` exists, and shows and acknowledges any messages it receives.

## Tests

`node --test test/live.test.js test/messages.test.js test/simulate.test.js`
