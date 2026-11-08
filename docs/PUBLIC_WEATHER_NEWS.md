# Public weather and News

Updated November 8, 2026. Ayan requested public hazards, a mainland-only map, less map clutter, smoother radar and continuously refreshed US alerts. This change makes public-source context available in both connected-device views and Simulations. It grants no access to real household records.

## What people see

- **News** in the workspace sidebar: NWS watches, warnings and advisories across the United States. Newest first, 60 cards at a time, with area names, issue/expiry times, expandable official details and Show on map. This is an official weather bulletin feed, not a general newspaper feed or a complete emergency dispatch service.
- **This map area** filters the feed after zoom 7. Automatic boundaries appear at zoom 7; event labels appear at zoom 8. Moving clears the old local overlay while the next area loads. Click a boundary for its event, area and source. Panning dismisses that popup.
- Supplied alert polygons are preferred. Alerts without polygons can use official NWS county, forecast or fire-zone geometry. These are explicitly named as such, not invented storm footprints. Disjoint counties and polygon holes are respected when selecting local results. Unresolved geometry stays marked unavailable or partial; unknown coverage never becomes an all-clear.
- The national list includes US territories and marine bulletins returned by NWS. The map remains focused on the lower 48. An alert outside the mainland map stays readable in News; its button explains that it cannot be shown in this map.
- Hazards no longer require an operator login. Missing provider keys, source failures, stale data and zoom requirements still appear. Simulation device reports and synthetic wind remain labeled separately from live public weather.
- The national fit is the farthest zoom. Resizing recomputes that limit. Panning remains constrained around the mainland. Narrow screens retain a full-country fit instead of cropping away states.
- Zones controls, the floating Map key & sources box and the distance scale are removed from the visible map. Existing private zone records/contracts are preserved. Required OpenFreeMap/OpenMapTiles/OpenStreetMap and active-source credits remain visible below the canvas.

## Refresh, limits and access

`GET /api/public/feeds` returns only public-source status, never operator zone counts. `GET /api/public/overlays?layer=...&bbox=...` uses the existing allowlisted feeds, caches and per-source bounds. `GET /api/public/news` returns a GeoJSON FeatureCollection with provenance, fetched time and stale/partial flags. Add `bbox=west,south,east,north` for a local view (maximum 8 degrees), or `alert=<NWS id>` to resolve a selected alert's boundaries.

Only GET/HEAD pass the anonymous middleware. Device, customer, operator, management, zone-write and model endpoints retain their own authorization. No client-supplied source URL is fetched. Provider credentials stay server-side. Force-refresh query values are ignored. Geographic public layer requests are mainland bounded and capped at 8 degrees, with tighter existing source limits still enforced.

The visible app polls News every 60 seconds and on return to the page. The shared NWS cache refreshes at most every 120 seconds on normal cache hits; this is polling, not an instant push stream. Expired, ended, canceled and test alerts are omitted. Failed refreshes preserve dated saved data and show delay/incomplete status. A blank or failed feed does not establish safety.

Official zone URLs are strictly allowlisted. Up to 200 cached boundary IDs are considered, with at most 16 cache misses fetched per request using four workers. Each upstream call has a nine-second timeout and an eight-MiB response cap; accepted boundary geometry is capped at 500 KB. Boundaries expire after one day in `public_alert_zones`. Larger unresolved requests report partial coverage and may fill in on later refreshes. Requests bearing Cloudflare's client-IP header share a 60-request-per-minute budget across public routes; `public_context_limits` stores a daily digest and minute counter, with a two-minute TTL. It never stores the raw address. Provider/cache quotas remain relevant; this is not a load-test or unlimited-capacity claim.

## Radar playback

NOAA MRMS reflectivity supplies **observed history**, not a rain forecast. The player reads advertised timestamps, keeps the last two hours (maximum 61 frames), starts at the latest frame and autoplays when motion is allowed. Play/Pause, Latest and a keyboard-accessible time slider stay above the map bottom. The displayed timestamp advances only after its tiles are ready.

The map preloads the next two frames in a six-frame cache. A 450 ms crossfade blends actual adjacent observations; it does not invent intermediate radar measurements. Failed frames leave the last complete image visible and show an error. Latest data older than 20 minutes is marked delayed. Reduced motion disables autoplay and fading while keeping manual time selection. Hidden pages stop playback, and map removal clears source listeners and timers. Fine detail remains limited by NOAA's source resolution and network availability.

## Verification

Unit/database coverage: public GET versus private/mutation access, active-alert expiry/cancellation, national caching, county resolution, missing/hostile URLs, boundary fetch limits, stale source fallback, public catalog isolation, viewport constraints, exact area intersections, shared request budget, radar crossfade/failure/prefetch/cache cleanup.

`test/public-weather.browser.mjs [origin]` is a live integration check using actual Argus controls, NWS alerts and NOAA frames. It checks public hazards, News, alert-to-map navigation, radar playback/pause, reduced motion, phone/tablet reflow and scoped Axe checks. It requires available providers and an appropriate current mainland alert. `test/wind-map.browser.mjs` also checks actual MapLibre zoom/pan constraints on desktop and phone. Release evidence is recorded separately in [WORKLOG.md](WORKLOG.md). Provider tests do not establish sensor delivery, physical hardware behavior or full manual accessibility compliance.

## Source references

- [NWS API documentation](https://www.weather.gov/documentation/services-web-api)
- [NWS alerts service](https://www.weather.gov/documentation/services-web-alerts)
- [NOAA GeoServer](https://opengeo.ncep.noaa.gov/geoserver/www/index.html)
- [OpenFreeMap setup and attribution](https://openfreemap.org/quick_start/)
- [OSM attribution placement guidance](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)

## Weather-only map playback (November 8 follow-up)

The floating fictional-device timeline now lives inside **Simulations**. Leaving that setup pauses its clock. The map's Wind and new Rain forecast views instead expose 24 hourly Open-Meteo timestamps, at the existing 60 sampled mainland locations. Selecting or playing a forecast hour updates only the atmosphere map source; device readings, device event history, risk, messages and NWS alerts are not replayed or recalculated. Standalone simulation maps use these real public forecasts too. Only the non-interactive homepage wind illustration remains synthetic.

The atmosphere cache uses `conus-samples-hourly-v2`. Its existing current-hour features remain compatible, adding `rain_mm`; optional `extra.forecastFrames` carries timestamped wind/direction/rain values keyed to the same feature IDs. Requests use `forecast_hours=24`. Rain is the provider's `rain + showers` in mm over the hour ending at the label, excluding snowfall. Missing values stay null. Times, units, coordinates, location ordering and aligned 24-row arrays are validated. Unrelated temperature/UV/solar fields are cleared from a future weather-only frame and restored from the current snapshot when leaving playback. No interpolated weather field or future household condition is invented.

The weather player pauses on view changes, hidden tabs and reduced motion; manual selection remains available. Visible forecast views refresh after 30 minutes or when returning to the tab. Selecting NOAA Rain radar closes forecast playback, since NOAA supplies observed history on a different clock. The two panels never overlap. Future rain forecasts remain separate from observed radar and FEMA flood zones. Provider field definitions: [Open-Meteo hourly documentation](https://open-meteo.com/en/docs).
