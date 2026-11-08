# API contract

Product-agnostic backend on Cloudflare Pages Functions + MongoDB Atlas, so hardware and software work can start before the product is final. Code: `src/app.js` (router + routes), `functions/api/[[path]].js` (Cloudflare entry). Tests: `npm test`.

Base URL: local `http://127.0.0.1:8788/api` (`npm run dev:local`), hosted `https://<pages-project>.pages.dev/api`.

## Auth

| Caller | Header | Can do |
| --- | --- | --- |
| Admin / backend / scripts | `Authorization: Bearer <API_ADMIN_KEY>` | Everything |
| Device (ESP32, Pi, phone) | `X-Device-Key: dk_...` (from `POST /devices`) | `POST /ingest`, `POST /events` |
| Browser dashboard | none, if `API_PUBLIC_READ=true` | All `GET` routes |

Device keys are shown once and stored only as SHA-256 hashes. Never ship `API_ADMIN_KEY` to a browser or device. Turn `API_PUBLIC_READ` off if data is sensitive.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Pings MongoDB; reports latency and auth config |
| POST | `/setup` | admin | Create indexes (run once after first deploy) |
| POST | `/devices` | admin | `{name, type?, meta?}` → `{device, deviceKey}` |
| GET | `/devices`, `/devices/:id` | read | List / get (with `lastSeen`, `readingCount`) |
| PATCH | `/devices/:id` | admin | `{name?, disabled?, meta?, rotateKey?: true}` |
| POST | `/ingest` | device | Readings: one object, an array, or `{readings: [...]}` (max 500) |
| GET | `/readings` | read | `?deviceId&sensor&since&until&limit(≤1000)&order=asc` |
| GET | `/readings/latest` | read | Latest value per device+sensor, `?deviceId` |
| GET | `/readings/stats` | read | Chart series: `?sensor&deviceId&since&bucket=<sec>` → avg/min/max/n |
| POST | `/rules` | admin | `{sensor, op: > >= < <= == !=, threshold, deviceId?, severity?, message?}` |
| GET / DELETE | `/rules`, `/rules/:id` | read / admin | List / remove rules |
| GET | `/alerts` | read | `?status=open,ack&deviceId&limit` |
| PATCH | `/alerts/:id` | admin | `{status: open\|ack\|resolved, note?}` |
| POST | `/events` | device or admin | `{type: "door.open", data?}` discrete happenings |
| GET | `/events` | read | `?type&deviceId&since&limit` |
| GET / POST | `/store/:collection` | read / admin | Generic JSON docs. `?filter={"status":"open"}&sort=-createdAt&limit&skip` |
| GET / PATCH / DELETE | `/store/:collection/:id` | read / admin | Get, merge-update, delete |

Reading shape: `{"sensor": "temp_c", "value": 4.2, "unit": "C", "ts": "2026-11-07T21:00:00Z"}`. `sensor` matches `[A-Za-z0-9_.:-]{1,64}`; `value` is a number, boolean or short string; `ts` defaults to server time (future timestamps are clamped).

Rules evaluate on every ingest. A matching reading opens one alert per rule+device; further hits increment `count` and update `lastValue` until the alert is resolved.

`/store/<name>` writes to Mongo collection `store_<name>`, so software features (users' items, tasks, scam reports, incident tickets…) need no new backend code. Keys starting with `$`, containing `.`, or named `_id` are dropped; filters allow scalar equality only.

Responses use `id` instead of `_id`. Errors are `{"error": "..."}` with 400/401/404/405/413/503.

## Examples

```sh
B=http://127.0.0.1:8788/api; A="Authorization: Bearer $API_ADMIN_KEY"
curl -X POST $B/devices -H "$A" -H 'Content-Type: application/json' -d '{"name":"Fridge ESP32","type":"esp32"}'
curl -X POST $B/rules   -H "$A" -H 'Content-Type: application/json' -d '{"sensor":"temp_c","op":">","threshold":8,"severity":"critical"}'
curl -X POST $B/ingest  -H "X-Device-Key: $DEVICE_KEY" -H 'Content-Type: application/json' -d '{"readings":[{"sensor":"temp_c","value":9.1,"unit":"C"}]}'
curl "$B/alerts?status=open"
```

Device firmware: [`firmware/`](../firmware/TESTING.md) (box A gateway, box B, Uno Q hub; supersedes the early `clients/esp32/esp32_client.ino` example). Other clients: `clients/python/hack_api.py` (Pi/laptop; `demo` mode streams synthetic anomalies).

## Running it

- `npm ci` then `npm test`: 9 end-to-end tests against an in-memory MongoDB.
- `npm run dev:local`: real Cloudflare runtime + throwaway MongoDB, no Docker or Atlas needed. Admin key `ak_local_dev_only`.
- Against Atlas: put `MONGODB_URI`, `MONGODB_DB`, `API_ADMIN_KEY`, `API_PUBLIC_READ` in `.dev.vars`, then `npm run dev`.
- `npm run keygen` prints a fresh admin key.

## Deploy checklist (Cloudflare Pages)

1. Atlas: create an app database user with `readWrite` on `utd_hackathon_26`. Cloudflare egress IPs are not fixed, so Network Access needs `0.0.0.0/0` (protected by the user's password). This is the usual pattern for serverless; rotate the password after the event.
2. Pages project → Settings → Variables and Secrets: `MONGODB_URI` (secret), `MONGODB_DB`, `API_ADMIN_KEY` (secret), `API_PUBLIC_READ`, optional `CORS_ORIGINS`.
3. Ensure the project has the `nodejs_compat` compatibility flag (from `wrangler.jsonc`).
4. Deploy, then `curl https://<project>.pages.dev/api/health` → `reachable: true`, then `POST /api/setup` once.

## Runtime notes

Each request opens and closes one MongoDB connection (Workers cannot reuse sockets across requests), so expect ~100–300 ms per call to Atlas from the edge. Batch readings (e.g. every 5 s) instead of one request per sample.

## Flood zones (FEMA National Flood Hazard Layer)

Code: `src/flood.js`. Requires a signed-in operator session or the admin key (same as other data routes). FEMA results are cached in MongoDB for 30 days (`flood_zone_cache`, `flood_polygon_cache`, TTL indexes created by `POST /setup`), so repeat lookups are fast and survive FEMA outages. A FEMA failure returns 503 with a plain message.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/flood/zone?lat=&lon=` | FEMA zone at a point → `{risk, zone, subtype, specialFloodHazardArea, baseFloodElevationFt, source, fetchedAt, cached}` |
| GET | `/flood/zones?bbox=w,s,e,n[&include=moderate]` | GeoJSON flood-zone polygons for a map layer (max 0.15° per side; tile larger areas). Default high-risk only; `include=moderate` adds 0.2%-chance and levee areas. Each feature has `properties.risk`. |
| POST | `/flood/homes/refresh[?limit=100&force=true]` | Admin: adds `floodZone` to documents in `homes` (from `location`); skips homes checked in the last 30 days. Changes no other fields. |

`risk` values: `high` (Special Flood Hazard Area, 1% annual chance, zones A/V), `moderate` (0.2% annual chance or levee-protected), `minimal` (zone X), `undetermined` (zone D), `open_water`, `unmapped` (no FEMA map at that point). These are regulatory map designations, not a forecast of current flooding; combine with live water sensors and NWS alerts.

Verified 2026-11-07 against live FEMA + Atlas: Richardson (32.95, -96.73) → minimal; Trinity River levee area (32.76, -96.81) → moderate; a 0.04° box on the Trinity returned 9 zone-AE polygons in under 1 s.

## Production data operations

See [DATA_OPERATIONS.md](DATA_OPERATIONS.md) for source coverage, retention, baselines and board configuration semantics. Operator-only endpoints: GET `/api/ops/data-catalog`, GET `/api/ops/data-history?source=nws`, GET `/api/ops/sensor-stats?id=...&days=7`, GET `/api/ops/location?id=...`, GET `/api/ops/location-image?id=...`, POST `/api/ops/response-preview` with `{deviceId,service}`, and GET/PATCH `/api/ops/device-settings?id=...`. POST `/api/ops/data-refresh` accepts an operator or the dedicated scheduler credential on that exact path. Device-key-only GET/POST `/api/device/settings` reads desired message polling or reports the applied revision. Exercise/demo sessions cannot access production data endpoints.

### Retained box history

`POST /api/device/history-sync` accepts only a registered box's `X-Device-Key`.
It stores finite on-box snapshots separately from live hazard ingest. It never
changes current status, alerts, thresholds or incident resolution.

Body: version `1`, `snapshot:{boot,seq}`, `samples` (1–8 original snapshots),
`metrics` (device-reported learned aggregates) and `overwritten`. See
[DEVICE_HISTORY.md](DEVICE_HISTORY.md) for fields, units and firmware limits.
Unknown observation time is epoch zero with its validity flag clear. The server
keeps it unknown, separately from receipt time. Bodies are streamed with a
16 KiB limit; no client-selected database identity is accepted.

Acknowledgement: `{version:1,accepted:["boot:seq",...],stored:N}`. Exact raw and
aggregate retries do not duplicate records or refresh their timestamps/expiry.
Changed content under an existing identity returns 409 and requires review.
Partial network failures can be retried with the same frozen batch. Local raw
records and aggregate snapshots expire after 365 days; known raw observation
times determine raw expiry. No fabricated missing samples are inserted.

Owners read their linked device through `GET /api/customer/history?id=<linkId>`;
operators use `GET /api/ops/device-history?id=<deviceId>`. Both accept `days=1..365`
for canonical daily summaries. The `local` member includes the latest 64 retained
box samples and latest device-reported aggregate, independent of that summary
range. Demo accounts cannot read live history. Local recorded references and
cloud-qualified references remain distinct and never replace fixed alarms.

### Checking hardware setup access

`npm run provision -- --check` checks the existing admin credential without
creating a home, device or key. Script settings load from environment, then
`.env`, then `.dev.vars`; blank placeholders do not mask later sources. Transfer
an existing admin credential only through a private channel. Do not rotate the
shared production key to fix a missing setting on one laptop. Board headers
contain device keys, never the admin credential.
