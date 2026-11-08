# Safe Home operations runbook

Current as of November 8, 2026. For contributors with existing authorized access to the private organization repository and project resources. Product naming does not change deployment IDs or credentials.

## Release and runtime checks

1. Fetch current main, inspect local changes and relevant PRs, and build/test the exact candidate.
2. Push a scoped branch and open a PR. GitHub Actions runs checks and creates an eligible same-repository preview.
3. Check the preview's changed pages, source freshness, access boundaries and mobile layout. Compare its built assets when verifying an exact UI release.
4. Merge through the authorized team process. Production deploys from `main` to Cloudflare Pages project `utd-hackathon-26`.
5. Check the new production run and deployment URL. Read `/api/ready`, then exercise the changed route on the canonical site. An uploaded bundle or successful earlier deployment is insufficient.
6. Record commit, run, deployment, runtime results and verification gaps in [WORKLOG.md](WORKLOG.md). Avoid creating fake live households or readings for a demonstration.

`npm run site -- status` checks approved management access and records non-secret site metadata. `npm run site -- deployments` synchronizes deployment summaries. These commands can write management metadata; they are not anonymous application health requests. Retry/rollback syntax and audit behavior are documented in [SITE_CONTROL.md](SITE_CONTROL.md). Do not guess a rollback target or reset the repository to roll back a deployment.

## Credential boundaries

| Credential | Used by | Never use it for |
| --- | --- | --- |
| `API_ADMIN_KEY` | Authorized backend/provisioning tools | Browser bundles or boards |
| Per-device key | A registered box using `X-Device-Key` | Other boxes, customer sessions or provider management |
| Operator session | Signed-in operator browser | Cloudflare/Atlas management |
| Customer session | Customer account and selected household access | Operator or infrastructure actions |
| Personal OAuth MCP token | Authorized account-scoped assistant | Arbitrary database access or provisioning secrets |
| Provider-management token | Approved CLI/CI operations | Ordinary operator/customer access |
| Customer NVIDIA key | Explicit account-owned inference | Shared operator inference or device identity |

The admin key is not a substitute for every application's session: customer endpoints enforce customer identity and same-origin rules. Keep `.env`, `.dev.vars`, secret-store values, QR pairing codes, session cookies and invitation links private. Shared provider secrets cannot necessarily be read back after storage. A missing local key does not justify replacing the production key; coordinate the actual dependent tools before a rotation.

## Failure triage

| Symptom | Check and response |
| --- | --- |
| Website opens but reports fail | Read readiness and the specific API status. A static HTML response does not prove the database or feed works. |
| Anonymous request gets 401 | Expected on protected endpoints. Use the correct role/session, not an admin key pasted into browser code. |
| Customer can see map but not operator data | Confirm which surface is public simulation versus protected operator workspace. Role boundaries remain separate. |
| Newly claimed box has no readings | Confirm device identity, measured report submission and last observation time. Never seed normal values to make it green. |
| Many boxes stop reporting | Review power/network evidence and source ages. Silence alone does not prove damage or dispatch need. |
| Provider layer is empty | Check coverage, selected view, viewport/zoom, missing key, cache age and provider errors. Empty/unmapped does not mean safe. |
| A queued message is not on a box | Check expiry, device polling, connectivity and acknowledgement. A successful queue write is not display confirmation. |
| Customer/household access disappears | Check account changes, membership generation, revocation and selected ownership. Never bypass ownership filters. |
| Ingest write result is ambiguous | Pause the affected ingestion flow and follow documented receipt reconciliation. Do not blindly replay writes. |
| A local test fails on Mongo transactions | Use a disposable replica set. Do not change production semantics to accommodate a standalone local database. |

## Data and model handling

Readings, telemetry, incidents, retained history and customer/household records have different ownership and retention rules. Follow [data operations](DATA_OPERATIONS.md), [database architecture](mongodb-architecture.md) and [device history](DEVICE_HISTORY.md). Do not delete retry receipts, clear latched incidents or rewrite timestamps as a cosmetic repair.

Source catalog entries distinguish integrated sources, local tests and unverified credentials. Recheck current provider access before promising live coverage. Avoid collecting private keys through chat. Bounded model output is advisory; unsupported queries are rejected and models cannot mutate hazard observations. Hosted models/credits may expire even if a past integration passed.

## Email, hardware and privacy gates

Email delivery remains disabled. Do not enable a sender, webhook or scheduled send merely because the templates exist. A configuration check is not delivery evidence. Existing user authorization for source/deployment work does not authorize unsolicited messages.

A board flash, measured sensor reading, loss of connectivity, original-timestamp replay, duplicate retry and message acknowledgement need physical verification. Software simulation does not establish endurance or calibration. Keep the hardware owner involved in firmware and threshold changes.

Test with disposable accounts and databases. Production credentials, household addresses, private invitations and real sensor data must not enter screenshots or public examples. Manual accessibility and legal/privacy reviews are not implied by passing automated checks.
