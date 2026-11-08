# Risk engine (module A)

Advisory only. It turns box readings into a status per box and per area so a person can decide who to look at first. It never says who is home, whether a building is safe to enter, how much damage there is, what is covered, or who to dispatch.

## Rules that never change

- Missing data is `unknown`, not `normal`.
- A stale critical reading stays `critical`, with "last reported N minutes ago", until a newer fresh reading replaces it.
- A stale watch or elevated reading makes the box `unknown` (priority 70), never `normal`.
- A box silent for more than 15 minutes is `offline`. Offline alone is never `critical` and never `normal`.
- Readings outside the valid range are discarded and logged, never clamped.

## Files

| File | What it holds |
|---|---|
| `src/risk/config.js` | The only place for thresholds, ranges, stale times, priority points and tier cutoffs |
| `src/risk/geo.js` | Geohash, point in polygon, box location, bbox parsing |
| `src/risk/device.js` | `assessDevice` (pure) |
| `src/risk/region.js` | `aggregateRegions`, `applyRegionBoosts`, `followUps` (pure) |
| `src/risk/customer.js` | `customerView` (plain wording for the customer side) |
| `src/risk/load.js` | `loadRisk(db, opts, deps)`: reads Mongo, calls the pure code, stores status changes |
| `functions/api/risk.js` | `GET /api/risk` |
| `test/risk.test.js` | 89 tests (pure logic, loader, endpoint) |
| `test/thresholds.test.js` | Firmware sensor names, duration rules, config/database filter agreement, onset loader |

## Ladder

`unknown < normal < watch < elevated < critical`. The highest triggered rule wins. Each reason has a plain sentence and the readings behind it (sensor, value, time, evidence id, stale flag).

Extra rules beyond the one-sensor table: mains off with battery 30 percent or less is `elevated` (replaces the two separate watch reasons), mains off with temperature at or below 5 C is `elevated` (heating may be out), and water depth rising 5 mm within 10 minutes is `elevated`.

## Duration rules

A rule with `forMin` only matches once the sensor's `sustain` condition has held without a break for that long. The duration runs from the first matching reading after the last non-matching one, up to the latest report (not to now, so a box that went silent is not stretched). The loader finds the start with two indexed lookups per box and sensor currently in that condition (`loadOnsets`); without it the engine uses the readings it was given and says "at least". Reasons from these rules carry `since` and `heldMin`.

| Sensor | Watch | Elevated | Critical |
|---|---|---|---|
| `mains_power` off | any report | 1 hour | 4 hours (USDA refrigerator guidance; medical equipment batteries) |
| `water_raw` (box A, 0 to 4095) | 800 damp | 1500 wet | 1500 wet for 2 minutes |
| `sound_hits` (alarm pattern) | | 6 hits | 6 hits for 2 minutes |
| `tilt` switch (box B) | tipped | tipped for 10 minutes | |
| `temp_c` at or below 0 C | any report | 2 hours (pipes may freeze) | |
| `moisture_pct` at or above 60 | any report | 30 minutes (or 80 at once) | |

Other firmware sensors: `flame` active is critical at once (a missed fire costs more than a false alarm from sunlight); `accel_dev_mg` 500 is watch and 1500 is elevated; `battery_mv` (9 V AA pack) 7200 is watch and 6600 is elevated, and readings under 3000 mV are discarded as a sensor fault. `water_raw` 1500 and `sound_hits` 6 match `WATER_WET_RAW` and `SOUND_HITS_ALARM` in `firmware/box_a/config.h`; recalibrate both together. Motion is never used: it cannot say anyone is home.

Operators see every rule in the command center under Settings, Alert thresholds. That table is generated from `src/risk/config.js`, so it cannot drift from what the engine applies.

## Areas

Boxes group by geohash cell (precision 4, 5 or 6). A cell needs 3 or more boxes to be reported.

- Hot spot: 3 or more boxes at elevated or worse, or 2 critical for the same hazard, or 3 or more that got worse in the last 30 minutes.
- Outage check: at least half offline with last-seen times within 15 minutes of each other is `possible_grid_or_isp_outage`. Anything else offline is `isolated_offline`. Mains reports from reachable neighbors add "mains reports corroborate".
- Boxes in a possible outage cell get +5 priority.

## Priority

Base: critical 100, elevated 60, watch 30, unknown 20 (70 with stale hazard evidence), normal 0. Boosts: evacuation zone +15, FEMA special flood hazard area +10, flood or fire weather alert +10, heavy rain with a water or moisture signal +10. Cap 100. Tiers: P1 80 and up "Review now", P2 40 and up "Check soon", P3 "Routine".

`hasContact` only means a linked customer gave consent, so someone can be called. It does not say anyone is home.

## Endpoint

`GET /api/risk?level=devices|regions&bbox=w,s,e,n&precision=5&device_id=&limit=&mode=exercise`

- Operator or admin key. The demo role is forced to exercise data and writes nothing.
- Returns `{asOf, mode, assessments | regions, followUps, sources, limited}`. `assessments` also carries `truncated`.
- Errors: 400 bad query, 401 not signed in, 404 unknown box, 503 database down.
- Side effect: updates `risk_state` when a box changes status (used for "got worse"). Writes a `reading_discarded` device log once per new bad reading.

## Inputs it expects from other modules

- `readCachedOverlays(db, {bbox, layers, now, exercise, env, cells})` from `src/feeds.js`. Zones, FEMA flood zones, weather alerts and declarations may be GeoJSON features or flat objects. Weather is keyed by geohash5. If the import fails or throws, risk still works with no overlays and `sources.overlays` says why.
- `writeDeviceLog(db, entry)` from `src/live.js`. If missing, discard logging is skipped.
- Collections read: `devices`, `homes`, `readings`, `customer_links`, `device_help`. Written: `risk_state`.

## Known limits

- Latest evidence is searched 14 days back, newest 3 readings per sensor per box, up to 500 boxes per call.
- Weather boosts need cached rain for the box's cell. Without it there is no rain correlation.
- Customer wording is in `src/risk/customer.js` and is the only text customers should see.
