# Household release verification

Ayan workstream, November 8, 2026. User requested household sharing, device updates, weather warnings and local news, then explicitly deferred email setup.

## Reviewed release

- Base: `f7a84816a12016205fdfcde2cab4b18beab9246d`.
- Reviewed feature head: `e9466ab2568972e81cdab83d16977a3d655eaf96`.
- PR: https://github.com/hackathon26UTD/utd-hackathon-26/pull/44
- Squash merge: `59770371c6799d1d21bb00e41517b391cbee79f2`.
- Task-specific sharing/UI review, context/email review and final whole-branch integration/security review all approved after corrections. No actionable review findings remained at the reviewed head.

## Automated and browser evidence

Local installation/build passed. The combined test suite passed **481 tests, zero failed or skipped**. The household additions account for 60 tests: 26 sharing/authorization tests, 27 disabled/optional-email tests, six context/source/cache tests and one real account-rename round-trip integration test. Eight separate headless Chrome checks passed, covering the actual bundled UI with injected disposable API responses.

Actual local Pages runtime with a disposable MongoDB replica set and two test accounts passed: owner creates household with a selected device; addressed recipient accepts a private invitation; fragment disappears; shared reports appear; owner revokes access; recipient reports clear on the next refresh. Desktop and 390px layouts had no page errors, no horizontal overflow and zero scoped Axe findings. The tests also cover the maximum 60-character unbroken household name, keyboard names, stable focus during polling, initial list/detail failures and subsequent recovery. No production household fixtures or real recipients were created.

Real source reads through local Pages returned official NWS point alerts and 12 hourly forecast periods plus KUT headlines. Direct publisher checks returned five recent items each for Dallas Free Press, Fort Worth Report, WUSF and KPBS, and one for KUT at inspection time. Feed availability and count vary. KERA's previous RSS endpoint redirected to its replacement website; it was not presented as a working feed. Sources are bounded regional headline feeds, not nationwide news monitoring or event-at-home evidence.

## Review corrections

- Current account, owner, membership and selected device ownership are checked at every read and again after source I/O. Email rename closes owned households and revokes affected memberships/tokens/queues in the same transaction. Renaming away and back cannot restore old access.
- Weather source links keep registered coordinates server-side, including old cached link shapes. Cache projection rechecks alert expiry, forecast period validity and headline age without replacing the original source times.
- Optional mail revalidates current device freshness and exact transition revision before delivery, including jobs outside the scheduler's current household batch. A newer successful weather result that removes an alert suppresses old queued mail; source failure defers rather than inferring recovery.
- Signed callbacks are persisted before acknowledgement and reconciled against later provider receipts. Early/ambiguous callbacks, duplicate replay and replacement account generations have regression coverage. Provider acceptance remains distinct from delivery.
- Hazard condition age/stale wording is preserved. Device heartbeat time is labeled last device contact, not substituted for hazard observation time.
- Household polling retries failed initialization, mounts controls after recovery, keeps scheduling after recoverable errors, and wraps long names on narrow screens.

The final independent review additionally exercised anonymous/foreign/alerts-only context denial without upstream calls; revocation/unlink during source I/O; source-cache TTL with email off; email rename before household collections exist; disabled email sweep making no household database/network calls; and normal data-refresh behavior with email off.

## Hosted preview

Cloudflare run `42467007980` passed checks and deployment for exact feature head `e9466ab`. Preview: https://pr-44.utd-hackathon-26.pages.dev (deployment https://cc7559f2.utd-hackathon-26.pages.dev).

Twelve current customer/app/style/shared assets matched local hashes. `/`, `/customer`, `/signup`, `/portal`, `/login`, `/simulations`, `/privacy` returned 200. `/api/ready` confirmed database connectivity. Anonymous household, context and email-settings endpoints returned 401. This proves deployed public assets and authentication boundaries, not a real production household enrollment.

## Explicit limits

Email delivery stays disabled. No sender was configured and no real message was sent. Source coverage/failures/ages remain visible; context is bounded to five distinct selected locations. Sharing is read-only and grants no operator, device-management or infrastructure permission. Physical sensor behavior, actual email delivery, manual assistive-technology review and legal/privacy approval are not established by automated tests. The original active checkout's unrelated uncommitted workflow files were left intact.

## Production

Production Cloudflare run `42467292475` passed checks and deployment of `59770371c6799d1d21bb00e41517b391cbee79f2`, deployment https://18c7442a.utd-hackathon-26.pages.dev. The canonical live site https://utd-hackathon-26.pages.dev matched all twelve checked customer/app/style/shared assets. Public routes returned 200, database readiness passed, and all three anonymous household read endpoints returned 401.

A read-only Cloudflare project API check independently confirmed the canonical production commit is `5977037`; household email is not enabled, and neither the Resend API key nor webhook secret is present. Only configuration presence/booleans were inspected in output; no secret values were printed. No real production household was created, no real email sent, and no physical box was tested by this release.

The final evidence-only documentation commit does not alter deployed code. The original active checkout remains untouched. Local full-suite host transport checks used the already-installed ArduinoJson headers; physical validation remains separate.
