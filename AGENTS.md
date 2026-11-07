# Project instructions

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
