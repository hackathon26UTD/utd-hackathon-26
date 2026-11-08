# Command center v2 (Module E)

The operator dashboard at `/command-center` (and the read-only exercise at `/demo`). It only consumes JSON from the other modules. Spec: `docs/SYSTEM_SPEC.md`.

## Files

- `ui/app.js` thin `dashboard()` that loads MapLibre, detects the role, then calls `mountCommand`. Marketing and legal mounting lines are untouched.
- `ui/command/core.js` pure logic with no DOM or fetch (status rules, live merge, message and zone validation, text helpers). Tested by `test/command-ui.test.js`.
- `ui/command/index.js` layout, state, 4 s live polling, home list, areas, priorities.
- `ui/command/map.js` MapLibre wrapper (street and light base maps, device dots, risk cells, zones, public layers, draw preview).
- `ui/command/overlays.js` layers panel, `/api/feeds` status, zone create, edit, delete and drawing.
- `ui/command/detail.js` home and area panel (overview, readings, logs, messages, customer).
- `ui/command/bottom.js` live updates feed, log search, sent messages.
- `ui/command/dialogs.js` send message, follow-up note, public sources, operator view builder, registration code.
- `ui/command/api.js` and `dom.js` small helpers.
- `ui/command.css` styles. Imported by `ui/app.js`, so esbuild emits `public/assets/app.css`. `app.js` adds the `<link>` when the dashboard mounts. No edit to `scripts/build-ui.mjs` or `ui/design.css` was needed.

## Behavior

- **Live updates.** `GET /api/ops/live?since=<cursor>` every 3 to 5 seconds. Paused while the tab is hidden, polls again when it returns. Errors back off to 30 s. A 404 or 503 shows "Live updates are not available yet" and the existing 30 s `/api/command-center` refresh keeps the list working. The first snapshot selects the first critical home unless the operator already picked one.
- **Status is never optimistic.** A home with no recent report, or one flagged offline or stale, is drawn as Unknown (grey), never No active alerts. Critical and elevated stay shown as last known when a device goes quiet. Missing readings say "Not reported".
- **Map.** OpenFreeMap Streets (liberty) or Light (positron), switchable in the layers panel. Dots are colored and sized by status, a blue ring marks a linked customer, a grey edge marks last known. Risk areas come from `/api/risk?level=regions` (hot spot ring, dashed outage outline). Click a dot, zone, area or public feature.
- **Layers.** Public layers load from `/api/overlays?layer=<id>&bbox=` with freshness and status from `/api/feeds`. Each layer row shows status, data age, stale and truncated notes. Layers that need a server key are disabled. Fetching happens on toggle, after the map stops moving, and every 2 minutes.
- **Zones.** Draw an area or place a pin (click, Enter to finish, Backspace to undo, Escape to cancel). Points can also be typed as latitude, longitude lines for keyboard use. Edit name, type, note, visibility and times (PATCH with `version`, 409 reloads). Redraw shape. Delete is soft and confirmed.
- **Information boxes.** Send to the selected home, an area cell, or the current map view. 20 and 80 character counters, plain ASCII, no links, no secrets (same rules as the server), expiry up to 7 days, ask for confirmation, customer visible, and a 21 by 8 screen preview. Sent messages show delivered and confirmed states and can be cancelled.
- **Logs.** Live updates feed filtered to everything, the selected home or the selected area. Logs tab queries `/api/ops/logs` by type, level, period, home and area, and downloads JSON.
- **Customer.** "Customer linked" chip in list, map and panel. Help status form (set by a person, 140 character note). Registration code dialog shows serial, code and link once.
- **Exercise mode (`/demo` or demo role).** Uses `exerciseProperties()` only. Areas, priorities and two fictional zones are computed in the browser. Every write control is disabled with a "read only" note.

## Contract assumptions

Where the spec leaves a shape open, the UI reads defensively:

- `GET /api/ops/device?id=` returns `{device|DeviceLive fields, series:{sensor:[{ts,value}]}, logs:[], messages:[], help:{status,note,updatedAt,history[]}, link}`.
- `GET /api/ops/messages` rows may carry `state` or `deliveries:[{deviceId,state}]`.
- `GET /api/ops/logs` rows with an `action` field are audit entries, the rest device logs.
- `POST /api/ops/pairing` returns `serial`, `pairingCode`, `qrPayload`.

## Known limits

- No QR image is drawn. The registration dialog shows the serial, the code and the link.
- Zone vertex editing is not built. Edit metadata, or redraw the whole shape.
- The optional rainfall heat layer is not drawn. Weather feeds risk only.
- Updates are polled, not pushed, so a change can take up to about 5 seconds to appear.
