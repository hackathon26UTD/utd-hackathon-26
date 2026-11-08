# World-view feeds

Implemented for Ayan's map workstream, November 8, 2026 (America/Chicago). Task 1 of MAP_WORLD_VIEWS.md only. UI integration belongs to the parent workstream. Existing rain parsing, rain thresholds, risk context defaults, generic cache and credentials are unchanged. No production database fixtures or deployments were performed.

## UI contract

Both feeds use the existing authenticated `/api/overlays?layer=...` response: GeoJSON FeatureCollection with `hb` freshness, delivery, refresh status, attribution and coverage. Source rows at `/api/feeds` expose the registered `minZoom` and `coverage` below. Data refresh discovers registrations normally; no separate scheduler or cache implementation was added.

| Feed | UI minimum zoom | Coverage and request limit | Freshness |
| --- | --- | --- | --- |
| `atmosphere` | 3 | 60 fixed lower-48 request locations; one source-wide batch/cache entry; optional bbox filters returned points | 1,800 seconds |
| `faults` | 10 | bbox required; maximum longitude OR latitude span 0.75°; up to 16 quarter-degree tiles | 86,400 seconds |

Fault source metadata includes `coverage.maxSpanDeg: 0.75` and `coverage.maxTiles: 16`. A wide view returns HTTP 400 with `minZoom:10` and `maxSpanDeg:0.75`; zoom alone cannot guarantee the span fits every viewport. Prompt for a closer view when necessary. Atmosphere is `coverage.type: sampled-national`, **not** global. Faults are `requested-area`, not complete national coverage. Source status counts cached tiles/points, not measured land area.

### Atmosphere

One `atmosphere` source supports wind, sunlight, UV and temperature views. Features are Points at the **returned model-grid coordinates**, with stable `atmosphere:<sampleId>` IDs. Requested coordinates and the location label remain in properties. The 60 request locations are 48 lower-48 state capitals plus Dallas–Fort Worth, Houston, Los Angeles, San Francisco, San Diego, Miami, Jacksonville, New York City, Chicago, Seattle, Kansas City and Billings. Exact request coordinates are exported as `ATMOSPHERE_SAMPLES` in `src/world-feeds.js`.

This deliberately sparse, uneven sample supports a national comparison and some regional markers within a bounded request budget. It is not a station network, representative state average or continuous field. No Alaska, Hawaii, territories, oceans or arbitrary zoomed neighborhood coverage is promised. Do not fill gaps, interpolate a heat surface or move a distant point into the visible area. Empty local views mean no sampled coverage.

| Property | Meaning |
| --- | --- |
| `wind_kph` | Model wind speed at 10 m, km/h |
| `wind_direction` | Model direction at 10 m, degrees clockwise from true north **from which** wind blows; source 0–360 preserved |
| `solar_wm2` | Global horizontal shortwave irradiance, W/m², mean over the hour preceding `validAt` |
| `uv_index` | Dimensionless modeled UV index |
| `temperature_c` | Modeled air temperature at 2 m, °C |
| `observedAt` | Always null: these are not instrument observations |
| `validAt` | UTC ISO timestamp converted from upstream hourly Unix seconds; UI label “Forecast valid” |
| `modelRunAt` | Null: this endpoint does not supply model initialization time |
| `dataKind` | `model_forecast` |
| `source`, `sourceUrl` | Open-Meteo provenance |

Never label cache `hb.fetchedAt`, response `generationtime_ms`, or `validAt` as a measurement time. A motion arrow points **toward** `(wind_direction + 180) % 360`; suppress direction for calm/unknown wind as appropriate. `windDirectionConvention` explicitly identifies the convention. The collection's `extra` contains units, requested sample count, missing-value count and sampling description.

The request explicitly selects the five hourly variables, one forecast hour, GMT, Unix seconds, km/h and Celsius. Parser validation checks returned coordinate bounds/proximity, row identity/count, UTC time units and a valid nonfuture timestamp less than two hours old. Unknown/mismatched units, absent measurements, nonnumeric values and negative speed/irradiance/UV become null; valid zero stays zero. Negative Celsius remains valid above absolute zero. Wrong array shapes, malformed locations/times and an entirely unusable batch fail the refresh. Some missing measurements produce `hb.truncated:true` while keeping nulls visible; missing data is never carried forward under a fresh timestamp.

Cache scope is `all` with versioned key `conus-samples-v1`. Panning does not cause additional upstream calls while fresh. One nominal refresh every 30 minutes is 48 batches/day, each containing 60 locations; provider accounting can charge multiple calls per multi-location request. Concurrent misses or explicit forced refreshes can add calls because the existing cache has no new single-flight/rate limiter. The free endpoint is for noncommercial use, requires attribution, and can rate-limit shared infrastructure. No key or alternate commercial endpoint was added. See [Open-Meteo API](https://open-meteo.com/en/docs), [terms and limits](https://open-meteo.com/en/terms), and [NWS direction convention](https://forecast.weather.gov/glossary.php?word=WIND+DIRECTION).

### Faults

Upstream is the official [USGS National Database line layer 21](https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer/21?f=pjson), within the [Qfaults service](https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer?f=pjson). The live service labels its map “2020 Release”; that label is not a current observation date. [USGS database context](https://www.usgs.gov/programs/earthquake-hazards/earthquake-geology) describes its geological purpose.

Features are LineString/MultiLineString, with stable `usgs-fault:<OBJECTID>` IDs. Properties: `name`, `section`, `faultId`, `age`, `slipRate`, `source`, `sourceUrl`, `dataKind: geological`, `observedAt:null`. Missing metadata stays null. Age and slip rate remain supplied category text (for example `historic`, `Greater than 5.0 mm/yr`); no numeric age, recurrence, imminent earthquake or current movement is inferred. An empty successful query means no returned mapped traces, never an all-clear.

Each tile query uses geographic-envelope intersection, input/output EPSG:4326, ordered OBJECTID pagination and `f=geojson`. Geometry is generalized upstream with `maxAllowableOffset=0.001` degrees, so this is regional context, not parcel siting. Returned intersecting traces can extend outside the tile; shared IDs deduplicate in the existing response assembler. No state-specific overlays or fault-area polygons are included.

Limits: 200 features/page, two pages/tile, four concurrent requests, at most 32 requests for a full uncached view. Missing transfer flags on a full page conservatively trigger another page. Remaining pages, repeated IDs, dropped oversized geometry or cache/output caps mark partial coverage. A single trace above 20,000 positions is omitted with partial status; an all-omitted/nonempty page fails. Invalid line structures, coordinates, source errors or unexpected CRS fail the tile. The existing cache additionally bounds each document to 2 MiB, response to 5,000 features, upstream body to 8 MiB and request timeout to nine seconds.

## Failure and cache semantics

No extra cache scope or core changes. Normal responses distinguish `hb.delivery: refreshed|cached` and `hb.refreshStatus: ok|not_requested|error`. Partial data uses `hb.truncated`, and missing fault tiles use `hb.missingTiles`. A failed refresh preserves the previous copy and its original fetched/valid times; an expired copy is stale. Forced-refresh failure before expiry can have `stale:false` with `refreshStatus:error`, so inspect both. Without a usable copy the overlay returns 503; source state is `error` after an attempted failure or `unverified` before the first attempt. Successful empty faults are valid, unlike malformed payloads. The default risk context does not consume either new source.

Stale retention follows the existing cache: six hours for atmosphere, seven days for faults, subject to MongoDB TTL deletion. The source listing does not currently aggregate partial flags across cached documents; the overlay response is the authority for requested-view completeness. The scheduler rotates bounded sources over configured interest areas; registration does not prefetch every fault tile nationally.

## Live evidence and reproduction

Public unauthenticated upstream requests only, with the actual new adapters and existing `makeGet`; no `.env`, provider keys or production DB access. On **2026-11-08 08:13 UTC**:

- Atmosphere: HTTP 200 in about 625 ms; all 60 features, zero missing fields, no truncation; normalized result 33,450 characters. Forecast valid time `2026-11-08T08:00:00.000Z`. First returned model grid `[-86.29702,32.37276]`: 7.6 km/h, from 2°, 0 W/m², UV 0, 7.9°C. Those zeros were present upstream, not defaults.
- Faults: HTTP 200 in about 551 ms for `[-122.5,37.75,-122.25,38]`; 91 line features, no truncation; normalized result 41,970 characters. First feature OBJECTID 79122, Moraga fault, age `undifferentiated Quaternary`, slip rate `Unspecified`.
- Earlier official service inspection confirmed layer 21 is polyline, supports GeoJSON, ordered queries and pagination, with upstream maxRecordCount 2,000. A separate bounded Bay Area query returned 200 features with both top-level and nested transfer-limit flags, verifying actual partial-response shape. Application limits remain lower than upstream limits.

Reproduce without database writes:

```js
import { WORLD_LAYERS } from './src/world-feeds.js';
import { makeGet } from './src/feeds.js';
const now = new Date();
const atmosphere = await WORLD_LAYERS.atmosphere.fetchMany(
  [{ key: 'conus-samples-v1', bbox: null }], { get: makeGet(), now });
const faults = await WORLD_LAYERS.faults.fetchMany(
  [{ key: 'sf', bbox: [-122.5, 37.75, -122.25, 38] }], { get: makeGet(), now });
// Map entries are parsed results or Error objects; inspect before displaying.
```

Targeted verification: `node --test test/world-feeds.test.js test/feeds.test.js test/data-operations.test.js test/risk.test.js` passed all **137 tests**, with no skips. New tests exercise values, units, timestamps, malformed/oversized responses, sampling, pagination, concurrency/bounds and cache success/failure against disposable local MongoDB. Existing precipitation/cache tests run alongside. Live availability is point-in-time evidence, not an uptime guarantee. UI/browser rendering and production deployment are separate parent tasks.

Requested renderer snapshots were fetched again at **2026-11-08 08:15 UTC** through `refreshLayer` into disposable local MongoDB, then saved as complete normalized FeatureCollections with the real `hb`/`extra` envelopes in ignored `work/world-atmosphere-live.json` (60 points) and `work/world-faults-live.json` (91 Bay Area traces). Both refreshes succeeded without truncation. The temporary database was stopped; these files are static verification snapshots, not current feeds, and are not committed or installed in production.
