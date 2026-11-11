# Changelog

## 2026-11-10 — Demo button and motion polish

### Changed

- Sign-in/sign-up page: the "Explore simulations" text link is now a visible **Try the demo** button with "No sign-in. Sample homes only, nothing live." (`ui/access.js`, `ui/access.css`). It opens `/simulations`, which reads only synthetic data from `/api/demo`; no session, database or device handler is involved.
- Motion (per /animations): customer page entrance 450ms to 250ms; buttons scale to 0.97 on press (150ms ease-out). Reduced-motion rules are unchanged (`ui/product-kit.css`).

Already true, verified not changed: the 3D box is on the homepage `#device` section (commit `dc9e9ef`); demo accounts are GET-only on exercise endpoints (`functions/api/_middleware.js`). Branch `feat/polish-demo-motion` is not merged; the homepage box is also still unmerged on `feat/marketing-about-explorer`.

## 2026-11-08 — Safe Home name and organization documentation

### Changed

- Renamed first-party website, account/assistant copy, page metadata, prepared email subjects and brand assets to Safe Home.
- Published a current [documentation hub](docs/README.md), [product guide](docs/PRODUCT_GUIDE.md), [architecture](docs/ARCHITECTURE.md), [development guide](docs/DEVELOPMENT.md), [operations runbook](docs/OPERATIONS_RUNBOOK.md) and [team guide](docs/TEAM.md).
- Replaced stale entry-point claims about unfinished customer signup, sharing, simulations and model integration with current implementation and verification boundaries.

No protocol, credential, stored-data or infrastructure rename. Read [brand compatibility](docs/BRAND.md) and the [decision](docs/decisions/0001-safe-home-name.md). Email delivery remains off. Physical hardware and complete manual accessibility review remain separate verification work. Release evidence is recorded in [WORKLOG.md](docs/WORKLOG.md).


## 2026-11-07: Ayan's full workstream handoff

Documented current product/stack, observed teammate attribution, coordination rules, request history, research/constraints, verified delivery and known gaps. Replaced stale starter context and architecture. Start at [HANDOFF.md](HANDOFF.md).

## 2026-11-07: Public marketing and portal experience

Replaced the login-first root with a full marketing page, interactive outage scene and motion, product/hardware narrative, command preview, FAQ, navigation and session-aware portal. See [marketing](docs/MARKETING.md), [design](docs/DESIGN.md), PR #13 and its audit report.

## 2026-11-07: Accounts, command center and operator views

Added operator access/profile/recovery, exercise-only demo, live Mongo summaries, real maps and official weather context, follow-up records and NVIDIA-ready declarative views. No NVIDIA connection or physical hardware operation is implied. See [accounts](docs/ACCESSIBILITY_AND_ACCOUNT.md), [operator views](docs/OPERATOR_LAYERS.md) and [work log](docs/WORKLOG.md).

## 2026-11-07: Team API and hosting integration

Integrated Dhruv's core API/client work with Ayan's Cloudflare/Mongo application access, readiness-tested deployment and CI/CD. Later preserved Dhruv's shared credential loader/access checker. See [API](docs/API.md), [architecture](docs/ARCHITECTURE.md) and [work log](docs/WORKLOG.md).

## 2026-11-08: Operations readiness

Faster database path, developer CLI (`npm run hb`), Uno Q agent and installer, Resend email templates, NVIDIA grounding harness with generated thresholds and runbook, and a demo day runbook. Branch only, not deployed. See [TOMORROW.md](docs/TOMORROW.md).
