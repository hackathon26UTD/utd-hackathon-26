# Project context and current handoff

Last updated: November 7, 2026 (America/Chicago). This document summarizes this project conversation, the referenced Smart Fridge Hardware Plan conversation, and directly inspected service state. It is not a record of unseen team conversations.

## Current decisions

- Four-person HackUTD team: Ayan Basheer, Adyaan Akram, Dhruv Patel, Saif Yusuff.
- GitHub organization: https://github.com/hackathon26UTD. Ayan's membership was verified active with the admin role. The private repository `hackathon26UTD/utd-hackathon-26` subsequently became available and is the current target. Ayan has admin access.
- Existing starter repository: https://github.com/AdyaanAkram/utd-hackathon-26. This is the earlier personal repository; the current target is https://github.com/hackathon26UTD/utd-hackathon-26.
- Hosting: Cloudflare Pages project `utd-hackathon-26` is configured. The organization PR #8 is pushed and ready for review, with automated preview deployments and main-branch deployment after merge.
- Database: Adyaan's MongoDB Atlas Free cluster is active. The application login `hackathon26-app` has read/write access only to `utd_hackathon_26`. Its connection passed ping, isolated write/read/cleanup, and local Cloudflare-runtime readiness checks. Supabase is superseded; no hosted Supabase resource was deleted.
- Current product direction: a battery-backed home disaster incident recorder (“house black box”) with local hazard observations, durable offline records, energy-aware operation, and a regional response-priority map. State Farm is the intended track; exact prompt and final hardware are unverified. See HOME_BLACK_BOX.md.
- The latest clarification means infrastructure API credentials, not a request to design app CRUD endpoints yet.

## Credential request and actual state

Ayan requested MongoDB Atlas, GitHub, and Cloudflare API credentials in a local `.env`, with broad access and no expiration to reduce team setup friction. Requested scope is not proof that a service supports unrestricted access or that credentials have been created.

- GitHub: existing signed-in CLI credential copied directly into the ignored local `.env`, with file permissions 0600. Token value was not printed or committed. Reported scopes: repo, workflow, gist, admin:org, admin:enterprise. No expiration header was returned; expiration is not independently verified. This is a reused personal OAuth credential, not a newly created organization credential.
- MongoDB: application credentials are saved privately in `.env` and `.dev.vars`, and in encrypted Cloudflare Pages settings. The user explicitly approved adding `0.0.0.0/0` for Cloudflare's changing outbound IPs; database password authentication is still required. No Atlas management key was created.
- Cloudflare: signed in successfully. Existing Global API Key saved locally as `CLOUDFLARE_API_KEY` with `CLOUDFLARE_EMAIL` and account ID. Read-only account API request returned HTTP 200. The existing global key stays local. A separate non-expiring account-scoped Pages Write token was created for GitHub Actions; no global key is stored in CI. Preview hosting is configured.
- GitHub Actions holds only the dedicated Pages deployment token. Database runtime secrets stay in Cloudflare. No credential values were sent to teammates, stored in MongoDB, or committed.

Prefer hands-off CLI/API work and avoid returning solvable setup steps to the user.

The local `.env` contains real credentials and must remain excluded from documentation, Git, screenshots, and chat. Management tokens and database connection credentials have different purposes. Atlas management API credentials cannot read/write application database contents.

## Current workflow and next actions

- Current organization PR: https://github.com/hackathon26UTD/utd-hackathon-26/pull/8. Ready for review, not merged. The old personal-repository PR #8 is closed as superseded.
- Preview: https://pr-8.utd-hackathon-26.pages.dev/status. `/api/health` checks liveness/configuration; `/api/ready` actually pings MongoDB and returns 503 if unavailable.
- [CI/CD runs](https://github.com/hackathon26UTD/utd-hackathon-26/actions): unit/privacy tests, isolated MongoDB integration test, and function compilation run before deployment. Deployment also verifies the live database connection; an upload alone is insufficient.
- Same-repository PRs get previews. Updates to main deploy production after tests. Fork PRs and Dependabot do not receive deployment credentials. Production URL is https://utd-hackathon-26.pages.dev once main has a deployment.
- The home black-box direction is now selected for planning. Final hardware, AI provider and demo scope remain to be confirmed. Coordinate with teammate PR #9 for device ingestion/events/alerts rather than duplicating it.
- Use CLI/API access first and keep credentials private. The persistent `.env` is under the original project work folder; active source checkout is linked from `work/active-repo` because filesystem syncing disrupted Git writes in the first checkout.

## Documentation map

- HOME_BLACK_BOX.md: current concept, meaning of response priority, 24-hour demo proposal, battery/network constraints.

- WORKLOG.md: ordered history and verified work.
- DECISIONS.md: choices, reversals, proposals, open questions.
- CONTACTS.md: names, emails, handles and source confidence (private-team use).
- HARDWARE.md: proposed components, constraints, observed checkout stock.
- DEVELOPMENT.md: collaboration, API planning, development and demo approach.
- RESEARCH.md: track findings, HARP/API observations, source links and limits.
- ARCHITECTURE.md: current stack and boundaries.
- MONGODB.md / CLOUDFLARE.md: provider setup details and pending work.

## Source pointers

- Referenced ChatGPT conversation: Smart Fridge Hardware Plan, `6aef7693-4d98-83ea-a594-081797eee22b`.
- HackUTD public site: https://zeroday.hackutd.co/
- Signed-in portal: https://harp.hackutd.co/app
- Event Devpost link observed in HARP: https://hackutd-zeroday.devpost.com/
- Earlier Cloudflare draft: https://github.com/AdyaanAkram/utd-hackathon-26/pull/8
- MLH prizes: https://hack.mlh.io/ (redirects to https://www.mlh.com/events/prizes).
