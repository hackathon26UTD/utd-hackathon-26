# Feeds and overlays (module B)

The server fetches public hazard feeds, keeps them in MongoDB and serves them as GeoJSON. Hazard-feed requests stay server-side; the browser requests basemap imagery/tiles directly from the attributed map provider. Operators also draw their own zones. Everything here is map context. It does not say who is inside a zone, whether entry is safe, or what is damaged.

## Endpoints

All need an operator session or the admin key. Demo may only `GET`, and sees exercise zones only.

| Request | Result |
| --- | --- |
| `GET /api/overlays` | `{layers:[...]}` list of layer ids |
| `GET /api/overlays?layer=zones&bbox=&type=&exercise=1&inactive=1` | Operator zones as GeoJSON. Live by default, `exercise=1` for drills. `inactive=1` includes retired zones. |
| `POST /api/overlays?layer=zones` | Create. Body `{type,name,note,geometry,active,startsAt,endsAt,exercise}`. Returns 201 `{zone}`. |
| `PATCH /api/overlays?layer=zones&id=` | Body must include the `version` last loaded. 409 with `currentVersion` if stale. |
| `DELETE /api/overlays?layer=zones&id=` | Soft delete (`active:false`). Optional `version` in body or query. |
| `GET /api/overlays?layer=<id>&bbox=w,s,e,n` | External layer as GeoJSON, read through the cache. |
| `GET /api/feeds` | `{asOf,sources:[{id,name,status,fetchedAt,ageS,ttlS,featureCount,attribution}]}` plus `keyName`, `minZoom`, `lastError` where they apply. |
| `POST /api/feeds` | `{layer,bbox,force?}` warms one layer. Operator only. |

Every GeoJSON answer has `hb:{source,attribution,fetchedAt,ageS,stale,truncated,tiles,missingTiles}`. `fetchedAt` and `ageS` describe the oldest tile, so a mixed answer shows its worst age. `truncated` is true when any tile was cut, a tile was missing, or the area was clipped. Layers with extra data (grid demand series) return it under `extra`.

Errors are `{error}`: 400 bad input or "Zoom in" (with `layer`, `minZoom`), 403 role, 404 unknown zone, 409 stale version, 429 too many zone changes (`Retry-After`), 503 feed unavailable (`{error,layer}`, plus `status:"needs_key"` when the server key is not set).

## Layers

| id | Source | TTL | Shape | Notes |
| --- | --- | --- | --- | --- |
| `nfhl` | FEMA NFHL MapServer layer 28 | 24 h | polygons `FLD_ZONE,SFHA_TF,ZONE_SUBTY` | Box wider than 0.75 degrees is refused (zoom 11+). Up to 4 pages of 500 per tile; dense tiles come back `truncated`. |
| `declarations` | OpenFEMA plus Census TIGERweb counties (layer 1) | 24 h | county polygons, last 2 years | Statewide declarations have no outline. Outline failure keeps the list. State from `FEEDS_STATE` (default `TX`). |
| `nws` | api.weather.gov active alerts | 2 min | polygons or null geometry | Defaults to `FEEDS_STATE` (`TX`). Set `NWS_SCOPE=national` for the U.S. active-alert feed. Expired alerts are dropped. Alerts without a shape are listed, not drawn. |
| `gauges` | USGS NWIS instantaneous stage (00065) | 10 min | points | |
| `quakes` | USGS all_day | 5 min | points | |
| `weather` | Open-Meteo, 24 h precipitation | 30 min | one point per geohash5 cell | Level `none`, `moderate` or `heavy` (peak 7.6 mm/h or 50 mm/24 h is heavy). Cells with no data stay absent (unknown). |
| `shelters` | FEMA NSS OpenShelters FeatureServer 0 | 10 min | points | |
| `firms` | NASA FIRMS VIIRS NOAA-20 | 15 min | points | Needs `FIRMS_MAP_KEY` on the server. |
| `airnow` | AirNow | 30 min | points | Needs `AIRNOW_API_KEY`. The lat/long query form is not yet verified with a key. |
| `eia` | EIA hourly ERCOT demand | 1 h | no features, `extra.series` | Needs `EIA_API_KEY`. |

Status values: `ok`, `stale` (past its TTL, served anyway), `error` (never fetched and the last try failed), `needs_key`, `unverified` (this deployment has not fetched it yet).

## Cache

`feed_cache` holds one document per `layer:tileKey`. Tile keys are `t:x:y` on a 0.25 degree grid, `gh5:<hash>` for rain, or the state for statewide layers. Fields: `data`, `count`, `truncated`, `fetchedAt`, `freshUntil`, `expiresAt`. Differences from the first spec draft:

- `freshUntil = fetchedAt + TTL` decides stale. `expiresAt` is only the database purge time (10 times the TTL, between 6 hours and 7 days), so the last good copy survives an outage.
- A failed refresh writes `meta:<layer>` with a plain reason. It never contains a URL, so server keys cannot leak.
- One document is capped at 2 MB. Over that, features are cut and `truncated` is set. Output is capped at 5000 features.
- Upstream calls time out at 9 s and answers over 8 MB are refused.

## Zones

Collection `overlay_zones`, 2dsphere on `geometry`. Types: `evacuation`, `closure`, `damage_survey`, `staging`, `shelter`, `custom`. Name up to 80, note up to 300 characters, no control characters. Geometry is a point, polygon or multi polygon with at most 200 points, closed rings, no repeated points, no self crossing, holes inside their shell. A zone is active when `active` is true and now is inside `startsAt`/`endsAt`. Every write goes to `audit_log` (`zone.create`, `zone.update`, `zone.delete`) through `writeAudit`, with a region such as `gh5:9vgm0`. Limits: 60 zone writes a minute per operator, 500 active zones per mode. Demo never sees `createdBy`.

## For the risk engine

```js
import { readCachedOverlays, refreshContext } from '../src/feeds.js';
const ctx = await readCachedOverlays(db, { bbox, layers, now, exercise, env, cells });
// { zones[], nfhl[], nws[], declarations[], weather:{ '9vgm0': {precip24h_mm,peak_mmph,level} }, status:{layer:{status,fetchedAt,ageS,stale,truncated}} }
```

Lists hold GeoJSON features (`geometry`, `properties`). Weather is keyed by the bare five character geohash. `readCachedOverlays` reads the cache only, never throws, and a layer never fetched reports `unverified`; a failed initial fetch reports `error`, which the risk engine must treat as unknown, never as clear. `cells` lets the caller name the geohash5 cells it needs rain for.

Nothing fills the cache by itself. A layer is fetched when the map asks for it, when `POST /api/feeds` runs, or when a caller uses `refreshContext(db, env, {bbox, cells})`, which fetches only expired layers then reads. A scheduled warm-up call every few minutes is the missing piece for headless risk runs.

## Files

`src/feeds.js` (cache, status, context), `src/feed-layers.js` (sources and parsers), `src/feed-geo.js` (bbox, tiles, geohash), `src/feed-error.js`, `src/zones.js`, `src/feeds-api.js` (handlers), `functions/api/overlays.js`, `functions/api/feeds.js`, `test/feeds.test.js`. Tests inject a fake fetcher, so they never touch the network.

## Interface and model context update — November 7

Source metadata includes `coverage`, `note`, `dataState`, and refresh-error information. A valid cached response and a successful new refresh are distinct; a failed refresh does not erase usable older context. Statewide NWS/FEMA cache metadata is scoped to its state, and national NWS uses a separate `US` cache key. EIA is **ERCOT hourly demand**, not household outages. FEMA declaration responses indicate the 400-record cap; omitted geometry is never an all-clear.

The model adapter uses `src/model-context.js` to read cached context only. It sends at most five allowlisted records per source with timestamps, attribution, coverage, and status. Exact home coordinates, household names/addresses, geometry, raw provider errors, credentials and device free text are excluded. The model receives explicit missing/stale/error information and cannot claim those sources were consulted. Context supports explanation; deterministic sensor policies remain authoritative.

The public `GET /api/demo?scenario=normal|power-outage|water-hurricane|recovery` endpoint is separate: 95 fictional homes, no database/environment dependency, no real provider calls, no mutation methods. The command center labels its snapshots and keeps unresolved water incidents visible during recovery.

Optional source keys still need server configuration and provider validation. This update does not certify live coverage, add a scheduled cache warmer, or claim current hazards where upstream geometry is absent.
