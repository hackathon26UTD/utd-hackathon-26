# Continue Safe Home

Safe Home is the existing HackUTD project formerly named HomeBeacon. Work in the private `hackathon26UTD/utd-hackathon-26` repository. Start with root `AGENTS.md`, `HANDOFF.md`, `docs/PROJECT_CONTEXT.md`, `docs/README.md` and the latest `docs/WORKLOG.md` entries.

## Establish current evidence

1. Verify the actual local checkout, branch and uncommitted changes. Fetch origin, inspect recent main commits, open PRs and relevant teammate branches.
2. Preserve unpublished teammate work. Use a separate worktree when necessary. Never blindly reset, stash, force-push or resolve conflicts by discarding one side.
3. Read the specific subsystem contract before changing an endpoint, database schema, firmware payload or permission boundary.
4. Use approved private credentials through existing tooling. Report a missing credential precisely; do not print values or rotate shared secrets as a workaround.
5. Install with `npm ci`, build, test the changed behavior and verify the actual runtime. Check the new deployment, not an old successful run.

## Product constraints

Preserve the complete public website, customer signup/pairing/sharing, operator workspace, full Workflow canvas and five-step Simulations. Use the team's real Argus components and current neutral/green design. The default map is lower-48 streets; thematic layers carry source status and attribution. Settings include theme and motion. Keyboard access, reduced motion and phone reflow are required.

The stack is vanilla JS/CSS/esbuild, Cloudflare Pages/Functions, MongoDB and MapLibre. Read `docs/BRAND.md` before renaming any old identifier. Safe Home is the display name; existing resource names, APIs, cookies, scopes, file paths and device identities remain compatible.

Missing data is unknown. Critical history does not become safe because it is stale. No occupancy, safe-entry, damage, coverage or dispatch inference. Simulations stay synthetic. Actual board flash/calibration/networking/battery behavior requires measured verification.

## Workstream map

- Product journeys: `docs/PRODUCT_GUIDE.md`.
- Source boundaries: `docs/ARCHITECTURE.md`.
- Setup/tests: `docs/DEVELOPMENT.md`.
- Deployment/secrets/failures: `docs/OPERATIONS_RUNBOOK.md`.
- Telemetry/receipts/incidents: `docs/mongodb-architecture.md`, `clients/esp32/HOMEBEACON.md`.
- Customer/household authority: `docs/CUSTOMER.md`, `docs/HOUSEHOLDS.md`.
- Headless simulation and assistants: `docs/SIMULATIONS.md`, `docs/ASSISTANT_CONNECTIONS.md`.
- Retained offline/website history: `docs/DEVICE_HISTORY.md`.

Email delivery is deliberately disabled. Do not enable it or send messages without instruction. Model/provider availability must be checked in the current environment. Keep legal/manual-accessibility review gaps separate from automated checks.

## Finish the authorized task

Use CLI/API first and headless Chrome where useful. Ayan has authorized ordinary project PR merges and prefers hands-off execution; do not invent repeated approval gates. Keep chats brief and put detailed evidence in the repository. Update living docs and the append-only worklog/changelog, with exact results and remaining gaps. Respect teammate ownership and unrelated FutureYou resources.
