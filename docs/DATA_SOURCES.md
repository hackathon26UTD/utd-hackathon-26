# External data sources

Catalog of public datasets for the HomeBeacon command center, with status as of November 7, 2026 (evening, CT). Keys live only in each person's git-ignored `.env` and in Cloudflare secrets; `npm run access` checks them without printing values. See [API.md](API.md) for our own API and [OPERATOR_LAYERS.md](OPERATOR_LAYERS.md) for the map layers.

Status legend: **Integrated** = used by app code today · **Tested** = endpoint verified from a team machine today · **Untested** = researched, not yet called.

## Live feeds

| Source | What it gives | Key (`.env` name) | Endpoint | Status |
| --- | --- | --- | --- | --- |
| NWS alerts | Active warnings with polygons | none (send a User-Agent) | `https://api.weather.gov/alerts/active?area=TX` | **Integrated** (`functions/api/weather.js`; cached overlay `nws` in `src/feeds.js`) |
| USGS earthquakes | Last-day quakes, GeoJSON | none | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson` | **Integrated** (also cached overlay `quakes`) |
| OpenFEMA declarations | Declared disasters by state | none | `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries` | **Integrated** (also cached overlay `declarations`, county outlines from Census TIGERweb layer 1) |
| USGS water gauges | Live river stage (param `00065`) | none | `https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd=tx&parameterCd=00065&siteStatus=active` | **Integrated** (cached overlay `gauges`, per 0.25 degree tile) |
| ERCOT dashboards | Texas grid supply/demand now | none (unofficial, may change) | `https://www.ercot.com/api/1/services/read/dashboards/supply-demand.json` | Tested |
| EIA Hourly Grid Monitor | Demand/forecast/generation per grid region (ERCOT = `ERCO`) | `EIA_API_KEY` | `https://api.eia.gov/v2/electricity/rto/region-data/data/?frequency=hourly&data[0]=value&facets[respondent][]=ERCO&api_key=` | Integrated as overlay `eia` (needs `EIA_API_KEY` on the server; not yet run with the key) |
| AirNow | Current outdoor AQI by zip or lat/long | `AIRNOW_API_KEY` | `https://www.airnowapi.org/aq/observation/current/ziplatLong?zipCode=75080&format=application/json&api_key=` | Integrated as overlay `airnow` (needs `AIRNOW_API_KEY`; lat/long query form not yet verified with the key) |
| NASA FIRMS | Satellite wildfire hotspots (5000 req / 10 min) | `FIRMS_MAP_KEY` | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/<key>/VIIRS_NOAA20_NRT/<w,s,e,n>/1` | Integrated as overlay `firms` (needs `FIRMS_MAP_KEY` on the server; not yet run with the key) |
| Open-Meteo | Forecast, rain, river-discharge (flood) forecast | none | `https://api.open-meteo.com/v1/forecast`, `https://flood-api.open-meteo.com/v1/flood` | Forecast rain **Integrated** as overlay `weather` (24 h precipitation per geohash5 cell); flood API untested |
| NWS point forecasts | Hourly forecast per location | none | `https://api.weather.gov/points/{lat},{lon}` → forecastHourly | Tested |
| NOAA Water Prediction Service | Official river flood forecasts | none | `https://api.water.noaa.gov/nwps/v1/gauges` | Responds; a bbox query returned no gauges, check parameters |
| NOAA tides (CO-OPS) | Water level / storm surge (coastal demos) | none | `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` | Untested |
| FEMA open shelters (NSS) | Open shelters and capacity | none (ArcGIS) | `https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/FeatureServer/0` (verified Nov 7: Point layer, envelope query works) | **Integrated** (cached overlay `shelters`) |

Gotchas found today:
- **AirNow retired its old endpoints on October 1, 2026.** `/aq/observation/zipCode/current/` and similar return HTTP 410 even with a valid key. Use `/aq/observation/current/ziplatLong` with lowercase `api_key`. Docs require logging in at docs.airnowapi.org.
- **EIA** query params use brackets; with curl pass `-g`. `DEMO_KEY` works for light testing.
- **Overpass (OpenStreetMap)** returned HTTP 406 without a User-Agent header.
- **FIRMS:** Suomi NPP data ended November 2, 2026; use NOAA-20/NOAA-21 VIIRS products.
- **No free live power-outage API exists** (PowerOutage.us is paid; utility outage maps are not official APIs). Our boxes' power-loss readings are the live outage layer.

## Map world-view additions, November 8

- **Wind, sunshine, UV and temperature:** integrated `atmosphere` overlay through the existing authenticated feed cache. Open-Meteo supplies 60 fixed lower-48 model forecast locations at every map zoom. Real upstream and local Pages checks returned 60 usable points. Values retain units and forecast valid time; this is sparse sampling, not continuous coverage or sensor observations. No new key required.
- **Fault lines:** integrated `faults` overlay from the official USGS Quaternary Fault and Fold Database layer 21. Real upstream and local Pages checks returned 91 traces for a bounded Bay Area query. Local zoom and request limits apply. Geological traces are not earthquake predictions or evidence of current movement. No new key required.

See [WORLD_FEEDS.md](WORLD_FEEDS.md) for official sources, cache behavior, request limits and parser evidence; [MAP_WORLD_VIEWS.md](MAP_WORLD_VIEWS.md) for cartography and source-state behavior. The older catalog rows above retain their stated verification date.

## Static datasets (load once into MongoDB)

| Source | What it gives | Access | Status |
| --- | --- | --- | --- |
| FEMA National Flood Hazard Layer | Flood zone per location (100-/500-year) | ArcGIS REST, no key, layer 28 | **Integrated**: teammate `/api/flood/*` and the integration’s live-cached `nfhl` overlay; preserve both until shared caching is reconciled |
| FEMA National Risk Index | Expected annual loss + social vulnerability per hazard, by tract | Download / ArcGIS, no key | Untested |
| CDC/ATSDR Social Vulnerability Index | Elderly, disability, no-vehicle etc. by tract | Download, no key | Untested |
| Microsoft US Building Footprints / OpenAddresses | Real house outlines/addresses for simulated homes | Download, no key | Untested |
| ORNL EAGLE-I | County outage counts every 15 min (2014+) for replaying Uri (2021) / Beryl (2024) | Download, no key | Untested |
| OpenStreetMap via Overpass | Substations, power lines, hospitals, fire stations | No key, needs User-Agent | 406 without UA |
| CMS hospital data | Hospital locations and types | Download, no key | Untested |
| NASA Black Marble (VNP46) | Night lights before/after an outage | Free Earthdata login | Untested |

## Plan: ingest, don't call live

Using every source live would add many failure points during judging and each needs its own parsing. Instead:

1. **Scheduled ingest:** a Cloudflare scheduled job pulls the live feeds every few minutes into MongoDB (one collection per source, with `fetchedAt` and source status).
2. **One-time loads:** a script loads the static datasets (flood zones, risk index, SVI, footprints, shelters, EAGLE-I) into MongoDB with geospatial indexes.
3. **Command center reads only our database,** so it stays fast and still works if a source is down. Stale data is shown with its age, never as current.
4. **Every source is a map toggle;** the pitch uses 3–4 that tell the story.

Priority:
1. Triage drivers: NWS alerts, FEMA flood zones (done: `/api/flood/*`), SVI, building footprints.
2. Context panels: EIA/ERCOT grid, Open-Meteo rain, USGS gauges.
3. Depth layers: FIRMS, AirNow, earthquakes, shelters, EAGLE-I replay, Black Marble.

Ownership: not yet assigned. Ayan owns the HomeBeacon command center UI (`functions/api/weather.js` already serves NWS/USGS/FEMA); coordinate before adding ingest jobs or layers so work does not overlap.

## Credentials summary

| `.env` name | Who has it | Needed for |
| --- | --- | --- |
| `EIA_API_KEY`, `AIRNOW_API_KEY`, `FIRMS_MAP_KEY` | Dhruv (free sign-ups) | Data feeds; add to Cloudflare secrets for production use |
| `MONGODB_URI` | Per-person database user (Dhruv: `dhruv-dev`, readWrite on `utd_hackathon_26`) | Local scripts |
| `MONGODB_ATLAS_CLIENT_ID/SECRET` | Dhruv (service account `hackathon-scripts`, Organization Owner, delete after the event) | `npm run atlas` |
| `API_ADMIN_KEY` | Ayan | Registering devices |
| `CLOUDFLARE_API_TOKEN` | Ayan | Manual deploys only; CI already deploys on merge to `main` |
| `NVIDIA_API_KEY` | not created | Optional Nvidia track |
