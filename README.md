# HomeBeacon

A prototype home disaster black box and neighborhood recovery command center.

**Start here when switching agents:** [Ayan's full handoff](HANDOFF.md), [current context](docs/PROJECT_CONTEXT.md), [request history](docs/history/AYAN_REQUESTS_2026-11-07.md), and [documentation index](docs/README.md). Always cross-check current main and teammate work before edits.

Live site: https://utd-hackathon-26.pages.dev/ . Private team repo: https://github.com/hackathon26UTD/utd-hackathon-26 . The public homepage leads to `/portal`; visitors sign in and authenticated operators reach `/command-center`. `/demo` is a labeled fictional exercise.

## Current status

Marketing, command UI, operator profile/password recovery, essential-only cookie preferences, policy pages, Mongo-backed API and deployment are implemented. NVIDIA inference is prepared for a future key/model. Actual hardware operation, offline replay/idempotency, endurance and sensor calibration remain integration work. This is not a certified alarm or emergency dispatch service.

## Local development

```sh
npm ci
npm run build
npm run dev -- --port 8792
npm test
npm run test:db
TEST_BASE_URL=http://localhost:8792 node scripts/test-marketing.mjs
```

Use ignored `.dev.vars` for Pages runtime secrets and `.env` for local service access. `.env.example` is the placeholder template; do not overwrite an existing secret file. The handoff records the approved private local paths. `npm run dev:local` is the throwaway-local-database alternative.

## Site management and next-agent brief

Use [AI_START_HERE.md](docs/AI_START_HERE.md) as the next model's copy-ready instructions. `npm run site -- status` links Cloudflare project metadata to MongoDB; `npm run site -- deployments` syncs deployment summaries. Management secrets stay private outside MongoDB. Explicit retry/rollback usage and limits: [site control](docs/SITE_CONTROL.md).

## Deploy

Cloudflare Pages project `utd-hackathon-26`, production branch `main`. Main CI tests, builds and deploys; live readiness is checked after upload. Authorized local deployment:

```sh
node --env-file=.env scripts/deploy.mjs --branch main --commit-dirty=false
```

See [Cloudflare](docs/CLOUDFLARE.md) and [architecture](docs/ARCHITECTURE.md). No secrets or private contacts belong in public bundles. Source is currently private/unlicensed; third-party map/font licenses are included separately.

## Team API (ready to use)

A product-agnostic REST API is in `src/app.js`: device registration with per-device keys, sensor ingest, latest/history/chart-series queries, threshold rules that open alerts, event logs, and a generic `/api/store/:collection` document store. Contract and deploy checklist: [docs/API.md](docs/API.md). Clients: `clients/esp32/` and `clients/python/`.

```sh
npm ci
npm test            # end-to-end tests against an in-memory MongoDB
npm run dev:local   # Cloudflare runtime + throwaway MongoDB at http://127.0.0.1:8788
```

## HomeBeacon database

The additive HomeBeacon API supports homes, time-series telemetry, retry receipts,
latched flood/power/temperature incidents, and geospatial home queries. Existing
hardware ingestion and dashboard APIs remain available. Configure Atlas in ignored
`.env`, then run `npm run db:setup`; `npm run db:seed` adds only fictional exercise
data using a locally configured `BEACON_DEMO_DEVICE_KEY`. Local Pages runtime
settings belong in `.dev.vars`. See [database architecture and Atlas verification](docs/mongodb-architecture.md)
and [ESP32 contract and curl examples](clients/esp32/HOMEBEACON.md).

## Credentials (hands-off)

`cp .env.example .env`, fill in what you have, then run `npm run access` to see what works (it never prints values). Every script loads `.env` through `scripts/env.mjs`; your GitHub token comes from `gh auth login` automatically. `npm run atlas -- status | ip | ip-add-me | users` manages Atlas once a service account is in `.env`. `.env` stays on your machine; share secrets privately, never in git or chat. Data sources, keys and test status: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Hardware firmware

`firmware/box_a` (XIAO ESP32S3 Sense gateway), `firmware/box_b` (ESP32 sensor box) and `firmware/hub` (Uno Q offline dashboard). Boxes form an AES-128 encrypted ESP-NOW mesh: messages hop box to box until any box with Internet (the gateway) uploads them, so data survives Wi-Fi and cellular outages. Uploads use verified HTTPS. Build, provision, flash and test: [firmware/TESTING.md](firmware/TESTING.md). Datasheets: [docs/DATASHEETS.md](docs/DATASHEETS.md).
