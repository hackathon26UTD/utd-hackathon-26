# Project context and current handoff

Last updated: November 7, 2026 (America/Chicago). This document summarizes this project conversation, the referenced Smart Fridge Hardware Plan conversation, and directly inspected service state. It is not a record of unseen team conversations.

## Current decisions

- Four-person HackUTD team: Ayan Basheer, Adyaan Akram, Dhruv Patel, Saif Yusuff.
- GitHub organization: https://github.com/hackathon26UTD. Ayan's membership was verified active with the admin role. The private repository `hackathon26UTD/utd-hackathon-26` subsequently became available and is the current target. Ayan has admin access.
- Existing starter repository: https://github.com/AdyaanAkram/utd-hackathon-26. This is the earlier personal repository; the current target is https://github.com/hackathon26UTD/utd-hackathon-26.
- Hosting: Cloudflare requested. Framework-neutral Pages starter exists in draft PR #8 in the earlier repository. It has not been merged or deployed.
- Database direction: MongoDB replaces Supabase. Adyaan is provisioning it; pause local MongoDB administrative credential creation until team access is available. No hosted database or Supabase resource was deleted.
- Product, audience, project name, final hardware, AI provider, frontend framework, application authentication, and app API contract remain undecided.
- The latest clarification means infrastructure API credentials, not a request to design app CRUD endpoints yet.

## Credential request and actual state

Ayan requested MongoDB Atlas, GitHub, and Cloudflare API credentials in a local `.env`, with broad access and no expiration to reduce team setup friction. Requested scope is not proof that a service supports unrestricted access or that credentials have been created.

- GitHub: existing signed-in CLI credential copied directly into the ignored local `.env`, with file permissions 0600. Token value was not printed or committed. Reported scopes: repo, workflow, gist, admin:org, admin:enterprise. No expiration header was returned; expiration is not independently verified. This is a reused personal OAuth credential, not a newly created organization credential.
- MongoDB: Adyaan's team organization and `utd-hackathon-26` Free cluster are now active. This computer's current IP was added as a single `/32`. Application database connection and database-user credentials remain unverified; no MongoDB administration key was created by this chat.
- Cloudflare: signed in successfully. Existing Global API Key saved locally as `CLOUDFLARE_API_KEY` with `CLOUDFLARE_EMAIL` and account ID. Read-only account API request returned HTTP 200. No key was created or rotated, and no hosting project or deployment has been created by this work.
- Team distribution of credentials is not configured. Credentials have not been sent to teammates or saved into any database.

Prefer hands-off CLI/API work and avoid returning solvable setup steps to the user.

The local `.env` contains real credentials and must remain excluded from documentation, Git, screenshots, and chat. Management tokens and database connection credentials have different purposes. Atlas management API credentials cannot read/write application database contents.

## Immediate next actions

1. Review the prepared Cloudflare/MongoDB starter and Markdown logs in the private organization repository. Preserve teammates' changes and keep contacts private.
2. Wait for Adyaan to provide team MongoDB access; do not create a credential in the older personal Atlas organization.
3. Use verified existing GitHub and Cloudflare API credentials for further setup. API/CLI first; Chrome when necessary. Never print credentials or copy them into Markdown.
4. Keep existing credentials local/server-only. A stable existing Cloudflare Global API Key is in use; GitHub is a reused OAuth credential. Do not describe either as a newly issued all-access token or claim independently verified GitHub expiration.
5. Move/rebase the prepared Cloudflare/MongoDB starter into the final repository without overwriting teammates' changes. Do not merge the stale Supabase-oriented PR unchanged.
6. Choose one product/problem, define the single demo journey, and reserve compatible hardware only if it remains necessary.

Current organization draft: https://github.com/hackathon26UTD/utd-hackathon-26/pull/8. Not merged or deployed.

## Documentation map

- WORKLOG.md: ordered history and verified work.
- DECISIONS.md: choices, reversals, proposals, open questions.
- CONTACTS.md: names, emails, handles and source confidence (private-team use).
- HARDWARE.md: proposed components, constraints, observed checkout stock.
- DEVELOPMENT.md: collaboration, API planning, development and demo approach.
- RESEARCH.md: track findings, HARP/API observations, source links and limits.
- ARCHITECTURE.md: current stack and boundaries.
- MONGODB.md / CLOUDFLARE.md: provider setup details and pending work.

## Source pointers

- Referenced planning conversation: Smart Fridge Hardware Plan, `6aef7693-4d98-83ea-a594-081797eee22b`.
- HackUTD public site: https://zeroday.hackutd.co/
- Signed-in portal: https://harp.hackutd.co/app
- Event Devpost link observed in HARP: https://hackutd-zeroday.devpost.com/
- Earlier Cloudflare draft: https://github.com/AdyaanAkram/utd-hackathon-26/pull/8
- MLH prizes: https://hack.mlh.io/ (redirects to https://www.mlh.com/events/prizes).
