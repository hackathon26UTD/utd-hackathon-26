# Safe Home

Safe Home combines unattended home sensor reports with nearby disaster context. Households can register a box and view its conditions. Operators can review many devices, inspect recorded events and send device messages for human follow-up.

Built for HackUTD by the team in **hackathon26UTD**. Formerly **HomeBeacon**; existing URLs, device contracts and connection identifiers remain compatible. This is a prototype, not a certified alarm or an emergency dispatch service.

[Live website](https://utd-hackathon-26.pages.dev/) · [Simulations](https://utd-hackathon-26.pages.dev/simulations) · [Team documentation](docs/README.md) · [Current handoff](HANDOFF.md)

## What works

- A complete public website, separate customer signup/sign-in and protected operator command center.
- A lower-48 street map, state zoom, device conditions, official-source overlays and distinct map views for wind, sun, UV, flood, terrain, fire, air and other context.
- Full device pages for conditions, sensors, logs, messages, customer linkage and a replayable workflow canvas.
- Address-based device pairing, self-built box registration, profile photos and household sharing through private invitation links.
- Five-step synthetic simulations, shared browser/HTTP/CLI/MCP simulation logic and customer-scoped assistant connections.
- Recorded telemetry, retry receipts, latched incidents, device message queues and retained history/reference summaries.

Live provider availability varies. Email delivery is disabled at Ayan's request. Physical sensor calibration, power endurance and outage/reconnect behavior still need board verification. Previously tested model connections do not prove a hosted model is running now. See the [capability guide](docs/PRODUCT_GUIDE.md).

## Run locally

Use Node 22 and the existing lockfile:

```sh
npm ci
npm run build
npm run dev:local
```

The last command starts a disposable local MongoDB replica set and Pages runtime on port 8788. For an already configured private environment:

```sh
npm run dev -- --port 8792
npm test
```

Keep `.env` and `.dev.vars` private. Do not overwrite existing files or copy their contents into issues. Detailed setup, local credentials, test dependencies and troubleshooting are in [Development](docs/DEVELOPMENT.md).

## Find your workstream

| Work | Start here |
| --- | --- |
| Product, customers and operator journeys | [Product guide](docs/PRODUCT_GUIDE.md) |
| System boundaries and source map | [Architecture](docs/ARCHITECTURE.md) |
| Setup, build and verification | [Development](docs/DEVELOPMENT.md) |
| Deployment, failures and credential handling | [Operations runbook](docs/OPERATIONS_RUNBOOK.md) |
| Firmware and real device reports | [Hardware testing](firmware/TESTING.md), [ingest contract](clients/esp32/HOMEBEACON.md) |
| API, risk, feeds and retained records | [Documentation index](docs/README.md) |
| Contributions and coordination | [Team](docs/TEAM.md), [current context](docs/PROJECT_CONTEXT.md) |
| Rename and compatibility | [Safe Home brand](docs/BRAND.md) |

## Shared implementation

Vanilla JavaScript/CSS and esbuild, the team's actual vendored Argus kit, MapLibre/OpenFreeMap, Cloudflare Pages/Functions and MongoDB Atlas. Public route shells live in `public/`; browser modules in `ui/`; API handlers in `functions/` and `src/`; shared models in `domain/`; box software in `firmware/` and `clients/`.

Production remains the `main` branch of this private repository and the Cloudflare project `utd-hackathon-26`. Pull-request previews and production are tested and deployed through GitHub Actions. Deployment requires runtime checks after upload. Read [operations](docs/OPERATIONS_RUNBOOK.md) before changing infrastructure or credentials.

Missing reports mean unknown. Last-known critical evidence remains visible. No screen, model response or message establishes occupancy, damage, safe entry, insurance coverage or emergency dispatch. Source is private/unlicensed; included third-party licenses remain applicable.
