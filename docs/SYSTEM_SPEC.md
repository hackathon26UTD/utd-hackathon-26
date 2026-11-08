# HomeBeacon system spec: live command center, downlink, overlays, risk, customer role

Single source of truth for modules A to E. Advisory only: missing data is unknown, stale last-known critical evidence never turns safe, no occupancy, safe-entry, damage, coverage or dispatch inference, human review required. The server computes; models never run queries. No secret values in code, logs, messages or docs. No em dashes in user-facing copy.

## 0. Conventions

- Stack unchanged: vanilla ESM, Pages Functions, per-request Mongo (`withDb` from `src/db.js`; tests inject `db`). No React, no Vercel.
- Every new endpoint is ONE static file under `functions/api/` and takes ids through query params (`?id=`), never `[param]` folders, so nothing collides with the catch-all `[[path]].js`. Operator-only new endpoints live under `/api/ops/`, `/api/risk`, `/api/overlays`, `/api/feeds`. Device-key endpoints under `/api/device/`. Customer endpoints under `/api/customer/`.
- Errors: `{"error":"plain sentence"}` with 400 invalid, 401 not signed in, 403 wrong role or origin, 404 missing or not yours, 409 conflict, 413 too large, 429 rate limited (`Retry-After`), 503 database or feed unavailable. Always `Cache-Control: no-store`.
- Times are ISO strings. Ids are 24-hex strings. Coordinates are `[lng,lat]`.
- Exercise vs live: every new document carries `exercise:boolean`. Live and operator reads filter `exercise:{$ne:true}`. Demo role reads only `exercise:true` and is read-only. Simulator writes exercise data by default (device `meta.exercise:true`).
- Operator identity in handlers: `context.data.operator.email` (set by middleware), or `"admin-key"` for script calls.
- Device location: `homes.location` via `device.homeId`, else `device.meta.latitude/longitude`. One shared helper `deviceLngLat(device, homesById)` in `src/risk/geo.js`.
- Existing sensors reach the server two ways: PR #14 `/api/beacon/ingest` (5 core fields, untouched) and legacy `/api/ingest` (any `sensor,value,unit`). All extended sensors below use legacy ingest; both land in `readings` (beacon projects there already). Risk reads `readings`.

## 1. Live updates (decision: polling with a since-cursor, 4 s)

Pages Functions are stateless with a new Mongo client per request, so no sockets or SSE. Polling every 4 s (3 to 5 s with jitter, paused when the tab is hidden, backoff to 30 s on errors) costs two or three indexed queries per poll.

`GET /api/ops/live?since=<cursor>&region=<gh5:9vgm0>|bbox=w,s,e,n&device_id=<id>` (operator or demo)
```
{ "cursor":"v1.1731000000000", "serverTime":"...", "reset":false, "mode":"live"|"exercise",
  "devices":[DeviceLive], "helpChanged":[{"deviceId","status","updatedAt"}],
  "messages":[{"id","deviceId","state","updatedAt"}], "incidents":[...], "logs":[LogEntry], "audit":[AuditEntry] }
DeviceLive = { "id","name","lng","lat","lastSeen","offline","latest":{sensor:{value,unit,ts}},
  "risk":DeviceRisk, "link":{"linked":true,"contactName","consent":true}|{"linked":false}, "help":{"status","updatedAt"} }
```
No `since` returns a snapshot (`reset:true`, up to 500 devices, then `limited:true`). The cursor is server time minus 2 s overlap; the client dedupes by `id+updatedAt`. Changed means `lastSeen`, `device_help.updatedAt`, delivery `updatedAt`, incident `updatedAt`, log `at` at or after `since`. `GET /api/ops/device?id=` returns one device in full: 60 min series per sensor, risk, last 50 logs, messages, help history, link.

## 2. Downlink: information boxes

Operators send, devices pull (devices only dial out). Delivery states: `queued` then `delivered` (first pull) then `acked` (device or customer confirms); `expired` (computed lazily when `expiresAt` passes) and `cancelled`.

Message limits (small OLED, 21 chars x 8 lines): `title` 1-20 chars, `body` 0-80 chars, printable ASCII only, no URLs, rejected if it looks like a secret (`dk_`, 32+ hex, "password"). `kind`: `info|condition|instruction`. `severity`: `info|advisory|urgent`. `expiresAt` required, max 7 days, default 6 h. `requiresAck` bool. `customerVisible` bool. Max 5 live messages per device; 30 sends/min per operator. Urgent preempts the display.

Operator endpoints (C):
- `POST /api/ops/messages` body `{"scope":{"type":"device","deviceIds":[..]}|{"type":"region","region":"gh5:..."}|{"type":"bbox","bbox":[w,s,e,n]},"kind","severity","title","body","expiresInMin","requiresAck","customerVisible"}` returns `{"message":{id,...},"deliveries":n}`. Region scopes fan out at send time, server resolved, capped at 200 devices.
- `GET /api/ops/messages?device_id=&state=&limit=` returns messages with per-device delivery states. `DELETE /api/ops/messages?id=` sets `cancelled`.

Device endpoints (header `X-Device-Key`, distinct from sessions):
- `GET /api/device/messages?after=<seq>&limit=3` returns `{"messages":[{"seq","id","kind","severity","title","body","expires_at","requires_ack"}],"cursor":<seq>,"poll_after_s":30}` (10 when an urgent item is open) and marks them delivered.
- `POST /api/device/messages` body `{"message_id","state":"shown"|"acked"}` returns `{"state"}`.
- `POST /api/device/logs` body `{"entries":[{"ts","level":"debug|info|warn|error","code","msg"}]}` max 20 entries, msg 120 chars; returns `{accepted:n}`.

Ingest hook (additive, no edit to `src/beacon.js`): C ships `functions/api/beacon/ingest.js`, a Pages Function that clones the request, calls `handle(request, env)` from `src/app.js`, and on a 202 adds `messages_pending` (int) and `poll_after_s` to the JSON. Every existing field is unchanged and `test/beacon.test.js` is unaffected. ESP32 contract: after each accepted ingest, if `messages_pending > 0` do `GET /api/device/messages`, show, then ack. C documents this in new `clients/esp32/DOWNLINK.md` plus `clients/esp32/downlink_snippet.h` (HOMEBEACON.md untouched).

## 3. Logs

- `device_logs` `{deviceId, at, level, code, msg, source:'device'|'server', exercise}`; TTL 14 days on `at`. Server writes entries for: first/last seen gaps over 15 min, power-save transitions, message delivered/acked, key-auth failures (count only).
- `audit_log` `{at, actor:{type:'operator'|'customer'|'device'|'system', id}, action, deviceId?, region?, details, exercise}`; TTL 180 days. Written by every operator write (message, zone, help status, pairing, link change) and customer claim/unlink. No secrets or passwords in `details`.
- `GET /api/ops/logs?kind=device|audit|all&device_id=&region=&level=&since=&until=&limit=` (limit max 500, newest first) returns `{entries:[...]}`. Telemetry stays at 30 days (PR #14).
- C exports `writeAudit(db, entry)` and `writeDeviceLog(db, entry)` from `src/live.js`; other modules call them.

## 4. Map and overlays

Base: MapLibre with OpenFreeMap vector tiles, `https://tiles.openfreemap.org/styles/liberty` (street names, buildings, to zoom 20+) with the existing positron as a light toggle. Click on a building or point reports nothing about occupancy.

Operator zones (B), collection `overlay_zones`: `{_id, type:'evacuation'|'closure'|'damage_survey'|'staging'|'shelter'|'custom', name(80), note(300), geometry:Point|Polygon|MultiPolygon (max 200 vertices, valid, within lng/lat), active, startsAt, endsAt, createdBy, createdAt, updatedAt, version, exercise}`; 2dsphere index on `geometry`.
`GET /api/overlays?layer=zones&bbox=&type=` GeoJSON; `POST /api/overlays?layer=zones`; `PATCH`/`DELETE /api/overlays?layer=zones&id=` (If-Match style `version` field in body, 409 on stale). Delete is soft (`active:false`) and audited.

External layers via `GET /api/overlays?layer=<id>&bbox=w,s,e,n` returning GeoJSON with a top-level `"hb":{"source","fetchedAt","ageS","stale","truncated"}`. All keyless unless stated; the server fetches and caches, the browser never calls them.

| layer id | upstream | notes |
|---|---|---|
| `nfhl` | FEMA NFHL ArcGIS `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query` (Flood Hazard Zones; verify layer id when building) | bbox, `f=geojson`, `outSR=4326`, fields `FLD_ZONE,SFHA_TF`, offset simplify, min zoom 11 |
| `declarations` | OpenFEMA `DisasterDeclarationsSummaries` plus Census TIGERweb county polygons by FIPS | list plus county highlight |
| `nws` | `api.weather.gov/alerts/active?area=TX` (User-Agent required) | null-geometry alerts listed, not drawn |
| `gauges` | USGS `waterservices.usgs.gov/nwis/iv` bbox, param `00065` | stage point layer |
| `quakes` | USGS all_day GeoJSON | |
| `weather` | Open-Meteo hourly precipitation per geohash5 centroid | feeds risk only, optional heat layer |
| `firms`, `airnow`, `eia` | needs `FIRMS_MAP_KEY`, `AIRNOW_API_KEY`, `EIA_API_KEY` | status `needs_key` if absent; never exposed |
| `shelters` | FEMA NSS open shelters feature service | status `unverified` until probed |

`GET /api/feeds` returns `{"sources":[{"id","name","status":"ok|stale|error|needs_key|unverified","fetchedAt","ageS","ttlS","featureCount","attribution"}]}`. Cache collection `feed_cache` `{_id:"layer:tileKey", layer, tileKey (0.25 degree grid), data, status, fetchedAt, expiresAt}`; TTL by `expiresAt`; data cap 2 MB; on upstream failure serve last cache with `stale:true`, with none return 503 `{error,layer}`. TTLs: nws 2 min, gauges 10, quakes 5, weather 30, nfhl and declarations 24 h.

## 5. Risk classification (A)

Thresholds, units, ranges and staleness live in ONE file `src/risk/config.js`. Readings outside range are discarded and logged, never clamped.

| sensor | unit / range | stale after | watch | elevated | critical |
|---|---|---|---|---|---|
| `mains_power` | bool | 10 min | false | false and battery<=30 | n/a |
| `battery_pct` | 0-100 | 15 min | <=40 | <=20 | n/a |
| `power_mode` | `normal|saver|critical` | 15 min | saver | critical | n/a |
| `temp_c` | -40..85 | 15 min | >=40 or <=0 | >=48 | >=55 |
| `humidity_pct` | 0-100 | 30 min | >=75 | >=90 | n/a |
| `moisture_pct` | 0-100 | 30 min | >=60 | >=80 | n/a |
| `water_detected` | bool | 5 min | n/a | n/a | true |
| `water_level_mm` | 0-500 | 5 min | >=5 | >=10 or rising 5 mm/10 min | >=20 |
| `smoke_alarm`,`fire_flame` | bool | 5 min | n/a | n/a | true |
| `co_ppm` | 0-1000 | 5 min | >=35 | >=70 | >=150 |
| `pm25_ugm3` | 0-1000 | 30 min | >=55 | >=150 | >=250 |
| `voc_index` | 0-500 | 30 min | >=200 | >=350 | n/a |
| `wan_connected` | bool | 10 min | false | n/a | n/a |
| `rssi_dbm` | -120..0 | 15 min | <=-85 | n/a | n/a |
| `tilt_deg`,`shock_g` | 0-90, 0-16 | 15 min | tilt>=10 | tilt>=25 or shock>=4 | n/a |

Device ladder: `unknown < normal < watch < elevated < critical`. Highest triggered rule wins. No readings at all, or every reading stale, with no stale hazard evidence: `unknown`. A stale critical reading keeps `critical` and shows "last reported 40 min ago" until a newer fresh reading replaces it. A device silent over 15 min is `offline:true`; offline alone is never `critical`. Each reason is `{ruleId, level, text, evidence:[{sensor,value,unit,observedAt,evidenceId,stale}]}` where `text` is a plain sentence ("Water was reported at the sensor 12 minutes ago").

Pure API (`src/risk/*.js`, no I/O):
```
assessDevice({device,readings,series,location,link,help}, ctx, now) -> DeviceRisk
  DeviceRisk = {deviceId,status,offline,lastSeen,observedAt,reasons[],correlations[{kind,sourceId,text}],
                priority:{score:0-100,tier:'P1'|'P2'|'P3',label},power:{mains,battery_pct,mode},location,advisory}
aggregateRegions(assessments, {precision:4|5|6, now, worsened:Set<deviceId>}) -> RegionRisk[]
  RegionRisk = {key:'gh5:9vgm0',bbox,centroid,deviceCount,counts:{unknown,normal,watch,elevated,critical},
                offlineShare,outage:'none'|'possible_grid_or_isp_outage'|'isolated_offline',
                hotspot:{is:bool,score,reasons[]},worsened30m:n,correlations[],priority,advisory}
followUps(assessments, limit) -> [{deviceId,tier,score,why,hasContact}]
```
`ctx` (OverlayContext, supplied by B's `readCachedOverlays(db,{bbox,layers,now,exercise})`): `{zones[],nfhl[],nws[],declarations[],weather:{[gh5]:{precip24h_mm,peak_mmph,level:'none|moderate|heavy'}},status}`. Correlation uses point-in-polygon in `src/risk/geo.js` (also exports `geohashEncode/Decode/Bounds`, `pointInGeometry`, `deviceLngLat`).

Region rules (cell needs 3 or more devices, else only per-device output): offline share >=0.5 with last-seen times within 15 min of each other is `possible_grid_or_isp_outage` (text adds "mains reports corroborate" when reachable neighbors report `mains_power:false`); under 0.5 is `isolated_offline`. Hotspot: 3 or more devices at elevated or worse, or 2 critical for the same hazard, or `worsened30m>=3`. `worsened` comes from `risk_state` `{_id:deviceId,status,since,prevStatus,prevAt}`, upserted by the risk endpoint when status changes.

Priority score: critical 100, elevated 60, watch 30, unknown 20 (70 if stale hazard evidence); boosts: inside active evacuation zone +15, NFHL SFHA zone +10, NWS flood or fire polygon +10, heavy rain next 24 h with water or moisture signal +10, neighbors offline +5; cap 100. Tiers: P1 >=80 "Review now", P2 >=40 "Check soon", P3 "Routine". `hasContact` (linked customer with consent) only marks that someone can be called, never occupancy. NVIDIA is optional later and may only explain, never score.

Endpoints: `GET /api/risk?level=devices|regions&bbox=&precision=5&device_id=&limit=` returns `{asOf,mode,assessments|regions,followUps,sources}`.

## 6. Roles and the customer side (D)

Credentials are distinct: device key (`X-Device-Key`), operator cookie `__Host-homebeacon_session` (unchanged), customer cookie `__Host-homebeacon_customer`, provider tokens server-side only. Customer tokens are signed with a key derived from `SESSION_SECRET` plus the label `customer`, role strictly `customer`, 8 h. `readSession` still accepts only operator or demo, so a customer cookie can never reach operator data or get the admin key injected.

Pairing (operator, D): `POST /api/ops/pairing` `{device_id}` returns once `{serial:"HB-7K3Q-9XMD", pairingCode:"482913", qrPayload:"https://<host>/customer#claim=HB-7K3Q-9XMD.482913"}`. Fragment keeps the code out of logs. Stored in `device_pairing` `{_id:deviceId, serial(unique), codeHash(sha256 with salt), claimed, createdAt, exercise}`; code expires on claim and after 30 days.

Customer endpoints (all `/api/customer/*`, same-origin required on writes):
- `POST register` `{email,password(10+),serial,code,contactName,consent}` creates the account and claims in one step. Uniform failure text "Those details do not match an available device." for bad serial, bad code, taken email with wrong password. An existing email with the right password and a valid code just adds the device. Rate limits via `login_attempts`-style windows: 8 per 15 min per IP and 5 per serial. Password hashing via `passwordHash` with a random per-account salt.
- `POST login`, `POST logout`, `GET me`.
- `POST claim` `{serial,code,contactName,consent}` for a signed-in customer adding another device. `DELETE devices?id=` unlinks (audited).
- `GET devices` returns only that customer's links: `{devices:[{id,nickname,status:"normal|needs_attention|urgent|no_recent_signal",statusText,lastSeen,conditions:[{label,text}],messages:[{id,title,body,severity,expiresAt}],help:{status,note,updatedAt}}]}`. `POST messages?id=` acks (sets customer seen).
- Help status (operator, `POST /api/ops/help-status` `{device_id,status,note(140)}`): `none|review_queued|follow_up_assigned|help_on_the_way|resolved`. Only humans set it; nothing automatic; each change audited and kept in `device_help.history`.

Stored PII, minimal: `customer_accounts` `{_id:email, hash, salt, createdAt, passwordChangedAt}`; `customer_links` `{_id, deviceId, customerEmail, contactName(60), nickname(40), consent:bool, consentAt, linkedAt, active, exercise}` (unique on active `deviceId`); `device_help` `{_id:deviceId, status, note, updatedAt, updatedBy, history[]}`. No phone, address or household data. Operators see `link:{linked,contactName,consent}`; the customer email is shown to operators only when `consent:true`. Unlink deletes the contact name.

IDOR rules: customer queries always filter on `customerEmail` from the session and `active:true`; ids from the client are only used inside that filter; foreign or unknown ids return 404; responses are built from an allowlist (no keys, operator notes, audit, other customers, raw readings beyond the conditions list); messages shown only if `customerVisible`; customer text always from A's `customerView(assessment)`.

Middleware (D edits `functions/api/_middleware.js` and `src/operator-session.js` only): order is 1) existing public list plus `/api/customer/register|login` and `GET /api/customer/me`; 2) device-key pass-through when `X-Device-Key` is present: `POST /api/beacon/ingest`, `/api/ingest`, `/api/events`, `GET|POST /api/device/messages`, `POST /api/device/logs`; 3) any other `/api/customer/` path: `context.next()` after deleting any `Authorization` header, handler validates the customer cookie itself; 4) admin key; 5) operator session with admin injection for `/api/ops/*`, `/api/risk`, `/api/overlays`, `/api/feeds`; demo may GET `/api/ops/live`, `/api/ops/device`, `/api/ops/logs`, `/api/risk`, `/api/overlays`, `/api/feeds`, and everything else non-GET is 403. Page `/customer` is public static.

## 7. Collections and indexes (additive)

| collection | indexes |
|---|---|
| `overlay_zones` | 2dsphere `geometry`; `{active,type}` |
| `feed_cache` | TTL `expiresAt`; `{layer,tileKey}` |
| `device_messages` | `{createdAt:-1}`; `{seq}` unique (counter in `counters`) |
| `message_deliveries` | `{deviceId,state,seq}`; `{updatedAt}`; `{messageId}` |
| `device_logs` | TTL `at` 14 d; `{deviceId,at:-1}` |
| `audit_log` | TTL `at` 180 d; `{deviceId,at:-1}`; `{at:-1}` |
| `risk_state` | `_id` |
| `device_pairing` | unique `serial` |
| `customer_accounts`, `customer_links`, `device_help` | `_id`; links: `{customerEmail,active}`, unique partial `{deviceId}` where active |

Each module creates its own indexes in an idempotent `ensure*Indexes(db)` called lazily on first use (same pattern as `ensureIndexes`).

## 8. Simulator (C): `scripts/simulate-device.mjs`

`node scripts/simulate-device.mjs --base http://localhost:8788 --devices 40 --center 32.98,-96.75 --scenario quiet|flood|fire|outage|storm|aqi|mixed --interval 5 [--live]`. Reads `API_ADMIN_KEY` from env by name, never prints it. Defaults to exercise data; `--live` is refused unless also `--yes-this-is-live`. Registers homes and devices, prints pairing serial and code for one device, posts core fields to `/api/beacon/ingest` and extended sensors to `/api/ingest`, emits power-save transitions, drops a cluster offline for the outage scenario, pulls and acks messages, posts device logs.

## 9. Module split and file ownership (exactly five, disjoint)

Each module first writes a stub file (no git commands) with the exported signatures below (15 min), then fills in. Tests run only as `node --test test/<file>.test.js`.

- **A Risk engine.** `src/risk/config.js geo.js device.js region.js load.js customer.js`, `test/risk.test.js`, `functions/api/risk.js`. Exports: pure functions in section 5; `loadRisk(db, {bbox,deviceIds,precision,exercise,now,env})` (reads devices, homes, readings, link and help via direct collection reads, calls B's `readCachedOverlays`, upserts `risk_state`); `customerView(assessment) -> {status,statusText,conditions[]}`.
- **B Feeds and overlays.** `src/feeds.js`, `functions/api/feeds.js`, `functions/api/overlays.js`, `test/feeds.test.js`, new `docs/FEEDS.md`, status-column edits only in `docs/DATA_SOURCES.md`. Exports: `readCachedOverlays(db,{bbox,layers,now,exercise}) -> OverlayContext` (cache only, no network), `refreshLayer(db,env,layer,bbox)`, `loadActiveZones`, `getFeedStatus`, `ensureFeedIndexes`. Fetcher is injectable for tests.
- **C Live, downlink, logs.** `src/live.js`, `src/messages.js`, `functions/api/ops/live.js device.js messages.js logs.js`, `functions/api/device/messages.js logs.js`, `functions/api/beacon/ingest.js`, `scripts/simulate-device.mjs`, `clients/esp32/DOWNLINK.md downlink_snippet.h`, `test/live.test.js messages.test.js`. Exports: `writeAudit`, `writeDeviceLog`, `customerMessages(db, deviceId, now) -> [{id,title,body,severity,expiresAt}]`, `markCustomerSeen(db, deviceId, messageId)`, `createMessage`, `pullForDevice`.
- **D Customer role.** `src/customer.js`, `functions/api/customer/{register,login,logout,me,claim,devices,messages}.js`, `functions/api/ops/pairing.js`, `functions/api/ops/help-status.js`, `public/customer.html`, `ui/customer.js`, `ui/customer.css`, `test/customer.test.js`, edits to `functions/api/_middleware.js` and `src/operator-session.js` (additive `issueCustomerSession`, `readCustomerSession`, `customerCookie`; `readSession` behavior unchanged), and one added entry in `scripts/build-ui.mjs` (`ui/customer.js`, `ui/customer.css`; re-read the file immediately before a minimal edit, marketing owner also edits it). Imports A's `loadRisk`, `customerView` and C's `customerMessages`, `writeAudit`.
- **E Command center UI.** `ui/app.js` (dashboard only; do not touch marketing mounting lines), new `ui/command.css`, additive appended block in `ui/design.css` under `/* command center v2 */` only if unavoidable. Features: street-level map with liberty/positron toggle, overlay panel (toggle, source status, data age, draw/edit/delete zones, type picker), region cells colored by risk with hotspot ring, device panel (readings, risk reasons with evidence, logs tab, messages, link and help-status controls), send-message dialog with 20/80 counters and expiry, region send, polling via `/api/ops/live` every 4 s, "customer linked" badge, stale/unknown never shown green. Degrades gracefully: any 404/503 from a new API shows "not available yet" in that panel and the existing `/api/command-center` path keeps working. Demo mode uses `exerciseProperties()` only and disables writes.

Cross-module dependency order: A geo/config and B `readCachedOverlays` stubs, then C and D, then E consumes JSON only.
