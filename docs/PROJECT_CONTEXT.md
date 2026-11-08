# HomeBeacon current project context

> November 7 evening NVIDIA update: the user's $60 Brev credits now fund a Crusoe L40S running pinned Nemotron Nano 9B v2. Real authenticated tool calls and the complete four-tool investigation passed with synthetic sensor records in disposable local MongoDB. Adyaan's explicitly requested operator account is now provisioned, and the deployed PR #26 preview passed password sign-in, operator session validation and a real NVIDIA layer request (HTTP 200, power loss AND water, zero matching connected homes). This was an authenticated API check; the browser form was not used. Production, physical sensing and firmware load shedding are not established by these model checks. See [BREV.md](BREV.md) for the fixed shutdown deadline and temporary endpoint limitations.

> November 7 interface update: the user requested a simple, direct website and integration of the newly pushed map. The redesign branch uses a full-viewport satellite canvas with floating tools and on-demand evidence, separate full Overview/Devices/Activity/Demo workspaces, an interactive homepage hurricane preview, homeowner/operator entry paths, explicit registration terms, and unified neutral/green Geist styling. This supersedes older dusk/paper and decorative-homepage notes below. Public demo scenarios use a separate read-only API. Live hazard coverage remains source-dependent; NWS national scope is optional and nationwide imagery is context only.

> Latest navigation refinement: the user supplied an ARGUS reference and requested a slim top bar, collapsible vertical sidebar, more map space and fade transitions between workspaces. The new shell uses the actual Kit section menu, a 56px header, 196/64px navigation widths and 8px canvas margins. Desktop/mobile checks and all 288 integrated tests pass. The user explicitly requested publication to `https://utd-hackathon-26.pages.dev/`; production UI, MongoDB readiness, personal operator sign-in and a real NVIDIA layer call are now verified. See WORKLOG for deployment evidence.

> System integration: [SYSTEM_INTELLIGENCE.md](SYSTEM_INTELLIGENCE.md) defines the additive evidence/Nemotron backend and power-policy reference. The labeled simulator remains available alongside the verified real-model path; automatic firmware load shedding remains unverified. A November 7 6:53 PM screenshot confirms pickup, including **one** AA holder (not the earlier draft's two).

> Design correction: Ayan rejected the current command layout. The evolving [map-only contract](design/COMMAND_CENTER_MAP_ONLY.md) locks a U.S. disaster-region-first map with tools on demand, devices revealed on zoom, and expandable cards anchored to selected houses. Compact cards show status, attention reason and last report time. Ayan approved the rendered satellite-map direction for Astra to develop and refine. That direction is integrated in the redesign preview; later full-view navigation follows the user’s expanded request.


> Latest continuation: [CLAUDE_CONTINUATION.md](CLAUDE_CONTINUATION.md). The actual Argus kit, customer role and live/risk/downlink modules remain. The neutral interface update above supersedes the older dusk/paper theme.


Updated November 7, 2026, America/Chicago. Owner of this handoff stream: Ayan Basheer. Read [Ayan's full handoff](handovers/AYAN-2026-11-07.md) and [request history](history/AYAN_REQUESTS_2026-11-07.md), then verify current branches and providers.

## Current product

HomeBeacon is a prototype home disaster recorder and neighborhood recovery command center. Local sensor observations support human review and follow-up. Missing data means unknown. Last-known critical observations remain visible. No certified alarms, safe-occupancy decisions, insurance coverage decisions or automatic emergency dispatch are provided.

The exact State Farm event challenge and complete current track inventory remain unverified. The intended pitch is property-level observations for catastrophe outreach and regional review, not a live State Farm integration.

## Current application

- Public marketing homepage `/`, session-aware `/portal`, separate `/login`, public `/demo`, protected `/command-center` and `/profile`.
- Actual street maps, synthetic exercise isolation, live Mongo summaries, refresh, filters, follow-up notes, source status, NWS polygon context and preview/apply/clear operator views.
- Operator sign-in/out, profile, password change and single-use recovery-code reset. Explicitly provisioned MongoDB accounts with role `operator` can sign in alongside the original configured operator; new account-backed sessions revoke on disablement, deletion, role changes or password changes. Shared demo cannot access live data or account writes. Public operator signup, email reset delivery and an account-management UI are not implemented.
- Privacy, terms, cookie and accessibility pages. No analytics or advertising. Automated audits pass on checked flows; manual accessibility and legal review remain.
- NVIDIA preview bindings connect to authenticated Nemotron Nano 9B v2 on Brev. Both inference paths passed real-model checks locally; operator access is required on the deployed app. Public synthetic presets work without inference.

## Actual stack and resources

Vanilla JS/CSS/static HTML with esbuild, Cloudflare Pages Functions, MongoDB Atlas, MapLibre with USGS imagery/OpenFreeMap street context and self-hosted Geist/Spline Sans Mono. See [architecture](ARCHITECTURE.md).

- Private repo: https://github.com/hackathon26UTD/utd-hackathon-26
- Live: https://utd-hackathon-26.pages.dev/
- Pages project: `utd-hackathon-26`, production `main`.
- MongoDB app DB: `utd_hackathon_26`. App user `hackathon26-app` is DB-scoped. Supabase is superseded.
- Cloudflare CI/CD tests, builds and deploys. A deployment is not verified until actual `/api/ready` succeeds. See the handoff for latest observed run/deployment evidence.

## Team and collaboration

Ayan owns this product/design/integration workstream. Dhruv authored the core API/hardware clients and shared credential tooling and is working hardware/weather research. Adyaan established the organization/shared MongoDB setup. Saif is a teammate; his active deliverable was not verified here. These are observed contributions, not exclusive permanent assignments.

Before edits, fetch main and inspect relevant teammate branches and PRs. Preserve their intent during merges. Coordinate schemas with the hardware work. Do not contact teammates just because their addresses are in docs.

## Access and workflow

CLI/API first, hands-off execution. User authorized project PR merges/admin merge; no authorization to erase unrelated work or disclose secrets. Existing approvals for app DB access, local/encrypted secret storage and `0.0.0.0/0` Atlas network access persist.

Credentials exist only in ignored local `.env`/`.dev.vars` or service secret stores. CI uses a scoped Pages token, while the global Cloudflare key stays local. Atlas management credentials and application database credentials are different. Expiration/scope must be verified, not guessed. Team contacts stay in private CONTACTS.md.

The active checkout is under `/private/tmp/codex-hackathon26-20261107-active` because the original synced checkout had Git failures. Temporary paths may vanish. Full recreation and stable private env locations are in the handoff.

## Next integration work

Verify actual firmware/gateway sensor names, units, power path and timestamps with Dhruv. Demonstrate real offline replay and idempotency, physical battery endurance and sensor calibration. Exercise the deployed NVIDIA path using an authorized operator account and verify the scheduled Brev shutdown after its deadline. Obtain exact track criteria. Add browser/axe enforcement and UI-only path coverage to CI. Review real-data privacy, retention and accessibility before production household use.
- Referenced ChatGPT conversation: Smart Fridge Hardware Plan, `6aef7693-4d98-83ea-a594-081797eee22b`.
- HackUTD public site: https://zeroday.hackutd.co/
- Signed-in portal: https://harp.hackutd.co/app
- Event Devpost link observed in HARP: https://hackutd-zeroday.devpost.com/
- Earlier Cloudflare draft: https://github.com/AdyaanAkram/utd-hackathon-26/pull/8
- MLH prizes: https://hack.mlh.io/ (redirects to https://www.mlh.com/events/prizes).


## Newly merged database workstream: PR #14

Another agent's `codex/homebeacon-database` work merged while this handoff was being written. Preserve `src/beacon.js`, its tests, explicit schema/setup/reconciliation tools, legacy readings projection and hardware contract. It adds `/api/beacon/ingest` with retry receipts, homes, telemetry time series, latched incidents and geospatial queries. See [database architecture](mongodb-architecture.md) and [ESP32 contract](../clients/esp32/HOMEBEACON.md). This supersedes earlier notes saying no HomeBeacon ingest adapter exists.

Update after Ayan's immediate-ship request: explicit Atlas schema bootstrap succeeded and direct inspection verified required collections and time-series retention. The full hardware-to-UI path has not been validated. Do not treat legacy database readiness as proof of new collections/indexes. Verify home coordinates and latched incidents are reflected in the existing command-center projection before calling that integration complete. `feat/futureyou` / PR #15 is separate work and was not merged by this handoff.

## Radar playback (local branch)

`codex/weather-radar` adds optional NOAA MRMS observed radar playback to the command map. It is real historical radar for the contiguous U.S., separate from simulated hurricane scenarios and forecast precipitation; the user must enable it. Local browser verification passed; not deployed as of this entry. See WORKLOG for limitations.
