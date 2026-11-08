# Start here: Ayan's HomeBeacon handoff

November 8 map world views (PR #43 merged as `de44466`, production verified): an Argus view menu now focuses wind, sunshine, UV, temperature, terrain, flood, rivers/coast, air, fire, faults/earthquakes, power, alerts, declarations or shelters. Read [MAP_WORLD_VIEWS.md](docs/MAP_WORLD_VIEWS.md) and [WORLD_FEEDS.md](docs/WORLD_FEEDS.md). Weather is a sparse 60-location forecast sample, not a continuous street-level field; faults require local zoom. No household risk thresholds changed. Final release evidence is in the worklog.

November 8 simulation/history release (PR #41 merged as `99f0681`, production verified): five-page Simulations, shared HTTP/CLI/MCP engine, private profile photos, unsent customer email templates, and bounded box-to-website retained history. Read [SIMULATIONS.md](docs/SIMULATIONS.md), [DEVICE_HISTORY.md](docs/DEVICE_HISTORY.md), [PROFILE_PHOTOS.md](docs/PROFILE_PHOTOS.md) and the newest work log. Firmware must be flashed and bench-tested before claiming physical outage/reconnect behavior.

November 8 customer extension (deployed in PR #37, production verified): self-built box registration, personal OAuth MCP, optional encrypted NVIDIA keys and password-confirmed email changes. Start with [ASSISTANT_CONNECTIONS.md](docs/ASSISTANT_CONNECTIONS.md), then the latest work log. Physical delivery, live customer-key inference and actual ChatGPT/Claude account connections are separate verification steps.


Latest homepage refinement (November 8): uncluttered hero, non-interactive simulated map playback, exactly three example readings (Power/Wi-Fi/Conditions), upper-right theme/motion Settings, project/team/services context and GitHub link. Compact rounded controls and plain status text replace badge clutter. Sidebar collapse is animated and respects reduced motion. See [MARKETING.md](docs/MARKETING.md) and the latest work log for verification.


Latest November 8 direction: near-white lower-48 street map, state click-to-zoom, nationwide status dots, full device workspace with Argus tabs, and account-first customer signup followed by address-based Add device. The satellite/card directions below are historical. See docs/MAP_V2_SPEC.md, docs/CUSTOMER.md and the newest WORKLOG entry.

Read [the full November 7 handoff](docs/handovers/AYAN-2026-11-07.md) before continuing Ayan's workstream. Read [current context](docs/PROJECT_CONTEXT.md), [request history](docs/history/AYAN_REQUESTS_2026-11-07.md), and the recent [work log](docs/WORKLOG.md).

Always cross-check current main, open PRs and teammate branches before editing. This is Ayan's workstream, not a claim of sole ownership of the team's work. Preserve Dhruv's API, hardware and shared credential changes, and Adyaan's organization/database setup.

For a contributor handoff brief, use [START_HERE.md](docs/START_HERE.md). Cloudflare management/Mongo linkage is documented in [SITE_CONTROL.md](docs/SITE_CONTROL.md).

Latest work: [Integration continuation](docs/INTEGRATION_CONTINUATION.md), including the real owner kit, customer role and live platform. Earlier capability/design notes are superseded there.

Current design work: Ayan rejected the command layout. Read [map-only design contract](docs/design/COMMAND_CENTER_MAP_ONLY.md) and [Astra brief](docs/design/ASTRA_COMMAND_CENTER_BRIEF.md) before UI edits. Default is map only, tools on demand; house selection opens an anchored expandable card.

Approved next direction: Ayan accepted the [satellite map-only composition](docs/design/COMMAND_CENTER_MAP_ONLY.md) for Astra to develop and refine. Start that work with the [Astra implementation brief](docs/design/ASTRA_COMMAND_CENTER_BRIEF.md) and [local prototype](docs/design/prototype/README.md). This supersedes the previous command layout, not the teammate backend/firmware contracts.
