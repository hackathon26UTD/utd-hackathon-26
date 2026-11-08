# Safe Home team documentation

Current entry point for the **hackathon26UTD** organization. Updated November 8, 2026. Earlier HomeBeacon references describe the same product; [compatibility names](BRAND.md) remain intentional.

## Start here

- [Product guide](PRODUCT_GUIDE.md): what each role does, the main journeys and current limits.
- [Architecture](ARCHITECTURE.md): browser, APIs, database, hardware and provider boundaries.
- [Development](DEVELOPMENT.md): setup, isolated environments, build, tests and contribution steps.
- [Operations runbook](OPERATIONS_RUNBOOK.md): production verification, failure triage, secrets and rollback.
- [Team](TEAM.md): observed contributions and coordination rules.
- [Current context](PROJECT_CONTEXT.md) and [root handoff](../HANDOFF.md): resuming active work.
- [Brand and compatibility](BRAND.md), [rename decision](decisions/0001-safe-home-name.md), [changelog](../CHANGELOG.md) and [work log](WORKLOG.md).

## Operator workspace

- [Command center](command-center.md), [map contract](MAP_V2_SPEC.md), [world views](MAP_WORLD_VIEWS.md), [workflow canvas](WORKFLOW_CANVAS.md).
- [Live polling, downlink and logs](LIVE_DOWNLINK.md), [risk rules](risk.md), [system investigation](SYSTEM_INTELLIGENCE.md), [operator model views](OPERATOR_LAYERS.md).
- [Design](DESIGN.md), [marketing](MARKETING.md), [actual Argus kit](UI_KIT.md), [contrast report](UI_KIT_CONTRAST.md).

## Households and accounts

- [Customer registration and pairing](CUSTOMER.md), [household sharing](HOUSEHOLDS.md), [weather and regional news](HOUSEHOLD_CONTEXT_ALERTS.md).
- [Self-built devices, OAuth MCP and NVIDIA keys](ASSISTANT_CONNECTIONS.md), [profile photos](PROFILE_PHOTOS.md), [account/accessibility notes](ACCESSIBILITY_AND_ACCOUNT.md).
- [Prepared customer email templates](CUSTOMER_ALERT_EMAIL.md). Real email delivery remains disabled.

## Data and devices

- [Core API](API.md), [additive telemetry/incident schema](mongodb-architecture.md), [system contract](SYSTEM_SPEC.md).
- [Source catalog](DATA_SOURCES.md), [feed integration](FEEDS.md), [world feed coverage](WORLD_FEEDS.md), [data operations](DATA_OPERATIONS.md).
- [Retained history and reference averages](DEVICE_HISTORY.md), [simulations and headless use](SIMULATIONS.md).
- [Hardware](HARDWARE.md), [firmware test procedure](../firmware/TESTING.md), [ESP32 ingest](../clients/esp32/HOMEBEACON.md), [device messages](../clients/esp32/DOWNLINK.md), [encryption](ENCRYPTION.md), [datasheets](DATASHEETS.md).

## Hosting and handoff

- [Cloudflare](CLOUDFLARE.md), [site management](SITE_CONTROL.md), [MongoDB](MONGODB.md), [contributor instructions](START_HERE.md).
- [November 7 handoff](handovers/AYAN-2026-11-07.md), [request history](history/AYAN_REQUESTS_2026-11-07.md), [historical decisions](DECISIONS.md), [household release evidence](verification/HOUSEHOLDS_2026-11-08.md).

Historical plans and screenshots are evidence of their date, not current requirements. Current source, this index, living subsystem docs and latest worklog take precedence over abandoned satellite-map or login-first designs. Private contact records stay in this private repository and must not enter public bundles or external documentation.

- [Public weather and News](PUBLIC_WEATHER_NEWS.md): anonymous hazards, national/local NWS alerts, map bounds and observed radar playback.
