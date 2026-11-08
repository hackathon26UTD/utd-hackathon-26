# Device workflow canvas

Ayan's November 8 direction replaces the graph card and lower history panels. The device Workflow tab fills the remaining workspace with a dotted canvas. The main navigation temporarily collapses to its icon rail and returns to its previous state when leaving. A user can still expand navigation while viewing the workflow. Leaving Workflow pauses playback.

Playback controls sit above the graph. The complete history returned by the timeline contract stays in a scrollable left rail, including later events marked Later. There is no extra client-side 80-event cutoff. Server window/truncation limits remain visible. On a phone the history moves beneath the canvas so checkpoints remain readable. Pan, zoom, Fit, keyboard traversal and the real Argus slider/speed controls remain available.

Play from Now or Restart begins with the first checkpoint. Advancing events reveals the checkpoint path through the current event's stage. Unreported intermediate stages remain explicitly unknown/not reported. Nodes fade in, the arriving event highlights in history, and a finite pulse follows the incoming arrow. Arrows illustrate checkpoint order, not proof of transport or dispatch. The human-only review connection never pulses automatically. Both system and Safe Home reduced-motion settings remove animation. Playback starts only by user action and can be paused or stepped.

Clicking or keyboard-activating a checkpoint pauses playback and opens a concise explanation directly below it. Further rule/evidence detail is opt-in. Status explanations use the event at the selected history position; newer summary notes and future evidence are excluded during replay. Fixed-rule checks are labeled Fixed rules. No model-generated reasoning, inference call, risk threshold change or backend mutation is added. Missing observations and last-known critical semantics remain unchanged.

Refresh preserves the selected event identity. If it leaves the bounded history window, replay pauses at the start with an explicit notice. Open details, focus and history scroll are retained across refresh. Explanation height has reserved graph space, and the viewport brings the expanded node into view.

## Verification

Build with `npm run build`, then `node --test test/workflow-ui.browser.mjs` for actual Argus/Chrome checks. Existing `npm test` covers the underlying conditions/risk/API contracts. Browser coverage includes replay start/step/pause, incoming pulses, inline evidence and future-record exclusion, keyboard focus, full 100-event history, refresh/expiry, empty history, teardown, phone layout, light/dark contrast and reduced motion. Real app checks additionally cover automatic navigation collapse/restoration, switching tabs, production bundles, and anonymous simulation behavior.

The original active checkout's unpublished place/detail/workflow work was inspected and preserved. This implementation is isolated on `codex/workflow-canvas` from current main. No credentials, device data, email or hardware behavior were changed. Automated browser checks do not establish a complete manual accessibility review.
