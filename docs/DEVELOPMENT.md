# Safe Home development

Current as of November 8, 2026. Start with the repository root, [AGENTS.md](../AGENTS.md), [current context](PROJECT_CONTEXT.md) and the relevant subsystem contract. Use the private organization repository; preserve teammate work.

## Prerequisites and first checkout

Node 22, npm, Git and an authenticated GitHub CLI are the standard path. The lockfile is authoritative. A local Chrome or Playwright Chromium installation is needed for browser checks. Firmware host tests also need a C++ compiler; transport tests use ArduinoJson headers installed through the documented firmware toolchain.

```sh
git clone https://github.com/hackathon26UTD/utd-hackathon-26.git
cd utd-hackathon-26
npm ci
npm run build
```

Inspect `git status`, fetch origin and review current PRs before editing. Do not reset, stash or overwrite someone else's changes. An isolated Git worktree is useful when a teammate is editing the active checkout. Temporary checkouts can disappear; Git is the durable source, not a session folder.

## Disposable local environment

```sh
npm run dev:local
```

This starts a disposable MongoDB replica set, creates required indexes and starts Pages on `http://127.0.0.1:8788`. Override the port with `PORT=8792 npm run dev:local`. It does not prove an Atlas connection. It uses a local-development admin fallback when none is supplied; never copy that fallback into production or onto a board. The first MongoDB binary download needs network access.

The helper reads `.dev.vars` for other settings. Inspect your own configuration privately before using a disposable database with external providers. It does not automatically create a production operator account or seed measured hardware reports. Public simulations require no operator account.

## Existing private environment

Use `.env` for CLI/provider credentials and `.dev.vars` for local Pages bindings. `.env.example` lists placeholders, not usable keys. Create a new file from it only when no private file already exists. `npm run access` checks supported access without printing secret values.

```sh
npm run build
npm run dev -- --port 8792
```

Never put environment files in a PR, browser bundle, screenshot or issue. Do not rotate shared production keys to fix a missing local key. The [operations runbook](OPERATIONS_RUNBOOK.md) explains the credential boundaries.

## Verification by change

```sh
npm test
npm run build
node --test test/workflow-ui.browser.mjs
node --test test/households-ui.browser.mjs
```

The browser files run separately from `npm test` and should follow a build. The workflow suite uses actual Argus components and synthetic timelines. The household suite uses disposable browser fixtures. Broader release checks should exercise the assembled Pages app and the changed live routes. `npm run test:db` checks the configured database and is not a disposable unit test.

Several backend tests start a local MongoDB replica set. Supply only a throwaway test database when using test URI overrides. Do not point test variables at the shared live database. Firmware transport tests may skip without the documented local ArduinoJson headers; report skips honestly. Read [firmware testing](../firmware/TESTING.md) for toolchain setup and physical checks.

## Frontend and brand assets

Build before opening the website. Edit first-party modules, styles and kit glue; leave vendored Argus source intact. Fonts are local packages, map tiles are external sources and source attribution remains visible. The brand share-card source is `ui/brand/social-card.html`; regenerate its checked-in PNG with:

```sh
node scripts/build-brand-assets.mjs
```

The command uses installed Chrome/Chromium, local fonts and no account credentials. It is a development asset command, not part of the server runtime. Compatibility filenames still use `homebeacon`; see [Brand](BRAND.md).

## Contribution and completion

Keep PRs scoped, explain the resulting behavior, and state actual test results and limits. Do not include secret values, real addresses or private invitation links in review examples. Check the preview, merge through the authorized team workflow, then verify production readiness and changed behavior. Record the result in [WORKLOG.md](WORKLOG.md), refresh affected living docs and add a short [CHANGELOG](../CHANGELOG.md) entry. Never treat a green old workflow as proof of the new release.
