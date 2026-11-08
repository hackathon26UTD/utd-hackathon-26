# Household sharing

Ayan's workstream, November 8, 2026. This document covers task 1 only; context/email/scheduler implementation belongs to the parent workstream. No production fixtures or outgoing email were used.

## Customer experience

`/customer` has household creation, explicit device checkboxes, household settings, invitation email and access choices, private-link copy, pending invitation status, revoke, leave and deletion. Choices use the real Argus dropdown. Invitations are **Not emailed**. Raw invitation tokens stay in module memory and the clipboard only after the owner explicitly copies; fragment credentials are removed immediately and never stored in local/session storage, DOM markup or logs. The guest notice keeps the invitation available through signup/login in the same page. A reload discards that memory; reopen the original private link.

Viewer members see only the owner's explicitly selected live devices. They cannot acknowledge messages, unlink devices, see device history or access owner APIs. Email-only members have optional email preferences but no shared device snapshots or local context. An empty household is allowed. Device polling is about ten seconds and does not replace focused forms. Missing data remains unknown; last-known critical reports stay visible. Failed polling replaces shared reports with an unknown-current-conditions message. Revoked access clears the shared content on the next poll.

Weather and regional news are separate context, fetched only for the selected readable household and ordinarily refreshed every five minutes. Display includes source status, original check/forecast issue/publication/alert times, regional scope and the first-five-distinct-locations notice. Source failures never imply no hazard. Sources/headlines do not feed risk. Invalid/non-HTTPS links cannot become clickable.

Email controls are collapsed under **Email updates (optional)**. With sender setup deferred, configuration remains false and verification is disabled. Manual invitation acceptance never verifies email or enables updates. The parent-owned `ui/household-email-confirm.js` is imported before household/claim fragment processing; its card is mounted for guests and signed-in accounts. `household-email-updated` refreshes the current member's settings.

## Contracts for parent modules

All new IDs are strings. Public handlers use explicitly selected fields, never account credentials, generations or invitation hashes.

- `ensureHouseholds(db)` creates indexes and the rate-limit TTL index; MongoDB must support transactions (replica set/Atlas).
- `resolveHousehold(db, {email, householdId, requireOwner=false, requireView=true})` returns `{household, member, links}` or `HttpError`. Every call checks current customer and owner accounts, disabled flags, email, session generation, household activity and member status/role. `links` includes only selected, active, still-owned, non-exercise links whose device still exists and is enabled. `requireView:false` permits alerts-only members to manage preferences.
- `activeHouseholdMember(db, memberId)` returns the same validated access for all active roles (including alerts) or `null`. It never adopts a replacement member record with a different ID. Database failures still throw, so background callers fail closed.
- `householdSnapshots(db, access, {env, now, deps}={})` revalidates access, invokes existing `listCustomerDevices` / `loadRisk` / `customerView` / `customerMessages` through a selected-links-only database view, and revalidates before returning. Risk computation runs with `readOnly:true`; message acknowledgements are never written. Freeform operator help notes are omitted. Returned devices preserve existing customer summary fields, with help limited to status/text/updatedAt. Removed links are filtered again after the computation.
- `mutateHousehold(db, email, body, {now, expectedGeneration}={})` and `listHouseholds(db,email)` are additional database helpers. HTTP mutations pass the authenticated generation into the transaction.

### Stored documents

`households`: `_id`, `ownerEmail`, `ownerGeneration`, `name`, `linkIds`, `active`, `createdAt`, `updatedAt`, `revision`, optional `deletedAt`.

`household_members`: `_id`, `householdId`, `email`, `accountGeneration` (null while pending), `role` (`owner`, `viewer`, `alerts`), `status` (`pending`, `active`, `revoked`), `inviteHash`, `inviteExpiresAt`, `preferences:{device,weather}`, `emailVerifiedAt`, `verifiedEmail`, creation/acceptance/revocation timestamps. Default preferences are both false and verification fields null. Revocation resets preferences/verification and clears the invitation hash. Records are retained for audit; there is no TTL on memberships. Owner has an active member row.

Limits: 5 active households per current owner generation; 20 selected links; **20 active members plus pending invitations, including the owner**. Invitation tokens have 256 bits of randomness; only SHA-256 hashes are persisted. Tokens expire after exactly 7 days and are consumed atomically once by the addressed signed-in account. Expired pending rows and invalidated active account rows are revoked when creating a replacement invitation. Active and pending rows are returned to owners; revoked history remains server-side.

Concurrency uses Mongo transactions plus a household `revision` write and account/link `householdRevision` writes to establish conflicts with competing creation, revocation, acceptance, deletion, unlinking and account changes. There is no standalone Mongo fallback. Generation/account checks remain authoritative even if an old record has not yet been marked revoked. Parent account-email integration must revoke owned households/membership records in its rename transaction; email rename currently preserves generation, so a later rename back must not revive a previous household binding.

`household_rate_limits`: hashed account/IP plus fixed 15-minute bucket as `_id`, atomic `count`, TTL `expiresAt`. The mutation limits are 60 per account and 120 per IP per bucket. Reads do not send email. Mutation requests require same-origin and a valid current customer session.

## HTTP API

`GET /api/customer/households` → `{households:[{id,name,linkIds,member}]}`. Only active memberships bound to the current account are returned. Self member includes preferences/verification timestamp.

`GET /api/customer/households?id=HOUSEHOLD_ID` → `{household,devices?,members?}`. `devices` is absent for alerts-only; `members` is owner-only. Device IDs are customer-link IDs, not hardware keys.

`POST /api/customer/households` accepts JSON:

| action | fields | result |
| --- | --- | --- |
| create | name, linkIds | household |
| update | householdId, name and/or linkIds | ok |
| delete | householdId | ok |
| invite | householdId, email, role (viewer/alerts) | member, token, delivery:not_emailed |
| accept | token | householdId |
| revoke | householdId, memberId | ok |
| leave | householdId | ok |

Owner cannot leave their own household; delete it instead. Limits and duplicate pending/active invitations return 409. Expired/wrong-account/consumed tokens fail generically. Responses are no-store. No API adds owner privileges to shared members.

## Verification

Run `node --test test/households.test.js` for real disposable replica-set database and signed-session tests. Run `npm run build:ui && node --test test/households-ui.browser.mjs` for real bundled customer UI against disposable browser API fixtures (Chrome; no provider calls). Browser fixtures check create/invite/copy, Argus roles/accessibility names, guest invitation/login, mobile alerts-only, context failures/times/truncation, focus-preserving polling, no extra context polls, unchanged claim fragment flow and no token storage.

The browser fixture test is separate from default `npm test`, because it requires a built bundle and browser. Parent separately tested real local API-backed browser create/invite/accept/revoke. Physical sensor behavior, manual assistive-technology testing, actual mail delivery and production household operations are not established here.
