# Cloudflare starter

Framework-neutral Pages starter. No product decision, app data model, or frontend framework is assumed.

## Current state

- Pages project: `utd-hackathon-26`, with encrypted MongoDB URI in preview and production settings.
- Public database name is tracked in `wrangler.jsonc`; never put the URI there.
- Existing global API key remains local. CI uses a separate account-scoped Pages Write token without an expiration, stored as GitHub Actions `CLOUDFLARE_API_TOKEN`.
- Repository variables `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_DEPLOY_ENABLED=true` are configured.
- CI gates preview/main deployments on tests and build. The deployment script verifies the live site and real database readiness before passing.
- Preview: https://pr-8.utd-hackathon-26.pages.dev/status. Production follows main after merge.

## Run locally

```sh
npm ci
cp .dev.vars.example .dev.vars
# Fill in your hackathon project's public MongoDB URL and publishable/anon key.
npm run dev
```

Open the local address printed by Wrangler. `/status` displays API status. `/api/health` returns no credential values. `/api/ready` performs an actual MongoDB ping and returns 503 on failure. Do not put privileged keys in `public/` or browser code. `.env` is not the Pages Functions local environment; use `.dev.vars`.

```sh
npm run build
```

This compiles Pages Functions and validates the deployment bundle; static files are already in `public/`.

## Create the hosted Pages project

Use the hackathon's intended Cloudflare account and the Free plan. Avoid adding billing, domains, or touching unrelated projects.

For the included GitHub Actions deployment, create a **Direct Upload** Pages project named `utd-hackathon-26`, production branch `main`:

```sh
npx wrangler login
npx wrangler pages project create utd-hackathon-26 --production-branch main
```

If that name is unavailable, update `wrangler.jsonc` and the deploy script to match the actual project name. Direct Upload cannot later switch to native Git integration without creating a new project. GitHub Actions still gives automatic deployments from main. Alternatively use native Git integration now and omit the Actions workflow; authorizing a private repo owned by Adyaan may require his installation approval.

## Deployment token and GitHub setup

Ayan later requested broad API privileges with no expiration, where supported. No token has been created. Confirm the intended account and the exact available permission selection before issuance; do not silently replace this preference with an event-expiring token. For a deploy-only alternative, the minimum permission is **Account → Cloudflare Pages → Edit** on the intended account. Store the token in the repository's GitHub Actions secrets as `CLOUDFLARE_API_TOKEN`, not MongoDB tables, source files, browser code, or chat.

Set GitHub Actions repository variables:

- `CLOUDFLARE_ACCOUNT_ID`: intended account ID.
- `CLOUDFLARE_DEPLOY_ENABLED`: `true` only when the project, token, and deployment configuration are ready.

The workflow is now enabled. Main pushes run tests then deploy production. Same-repository PRs get previews after tests; forks and Dependabot do not receive deployment credentials. Never add an unrestricted global key to CI. The chosen token permissions determine its account-wide impact; record actual scope and expiration without storing the value here. If collaborator permissions prevent setting repository secrets/variables, Adyaan must add them.

## MongoDB configuration

Confirm the intended hackathon Atlas project and cluster first. Do not use an unrelated personal project. Follow `docs/MONGODB.md` for application access.

In Cloudflare Pages → this project → Settings → Variables and Secrets, set these for production (and preview only if needed):

- `MONGODB_URI`: database connection string including a dedicated application database user; store as an encrypted secret.
- `MONGODB_DB`: hackathon database name.

Redeploy after changing variables. The planned backend needs a database user restricted to the hackathon database. An Atlas administration API key is not an application database credential. Never expose the connection string to the browser. Cloudflare's deployment token belongs in GitHub Actions; MongoDB runtime configuration belongs in Cloudflare.

## First deployment and verification

After review and merge, enable the repository variable and run the deployment workflow. Or, with the approved token in your local environment, run `npm run deploy` from the repository root. Do not pass secrets as command-line arguments.

Check `/`, `/status`, `/api/health`, and an unknown path (404). Confirm the returned `pages.dev` URL and commit in the Cloudflare dashboard. Record the actual URL and account owner here. The configured project is `utd-hackathon-26`; stable URLs are listed above.

## References

- [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [GitHub Actions deployment](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
- [Pages Functions environment variables](https://developers.cloudflare.com/pages/functions/bindings/#environment-variables)

## Verified local authentication

The user authorized reusing their existing Global API Key. The ignored local `.env` contains `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, and `CLOUDFLARE_ACCOUNT_ID`; account REST access returned HTTP 200. GitHub authentication is also verified. No new key was created and no credential values belong here. The user's priority is CLI/API first and hands-off execution, using Chrome for setup only when necessary.

Wrangler supports key/email authentication as an alternative to `CLOUDFLARE_API_TOKEN`: [supported environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/). The CI workflow now uses the dedicated scoped `CLOUDFLARE_API_TOKEN` configured in GitHub Actions. No personal global key was copied to shared CI. `.dev.vars` keeps runtime development variables separate from the local management `.env`; do not expose management credentials in app responses.

## CI/runtime details

The MongoDB service check runs on `ubuntu-22.04`; MongoDB 8.0 rejected the kernel on the original newer runner. Context: https://www.mongodb.com/docs/manual/release-notes/8.0/ and https://jira.mongodb.org/browse/SERVER-121912. The deploy job can run on the current Ubuntu image. Node compatibility is set explicitly for the MongoDB driver.

`scripts/deploy.mjs` uses Wrangler, reads the resulting immutable deployment URL, and verifies `/api/ready` and the home page. Branch aliases may take a short time to propagate. Build success or upload success alone does not establish a working hosted database connection.
