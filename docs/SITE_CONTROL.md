# Cloudflare site control and MongoDB

Current as of November 7, 2026. Ayan's workstream. Management access is a team CLI, not a public browser administration endpoint.

## What is connected

`npm run site -- status` verifies Cloudflare Pages access and upserts a non-secret `service_connections` record in the application MongoDB database. It stores project/account IDs, site URL, verification timestamp and a credential-store reference. API token values stay outside MongoDB, in the approved local environment and service/GitHub secret stores.

`npm run site -- deployments` stores the latest ten deployment summaries in `site_deployments`. Only IDs, branch/commit, URL, timestamps and status are persisted. Full Cloudflare responses, environment settings and credentials are never saved.

`npm run site -- retry DEPLOYMENT_UUID` asks Cloudflare to retry an existing deployment. `npm run site -- rollback DEPLOYMENT_UUID` accepts only a successful production deployment as a target. These mutate the site only when explicitly invoked. Cloudflare may reject retries for unsupported deployment types; new Direct Upload builds should use the existing `npm run deploy` flow. There is no delete command.

Mutation requests are recorded in `site_control_audit` before sending. Accepted responses are recorded; network/other ambiguity remains unconfirmed. Do not automatically retry ambiguous mutations or assume accepted means live. Verify the immutable URL and `/api/ready`.

## Credentials and ownership

Loads the team's existing env helper. Prefers the dedicated `CLOUDFLARE_SITE_API_TOKEN`, with Pages read/metadata/write permissions on the intended account and no expiration specified. The existing deploy-only token returned 403 for project reads, so a separate management token was created privately. Falls back to another scoped Cloudflare token, with existing local key/email as fallback. `CLOUDFLARE_ACCOUNT_ID`, optional `CLOUDFLARE_PAGES_PROJECT`, and the private Mongo URI identify the intended hackathon resources. The shared demo and browser operators are not given provider tokens. No new runtime permission is granted to the website itself.

## User auth is separate

Operator sign-in uses salted password hashes and signed eight-hour secure HTTP-only cookies. Password change revokes older sessions; recovery uses a one-time code. Profiles are in MongoDB. Shared demo is exercise-only. Device keys authenticate hardware, while provider tokens authenticate management tools. There is no Supabase/Clerk/Auth0 integration, no email-reset service and no general team-invitation system yet.

## Limitations

This is not a no-code content editor or arbitrary infrastructure control panel. The site's source/CI remains the deployment path. Mutation commands are implemented but were not exercised just to demonstrate setup. Future browser control would need an explicit administrator role, separate authorization, anti-CSRF and an audit trail, rather than giving every operator broad provider access.

Official endpoint reference: https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/
