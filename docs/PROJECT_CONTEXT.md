# HomeBeacon current project context

Updated November 7, 2026, America/Chicago. Owner of this handoff stream: Ayan Basheer. Read [Ayan's full handoff](handovers/AYAN-2026-11-07.md) and [request history](history/AYAN_REQUESTS_2026-11-07.md), then verify current branches and providers.

## Current product

HomeBeacon is a prototype home disaster recorder and neighborhood recovery command center. Local sensor observations support human review and follow-up. Missing data means unknown. Last-known critical observations remain visible. No certified alarms, safe-occupancy decisions, insurance coverage decisions or automatic emergency dispatch are provided.

The exact State Farm event challenge and complete current track inventory remain unverified. The intended pitch is property-level observations for catastrophe outreach and regional review, not a live State Farm integration.

## Current application

- Public marketing homepage `/`, session-aware `/portal`, separate `/login`, public `/demo`, protected `/command-center` and `/profile`.
- Actual street maps, synthetic exercise isolation, live Mongo summaries, refresh, filters, follow-up notes, source status, NWS polygon context and preview/apply/clear operator views.
- Operator sign-in/out, profile, password change and single-use recovery-code reset. Shared demo cannot access live data or account writes. Email reset delivery and broader account administration are not implemented.
- Privacy, terms, cookie and accessibility pages. No analytics or advertising. Automated audits pass on checked flows; manual accessibility and legal review remain.
- NVIDIA adapter is ready for a later key or compatible model endpoint. No NVIDIA key/model is connected. Current presets work without inference.

## Actual stack and resources

Vanilla JS/CSS/static HTML with esbuild, Cloudflare Pages Functions, MongoDB Atlas, MapLibre/OpenFreeMap and self-hosted Geist/Bricolage. See [architecture](ARCHITECTURE.md).

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

The active checkout is under the original temporary integration checkout because the original synced checkout had Git failures. Temporary paths may vanish. Full recreation and stable private env locations are in the handoff.

## Next integration work

Verify actual firmware/gateway sensor names, units, power path and timestamps with Dhruv. Demonstrate real offline replay and idempotency, physical battery endurance and sensor calibration. Connect/evaluate NVIDIA only when the API/model becomes available. Obtain exact track criteria. Add browser/axe enforcement and UI-only path coverage to CI. Review real-data privacy, retention and accessibility before production household use.
