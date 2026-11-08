# MAP V2 SPEC (single source of truth for builders S, M, D)

Branch feat/map-v2. Vanilla JS ESM + CSS, esbuild, MapLibre, Cloudflare Pages Functions, MongoDB. No React/Next/Vercel. Builders never run git add/commit/stash/checkout/reset/merge; the lead commits. Do not touch ui/marketing*, public/index.html, firmware. API changes are additive only. No em dashes in user-facing copy. Never print secrets.

## 0. Product rules (all builders)
- Missing data is unknown. Stale last-known critical evidence keeps its tier and is labeled last-known; never downgraded to safe.
- Never infer occupancy, safe entry, damage probability, insurance coverage, dispatch. Banned words in generated copy: occupied, safe (except "unsafe" never), damage, dispatch, coverage.
- Every datum shows source and age. Demo/exercise data is labeled "Exercise" and never mixed with live. Demo role is read-only.
- The model never queries or mutates data. The server computes; the model only words an already-computed snapshot. Model output is labeled "Model output, unverified", lists evidence ids and limits, says "Human review required". When not configured, show the deterministic text and "Model not configured".
- WCAG 2.2 AA: keyboard, visible focus, 24px min targets, reduced motion, 320px reflow.
- Use vendored kit parts (window.Kit: toolbarDropdown, buttonMenu, filterButton, select, tickBox, toggle, segs, pickOne, confirm, sectionBox) and tokens from ui/kit/theme-homebeacon.css. No lookalike controls.

## 1. Ownership (disjoint files)
- S: src/place.js, functions/api/ops/place.js, src/timeline.js, functions/api/ops/device-timeline.js, functions/api/_middleware.js (only S edits it), test/place.test.js, test/timeline.test.js, docs/API.md section.
- M: ui/command/geo.js (new, constants), ui/command/map.js, ui/command/toolbar.js (new), ui/command/place-card.js (new), ui/command/overlays.js, ui/command/map.css (new), minimal hooks in ui/command/index.js marked `// MAP-V2`. M is the only editor of index.js until integration.
- D: ui/command/detail.js, ui/command/workflow.js (new), ui/command/explain.js (new), ui/command/drawer.css (new), dialogs.js only if needed.
- Integrator: adds `@import`/imports of map.css and drawer.css in ui/command.css or ui/app.js, runs build.

## 2. Shared constants: ui/command/geo.js (M owns; others import)
```js
export const CONUS_BOUNDS = [[-126.5, 23.5], [-65, 50.5]];       // maxBounds
export const CONUS_FIT = [[-124.9, 24.4], [-66.8, 49.5]];        // initial fit, Keys to Maine
export const CONUS_API_BOX = { minLat: 24.3, maxLat: 49.6, minLon: -125.1, maxLon: -66.8 }; // matches server validation
export const MIN_ZOOM = 3, MAX_ZOOM = 18, FIT_TO_MAX_ZOOM = 16;
export function clampBbox([w,s,e,n]) -> [w,s,e,n] | null          // intersect with CONUS_API_BOX; null if empty
export function inConus(lat, lon) -> boolean
export const PLACE_ENDPOINT = '/api/ops/place';
export const TIMELINE_ENDPOINT = '/api/ops/device-timeline';
```
S duplicates the numbers in src/place.js (server cannot import ui code); a test asserts both match by regex on geo.js.

## 3. Map engine (M)
- `MapView` constructor: `maxBounds: CONUS_BOUNDS`, `minZoom: 3`, `maxZoom: 18`, `renderWorldCopies:false`. Startup `styleKey:'street'` (near-white), `fitBounds(CONUS_FIT, {padding})` with no maxZoom cap. `fitNational` uses CONUS_FIT. Alaska and Hawaii cannot be panned to.
- STYLES: remove `satellite` as a base. Keys: `street` (OpenFreeMap positron, default), `topo` (USGSTopo raster, opaque, alternate base, source maxzoom 16, attribution "USGS The National Map"), `streetTerrain` (positron plus hillshade overlay). Liberty may remain as `streetColor` only if the toolbar lists it; satellite and USGSImageryTopo are forbidden everywhere.
- Raster overlays added in `install()` below the first symbol layer, `visibility:none` by default: `ov-hillshade` (USGSShadedReliefOnly, opacity 0.45) and `ov-hydro` (USGSHydroCached). Source maxzoom 16, tileSize 256. Toggle with `setLayoutProperty`. install() re-applies current toggle state on every style.load from `this.viewState`.
- Zoom reaches street/house level (vector tiles overzoom past z14).
- Data requests (overlays, /api/risk, /api/layers bbox) pass through `clampBbox`; skip when null.
- Add missing paint entries for `nwps`, `weather`, `ercot`, `river_forecast`, `nws_forecast`, `tides` so none fall back to grey.
- Drop AK/HI features client-side from nws, declarations, airnow, shelters (state not in lower 48 or point outside CONUS_API_BOX).
- MapView public API additions:
  - `setBase(key)`, `setOverlayVisible(id, bool)`, `getViewState()` -> `{base, overlays:{id:bool}}`
  - `onPlaceHover(cb({lngLat, point, hit}))`, `onPlaceLeave(cb())`, `onPlaceClick(cb({lngLat, point, hit}))`, `onDeviceClick(cb(deviceId))`, `onMoveStart(cb())`. `hit` is the existing priority-ordered `hit()` result (device, group, zone, region, overlay) or null for bare map.
  - `projectToScreen(lngLat)`, `fitConus({animate})`, `flyTo/fitTo` unchanged (fitTo maxZoom <= 16).
  - Hover is throttled (rAF, 120 ms dwell before firing onPlaceHover; devices fire immediately).
- Device click: `onDeviceClick(id)` -> index.js calls `window`-free ctx hook `ctx.drawer.openDevice(id)` (section 6). The old floating `#detail` card and connector are retired for devices; region/zone cards keep using detail.js shell (D keeps region rendering).
- The default MapLibre popup is not used for place info; place-card.js replaces it.

## 4. Top bar (M): `ui/command/toolbar.js`
`export function mountToolbar({ root, map, ctx }) -> { destroy, sync(state), setBusy(bool) }`.
- Host: `<div id="map-bar" class="kit mapbar" role="toolbar" aria-label="Map views and layers">` inserted as first child of `.map-wrap`, `position:absolute; top:0; left:0; right:0; height:44px; z-index:12`. It sits directly under the main top bar (`.cc-hub`, height `var(--topbar-size)`, z-index 30) because `.map-wrap` starts below it; in map-only vertical shell M offsets with `top: var(--topbar-size)` if the map container spans full screen. Map controls (zoom, attribution, scale) shift down 8px under it. Notice and draw bar move to `top: 52px` / unchanged bottom. Horizontal scroll on narrow screens (`overflow-x:auto`, no wrap, snap), pop-outs render at body level (kit default).
- Retire: `.map-tools` buttons (#quick-weather, #quick-wind, power, water, layers, find devices, national-view, create view) and the base-map radios in #overlay-panel. Their IDs may be preserved on equivalent controls where index.js binds them; M updates the bindings. #overlay-panel keeps only zones management and legend.
- Controls, left to right (all state mirrored via `sync` and persisted to `localStorage` in try/catch for per-viewer view only):

| Control | Kit part | Content | Behavior |
|---|---|---|---|
| View | `Kit.toolbarDropdown` ariaLabel "Base map" | Street (default), Topographic, Streets + terrain | `map.setBase`; label shows current choice |
| Fit | `Kit.buttonMenu` text "Go to" | Lower 48, Find devices, My area (if saved) | `fitConus`, open devices list |
| Layers | `Kit.filterButton` label "Layers" | `Kit.tickBox` groups: Risk areas, Operator zones, Hillshade, Hydrography | on count badge via `kitSet({on})` |
| Hazards | `Kit.filterButton` label "Hazards" | tickBox rows: Weather alerts, Flood zones, Gauges, Quakes, Fire hotspots, Air quality, Power grid, Disaster declarations. Each row shows source chip and age from `overlayNote`/`SOURCE_STATUS_TEXT`; "Needs key" rows disabled with reason | toggles overlays in `ctx` overlay state (existing overlays.js logic) |
| Reports | `Kit.toggle` x2 | Power loss, Water reports | existing filters |
| Time | `Kit.toolbarDropdown` "Last 24 hours" | 1h, 6h, 24h, 72h | lookback for quakes/fires/devices history only if server param supported; otherwise control omitted (do not fake) |
| Ask / Views | `Kit.buttonMenu` text "Ask" | "Ask about this map" (opens existing /api/layers dialog flow in dialogs.js), "Create view", saved views list | model entry; shows "Model not configured" note when `/api/ops/agent` config says not configured; demo shows saved views only |

- The tickBox `onChange` calls into overlays.js exported `setOverlay(ctx, id, on)`; toolbar never owns fetching.
- Keyboard: Tab order left to right, each kit part handles arrows/Esc; focus returns to the trigger on close. Roving not required.
- `ctx.toolbar.sync({base, overlays, filters})` is called by overlays.js and index.js after state changes so the bar never drifts.

## 5. Place card (M): `ui/command/place-card.js`
`export function mountPlaceCard({ map, ctx, mapEl }) -> { show(lngLat, {pinned}), hide(), isPinned(), destroy }`.
- DOM: `<div id="place-card" class="pc kit" role="dialog" aria-modal="false" aria-label="Conditions at this place" tabindex="-1">`, absolutely positioned in `.map-wrap`, z-index 13 (above toolbar 12, below drawer 20), max width 340px, max-height 60% with scroll, placed beside the pointer, flipped to stay within `.map-wrap`, never under the toolbar.
- Data: `GET /api/ops/place?lat=&lon=` (5 decimals, only inside CONUS; otherwise show "Outside the lower 48" without a request). AbortController cancels in-flight request on move or new target. Client cache by rounded lat/lon (4 decimals) for 60 s. Nearby devices and regional risk shown only from the response. Demo role: endpoint returns exercise devices only.
- Layout: header (place name, county, state, mode chip "Live" or "Exercise", asOf age). "What stands out" list (`standsOut`, deterministic). Sections as compact rows, each: label, value, source chip, age. Section statuses render: ok, stale (amber "Out of date"), none ("Checked, none found"), unknown ("Unknown"), not_cached ("Not loaded yet"), needs_key ("Needs <KEY NAME>"), not_applicable, error ("Source unavailable"). `not_cached` is never rendered as none. Footer lists `limits` and the advisory sentence.
- "What stands out here (model)" button appears only when `ctx.agent.configured` and role is operator/admin; it calls `POST /api/ops/place-summary` is NOT built in this phase, so button is hidden unless D/S add the route; default is the deterministic list only. Acceptable v1: omit the button, show "Model help is available from a device view."
- Interaction rules:
  - Hover (mouse pointer): after 250 ms dwell on map or an overlay/device feature, show transient card. Card disappears when the pointer leaves both the map target and the card (150 ms grace), on map move start, zoom, Esc, or click elsewhere. Moving onto the card keeps it open.
  - Click pins the card until dismissed (Esc, close button, click elsewhere, map drag/zoom). A pinned card stays while the pointer moves off. Clicking a device does NOT show the place card; it opens the drawer.
  - Keyboard: map container is focusable; arrow keys pan (MapLibre default). `Enter` on the focused map shows the card for map center and pins it; Esc closes and returns focus to the map. Card has a visible close button, receives focus when pinned, focus trap not used (non-modal).
  - Touch: tap shows a pinned card; tap elsewhere or drag hides it. No hover on touch (`pointerType` check).
  - Screen reader: card content is in an `aria-live="polite"` region updated once per load; "Loading conditions" state announced; errors announced.
  - Reduced motion: no fade or slide, instant show/hide.
- Class prefix `pc-`. CSS lives in map.css.

## 6. Device drawer (D)
Module surface exported from detail.js: `export function mountDetail(ctx)` returns `{ openDevice(id, {tab}), closeDevice({restoreFocus}), openRegion(key), render }` (existing region/zone API retained). index.js binds `map.onDeviceClick(id => ctx.drawer.openDevice(id))` and list selection to the same call; `ctx.closeDetail` delegates to `closeDevice`.
- Layout: `<aside id="device-drawer" class="dr" role="dialog" aria-modal="false" aria-labelledby="dr-title">` fixed on the right of the map area: `width: clamp(520px, 66vw, 1100px); max-width: 100%`, top below top bar, bottom 0, z-index 20. Under 760px viewport: full screen (`inset:0`, header sticky with Back/Close). Focus moves to the title on open, returns to the originating marker or list row on close. Esc closes. Map remains visible and interactive behind the left third; map `padding.right` is set so the selected device stays centered in the visible area.
- Structure (kit `sectionBox`, tabs via kit sub-tabs): header (device label, status pill, mode chip Exercise/Live, last seen age, close). Tabs: **Conditions** (default), **Workflow**, **Sensors**, **Logs**, **Messages**, **Customer**, **AI**-assisted blocks are inside Conditions (below), not a separate floating box.
- Conditions tab (plain sentences from `timeline.conditions`, falls back to client deterministic text from `/api/ops/device` if timeline unavailable): headline; "What we see"; "Why it matters"; "How fresh"; "What we do not know"; "What a person should do next"; advisory line. Then `explain.js` blocks.
- Sensors: latest per sensor with units and age, sparklines (existing `readingRows`, `sparkline`), history. Logs, Messages, Customer link, help-status form reuse existing code (write controls disabled in demo with title "Exercise mode is read only").
- Class prefix `dr-`; CSS in drawer.css. Drawer width and breakpoints exactly as above.

### 6.1 Workflow view: `ui/command/workflow.js`
`export function mountWorkflow({ root, ctx }) -> { update(timelineJson), destroy, selectNode(id) }`.
- Renders SVG (no graph library). Nodes are rounded rects with title, status dot + text (not color alone), last timestamp, counts, evidence count, and `source` badge (Recorded, Derived, Not recorded). Edges are SVG paths with arrowheads; the `risk_ladder -> message_help` edge is dashed with label "human only".
- Layout: fixed left-to-right two-row snake of 8 nodes, node 200x96, gap 48; viewBox computed; pan by drag, zoom by wheel/pinch and buttons (+, minus, Fit), clamped 0.4 to 2.5. Keyboard: canvas `tabindex=0` role="application" aria-label; arrow keys pan, +/- zoom, 0 fits; each node is a focusable `<g role="button" tabindex="0">` with aria-label "Node name, status, last update, N events"; Enter/Space selects; Left/Right arrow moves between nodes in order.
- Selecting a node filters the event log under the canvas to `events[nodeId]`; selecting again or "Show all" clears. Selection is highlighted with a 3px outline.
- History timeline: slider (Kit.slider) plus Step back, Step forward, Play/Pause, Speed (1x, 4x) controls over `events` sorted by `at`. Scrubbing sets a cursor time; node status/counts displayed are those computed from events with `at <= cursor` (client recomputes counts from events; status shown as "as of cursor" and the live status stays in the node detail). Playing is manual only, honors `prefers-reduced-motion` (no animated edge flow; Play steps events without transitions, and the default is paused). Live region announces "Event N of M: text".
- Unknown stays unknown: nodes `local_record` and `gateway_mesh` display "Not reported to the cloud" with a dashed border, never green.
- Edge case states: loading skeleton, error with retry, `coverage.truncated` banner "Showing the most recent N events".
- Class prefix `wf-`.

### 6.2 AI placement: `ui/command/explain.js`
`export function mountExplain({ root, ctx, deviceId }) -> { destroy }`.
- Blocks in Conditions tab: "Explain these conditions" and "Suggest a follow-up" buttons. Click to run, never auto-run. Calls `POST /api/ops/agent` (existing contract) with `{deviceId, mode:'explain'|'follow_up', engine: exercise ? 'simulator' : 'nemotron', requestId}`; D reads `GET /api/ops/agent` for `nvidia.configured` once per drawer open. If a mode field is not supported by the existing endpoint, D uses the existing request shape unchanged and labels the result by the checkpoint fields only (additive only; no server change by D).
- Result card: heading "Model output, unverified" (or "Simulator output, not AI" for `simulator_not_ai`), body = `checkpoint.interpretation` / `nextAction`, then "Evidence" chips from `evidenceIds`, "Source data as of" `sourceGeneratedAt`, "Limits" (budget/policies), "Human review required". `hardwareApplied:false`, `messagesSent:false` stated. 429 shows "Try again in a minute" (4 runs per minute per operator).
- Not configured: show "Model not configured" and keep the deterministic conditions text. Demo: buttons hidden, note "Model help needs an operator sign-in".
- Class prefix `ex-`.

## 7. Endpoints (S)

### 7.1 GET /api/ops/place?lat=&lon=
Auth: middleware; add `/api/ops/place` and `/api/ops/device-timeline` to `DEMO_GET`. Operator/admin see live plus exercise devices; demo sees exercise devices only, never live homes. Params: lat, lon numbers, max 5 decimals; CONUS box (lat 24.3 to 49.6, lon -125.1 to -66.8) else 422; Census returns no geography (Canada, Mexico, ocean) 422. 400 bad params, 405 non-GET, 429 with `Retry-After` (60/min per actor, 300/min global upstream-hitting), 503 only if DB unreachable; upstream failure never fails the request (that section becomes `error` with safe reason, no URLs or keys). `Cache-Control: no-store`.
```json
{ "asOf":"2026-11-07T18:00:00Z", "query":{"lat":32.7767,"lon":-96.797}, "mode":"live",
  "place":{"name":"Dallas","county":"Dallas County","countyFips":"48113","state":"TX","timeZone":"America/Chicago","elevationM":137,"source":"US Census, Open-Meteo"},
  "sections":{
    "weatherNow":{"status":"ok","source":"NWS KDAL","fetchedAt":"...","ageSeconds":420,"items":[{"label":"Temperature","value":21.0,"unit":"C"}]},
    "alerts":{"status":"ok","source":"NWS","fetchedAt":"...","ageSeconds":90,"items":[{"event":"Flood Watch","severity":"Moderate","ends":"..."}]},
    "floodZone":{"status":"unknown","source":"FEMA NFHL","reason":"Unmapped is not the same as low risk","items":[]},
    "gauges":{"status":"ok","source":"USGS","items":[{"id":"...","name":"...","distanceKm":11,"stageFt":4.2,"trend":"unknown"}]},
    "fires":{"status":"needs_key","source":"NASA FIRMS","reason":"Needs FIRMS_MAP_KEY","items":[]},
    "shelters":{"status":"not_cached","source":"cache","reason":"Tile not loaded yet","items":[]},
    "devices":{"status":"ok","source":"HomeBeacon","items":[{"id":"hb-...","label":"...","distanceM":420,"tier":"watch","status":"normal","lastSeenAgeS":35,"exercise":false}]},
    "regionalRisk":{"status":"none","note":"No regional summary (fewer than 3 boxes)","items":[]} },
  "standsOut":[{"text":"Flood Watch active until 6 PM CT (NWS, 2 min old)","sectionId":"alerts","severity":"watch"}],
  "limits":["Shelters not loaded yet","Flood zone unknown"] }
```
Section ids: weatherNow, forecast, alerts, floodZone, gauges, riverForecast, tides, quakes, fires, airQuality, shelters, declarations, devices, regionalRisk, zones. Status: ok | stale | none | unknown | not_cached | needs_key | not_applicable | error. Device items: `{id,label,distanceM,tier,status,lastSeenAgeS,exercise}`, no customer fields. `loadRisk` called with `readOnly:true`. Cache in `place_cache` (TTL index `expiresAt`, stale-on-error): Census 30d, NFHL 30d, NWS grid 7d, forecast 30m, observation 10m, alerts 2m, Open-Meteo 15m (0.05 deg key), flood 1h, USGS 10m, tides 10m; devices and risk never cached. Each section 4 s abort, 6 s overall budget, parallel. NWS observations older than 3 h are stale. Use Open-Meteo elevation (not EPQS). Alerts come live from `alerts/active?point=` (state caches are not national). Counts and stand-out sentences are templates only.

### 7.2 GET /api/ops/device-timeline?id=&hours=
Operator/admin only plus demo for exercise devices (read from exercise data only); `hours` default 24, max 72; respects mode; no-store. Reuses `getDeviceDetail`, `loadSystemEvidence`, receipts, `incident_events`, deliveries.
```json
{ "version":1,"mode":"live","deviceId":"hb-1","generatedAt":"...",
  "window":{"since":"...","until":"..."},
  "conditions":{"headline":"","what":[""],"why":[""],"freshness":"","unknown":[""],"nextSteps":[""],"advisory":""},
  "nodes":[{"id":"cloud_ingest","label":"Cloud ingest","order":4,"status":"ok","lastAt":"...","counts":{"events":12,"delayed":0},
    "evidence":[{"id":"receipt:...","kind":"receipt","at":"..."}],"source":"recorded","note":""}],
  "edges":[{"from":"observation","to":"local_record","kind":"flow"},{"from":"risk_ladder","to":"message_help","kind":"human_only"}],
  "events":[{"id":"","nodeId":"","at":"...","receivedAt":"...","kind":"","level":"info","text":"","refs":[]}],
  "coverage":{"truncated":false,"notRecorded":["local_record","gateway_mesh"]},
  "ai":{"configured":false,"model":null,"lastRunId":null} }
```
Node ids and order: 1 observation, 2 local_record, 3 gateway_mesh, 4 cloud_ingest, 5 rules_latch, 6 risk_ladder, 7 operator_review, 8 message_help. Status values: ok | warn | critical | stale | unknown | not_reported. Rules: observation ok if last reading within 120 s, stale if older, unknown if none; local_record always not_reported; gateway_mesh unknown unless box_b.silent/box.boot events or sibling devices give evidence; cloud_ingest warn if any receipt stuck in reserved/persisted or clock is server_fallback, delayed if receivedAt minus observedAt over 120 s; rules_latch from incidents (latched/none/resolved); risk_ladder from device risk (stale critical stays critical, marked last-known); operator_review from status-change events and latest system_agent_runs checkpoint (pending_review until a person acts); message_help from message_deliveries, device_help, customer_links. Edges: linear 1 to 8 plus dashed human_only. Event-to-node mapping: readings/telemetry to 1 and 4; receipts to 4; incidents and created/observation entries to 5; status_change to 7; events to 1 (3 for box_b.silent/box.boot); device_logs to 4; deliveries and help to 8. Exercise data carries `mode:'exercise'`, `simulated:true`. `conditions` text is deterministic, no banned words, no em dashes, includes advisory "Advisory only. A person must review this."

## 8. Layout, z-index
Main top bar `.cc-hub` z 30 (height `--topbar-size`). Sidebar z 24. Drawer z 20. Place card z 13. Map bar z 12. Zone overlay panel z 11. Draw bar z 12 (bottom). Toasts z 30 (fixed). Map pop-outs from kit are body-level (kit z above 40). Drawer under 760px: full screen. Place card on viewports under 560px: bottom sheet (`left/right 8px`, bottom 8px, max-height 55%), dismiss by tap outside.

## 9. Accessibility checklist
Visible focus ring on every custom node (use theme `--kit-focus`); 24px minimum targets; no color-only status (text label plus icon); `prefers-reduced-motion` disables transitions and auto-play; dialogs non-modal but Esc closes; live regions for place load, AI result, timeline step; contrast per UI_KIT_CONTRAST.md; reflow at 320px with horizontal scroll only inside the toolbar and the workflow canvas.

## 10. Test plan
- S (node --test, mongodb-memory-server, stub fetcher): param validation (NaN, missing, lat 0, Hawaii, Alaska, Canada 422); parsers from fixtures; one section times out or 500 and response stays 200 with other sections ok; stale cache served on upstream error with status stale and age; not_cached never rendered as none; point inside versus outside alert polygon; demo gets no live devices; 429 with Retry-After; standsOut and conditions contain no em dashes or banned words; no key strings or upstream URLs in response; loadRisk readOnly true and no risk_state write; timeline: each node status rule, stale critical stays critical, local_record always not_reported, event mapping, truncation flag, demo exercise only, middleware allowlist.
- M: unit tests for `clampBbox`/`inConus`, style objects contain no imagery source, MapView options contain maxBounds, toolbar control list builds with Kit stubs; browser check with preview: hover shows then hides, click pins, Esc closes, touch emulation, toolbar sits under top bar at 1280 and 375 widths.
- D: unit tests for workflow layout/state-at-cursor and conditions fallback; browser check: drawer width 66vw at 1440 (about 950px), full screen at 375, node select filters log, keyboard-only walk, reduced-motion emulation.
- Integrator: `npm test`, `npm run build`, grep user-facing strings for em dashes, confirm no `satellite` imagery key in ui/.
