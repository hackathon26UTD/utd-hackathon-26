# Instructions for Astra: HomeBeacon command center design

You are helping Ayan's workstream redesign an existing operational map. Start with `COMMAND_CENTER_MAP_ONLY.md`, not the previous deployed layout. The current design was explicitly rejected. Coordinate with the team and preserve existing APIs.

**Locked:** default is a full-viewport U.S. disaster overview, all tools open on demand. Remove KPI cards, the permanent side rail, the permanent home queue, the default-selected home and the always-open inspector/activity panels. Disaster regions lead the wide map; individual devices appear as you zoom in. Device details appear only after deliberate selection, in an expandable card anchored to that house. Do not create another ordinary dashboard around a small map.

**Locked interaction:** a compact house card expands in place at the geographic anchor. Compose Kit.sectionBox/Kit.details/Kit.foldOpen content inside the MapLibre anchor; do not substitute a right-hand drawer or invent a Kit.mapCard component.

**Region selection:** zoom into the selected disaster region and open a compact summary anchored to that area.

**Compact card:** status, why attention is needed, last report time. Everything else expands on demand.

**Geography:** U.S. overview, then regions and neighborhoods, then individual houses. National source discovery/aggregation is required; existing Texas-only data is not national coverage. Exact visual/motion treatment still needs review. The source brief separates Ayan's decisions from proposals.

Use the actual Argus library under `ui/kit/vendor/` and its picked standards. Read `docs/UI_KIT.md`, the registry, and the specific component APIs. Compose actual factories for search, menus, layer controls, inspection, message forms and histories. A universal class-decorating observer over old markup does not satisfy this request. Keep vendor files unchanged.

Develop the spatial layout and interaction states before implementation. Show full desktop/mobile map states, selection, tools, source failure/staleness, exercise mode and message workflow. Use real street geography; keep synthetic observations labeled.

Propose coordinated, modern motion tied to real events. No fake liveness, endless fleet-wide pulses or camera hijacking. Include reduced motion and keyboard/focus behavior.

Review the cookie experience honestly: current choices are identical, no optional tracking is installed, the panel consumes map space and dismissal jumps toward the footer. Propose privacy/settings access without an unnecessary consent-style interruption to operations. This is a UX proposal, not legal certification.

Deliver the component bill of materials, annotated compositions, motion demonstration and open decisions. Compare rendered results with the source brief. Do not treat imported styles, a passing gallery, a green build or an axe result as design acceptance. Keep adding accepted decisions to the living brief. Do not deploy another redesign until the design is reviewed with Ayan.

Keep the outer command canvas anchored without blank scroll space. Avoid expensive whole-page rescans or unnecessary font/module downloads. Public website, operator login and household access must remain discoverable. PR #25 repairs the current layout performance and scrolling; it does not replace this redesign.
