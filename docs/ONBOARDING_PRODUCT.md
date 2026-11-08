# Onboarding product review

Ayan's workstream. Review date: November 8, 2026. Local review for the parent/integrator; this is not production sign-off.

The customer flow is implemented and its browser checks pass against fixture APIs. The parent separately ran backend lifecycle and security tests against disposable MongoDB replica sets. Those are different evidence: the browser checks do not establish that a browser, deployed server, database and physical box work together.

## Reviewed version and integration

Customer implementation reviewed after its completion commit `0e19e58`, with the parent's subsequent uncommitted `linkedAt` and Fleet-label fixes verified separately below. The parent then integrated main in `9af42bb`, including [PR #60, Nemotron fleet review and responder briefs](https://github.com/hackathon26UTD/utd-hackathon-26/pull/60), merged upstream as `c55328a`.

Fleet inventory and the existing Review workspace are separate views. The retained browser check asserts that Review is still present while opening Fleet, loading its rows and returning to the map. This review changed no customer, backend or command-center implementation. The parent owns fixes and integration.

## Findings resolved by the parent

Both product findings below were fixed by the parent. This reviewer changed no implementation. Final checks are recorded in the verification ledger.

### Resolved: Returning customers retain the elapsed waiting time

Previously, reloading a box that had never reported restarted the ten-minute delay before Wi-Fi help appeared. The customer API omitted `linkedAt`, so the page substituted its own first-read time.

The response now includes the active link's `linkedAt`, and the customer response allowlist test includes it. References: [customer response](../src/customer.js#L305), [waiting calculation](../ui/customer-onboarding.js#L107).

A new regression in `test/customer-onboarding-ui.browser.mjs` opens a waiting box linked eleven minutes earlier, verifies that help appears immediately, reloads without advancing the clock, and verifies that the help is still present after a fresh device read. It also confirms that the waiting checklist disappears once the server fixture reports the box as active. The browser uses fixture APIs; the separate focused server test checks the actual response allowlist against isolated MongoDB.

### Resolved: Fleet reason instructions match the 160-character limit

Previously, submission validation capped reasons at 160 while the field and its label still promised 200. The parent changed both the textarea cap and visible label to 160. The label was checked with its actual en dash: `Reason (3–160 characters)`.

References: [field and label](../ui/fleet.js#L202), [validation](../ui/fleet.js#L219). The Fleet browser suite also attempts a 161-character value beyond the native field cap and confirms that no POST is made. No stale 200-character reason label remains.

## Complete customer journey reviewed

1. **Account access and card handoff.** A private-card fragment is removed before the first authentication request. Its claim stays in page memory through sign-in or account creation. Both legacy six-digit cards and new eight-character cards are supported. Account creation requires terms acceptance and is separate from claiming a box.
2. **Find the box.** Manual serial/code entry works without a camera. A checksum mismatch gives a warning and permits a second Continue for legacy cards. Scanning is optional; camera permission, physical camera operation and reading a printed card were not exercised in this browser review.
3. **Confirm the link.** Box name, room and address are optional. Contact sharing starts off. Enabling it reveals the contact-name field and permits sending that name. No location-sharing or email opt-in controls are invented. An entered address goes to the existing address service; this release does not add a new precise-location privacy switch.
4. **Handle partial success.** Claiming links the box before the optional room PATCH. A failed room save explicitly says the box is linked and directs the customer to Manage to retry, rather than asking them to reuse the consumed card. A failed claim keeps the form available for correction.
5. **Wait for reports.** Device reads repeat every ten seconds while visible. Waiting, reporting, silent and operator-disabled states are distinct. Reporting does not replace urgent sensor evidence or claim that a home is safe. The first waiting-to-reporting transition gets an in-page banner. The original link time now survives a reload; see the resolved finding above.
6. **Manage the box.** Name and room drafts retain focus across polling. Pause for 24 hours, pause for seven days and resume update the alert-pause setting. Failed saves leave a visible error. Pausing does not hide reports or erase incidents. Browser success here proves request/UI behavior only; suppression before actual sending is covered by the parent's backend tests.
7. **Unlink and remove.** The customer gets an explicit explanation and a separate confirmation. Failure retains the box. Success removes it from the list. The UI says that team history remains and a replacement pairing code is needed. It offers no self-service transfer-code issuance or physical factory reset.
8. **Exit and return.** Sign-out clears the onboarding state. An expired session returns to account access and stops device polling. Wi-Fi help explains that an installer must update the box's network configuration; claiming does not set up Wi-Fi or flash firmware.

Contact permission can currently be read in Manage, but there is no in-place consent-edit control. A future transfer, location-privacy or Wi-Fi setup flow needs an explicit API/product decision; these are not represented as completed features.

## Verification ledger

### Browser and UI checks run in this review

| Check | Result | What it establishes |
| --- | --- | --- |
| `node --test test/fleet-ui.browser.mjs` | 16 passed | Fleet fields, filters, consent projection, five confirmation payloads, demo restrictions, key cleanup, error handling, phone accessibility, integrated navigation and reason boundary. |
| `node --test test/customer-onboarding-ui.browser.mjs test/customer-onboarding-ui.test.js` | 18 passed: 9 browser cases and 9 helper cases | QR/manual entry, claim UI, state changes, editing, alert pauses, unlinking, session expiry, phone accessibility and pure helper behavior. |
| Additional review-only customer fixture check | Signup/contact/room-failure/sign-out passed | Fixture-only customer journey review. The earlier waiting-help reproduction is superseded by the retained regression above. |

The Fleet suite is now retained in the repository. It builds into a temporary directory, serves only local test files, mocks all API responses, blocks external requests, and removes its build output. It records no screenshots, videos or traces. Rotation tests use a literal disposable test value, never an actual device key. It runs explicitly because `npm test` currently selects `test/*.test.js`, not these `.browser.mjs` files.

### Focused backend verification run by this reviewer

After the parent's `linkedAt` fix, `node --test --test-name-pattern='register links a device' test/customer.test.js` passed its one selected test. It uses the actual customer handler and isolated MongoDB and checks the updated response allowlist, including `linkedAt`. This is a focused backend integration check, separate from the fixture-based returning-customer browser regression; it is not a new full lifecycle or deployed E2E run.

### Backend evidence supplied by the parent's runs

These results were read from the parent's local logs, not rerun or claimed as browser E2E by this reviewer:

- `/private/tmp/hb-onboard-server-tests.log`: 22 passed, covering customer server behavior and the four fleet onboarding integration tests. The fleet tests use real application handlers/helpers and an isolated MongoDB replica set for provisioning, claim/report/silence/recovery, settings, unlink/reissue, claim races, key rotation and authorization.
- `/private/tmp/hb-onboard-security.log`: 34 passed, including the pause-during-email-preparation regression that failed in an earlier run. This is database/handler evidence, not proof that a real notification was delivered.
- `/private/tmp/hb-onboard-full3.log`: 681 tests, 679 passed, zero failed, two skipped after main integration. Earlier logs had failures; the passing rerun is the relevant recorded snapshot. This full-suite snapshot precedes the final `linkedAt`/Fleet-label fixes; those were verified by the focused reruns above. Counts overlap the focused runs and must not be added together.

Backend tests can be called lifecycle E2E within the server/database boundary. They do not include a real customer browser, external email delivery, the printed-card camera path, or physical device Wi-Fi/firmware installation. No live customer accounts, inventory, keys, messages or device actions were created by this product review.

## Release handoff

Both reported product findings are resolved. Preserve both Review and Fleet when resolving future command-center changes. Re-run the focused browser commands after further changes. Parent release evidence, deployment checks and physical onboarding verification belong in the work log; none is implied by this local product review.
