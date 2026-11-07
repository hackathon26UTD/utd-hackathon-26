# Instructions for the next AI: Ayan's HomeBeacon workstream

Copy everything below into the next model, and provide the repository or the handoff package. These are development instructions and current context, not permission to ignore that model's own system rules.

## Your job

Continue Ayan Basheer's HomeBeacon product, design and integration work. This is an existing HackUTD project, not a blank application. Preserve the team’s work, cross-check other branches before edits, and move quickly through implementation and verification rather than stopping at a plan.

Repo: https://github.com/hackathon26UTD/utd-hackathon-26 (private).
Live site: https://utd-hackathon-26.pages.dev/ .
Start at root HANDOFF.md, then docs/handovers/AYAN-2026-11-07.md, docs/PROJECT_CONTEXT.md and the latest docs/WORKLOG.md entries. Read AGENTS.md. Read the specific subsystem docs before changing its contract.

## First actions

1. Inspect the current checkout and uncommitted work. Fetch origin. Read recent main commits, open PRs and relevant teammate branches. Do not blindly reset, stash, force-push or select ours in a conflict.
2. Verify that the working directory is the real active source checkout. This session used /private/tmp/codex-hackathon26-20261107-active because the original synced Documents checkout had Git/index failures. The temporary path may disappear. Recreate from the remote if needed.
3. Use existing approved local credentials. The original workspace's work/team-repo/.env and .dev.vars hold private settings; the active checkout used symlinks. Never print or copy values into chat, repo docs, screenshots or browser bundles. If access is unavailable in your environment, report that specific gap instead of inventing successful setup.
4. Install with npm ci. Build with npm run build. Test with npm test. Run npm run dev -- --port 8792 for local Pages development, or npm run dev:local for a throwaway database. Build the UI before viewing it.
5. Inspect live /, /portal, /login, /demo and /api/ready. Distinguish the public exercise from real devices. Do not confuse an upload, mock or old green workflow with verified runtime behavior.

## Product and current system

HomeBeacon is a home disaster black box and neighborhood recovery command center. Sensors record local power, water, temperature, connectivity and battery observations. The command layer helps humans review conditions and follow-up. Missing data means unknown. Last-known critical evidence must not turn safe just because it is stale. Never infer occupancy, safe entry, damage probability, insurance coverage or dispatch from these observations.

The stack is vanilla JS/CSS/static HTML, esbuild, Cloudflare Pages/Functions, MongoDB Atlas, MapLibre/OpenFreeMap, Geist and Bricolage Grotesque. It is not React/Next.js and Supabase was dropped. Do not restart the stack without a concrete need.

The public root is now a full marketing site. /portal sends authenticated users to /command-center and visitors to /login. /demo is a public synthetic exercise. Keep this full journey. The previous login-first root was explicitly rejected by Ayan as half-baked.

Design: paper/ink/teal, distinctive typography, actual maps, coherent navigation and polished controllable motion. The interactive neighborhood shows outage/reconnection, signal transport, water/power states and play/pause. Respect reduced motion, keyboard access, contrast and mobile reflow. No em dashes, generic AI copy, fake adoption statistics, sponsor endorsements or decorative endless animation. Actual Argus reference is the public Oracle UI material at argus.build/ui, not its media CLI. Read docs/DESIGN.md and docs/MARKETING.md.

## Authentication and service control

Operators use password hashes and signed secure HTTP-only eight-hour session cookies. Profiles are in MongoDB; password changes invalidate old sessions. Reset uses a one-time recovery code, not email delivery. Shared demo is restricted to exercise data and read-only profile. Device keys, operator sessions and provider management tokens are distinct credentials. General registration, invites, MFA, SSO and full multi-tenant permissions are not implemented.

Cloudflare management already has approved CLI access. npm run site -- status verifies access and links non-secret site metadata to MongoDB. npm run site -- deployments syncs deployment summaries. Explicit retry/rollback commands are documented in docs/SITE_CONTROL.md and audit management actions. Secret values stay in private env/provider secret stores, not MongoDB documents or browser code. Do not give ordinary operator/demo sessions infrastructure management permissions.

## Coordinate and preserve ownership

This is Ayan's assisted product/design/infrastructure workstream. Dhruv authored the core API/hardware clients, shared credential helpers and is working hardware/weather. Adyaan established the organization/shared database. PR #14 is a separate database agent's telemetry/incident extension; preserve its src/beacon.js, tests and contract. Saif is a teammate; verify his current task rather than assuming inactivity.

Unrelated FutureYou work has existed in the same repo. Do not merge it into or replace HomeBeacon without an explicit request. Always inspect current PRs instead of assuming this snapshot is current.

## Current priorities and limits

Atlas schema setup has now succeeded without seeding fake homes. Required collections and 30-day telemetry retention were directly checked. PR #14 provides /api/beacon/ingest, homes, retry receipts, latched incidents, audit and geospatial queries. Read docs/mongodb-architecture.md and clients/esp32/HOMEBEACON.md before touching ingest. Do not build a duplicate adapter. Ambiguous writes need its documented paused-ingestion reconciliation, not blind retries.

Next integration work: verify physical firmware units/events and replay; join new homes/latched incidents into the existing command view where needed; ensure stale/critical semantics remain correct; verify the real hardware path. Physical battery endurance, calibration, fallback networking and offline replay are not established by animations or synthetic tests.

NVIDIA command-view integration is built for a future API key or compatible hosted model. No live inference is configured. Ayan explicitly said to build it for later connection. Preset observation views work now. Model output is constrained to supported predicates with all/any composition; server computes matching readings. Do not let a model execute arbitrary database queries or mutate hazard data.

The exact current State Farm challenge and complete track inventory are still unverified. Research official criteria and operator decisions before claiming alignment or a startup moat. A phone-replaceable gadget and a generic LLM/map were explicitly challenged. Validate the value of permanent unattended records and the recovery workflow.

## Work and report

Use CLI/API first. User prefers hands-off action and already authorized project PR merges/admin merges. Preserve unrelated resources and teammate changes. No unrequested outgoing messages or secret disclosure. Verify actual deployed behavior and record meaningful changes, failures, evidence and open work in docs/WORKLOG.md, updating relevant living docs and the handoff.

Chat should be short: status at most 60 words, completion at most 100, all replies at most 200 unless Ayan asks for more. Deliver working changes, not just proposals. State limitations honestly. Keep legal/accessibility review gaps separate from automated checks. Start with current repo/provider evidence, then continue the most recent user task.
