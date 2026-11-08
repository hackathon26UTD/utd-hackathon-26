# Onboarding security review

Reviewed November 8, 2026 (America/Chicago), Ayan integration workstream, in `/private/tmp/hb-onboard`. Initial base HEAD: `17cdb48bb9fffa116b8cd6b3aec24b27eeed10ea`; final verification base HEAD: `9af42bbf53feaf32f4a71d6c77c97ba5fc7ea5e6`, including concurrent uncommitted fixes. This is a local source and executable boundary review, not deployment approval or production verification.

## Final disposition

**No unresolved findings remain in the reviewed scope. SEC-01 through SEC-04 are resolved.**

**SEC-02 — P2: legacy operator unlink audit attribution (RESOLVED).**

Original location: `src/customer.js:524–528`, legacy `DELETE /api/ops/pairing`. The operator audit previously ran outside the unlink transaction. Failing only its `link.release` insert reproduced a 200 response, completed unlink and a misleading customer-attributed release record. The broader audit-outage test did not exercise this narrower failure.

Verified fix: `unlinkDevice` now accepts trusted internal actor/action options and inserts the audit inside the ownership transaction. The operator route passes the authenticated operator and `link.release`; its separate audit call is removed. A targeted operator-audit failure now returns 503, keeps the active link, leaves pairing/device records unchanged, and creates neither release audit. Successful operator release records exactly one operator-attributed `link.release`; customer release retains `customer.unlink` and its customer actor. Forged actor/action fields in a customer DELETE body cannot change that attribution.

This finding was reported immediately in the coordinating conversation. Review ownership is limited to this document and `test/fleet-security.test.js`; implementation changes belong to the integrating agent.

## Fixed or closed during the review

| ID | Boundary | Current evidence |
| --- | --- | --- |
| SEC-01 | Legacy pairing issuance racing claim | Implementation now uses a transaction, explicit version 1, and the shared device revision. Forced interleaving cannot reopen a card while a committed active owner remains. Audit-failure rollback and five concurrent issuances pass. |
| SEC-02 | Legacy operator release and attribution | RESOLVED: operator audit and ownership changes share one transaction. Narrow failure rollback, correct success attribution, preserved customer attribution and rejection of body-supplied actor overrides pass. |
| SEC-03 | Exercise claims with an address | The created home now retains its exercise flag. Actual address-backed claim with a synthetic geocoder passes. |
| SEC-04 | Pause/unlink/consent change during legacy email preparation | Originally reproduced a provider call after pause committed. The implementation now rechecks the exact active link, recipient, consent and pause after preparation, then marks suppressed events. Pause regression and both sender variants for unlink/consent revocation pass. |

A request to issue a replacement code may legitimately retry its transaction after both a claim and unlink complete. That is a new authorized issuance serialized after release, not replay. The test requires the original card to remain unusable, a new audited issuance after unlink, and one active owner. It does not incorrectly forbid transaction retry.

## Executable coverage

The new suite uses `MongoMemoryReplSet` on loopback and real MongoDB transactions. Each case gets its own database. Test-only proxies pause specific database calls to reproduce races or inject narrow audit failures; they do not emulate successful database writes. No environment files are loaded. Provider calls use injected synthetic transports. Replica set/client teardown runs after testing.

Covered boundaries:

- Eight simultaneous claims: exactly one owner, home and claim audit. Used codes fail before and after unlink; secret hashes/salts are erased on claim.
- Claim, customer unlink, forced unlink, disable, batch creation and legacy code issuance roll back after audit failure.
- Customer/fleet competing unlinks commit only once; claim racing fleet reissue cannot leave an active owner with an available card.
- Concurrent legacy issuance retains serial identity and only the final stored card works. A held legacy write races real claim/unlink transactions.
- Real Functions middleware and route exports reject customer/device/anonymous provisioning, browser operator provisioning, demo writes, cross-origin customer mutation, foreign customer link IDs and ownership-field changes. Admin-key batch provisioning succeeds.
- Legacy `POST /api/devices` and `/api/devices/` deny authenticated browser operators before admin-header injection; genuine administrator bearer keys reach the next handler. This middleware test uses a stub next handler and never creates inventory.
- Demo fleet queries remain exercise-only even with `mode=live`; address-backed exercise claims preserve environment tagging.
- Fleet/customer/pairing read projections and audits omit generated device keys, codes, code hashes and salts. Contact information is absent without consent. One-time provisioning responses use `no-store`.
- Wrong-code lockout, expired codes, wrong HMAC pepper and disabled devices reject ownership. Rotated/disabled keys cannot ingest or create first-report evidence.
- Pauses suppress both legacy customer event senders; expiry resumes sending; unlink revokes the recipient. Mid-preparation pause and unlink/consent changes prevent handoff after the SEC-04 fix.
- Household pauses block new queue entries and suppress already queued retry jobs. This path executes real household membership, encrypted payload preparation and queue state checks with a synthetic sender.

CLI/security review also covered `scripts/commands/provision.mjs`, `devices.mjs`, labels/QR helpers and the existing dedicated CLI suites: private output permissions, exclusive creation, symlink/hardlink protections, preflight before mutation, no terminal credentials including verbose failures, preserved one-time responses, QR contents and origin handling. Existing CLI tests inject their own environment and HTTP transport.

## Verification record

- Before final SEC-04 extensions: **101/101** passed across security, fleet onboarding, customer, email, household email, CLI and label suites.
- After the SEC-04 fix: **40/40** passed across the then-20-case security suite and 20 CLI/label tests.
- Expanded SEC-04 unlink/consent coverage: **21/21** security tests passed.
- Before the final SEC-02 fix: targeted run **1 passed, 1 failed**; complete security suite **21 passed, 1 failed**. Historical failure observed `{status: 200, active: false, customerUnlinks: 1}` instead of atomic failure `{status: 503, active: true, customerUnlinks: 0}`. The regression remains a normal assertion.
- After the final SEC-02 fix: **58/58** passed across security, fleet onboarding, customer and email suites.
- Expanded SEC-02 success attribution and full rollback coverage: **23/23** security tests passed.
- Final security suite including the legacy provisioning boundary: **24/24 passed, zero failures, skips or TODOs**. Both `/api/devices` and `/api/devices/` reject browser operators and admit genuine administrator keys.

Commands:

```sh
node --test test/fleet-security.test.js
node --test --test-name-pattern='SEC-02' test/fleet-security.test.js
node --test test/fleet-security.test.js test/fleet-onboarding.test.js test/customer.test.js test/email.test.js
node --test test/fleet-security.test.js test/fleet-onboarding.test.js test/hb-onboarding-cli.test.js test/hb-labels.test.js test/customer.test.js test/household-email.test.js test/email.test.js
```

The integrating agent separately reported 651 passing cases plus the original SEC-04 failure in an earlier full run. That is historical coordination context, not a current full-suite result independently verified by this reviewer. The final local verification above resolves this review's findings; the parent remains responsible for full integration/release checks on the commit being merged.

## Scope and limits

- Reviewed changed customer/fleet/pairing/lifecycle/live API code, Functions middleware/routes, provisioning CLI, and notification paths relevant to pause. Preserved concurrent UI/CLI and implementation edits; did not modify implementation, worklog, package manifests or other tests.
- Browser operators are intentionally allowed one-time rotation/reissue responses. New inventory provisioning requires genuine administrator credentials on both fleet-batch and legacy device-registration routes; the server enforces credential separation, not the identity of a particular CLI executable. Read projections and ordinary terminal output are separately checked for credential exclusion.
- Customer/household device GET no longer records silent-device events. Source inspection confirms the scheduler calls `checkSilentFleet`; operator fleet GET still records scoped silence events. Physical receipt, scheduled production execution and hardware state were not tested here.
- No production writes, real email sends, secret-file reads, deployment, merge or provider credential access were performed. Real provider delivery, distributed failures after network handoff, and recall of already-sent mail are outside the local verification claim.

## Handoff

Keep both owned files for the parent change. This scoped review is clear after the verified fixes; retain all regression tests and complete the parent's full checks on the final commit. No implementation changes were made by this reviewer. This document is the scoped handoff instead of editing shared WORKLOG files, per the explicit two-file ownership instruction.
