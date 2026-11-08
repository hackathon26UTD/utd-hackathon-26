# HomeBeacon command center: map-only design contract

Owner: Ayan's workstream. Updated November 7, 2026, America/Chicago.
Status: evolving design brief for Ayan and the teammate using Astra. This is not a claim that the replacement UI is implemented or accepted. Record new answers here rather than scattering requirements across chats.

## 1. Decisions and their source

### Locked by Ayan

- The default workspace is **map only, with all tools opening on demand**. Exact answer to the layout question, November 7.
- The map is the command center, not a small dashboard widget. It owns the viewport.
- No KPI row or KPI cards in the command-center landing state.
- Remove the current persistent side navigation and side tabs. Do not just recolor or relocate the same dashboard rail.
- Device-specific information is secondary and appears when a device is deliberately selected.
- **Selection opens an expandable card anchored to the selected house**, not a permanent side panel or a separate default device screen. Exact answer to the selection question, November 7.
- **The compact card shows status, why the house needs attention, and when it last reported.** Sensor details/history/logs/actions follow on expansion.
- **Disaster regions are the default visual priority; individual devices appear as the operator zooms in.** Do not open on a wall of house markers.
- The experience must feel animated, dynamic and modern while remaining operationally useful.
- Use Ayan's actual Argus UI components. A kit import, a gallery or CSS-class decoration is not enough evidence of a component-led product.
- Inspect what is actually rendered. The cookie experience is explicitly part of this review.
- First consolidate what we want in this living design document. A teammate will use Astra. Do not silently deploy another redesign before this design is resolved.

### Pending Ayan's answer

- Initial geographic coverage: U.S. overview, Texas, or Dallas-Fort Worth. Asked once; awaiting the answer. Current verified data is Texas-focused and must not be relabeled nationwide.

### Proposed, not yet approved

- A single compact floating command launcher and region/data-status label are the only app chrome at rest. Conventional map controls and attribution remain.
- Region selection can open an area inspector, with the same information hierarchy as device selection.
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

The map fills 100vw x 100dvh. No page-length command-center document and no normal page scrolling at rest. Map controls, legal attribution and one small command hub overlay it.

Target at 1440 x 960 and 1920 x 1080:
- Map canvas occupies the entire application viewport.
- At least 90% of the viewport remains unobstructed by app chrome when no tool or selection is open.
- There is no 80 px rail, hero/title band, KPI strip, device list, inspector, timeline panel or cookie banner taking permanent space.
- No device is selected automatically. A new critical reading does not hijack the camera or open a panel.

At 390 x 844, preserve the map as the default screen. Tools open in an appropriate overlay; do not stack desktop columns into a long scrolling dashboard. Record desktop and mobile screenshots at identical states.

### Minimal controls

One floating command hub, proposed top left, contains a small brand/region identity and a clear Tools or Search action. The exact wording and arrangement are to be reviewed, but it must not grow into a row of eight buttons.

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

## 4. Tools open on demand

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

Ayan chose **disaster regions first, individual devices as you zoom in**. The default is therefore a geographic incident overview, not the current dense scatter of 32 exercise pins. Initial geographic coverage is the next open decision.

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

Current technical behavior, confirmed in `ui/app.js`:
- No analytics or advertising tools are installed.
- Both "Essential only" and "Save preferences" write the same essential choice.
- Closing then focuses the footer preferences button, causing the observed scroll jump.

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
- Do not deploy merely because the bundle compiled. Review with Ayan first; record accepted changes and remaining objections.

## 12. Change log and open questions

- Initial audit: found 30.3% visible map, 12.6% cookie panel, permanent KPI/queue/inspector, and cookie focus jump.
- Ayan chose map only, all tools on demand. This supersedes earlier proposals for a permanent live activity strip.
- Ayan chose an expandable card anchored to the selected house. This supersedes the floating inspector/full-page alternatives.
- Ayan chose compact-card status, attention reason and last report time.
- Ayan chose disaster regions first, with individual devices appearing on zoom.
- Initial geographic coverage is pending.
- To resolve next: information order within selection; whether area inspection uses the same pattern; initial region and source defaults; which live events deserve attention; mobile tool behavior. Ask progressively, not as a large questionnaire.

This document remains a draft until the pending decisions and visual review are resolved. No production UI change is claimed by writing it.

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

- This phase is requirements/design for Astra, not authorization to claim another redesign is accepted.
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

The first wide view prioritizes disaster regions as Ayan chose. The map may not have trustworthy geometry for every event or dataset. Unsupported coverage is a data limitation, not permission to draw a plausible shape. Choosing a national initial view would require national source/bounds work; the current Texas-focused implementation is not proof that national incident coverage is finished.
