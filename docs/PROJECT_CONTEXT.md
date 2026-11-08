# Safe Home current project context

Updated November 8, 2026. Safe Home is the current product name; HomeBeacon is the former name and remains in compatibility identifiers and historical records. Read [BRAND.md](BRAND.md), [README](../README.md), [Architecture](ARCHITECTURE.md) and the [documentation index](README.md).

## Product and implemented surfaces

Safe Home is an unattended home disaster recorder and a shared review workspace. The public marketing site leads to household signup/sign-in and the operator portal. The operator workspace has a lower-48 street map, state zoom, themed public-source layers, device pages, concise condition summaries and a full workflow replay canvas. Customer accounts support address-based QR/serial pairing, self-built boxes, profile photos and selected-device household sharing.

Five-step Simulations use one deterministic browser/HTTP/CLI/MCP engine. Synthetic frames remain isolated from live telemetry. Personal assistants use customer OAuth scope or an encrypted account-owned NVIDIA key; operator model investigation is separate. Box-side bounded local history/reference learning and website archives exist in code. Physical flash state, calibration, endurance, fallback networking and replay still require board checks.

The latest verified release before the naming work is workflow PR #45, production commit `0086310`, run `42469054959`. Household sharing was verified in PR #44; world views in #43; simulations/history in #41. Exact runtime evidence and newer release results belong in [WORKLOG.md](WORKLOG.md), not a stale green workflow screenshot.

## Fixed implementation choices

Vanilla JS/CSS/static HTML with esbuild, the actual vendored Argus kit, Cloudflare Pages/Functions, MongoDB Atlas and MapLibre/OpenFreeMap. Do not restart the application or migrate to React/Next/Supabase as a rename or styling task. The complete marketing-to-account-to-command journey is required.

Infrastructure identifiers remain `hackathon26UTD/utd-hackathon-26`, Pages project `utd-hackathon-26`, and database `utd_hackathon_26`. Credentials live only in ignored local settings or provider secret stores. APIs, cookies, OAuth/MCP names, device identities and simulation envelopes retain their existing names for compatibility.

## Interpretation and access boundaries

Missing observations mean unknown. Last-known critical evidence stays visible. Do not infer occupancy, safe entry, damage probability, insurance coverage or emergency dispatch. Forecasts, mapped hazard zones, regional news and measured device reports are distinct sources with their own times and limits.

Customer signup and household invitations are implemented. Public operator registration, general enterprise multi-tenancy, MFA and SSO are not. Email code/templates exist but delivery remains disabled at Ayan's request. Provider keys and hosted-model uptime must be checked in the current environment; historical success does not establish today's configuration.

## Team and active work

Ayan owns this assisted product/design/infrastructure integration stream. Dhruv authored core API/hardware clients, credential tooling and sensor-threshold work. Adyaan established the organization/shared database. Saif is a teammate whose current deliverable must be checked rather than assumed. Contributions are shared dependencies, not permission to overwrite another branch. [Team guide](TEAM.md).

Fetch current main, inspect open PRs and uncommitted work, and read the subsystem contract before edits. The original active checkout under `/private/tmp/codex-hackathon26-20261107-active` has contained unpublished place/detail/workflow changes. Other isolated worktrees exist; confirm the actual path and branch rather than resetting one to match another.

Ayan prefers CLI/API and headless Chrome, short updates, hands-off execution and authorized project merges. Do not send unrequested messages or publish private contacts. Preserve unrelated FutureYou work. Continue with physical integration evidence, source availability, operator usefulness and accurately recorded release checks. Official challenge/track criteria require verification before claiming alignment.
