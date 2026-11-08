# Device workflow canvas

Ayan's latest November 8 direction is a static, scrollable workflow. This supersedes the earlier replay animation. The device Workflow tab keeps a dotted canvas and temporarily collapses the main navigation, restoring its previous state when leaving.

Every checkpoint is shown immediately at its latest reported state. There are no playback buttons, timeline slider, speed controls, node reveals, arrow pulses or animated history scrolling. The redundant “Simulation · generated history.” label is removed; the workspace's top demo banner still identifies simulations. Data availability and truncated-history notices remain.

Use a mouse wheel, trackpad, touch scrolling or keyboard to reach every row. Zoom remains available; Fit fits the width while preserving readable labels. Expanded checkpoint explanations reserve space beneath the node and remain reachable. History scrolls independently on the left; on phones it sits below the canvas, with the whole workspace scrollable.

Select a checkpoint or a history entry to open that checkpoint's current explanation. This does not rewind the device or replay an event. Further rule/evidence detail is opt-in. Fixed-rule checks remain labeled, missing observations stay unknown, and existing critical evidence is not cleared. Arrows show checkpoint order, not proof of delivery or dispatch.

Refresh keeps open explanations, keyboard focus and history scroll. The full available event list is retained with server window/truncation limits. No additional client-side 80-event cutoff is imposed.

Device and area send-message actions, New message and board-message-polling controls are removed from this workspace because physical display delivery is not supported by the current box. Existing message history/cancellation and backend contracts remain intact. Record follow-up is retained for real operators.

## Verification

Build with `npm run build`, then `node --test test/workflow-ui.browser.mjs` for actual Argus/Chrome checks. Coverage includes native wheel scrolling to the final checkpoint, phone history access, keyboard explanations, full 100-event history, refresh, empty data, teardown and scoped accessibility. Integrated app checks cover removed send actions, tab switching and the demo/live boundary. Release evidence is in WORKLOG.
