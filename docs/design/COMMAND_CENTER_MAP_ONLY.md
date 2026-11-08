# HomeBeacon command center: map-only design contract

Owner: Ayan's workstream. Updated November 7, 2026, America/Chicago.
Status: Ayan approved the rendered satellite-map direction for Astra to develop and refine. This is an evolving implementation brief, not a claim that the production replacement is implemented or accepted. Record new answers here rather than scattering requirements across chats.

## 1. Decisions and their source

### Locked by Ayan

- The default workspace is **a full map, with detail panels opening on demand**. Ayan initially chose all tools on demand, then explicitly added visible basic overlay buttons and a compact floating tab island (section 22).
- The map is the command center, not a small dashboard widget. It owns the viewport.
- No KPI row or KPI cards in the command-center landing state.
- Remove the old full-height dashboard rail and side tabs. Ayan later requested a compact floating left tab island for Devices, Priorities and related views. That small island is allowed; its panels open on demand. Do not restore the old permanent columns.
- Device-specific information is secondary and appears when a device is deliberately selected.
- **Selection opens an expandable card anchored to the selected house**, not a permanent side panel or a separate default device screen. Exact answer to the selection question, November 7.
- **The compact card shows status, why the house needs attention, and when it last reported.** Sensor details/history/logs/actions follow on expansion.
- **Disaster regions are the default visual priority; individual devices appear as the operator zooms in.** Do not open on a wall of house markers.
- **Selecting a disaster region zooms into it and opens a compact summary anchored to that area.** Exact answer to region-selection question, November 7.
- **Open on a U.S. disaster overview, then move into regions and neighborhoods.** The target is national, not a Dallas or Texas default.
- **Use satellite imagery with disaster layers.** Exact answer to the map-style question, November 7.
- The experience must feel animated, dynamic and modern while remaining operationally useful.
- Use Ayan's actual Argus UI components. A kit import, a gallery or CSS-class decoration is not enough evidence of a component-led product.
- Inspect what is actually rendered. The cookie experience is explicitly part of this review.
- **Use the rendered satellite-map composition for Astra and refine the details.** Exact answer to composition review, November 7. This approves the direction, not a claim of production completion.
- First consolidate what we want in this living design document. A teammate will use Astra. Do not silently deploy another redesign before this design is resolved.

### Remaining design review

The foundational layout and selection choices above are locked. The rendered composition is approved as the direction. Imagery provider, detailed tool placement, expansion dimensions and motion treatment remain refinements for Astra. Backend national coverage remains implementation/research work, not an unanswered user preference.

### Details for refinement within the approved direction

- A compact floating launcher, direct overlay buttons and a small floating left tab island form the app chrome at rest. Conventional map controls and attribution remain.
- The exact content, dimensions and edge placement of the locked anchored region summary require visual review.
- Dusk/paper tokens and Hanken/Spline typography continue; avoid a new brand/palette invention. Use display serif sparingly in operator UI, not a large marketing headline above the map.
- Historical replay is an explicit mode, not an always-visible timeline. Its UI is a later priority after live/selection behavior is correct.

## 2. What is wrong with the current screen, from evidence

Inspected current source and the deployed `/demo` at 1440 x 960, fresh browser state. Baseline code: main 3ce2834. Measurements are in `current-command-measurements.json`; review screenshots are in the workspace outputs.

| Surface | Current observation | Implication |
| --- | --- | --- |
| Visible map | 722 px wide; 419,098 visible square pixels, about 30.3% of the viewport | The central task loses most of the screen |
| First-visit cookie panel | 121 px tall; about 12.6% of viewport | A consent-like interruption dominates an operational screen |
| Header | About 127 px tall | A dashboard title/action row competes with the map |
| KPI row | About 92 px tall | Summary cards are prioritized over geographic context |
| Left queue + right details | 260 px + 340 px, both open | The map is permanently squeezed even without intentional selection |
| Side rail | 80 px | Persistent navigation duplicates tools that should be on demand |
| Device focus | A device is selected automatically | User did not choose to leave the regional overview |
| Cookie dismissal | Current handler focuses footer preferences; observed browser scroll jumps down | Dismissing privacy UI changes the operator's map context |

The post-dismiss measurement includes this unintended focus/scroll jump. Do not use it as a clean no-banner layout measurement without resetting scroll.

### Argus component truth

The current code does load the real vendor runtime. It constructs `Kit.select` and `Kit.confirm`. However, `ui/product-kit.js` uses a MutationObserver to add kit classes to much of the existing hand-built markup. The permanent rail, KPI strip, queue and detail scaffolding remain custom dashboard structure. That is why a technically loaded kit does not satisfy Ayan's design request.

New acceptance evidence must show actual component composition at the point of use, with the factory/registry reference, interactive states and rendered comparison. Do not answer layout criticism with "108 gallery parts pass" or "the stylesheet is imported."

## 3. Default workspace

### Layout

The map fills 100vw x 100dvh. No page-length command-center document and no normal page scrolling at rest. Map controls, legal attribution, a small command hub, direct basic overlays and the compact floating tab island overlay it.

Target at 1440 x 960 and 1920 x 1080:
- Map canvas occupies the entire application viewport.
- At least 90% of the viewport remains unobstructed by app chrome when no tool or selection is open.
- There is no 80 px rail, hero/title band, KPI strip, device list, inspector, timeline panel or cookie banner taking permanent space.
- No device is selected automatically. A new critical reading does not hijack the camera or open a panel.

At 390 x 844, preserve the map as the default screen. Tools open in an appropriate overlay; do not stack desktop columns into a long scrolling dashboard. Record desktop and mobile screenshots at identical states.

### Minimal controls

The floating command hub at top left contains a small brand/region identity and a clear Tools or Search action. Basic overlay buttons sit below it, with a small floating view island to the left; opened content is temporary. The exact wording and arrangement are to be reviewed, but it must not grow into a row of eight buttons.

A quiet connection/freshness indicator can sit beside the hub. "Feed connected" means the software connection is live; it does not mean houses are safe. Do not use a fleet count as a KPI substitute.

Conventional zoom, compass and scale remain where map users expect them. Keep OpenFreeMap/OpenStreetMap attribution legible and outside selection surfaces.

### Suggested spatial arrangement

```text
+----------------------------------------------------------+
| [HomeBeacon / Region] [Tools]                              |
|                                                          |
|                                                          |
|                    FULL MAP                              |
|                                                          |
|     Device points, boundaries and actual data layers      |
|                                                          |
|                                             [map controls]|
| Feed status                             map attribution   |
+----------------------------------------------------------+
```

This is an interaction diagram, not a visual mockup. No map should be replaced by decorative blobs or a fake static city drawing.

## 4. Tool panels open on demand

| Task | Proposed interaction | Closure and state |
| --- | --- | --- |
| Find a home, device, street or area | Command/search panel with clear search scope and results | Selecting a result highlights it; Escape closes search |
| Browse devices without using the map | Accessible searchable list opened from the launcher | Same information as map; no permanent queue |
| Change map layers | Compact layer popover or panel | Preserve enabled layers after closing; map remains interactive |
| Inspect live activity | Activity surface opened by command | Preserve filters, scroll and selected device; no permanent feed strip |
| Read logs | Device or region scoped history surface | Source, observed time and receipt time when relevant |
| Send a device information box | Explicit compose surface after selecting device/area | Show target scope and delivery limitations before Send |
| Draw/edit a zone | Explicit map-edit mode | Visible save/cancel; confirm abandonment of unsaved work |
| Review customer pairing/help | Scoped device action | Do not expose pairing code permanently or invent help status |
| Ask NVIDIA to suggest a view | On-demand assistant surface | Preview supported predicates and evidence before applying |
| Manage account/settings | Account menu | Not a permanent rail item |

Only one primary tool surface should be active at a time. Small contextual popovers can nest when the actual component supports that. Do not make the operator navigate multiple permanent side tabs to recover the map.

## 5. Device selection: anchored expandable card

Ayan chose an expandable card anchored to the selected house. This is locked. Do not replace it with a permanent right inspector, drawer, side tabs, or a full-page device dashboard.

### Compact and expanded states

- At rest there is no card. Selecting a house opens one compact card at that map feature.
- Proposed compact size: 280-320px wide, with identity and Ayan's chosen essentials: status, why attention is needed, and last report time, followed by explicit Expand/Close. If no attention condition is reported, say what is known without declaring the home safe.
- Expand grows that same anchored card in place; it does not spawn another independent panel. Proposed expanded width 360-420px, with a bounded height and internal content scroll.
- Compose its content from actual `Kit.sectionBox`, `Kit.details`, `Kit.pill`/`Kit.statusDot` and `Kit.foldOpen`. MapLibre provides geographic anchoring/placement, not another visual card design. There is no invented `Kit.mapCard` factory.
- The card follows the selected home's geographic location during pan/zoom. Use an appropriate anchor side and minimal camera padding if needed to keep both card and house visible. Do not repeatedly pan after each reading.
- Near viewport edges, flip/shift the geographic popup first. A bounded camera adjustment is a fallback, not a repeated animation.
- On mobile retain the anchored-card relationship, fitting width inside the viewport and limiting expansion height. Do not silently turn this into a bottom sheet. If a full record cannot fit, offer an explicit full-record action for review rather than replacing the chosen interaction by default.
- One card at a time. Selecting another house replaces content/anchor. Closing returns to the map without a permanent inspector placeholder.
- A device with no reported coordinates cannot have a truthful geographic anchor. An accessible list can offer a clearly labeled non-geographic record view; never invent its location.

### Invariants

- Open only after an explicit map/list/search selection or an intentional deep link.
- Highlight the selected home precisely. Do not cover its marker with the inspector; adjust camera padding only if needed.
- Give one clear Close action. Closing restores the previous camera, layer settings and search/filter context.
- Switching devices updates the same inspection surface, not a stack of dialogs.
- Live polling does not reset selected device, scroll or input focus.
- No nested tab maze. Prefer a readable information hierarchy with scoped actions; use actual kit navigation only if the need is demonstrated.

### Information order

The compact card stops after identity/status, one plain reason and report freshness. Expansion progressively reveals the rest; do not cram this whole list into the initial popup.

1. Device/home identity and location, reported status, freshness and power-save mode.
2. Why it needs review: plain reasons tied to recorded evidence, including last-known critical reports.
3. Current readings, with units and observation time: water/moisture, temperature/humidity, smoke/air proxies where present, mains power, connection, battery and mode. "Not reported" is distinct from false/zero.
4. Recent changes/history. Original observation time and receipt time must be distinguishable for replayed data.
5. Household linkage and consent, followed by the operator-set help status. Do not infer occupancy or an evacuation from sensors.
6. Explicit actions: send information, record follow-up, manage pairing, inspect full history. These are actions, not a permanently expanded button wall.

Selected-device sensor values are operational evidence, not the rejected fleet-wide KPI card row. Do not remove useful readings because global KPI cards were rejected.

## 6. Region and layer behavior

Ayan chose **disaster regions first, individual devices as you zoom in**. The default is therefore a geographic incident overview, not the current dense scatter of 32 exercise pins. The initial view is the U.S. overview Ayan chose. National source coverage still needs verification/building.

### Semantic zoom

- Wide overview: show verified incident/hazard footprints and their clear source meaning. Group device evidence quietly; no individual-house label wall.
- Region/neighborhood: reveal reported-condition clusters and coverage, retaining hazard context. Cluster counts, if used, belong to geography rather than KPI cards and must come from actual data.
- Street/house scale: reveal individual devices at their recorded locations. Device selection opens the anchored card. Keep relevant region boundaries understandable as zoom changes.
- Use scale/density-based transitions with hysteresis, not flicker at one exact zoom threshold. Exact thresholds need a rendered prototype across real data density.
- Do not automatically choose a region, open a house or keep refitting the map because a poll returned more data.

Official warnings and incident areas, FEMA declaration areas, historical flood-risk polygons and algorithmic device-risk cells are not interchangeable. A FEMA declaration may not supply an exact active incident footprint; do not invent one. Historical flood hazard is context, not a report that a street is flooded now. Earthquake epicenters are not automatically disaster-area polygons. If no verified area is available, show the unavailable/empty distinction honestly rather than painting a synthetic disaster region.

The operator should move from regional patterns to street-level evidence without losing geographic context.

- Device markers need clear selected, critical, stale/unknown and linked states, explained in an on-demand legend.
- Cluster markers at regional scale; expand to individual properties at street scale. Avoid covering every road with a permanent marker label.
- Use muted base-map roads/buildings so device evidence and hazard geometry are legible. Do not use a dramatic dark map if its labels disappear.
- Layer order: base geography, contextual boundaries/forecast or official zones, our operational zones, device points and selected focus. Specify opacity and hover/selection behavior for each.
- Distinguish official source polygons, operator-drawn zones, and algorithmically grouped areas through legend and source labels. No visual ambiguity about an evacuation instruction versus an observation area.
- Every context layer carries source, age, spatial scope and availability. A missing API key or failed fetch is not an empty/no-hazard region.
- Apply region filters without losing the user's camera. Incoming data must not repeatedly refit the map.
- Region summaries live inside an explicitly selected area or tool, not as a KPI row restored under another name.

## 7. Motion contract

Dynamic means state changes remain understandable. No invented live activity, constant pulsing across the fleet, or animation as a substitute for data.

| Trigger | Motion proposal | Constraints |
| --- | --- | --- |
| Enter workspace | Map and compact command hub settle once, 250-400 ms | No long loading performance or marketing intro |
| Select a device | 180-260 ms inspector entrance, clear marker focus; camera only if necessary, 400-650 ms | Preserve location context; no auto-flight on every update |
| Switch selected device | Contents update in place; short crossfade or shared focus movement | No close/reopen flashing; don't destroy focused fields |
| Receive a new observation | Brief marker emphasis and updated timestamp | Only on a real new event; don't restart every poll |
| Status worsens | One restrained alert treatment and visible status change | Never auto-open a sheet or move the camera |
| Toggle a layer | Fade layer opacity 150-250 ms | Keep source/status labels truthful while loading |
| Open a tool | Actual kit motion and focus behavior | Do not invent another modal system |
| Message send/delivery/ack | Small state transition tied to server confirmation | Queued is not shown, delivered is not acknowledged |
| Connection loss | Steady stale/reconnecting state with restrained transition | No fake heartbeat or safe/green stale homes |

Astra should specify easings and interruption behavior using the actual kit's motion tokens. Do not scatter hand-coded animation values throughout modules. Reduced-motion mode removes camera fly/zoom and spatial transitions, while keeping every action and status available. Provide an obvious pause control if any sustained playback exists. Sounds and flashes are not part of this brief.

## 8. Actual Argus composition plan

Source: `ui/kit/vendor/`, copied from Ayan's `rion-nexus-worktrees/ui-library`, commit db1475849. Do not substitute the public argus.build media CLI or approximate Oracle patterns. Do not edit vendor files to fit the layout.

| Surface | Existing real component | Evidence to supply |
| --- | --- | --- |
| Floating command/tool grouping | `Kit.listToolbar`, `Kit.buttonMenu` or verified picked menu | Factory call and selected registry key |
| Search | `Kit.searchField` | Keyboard focus, clear/loading/empty/error behavior |
| Layer/visibility controls | `Kit.filterButton`, `Kit.filterChip`, `Kit.tickBox` / `Kit.switch` as appropriate | Real control state, not a native select hidden by a universal decorator |
| Anchored expandable house card | `Kit.sectionBox`, `Kit.details`, `Kit.foldOpen` with a MapLibre geographic anchor | Real factory calls; compact/expanded states; no default right-hand inspector |
| Message composition | `Kit.popUpWindow`, `Kit.field`, `Kit.select` | OLED limits, scope, errors and busy state |
| Risk/status | `Kit.statusDot`, `Kit.pill` | Text meaning and semantic tone; no color-only state |
| Observation/activity history | `Kit.historyList` | Observed time, actor/source and accessible chronology |
| Destructive or abandoning action | `Kit.confirm` | Specific wording and cancellation behavior |
| Read state | `Kit.region` / library loaded, empty, unread and not-set-up states | Failed reads never paint empty data |

Useful registry references include `bars__list-toolbar`, `overlays__side-panel`, `overlays__pop-up-window`, `overlays__yes-no-question`, `history__history-list` and `icons__status-dot`. Confirm the exact entry and API from local source before implementation; do not fabricate a missing factory.

The library also provides `Kit.sideSheet`, but Ayan chose an anchored card. Its existence is not a reason to use it as the default device interaction. Geospatial placement is product integration around real kit content; do not claim the kit has a geographic popup factory when it does not.

The existing `ui/product-kit.js` class-decorating bridge is migration debt, not the blueprint. Compose the redesigned surfaces directly with factories/DOM. Own only screen layout, map integration and approved theme overrides. Buttons pasted over old HTML are insufficient.

## 9. Cookie/privacy experience

Rejected baseline behavior at main 3ce2834, confirmed in `ui/app.js`:
- No analytics or advertising tools are installed.
- Both "Essential only" and "Save preferences" write the same essential choice.
- Closing focused the footer preferences button, causing the observed scroll jump. PR #25 now prevents that scroll movement. Duplicate choices and an unnecessary first-visit notice still need the redesign treatment.

UX decision proposal: no consent-style banner inside the command workspace while the product only has necessary access storage and explicit preferences. Keep privacy/cookie information and preference access in account/settings. The marketing site's privacy treatment can be reviewed separately; do not force a choice between duplicate actions.

If optional tracking is later introduced, design an actual meaningful preference flow with distinct choices, before starting optional requests. Its legal requirements need the appropriate review; this brief is not a legal ruling.

Any privacy surface must be compact, keyboard accessible, non-obscuring and honest about actual storage. Dismissal must preserve viewport, selection and camera, and restore focus locally rather than scrolling to a distant footer. The command center should not have a marketing footer occupying map workspace.

## 10. Data, roles and operational boundaries to preserve

- Operator, demo and customer authority remain separate. Customers do not gain map-wide data; demo cannot write to devices or real homes.
- Device keys never become browser/operator credentials. Tokens, passwords, pairing codes and personal data never enter screenshots/spec samples.
- Current live behavior is polling with cursors, jitter/backoff and hidden-tab pause. Do not call it WebSocket streaming or fabricate update events to animate it.
- Keep raw observations distinct from inferred review priority. Missing/stale data is unknown; critical evidence remains visible until resolved appropriately.
- NVIDIA may suggest supported views, not run arbitrary queries or decide safety/coverage/dispatch.
- Message lifecycle is queued/delivered/acked/expired/cancelled. Help status is manually sourced; a UI action does not dispatch a response team.
- EIA/AirNow/FIRMS/NVIDIA credentials were absent from the checked runtime. Surfaces must show unavailability instead of simulated "live" data.
- Preserve existing APIs and teammate sensor/incident contracts. New UI work must not discard Dhruv's feed/hardware work or the database workstream's receipt/incident behavior.

## 11. Evidence and acceptance gates for Astra

A passing unit suite, kit gallery and an accessibility scan do not prove the design meets this brief.

Required design artifacts:
1. Desktop and mobile default-map composition, with no selection.
2. Selected-house compact and expanded anchored-card compositions, including near-edge and mobile states.
3. Layers open, search open, activity open, compose message and draw-zone states.
4. Live, stale, failed, empty, not-configured and exercise data states.
5. Motion storyboard or interactive demonstration, with reduced-motion counterpart.
6. A component bill of materials naming actual factories and registry entries.
7. Cookie/privacy proposal and focus/dismiss behavior.

Required implementation verification when that phase starts:
- Measure map/occlusion bounds at 1440 x 960, 1920 x 1080 and 390 x 844. No KPI row, rail, permanent queue or default inspector.
- Default screen has no automatic selected device. Selecting and closing preserve map context.
- Tools truly open on demand and don't permanently consume map width.
- Demonstrate marker selection, search/list keyboard alternative, region selection, source states, downlink scope/delivery and form preservation during live updates.
- Inspect rendered screenshots, not just DOM/source. Compare them with this brief and selected kit references.
- Automated and manual keyboard/contrast/focus/reduced-motion checks. No focus jump on privacy dismissal or polling.
- Retain operator/customer/demo isolation and existing backend tests.
- Do not deploy merely because the bundle compiled. Inspect the rendered implementation against the direction Ayan approved, record remaining objections, and raise meaningful departures from the locked behavior.

## 12. Change log and open questions

- Initial audit: found 30.3% visible map, 12.6% cookie panel, permanent KPI/queue/inspector, and cookie focus jump.
- Ayan chose map only, all tools on demand. This supersedes earlier proposals for a permanent live activity strip.
- Ayan chose an expandable card anchored to the selected house. This supersedes the floating inspector/full-page alternatives.
- Ayan chose compact-card status, attention reason and last report time.
- Ayan chose disaster regions first, with individual devices appearing on zoom.
- Ayan chose a U.S. disaster overview, then regional and neighborhood zoom. This supersedes the Texas/DFW default.
- Ayan chose region selection to zoom into the region and open a compact anchored area summary.
- Ayan reports heavy loading and blank space at scroll boundaries. Keep the command canvas anchored, prevent page overscroll, and keep marketing, operator and household access discoverable.
- Performance repair shipped separately in PR #25: scoped component updates, smaller runtime/font payload, contained page scrolling and cookie focus repair. This does not implement the map-only redesign.
- Design review next: exact visual composition; source/layer defaults within the chosen national overview; event attention/coalescing; mobile tool fit. The foundational user choices above are already answered.

Ayan approved the rendered satellite-map direction on November 7: "Use this direction for Astra and refine the details." The requirements/design handoff is ready. Detailed implementation and production validation remain assigned to the next workstream.

## 13. Scenario walkthroughs Astra must cover

### Open a neighborhood

Operator opens the command center. The map is already the workspace; no house is preselected and no panels surround it. The compact hub names the area and reports connection state. Streets remain readable. The operator can pan/zoom freely. Live observations update the map without resetting the camera. No fleet KPI cards appear.

### Understand one house

Operator selects a house. A compact card opens at that house. Its compact content is status, a plain attention reason and last report time, as Ayan selected. Expand reveals the detailed evidence in the same anchored card. Switching houses moves the selection and replaces that card. Close returns to the undisturbed map. An unknown location is never assigned a fabricated anchor.

### Check a suspected flood area

Operator opens Layers on demand, enables water/flood context, and sees the source age and meaning. Official flood-hazard areas, current gauge observations, forecasts, operator zones and home sensor reports stay distinct. A historical flood-hazard polygon is not presented as a current flooded street. Select an area or house to inspect the evidence; do not infer damage from the overlap alone.

### Receive a worsening observation

A genuinely new report worsens a house's review state. The marker changes with a single restrained emphasis; a small actionable notification may be proposed, with coalescing during bursts. The app does not open that house, move the camera or replace another selection. No initial-load toast storm, fake blinking fleet or polling-as-new-event animation.

### Contact a connected box

Operator selects the target(s), opens a real kit compose surface and sees the intended device/area scope. The server acknowledgement creates a queued state. Delivery depends on an available network path and subsequent device pull. Device acknowledgement is a different state. Lost Wi-Fi does not become connectivity just because the UI animates a send. Expired messages remain expired rather than looking successfully delivered.

### Link a household

Pairing is an explicit device action. Show the serial/code/link once, keep it out of screenshots/logs, and clearly separate customer registration from operator authority. A linked customer is not inferred occupancy. Help status shows who reported it and when; UI changes do not dispatch a team. Respect the recorded contact consent.

### Lose connection or map access

Retain last-known observations and their age. Show a concise connection state, not safe/green empty data. A failed source fetch is distinct from no alerts. If the base map cannot render, provide the on-demand accessible device list through the same clear launcher; do not display a static map image as if it were live.

### Use keyboard, a small screen or reduced motion

Every task is reachable without interacting with map canvas pixels. Search/list exposes the same device evidence. The anchored card has clear focus entry/close behavior, does not trap focus from the usable map, and does not disappear during updates. Controls do not cover the selected marker, attribution or other controls. Reduced motion preserves all state changes without camera flight or spatial effects.

## 14. Implementation boundaries and rejected shortcuts

- This handoff phase records the approved direction for Astra, not evidence of a completed production implementation.
- No new framework or backend service is needed to express this layout. Preserve existing vanilla modules, map implementation and API contracts unless the actual design requires a scoped change.
- Remove the old KPI/rail/default-inspector structure and update its rendering logic. Do not leave hidden placeholder elements solely to satisfy old DOM tests.
- Update visual and interaction tests to the new contract while preserving backend role/data tests. Old passing screenshots are not an approval baseline.
- Existing per-device readings and region analytics may remain in data/APIs; removing the KPI row is not deleting the information needed inside an intentional inspection.
- Do not use a generic third-party dashboard, invented kit API, raw native select hidden behind a label, or a class-decoration pass as evidence of actual Argus composition.
- Do not let a model apply unsupported filters or execute arbitrary data/code queries. The UI must show preview, scope, source evidence and unavailable states.
- Do not load optional analytics first and ask about consent later. Do not add a cookie prompt for nonexistent options merely because another website has one.
- Do not substitute a permanently visible activity strip for the chosen map-only state.
- Do not substitute a side sheet for the chosen geographically anchored expandable house card.

## 15. Compact card content examples and freshness rules

These are labeled design examples, not live observations or approved final copy.

| Case | Compact card example | Expanded context |
| --- | --- | --- |
| Current critical observation | `HB-1003` / `Critical observation` / `Water sensor reported water` / `Observed 2 min ago` | Exact reading, time, source, recent history and manual follow-up |
| Power interruption | `HB-1020` / `Needs review` / `Mains power lost; backup active` / `Observed 40 sec ago` | Battery/mode/network readings and original timestamps |
| Critical but stale | `HB-1003` / `Critical, last known` / `Earlier water report still needs review` / `Observed 2 hr ago` | Last network receipt, whether data was replayed, unresolved incident evidence |
| No recent reports | `HB-1010` / `Unknown now` / `No recent observations` / `Last observation 32 min ago` | Last-known state, last receipt and connection history |
| Reporting without active evidence of an alarm | `HB-1002` / `Reporting` / `No active alarm reported` / `Observed 30 sec ago` | What sensors actually reported and what remains missing; no "home is safe" claim |

Identity is context, not a fourth KPI. Compact essentials remain status/reason/freshness. Avoid adding six sensor tiles into the collapsed state.

"Last reported" must not confuse network receipt with measurement time. For a delayed/offline replay, make the older observation age visible in the compact card and label it delayed/last known; show last received/last connected separately on expansion. A newly received old measurement cannot be styled as fresh evidence. If device clock quality is unknown or server time is a fallback, label that clearly. Absolute time and timezone should be available alongside relative age.

## 16. Working hierarchy for regional information

Astra must show distinct semantics, not just attractive colored polygons:

1. Verified active official hazard/incident geometry, with event name, source and age.
2. Reported device-condition regions/clusters, explicitly derived from the available boxes.
3. Operator-drawn operational zones, explicitly owned and editable with audit.
4. Historical susceptibility/context layers, enabled deliberately and labeled as context.

The first wide view prioritizes disaster regions as Ayan chose. The map may not have trustworthy geometry for every event or dataset. Unsupported coverage is a data limitation, not permission to draw a plausible shape. Ayan chose the national initial view. It requires national source/bounds work; the current Texas-focused implementation is not proof that national incident coverage is finished.


## 17. National overview: implementation and research requirements

Ayan selected the U.S. overview. Do not downgrade this to a Texas default because existing endpoints are easier to reuse. Keep current regional APIs as working dependencies while adding the necessary national/viewport path.

### Coverage to reconcile

| Current dependency / constraint | Required treatment for the U.S. design |
| --- | --- |
| Existing NWS/weather route uses Texas scope and a bounded feature list | Obtain national active-event discovery with explicit completeness/limits, then viewport detail. Do not label the first 100 Texas alerts as all U.S. disasters. |
| Existing OpenFEMA declaration request is Texas-filtered | National context needs state/county coverage and verified geometry; declarations are not automatically active event footprints. |
| Earthquake feed and current regional filters | National event discovery with correct event/time semantics; points are not fabricated disaster perimeters. |
| River/flood data | Fetch by meaningful geography/viewport, with age, limits and gauges/forecast distinctions; do not request every detailed geometry at street resolution on startup. |
| ERCOT/EIA examples | ERCOT is regional grid context. A Texas grid value is not a nationwide or neighborhood power-outage measurement. Expand only from actual source coverage. |
| AirNow/FIRMS/model keys missing in checked runtime | Show unavailable/needs setup. Do not synthesize nationwide layers or call unknown coverage clear. |
| Current bounded device summaries | National overview needs server-side spatial aggregation and viewport-scoped detail. Do not silently drop devices beyond a limit and present the result as full coverage. |
| Existing synthetic exercise properties are centered in DFW | National design examples need separately labeled regional fixtures or real public geometry; they are not evidence of deployed national boxes. |

### National-to-house progression

```text
U.S. incident/hazard overview
    -> select or zoom to a disaster region
        -> compare neighborhoods and reported-condition clusters
            -> reveal street-level device markers
                -> select a house
                    -> compact anchored card
                        -> expand evidence, history and actions
```

Alaska/Hawaii and any supported additional jurisdictions must have an intentional navigation and coverage treatment; do not silently omit them while claiming complete U.S. coverage. Exact initial projection/extent is a design review item. National discovery is not a claim to monitor every house or every hazard.

Use cluster/aggregation detail appropriate to zoom, geographic request bounds, cache age and request limits. The map must remain responsive while sources load independently. A missing source must not block viewing other available evidence or be confused with no incidents.

### Useful next validation questions for the teammate

- Which official geometries reliably represent active events, versus forecasts, susceptibility or historical declarations?
- What national overview can be truthfully built from the currently available public/keyed sources?
- Which endpoints are still Texas-limited, truncated or unconfigured, and what exact national query/aggregation replaces that limit?
- At each zoom/density level, what is visible and selectable, with keyboard equivalents?
- How does the anchored card behave at map edges, on mobile, during a burst of reports and while the operator is typing?

Do not report the national UI complete until actual current-state data and rendered behavior prove it.


## 18. Region summary, continuity and speed

### Locked selection and proposed content

Clicking a disaster region zooms to its usable geographic bounds and opens a compact summary attached to that region. Respect reduced motion by changing the view without a flight. Preserve a stable geographic anchor if the shape changes on refresh. Do not place a region card at an invented affected house.

Proposed compact content for visual review: event/area name, type of evidence, source freshness, and the plain reason it needs review. An optional observed-device count must include reporting coverage and unknowns. No permanent national totals, fabricated affected-home counts or count-based damage claims. Expanded content can compare neighborhoods, source evidence and reported home conditions. Region cards and house cards share a selection model; avoid overlapping stacks of inspectors.

Near-edge behavior must keep the marker/region context, card controls and map attribution reachable. A bounded pan is permitted for deliberate selection; background polling must not repeat it. If an event expires or disappears while selected, retain a clearly labeled ended/unavailable summary until the user closes it. Do not silently move selection to another event.

### Proposed speed and stability gates

These are engineering targets, not user-approved measured claims:
- App chrome responds to clicks and keyboard input within 200 ms on the agreed test device; record the device and network profile.
- Render the map shell and source loading states independently. One slow external feed cannot block search, selection, account access or other loaded layers.
- National load starts with coarse event/cluster data, then fetches viewport detail. Do not mount every house as a DOM marker at U.S. scale.
- Controls are composed once and updated in place. No full-document style scans after map or telemetry mutations; no reload of the entire panel while typing.
- Bound histories and lists; paginate or window long collections. Cancel obsolete viewport requests and discard out-of-order responses.
- Root viewport stays fixed at rest. Internal tool content may scroll, with no scroll chaining, white overscroll canvas or camera change from page focus.
- Capture cold and warm load, interaction responsiveness, requested bytes and long tasks for national, dense neighborhood and open-card states. Compare to the rejected baseline rather than reporting a fast local server as production evidence.

### Research starting points, checked November 7

- [NWS alerts service](https://www.weather.gov/documentation/services-web-alerts) and [API documentation](https://www.weather.gov/documentation/services-web-api): official active alert discovery and GeoJSON/CAP semantics. Verify null/missing geometry, affected-zone references, expiry/update relationships and actual request limits before choosing the regional shape.
- [USGS GeoJSON summary format](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php): event discovery and time/magnitude semantics. An event point is not a damage perimeter. Detailed event products require deliberate source interpretation.
- [FEMA official API examples](https://github.com/FEMA/openfema-samples/blob/master/analysis-examples/API_Tutorial_Part_1_GettingStarted.ipynb): declaration dataset discovery and query patterns. Administrative declarations remain distinct from current sensor evidence or active hazard boundaries.

These links establish source starting points, not proof of national integration. Teammates must document the actual query, coverage, pagination/limits, cache age and shape semantics they implement.

## 19. Handoff review sequence

1. Read the locked decisions and current rejection evidence. Cross-check the current main branch and teammate API/hardware changes.
2. Present three actual rendered compositions: U.S. idle overview; selected region with anchored summary; selected house compact then expanded. Include mobile and reduced motion.
3. Identify each actual Argus factory used and show its interactive states. Keep vendor source intact.
4. Resolve visual direction, launcher placement, card edge behavior and cookie treatment with Ayan. Record answers here, without reopening settled choices.
5. Implement the accepted composition, preserve roles/data semantics, then run the scope-matched acceptance gates in section 11.

No implementation is accepted merely because the requirements packet is complete. This brief is ready for teammate implementation. The directional review is complete; detailed rendered implementation review and the production replacement remain outstanding.


## 20. Satellite imagery: locked direction and review prototype

Ayan selected satellite imagery with disaster layers. Use imagery as the geographic base, not a decorative background underneath a conventional dashboard. Disaster overlays, geographic labels and card text must remain readable against both bright terrain and dark water. Imagery is not a real-time view of damage. Source collection age, coverage and resolution need explicit source information; never describe an old roof image as an observation of the present event.

Candidate examined for the independent review prototype: [USGS imagery-only basemap](https://www.usgs.gov/faqs/what-are-urls-imagery-services-national-map-and-are-they-cached-or-dynamic), a cached orthoimagery service. It includes aerial imagery and is not a promise of satellite-only acquisition. The service's metadata reports USDA/USGS attribution and a June 2024 data-refresh description; that is not a capture date for every tile. Final provider and licensing/attribution/coverage need production review. No imagery provider credentials are embedded in the prototype.

The independent source is under `docs/design/prototype/`. It is not wired into public Pages or the production command center. Build with `node docs/design/prototype/build.mjs`, then serve `work/map-review/` over HTTP. It uses actual Kit.buttonMenu, Kit.searchField, Kit.tickBox, Kit.sectionBox, Kit.pill, Kit.details, Kit.foldOpen and Kit.historyList factories. Product CSS owns spatial placement and a geographic leader line, not replacement component styling.

Prototype scope: U.S. imagery overview, grouped national alert label, deliberate area zoom/anchored summary, neighborhood-only fictional device markers, compact/expanded house card, on-demand search/layers/activity/privacy, source age, no consent interruption, no page scrolling, reduced motion and one explicitly requested exercise-report animation. No production writes, model requests, private household data or made-up live stream.

Snapshot evidence: the successful NWS active-alert request returned 322 features at retrieval, with two non-null geometries. The prototype includes only those two geometries, with original source/issue times and retrieval timestamp in `alerts-snapshot.json`. It does not claim complete national hazards. Missing-geometry alerts need source-zone resolution in real implementation. The API rejected a `limit` parameter on this active endpoint during this check; verify supported query parameters instead of assuming pagination syntax.

Ayan approved this rendered direction for Astra to develop and refine. It is not an accepted final production implementation. Remaining full-product work includes national completeness/zone geometry, Alaska/Hawaii entry, source failures/retry controls, message/zone/model flows, mobile edge cases, light-theme review and production integration. Do not equate prototype screenshots with completion of the replacement command center.


## 21. Handoff acceptance and remaining implementation

Ayan's latest decision: **"Use this direction for Astra and refine the details."** The requirements-gathering and directional-review stage requested in the original message is complete. Continue adding refinements here during implementation. Do not reopen the locked map/layout/selection choices as if they were unanswered.

| Original request | Authoritative handoff evidence | State |
| --- | --- | --- |
| First gather what we want and keep a design document | Sections 1–20 plus explicit user answers recorded with source/date | Complete for handoff |
| Map dominates rather than acting as a small widget | Approved full-viewport rendered prototype; 1920px measurement: 97.7% unobstructed by app chrome at rest | Direction approved |
| Remove side tabs/rail and KPI cards | Prototype idle DOM has neither; national desktop/mobile captures show the map-only state | Direction approved; production replacement remains |
| Device details only on deliberate selection | Prototype opens with no selection; explicit region/house selection and anchored compact/expanded evidence demonstrated | Direction approved |
| Modern, animated and dynamic | Actual transitions, deliberate camera movement, controlled new-report emphasis, normal/reduced-motion interaction checks | Direction approved; detail refinement remains |
| Actual Argus components | Prototype source calls the eight verified factories; vendor source unchanged | Demonstrated in proposal; product integration remains |
| Critique cookie banner | Section 9 records duplicate-choice/interruption problems; prototype has on-demand privacy with no consent banner for nonexistent options | Critique and proposed treatment delivered |
| Actually inspect rendered work | Ten screenshot states, page-error/axe/overflow/bounds audit, 1920px interaction check, manual image inspection and corrected overlaps/anchor occlusion | Demonstrated for proposal |
| Give teammate using Astra enough context | ASTRA_COMMAND_CENTER_BRIEF.md, prototype README/source/build path, data semantics, source research, acceptance gates and packaged evidence | Ready |
| Confirm the direction | User's explicit acceptance above | Approved for Astra refinement |

### Scope boundary

This handoff satisfies the requested first stage: gather requirements, document them, demonstrate and review the direction for the teammate using Astra. It does not certify the deployed command center as redesigned. The existing production layout still has its old structure, with the separate performance repairs from PR #25.

### Next owner: teammate using Astra

Implement the approved full-viewport satellite composition against current main. Preserve teammates' firmware/API/database work. Replace the KPI/rail/queue/default-inspector structure rather than hiding it. Build national/viewport data coverage and truthful source states. Complete on-demand search/list/layers/activity/messages/zones/model/account flows. Keep device compact essentials and anchored expansion. Preserve accessibility, privacy, motion/performance constraints and role isolation. Review actual rendered implementation, then perform the acceptance gates in section 11 before reporting production completion.

No new user preference is needed to begin that implementation. Resolve routine details within this approved direction, and return to Ayan only for meaningful changes to the locked behavior or concrete review findings.


## 22. Latest refinement: direct overlays, floating tab island and disaster demo

Ayan requested additional top buttons for basic overlays, a left sidebar "like dynamic island" for views such as all devices and assigned priorities, a layered hurricane demo with large danger/severity circles, sorting by power loss, and device dots revealed as the operator zooms in. This explicitly refines the earlier all-tools-hidden direction: a compact floating tab island and direct overlay controls are now desired. It does not restore KPI cards, full-height navigation or permanently open device columns.

### Implemented in the independent proposal

- Top overlay actions: official alert boundaries, exercise wind exposure, power-loss highlights and water reports. Controls expose pressed state; scenario-inapplicable layers are disabled with explanatory labels.
- Scenario selector: dated official alert geometry sample or a hurricane exercise. Exercise source/zone/device labels remain explicit.
- Compact rounded floating island: Devices, Priorities, Activity. Desktop stacks the three controls to the left; mobile uses a compact bottom island. Clicking an active view closes it. Tool panels stay on demand.
- Devices: scoped searchable list, assigned-priority/power-loss/battery/observation-age sorting, power-loss-only filtering, matching map filters and deliberate house selection.
- Assigned priorities: P1 immediate review, P2 follow up, P3 monitor; actual Argus select controls edit assignments in the review session. Assignment is independent of reported sensor status and does not dispatch anyone. Production persistence/audit is future implementation work.
- Hurricane exercise: 63 fictional Gulf Coast devices, a fictional track and three exposure circles. Elevated/high/severe radii are 180/95/38 km for demonstration, not NHC forecasts, Saffir-Simpson categories, estimates of damaged houses or safety boundaries.
- Zoom hierarchy: wide views show the region/zone; individual device dots appear at neighborhood zoom. Search/list remains the keyboard alternative. Selected house evidence still uses the approved anchored card.
- Mobile: controlled internal scrolling, no page overflow, selected house remains visible on expansion, and source/attribution/control placement are checked by rendered review.

### Production acceptance additions

Persist priority assignments with operator identity/time and an audit trail, keeping triage priority distinct from derived observation severity. Sorting must label whether it uses current or last-known evidence. Store demo datasets separately from real devices and disable real writes in exercise mode. Do not persist this prototype's mutable fixtures as production households. Keep filter choices reflected in map and list, and preserve them across live updates without focus/camera resets.

Use genuine official forecast geometry/radii where a live hurricane layer is later implemented; retain source/valid time/uncertainty and attribution. Do not reuse the fictional circles as live weather or call them official hurricane categories.
