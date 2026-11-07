# HomeBeacon architecture

Current as of November 7, 2026. See [full handoff](handovers/AYAN-2026-11-07.md) for ownership, verified state, operational traps and open work.

## Browser and routing

Static HTML routes render vanilla JS/CSS modules bundled by esbuild. `ui/marketing.js` owns the public product experience; `ui/app.js` owns login/profile/legal and the command workspace. MapLibre is loaded dynamically for the workspace. Fonts, map worker and license notices are self-hosted. OpenFreeMap supplies actual street tiles with attribution. See [marketing](MARKETING.md) and [design](DESIGN.md).

`/portal` redirects by session state. Marketing and exercise routes are public; command/profile routes require a valid session. API middleware separates operator access, exercise-only demo access and device/admin API credentials.

## Server and MongoDB

Cloudflare Pages Functions route the API. Dhruv's `src/app.js` provides device enrollment, per-device keys, readings, threshold rules, alerts, events and store operations. `src/db.js` and `lib/mongodb.js` open/close per-request Mongo clients, avoiding reuse of request-bound sockets. The shared Atlas database is `utd_hackathon_26`; application credentials are DB-scoped and encrypted on Cloudflare.

`domain/property.js` converts latest observations into review priority and freshness. Stale/missing values remain unknown unless last-known critical evidence requires review. `functions/api/command-center.js` returns bounded live snapshots. Follow-ups record human actions and explicit sourced evacuation reports; they do not dispatch teams. See [API](API.md), [MongoDB](MONGODB.md) and [concept](HOME_BLACK_BOX.md).

## Newly merged telemetry and incidents

The separate PR #14 database workstream adds `src/beacon.js`: homes/device association, `/api/beacon/ingest`, time-series records, ordinary unique retry receipts, latched incidents, audit and geospatial queries. It preserves legacy APIs and projects sensor records into readings. Explicit bootstrap/reconciliation requirements, partial-write semantics and Atlas verification are in [database architecture](mongodb-architecture.md) and the [hardware contract](../clients/esp32/HOMEBEACON.md). New schema bootstrap and full home/incident joins into the command UI remain unverified. Do not duplicate this work or confuse generic readiness with schema verification.

## Accounts

Salted PBKDF2 password verification, signed eight-hour secure HTTP-only sessions, same-origin state changes, throttling and database-backed session invalidation after password changes. Profile and single-use recovery code reset are implemented. Email reset, self-service registration, invitations, SSO/MFA and general multi-tenant permissions are not. Shared demo is restricted on the server to fictional records/read-only profile/preset views. See [account/accessibility implementation](ACCESSIBILITY_AND_ACCOUNT.md).

## Public context and model views

Weather endpoint obtains bounded NWS, USGS and FEMA information with explicit source status and timeouts. NWS polygons can be mapped when geometry exists; these feeds do not establish damage to a home.

NVIDIA-ready views use bounded sensor snapshots and a constrained declarative output. A model can suggest supported predicates; server-side code selects matching observations. It cannot issue arbitrary database commands or alter recorded priority. The connection is not configured yet. See [operator layers](OPERATOR_LAYERS.md).

## Delivery and verification

GitHub Actions on Node 22 run backend tests, a real MongoDB service/readiness check and builds, then deploy using a scoped Cloudflare token. Mongo service runs on Ubuntu 22.04 due to a verified kernel incompatibility on newer runners. Main deploys production; eligible same-repo PRs get previews. Live deployment helper checks the immutable URL's database readiness and home response. Browser accessibility/interaction tests currently run separately; add CI enforcement and UI path filters as follow-up. See [Cloudflare](CLOUDFLARE.md).

## Hardware boundary

ESP32 boxes and Arduino Uno Q gateway are planned/current inventory, not proof of flashed or calibrated devices. Existing ingest/client contracts must be reconciled with actual sensors. Durable replay/idempotency, battery endurance, fallback networking, voltage/current limits and physical survivability require demonstration. Synthetic UI behavior is not hardware verification. See [hardware](HARDWARE.md).
