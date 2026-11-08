# Project instructions

## Git attribution

Preserve the actual human author's Git identity and credit human contributors accurately. Commit authors, committers and co-authors must reflect actual human contributors; omit generated-by footers and session links. Do not misrepresent development methods. Keep product integration documentation and third-party license notices intact.

## Shared context and logs

Before changing this project, read `docs/PROJECT_CONTEXT.md` and the recent entries in `docs/WORKLOG.md`. Inspect live repo/provider state when consequential; history can be stale.

After meaningful work, append the date (America/Chicago), request/decision, actual changes, verification, blockers, and next action to `docs/WORKLOG.md`. Update the context, decisions, architecture, hardware, and development docs when their facts change. Distinguish plans, user preferences, and verified completion. Record failed approaches and reversals honestly without duplicating entire transcripts.

Keep teammate work intact. MongoDB supersedes Supabase. Cloudflare is the intended hosting provider; the product, framework, hardware choice, AI provider, and app API are not fixed. Coordinate through branches/PRs and check current branches before edits.

## Sensitive data

Never put tokens, passwords, cookies, credential-bearing database URIs, private invite URLs, or QR credentials in source, logs, screenshots, or chat. Real secrets belong only in ignored local environment files or the intended service's secret store. `.env.example` contains placeholders only. `docs/CONTACTS.md` contains user-authorized personal team contacts and must remain in the private repository; do not publish it publicly. Never contact teammates just because a document includes their address.

## Credentials and service state

Read `docs/PROJECT_CONTEXT.md` for the requested credential scope and provisioning state. Do not assume a token exists, has no expiration, or grants database data access because administration access is available. Do not claim a deployment or database connection works until directly tested.

## User workflow preference

Prioritize CLI/API access. Use Chrome to establish access or handle capabilities unavailable through APIs. Complete authorized, solvable setup without handing routine steps back to the user. Credentials are in the ignored local `.env`; never log their values. Use the intended hackathon resources and preserve unrelated account projects.

## Ayan workstream handoff and coordination

For work continuing Ayan's product/design/infrastructure stream, read `HANDOFF.md` and `docs/handovers/AYAN-2026-11-07.md` first. Label logs and handoffs as Ayan's workstream while attributing actual teammate contributions. Always fetch current branches, inspect open PRs and relevant teammate changes, and reconcile their contracts before edits. Preserve both intents during merge resolution; do not blindly choose ours. Dhruv's core API/hardware/credential work and Adyaan's organization/database work are shared dependencies.

The product is now Safe Home (formerly HomeBeacon). Read docs/BRAND.md before changing compatibility identifiers. Vanilla JS/CSS/esbuild, Cloudflare Pages Functions, MongoDB, real MapLibre maps and server-side operator sessions are implemented. The public marketing homepage, separate portal/login and controllable motion are required. Optional NVIDIA integrations require current provider/runtime checks; physical hardware behavior is not established by simulation data. Use current context and source over stale starter notes.
