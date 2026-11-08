# Production data operations

Ayan's workstream, November 7, 2026 (America/Chicago). Extends the existing team API/database/firmware work, including the redesign from PR #26. No existing collections were renamed, moved or dropped. MongoDB remains authoritative. Provider secrets remain in ignored local environment files, encrypted Cloudflare settings or GitHub secrets, not database documents.

## Organization and retention

`dataset_catalog` labels every known collection by purpose, data kind, source and schema version. Existing unrecognized collections are explicitly classified as requiring review. MongoDB internal bucket collections are left alone. Authentication records are labeled restricted identities rather than treated as sensor datasets.

| Collection | Meaning | Retention / interpretation |
| --- | --- | --- |
| telemetry | Original canonical board observations, with receipt and observation times | Existing 30-day time-series TTL, unchanged |
| readings | Legacy REST measurements plus canonical dashboard projections | Existing collection, preserved; units stay source-specific |
| feed_cache | Latest good public-source result | Each source has its own freshness cadence; stale data keeps its original age |
| source_snapshots | Compressed first successful hourly sample per source/cache tile | 90 days; gzip JSON, not every HTTP response and not a complete historical archive |
| device_daily_stats | Daily observed sensor summaries | 365 days; recent 30 days recomputed hourly to accommodate replay; UTC day boundaries |
| source_registry | Refresh status, cadence, coverage and credential requirements | Latest state, no provider secrets |
| data_job_runs | Real refresh attempts and results | 30 days |
| response_previews | Exact responder-routing demonstration messages | 30 days; never an external message or dispatch |

Raw observation time is not overwritten by a later receipt. Missing fields stay null; boolean means are fractions of reported observations, not time-weighted uptime. Numeric legacy readings are grouped by sensor and supplied unit; booleans have fraction units. Canonical telemetry takes precedence when present to avoid counting projected readings twice.

### What an average means

`GET /api/ops/sensor-stats?id=...&days=7` computes sample mean/min/max/count for recorded observations. Window: 1–30 days. It does not invent expected readings, safety limits, healthy occupancy or a climatological normal. Samples include incidents and changing reporting rates; a simple sample average is not duration-weighted. Fewer than 30 samples or less than 48 hours of coverage is insufficient history. Even a larger sample remains an observed reference, not a calibrated normal.

Canonical daily summaries retain history beyond raw telemetry TTL. Legacy readings remain available through the existing history contract; the daily canonical rollup does not pretend to have converted every historical legacy sensor. Future calibrated baselines need sensor calibration/version, operating mode, season/time-of-day, geography, interval-aware weighting and event exclusions. Climate normals require an identified long-term reference dataset and period, not seven days of device data. Do not average unlike units, river datums, forecasts and observations together.

## Source coverage and refresh

All catalog feeds have backend adapters, refresh state and visible operator source/layer access: FEMA NFHL, FEMA declarations with Census geometry, NWS alerts, USGS gauges, USGS quakes, Open-Meteo rain, FEMA shelters, FIRMS, AirNow, EIA, ERCOT, Open-Meteo river forecast, NWS point forecast, NOAA coastal levels and NOAA river guidance.

The separate `homebeacon-data-refresh` Worker runs every minute. It invokes only `POST /api/ops/data-refresh` using a dedicated secret, not the operator/admin key. Each tick attempts up to three due sources; the registry prevents concurrent leases and records errors/needs-key states. Sources respect their own freshness windows. The browser refreshes visible layers/source state every minute while visible, and the existing observation feed polls independently.

Bounded sources rotate across up to 25 registered live-device home locations. With no live boards, they use the explicitly configured DFW interest box, not fictitious participating homes. Source-wide feeds retain their actual coverage; NWS is configured nationally in production, declarations remain state-scoped, EIA is ERCOT-only, and NOAA tides use two configured coastal stations unless changed. Rotation, API limits and truncation mean this is not complete nationwide household coverage. A successful empty in-area result is distinct from a failed source.

The worker does not manufacture new observations when an upstream is delayed, down, rate-limited or missing its key. “Live” means regularly refreshed source data with visible age, not a guarantee that every upstream publishes continuously. Historical susceptibility, administrative declarations, forecasts and actual sensor observations remain distinct.

### Current credential requirements

At the checked production setup, EIA_API_KEY, AIRNOW_API_KEY, FIRMS_MAP_KEY and GOOGLE_MAPS_API_KEY were absent. Those services remain explicitly unavailable until team keys are supplied. Public feeds were refreshed against real endpoints and stored in Atlas; no fake board telemetry was seeded into production. Google images are not replaced with imagery from a different provider under a Google label.

## Board REST contract

Existing device registration and home assignment remain in `clients/esp32/HOMEBEACON.md`. Use only that board's `X-Device-Key` on board requests. Never put database, operator or provider credentials on the board.

- POST `/api/beacon/ingest`: canonical sensors, stable event ID, original observation timestamp; idempotent retries.
- POST `/api/ingest`: existing generic sensor readings, including additional board sensors and supplied units.
- GET `/api/device/messages?after=...`: queued information boxes, delivery state, recommended `poll_after_s`, and optional requested `configuration` revision.
- POST `/api/device/messages`: existing shown/acknowledged message report. “Delivered” is not “acknowledged.”
- GET `/api/device/settings`: optional desired message-polling configuration.
- POST `/api/device/settings`: report `{revision,pollAfterSeconds}` matching the currently requested revision. A stale/different revision returns 409.
- GET/PATCH `/api/ops/device-settings?id=...`: authenticated operator reads/requests message-poll interval (10–300 seconds). Urgent messages still recommend 10 seconds. This does not remotely change sensor sampling or disable any sensor.

Requested settings remain awaiting-device until the board reports application. Firmware must implement the poll/report path; an API test does not prove real battery, radio, display or physical setting behavior. Boards without connectivity cannot receive a live change. Existing messages remain queued under their existing expiry rules.

## Responder routing and registered location

POST `/api/ops/response-preview` accepts a registered live device ID and an optional recipient type (`fire/rescue`, `medical response`, `utility restoration`, `response liaison`). It builds a deterministic message from registered coordinates and unresolved incident evidence, saves the exact preview, and returns `sent:false` and `dispatchCreated:false`. It chooses a recipient *type*, not an invented emergency organization or guaranteed route. The UI shows and prints the exact message with “NOT SENT” and unknown occupancy/safe-entry status. No email, SMS, call, emergency dispatch or insurance claim is performed.

GET `/api/ops/location?id=...` returns the registered coordinate and Google Maps link. GET `/api/ops/location-image?id=...` requests Google Maps Static satellite imagery server-side only when GOOGLE_MAPS_API_KEY is configured. The key stays off the browser; imagery has no-store headers and its original provider branding. Missing registration returns 409; missing Google access returns 503. Opening the image/link is deliberate. Imagery age is not current disaster evidence.

## Run and verify

```
npm run data -- setup
npm run data -- status
npm run data -- refresh
npm test
npm run build
```

Setup is additive. Refresh writes actual source caches/history and job outcomes, not fake households. Use `npm run dev:local` and isolated MongoDB for fake sensors/browser tests. Deploy Pages before relying on the scheduler endpoint. Worker deployment is defined by `workers/data-refresh.jsonc`; CI uses the separate account-scoped worker token. Provisioning helpers never print secret values. Check actual scheduled job timestamps and production `/api/ready`, not just a successful upload.

Official source references: [Google Maps Static requirements](https://developers.google.com/maps/documentation/maps-static/get-api-key), [Cloudflare cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [NOAA CO-OPS datum/time requirements](https://api.tidesandcurrents.noaa.gov/api/prod), [NOAA river guidance OpenAPI](https://api.water.noaa.gov/nwps/v1/docs/). NOAA river bounding boxes require explicit EPSG_4326 for geographic coordinates; sentinel -999 values are null, not zero.

## Household source checks

The customer household view queries NWS point alerts/forecast and fixed regional publisher feeds through a private bounded cache. It never feeds news into device risk. The data refresh job also has an optional household-email sweep, gated off unless a verified sender and signed callback are explicitly configured. Ayan deferred email setup on November 8; normal refresh continues with household delivery disabled. See [HOUSEHOLD_CONTEXT_ALERTS.md](HOUSEHOLD_CONTEXT_ALERTS.md) for limits and source ages.
