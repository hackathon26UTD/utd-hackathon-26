# Task 2 report: profile photos and customer email groundwork

Date: November 8, 2026 (America/Chicago). Ayan's HomeBeacon workstream.
Branch: `feat/simulation-studio`.
Requirements: `.superpowers/sdd/SIMULATION_STUDIO_PLAN/task-2-brief.md`.

## Status

Implementation complete within the assigned paths. Parent integration of existing customer/operator screens and account email-change transaction remains parent-owned; the final read-only scan observed both mounts and the migration call in the parent’s uncommitted files. Their complete screen/account flow is not verified by this worker. No deployment, email delivery, provider configuration, real recipients, live account changes or public household images were created. No subagents were used. User-confirmed history on the box and website belongs to a subsequent task and was not implemented here.

The parent's `email:preview` package script was observed and used successfully; package edits and all unrelated files were preserved. Existing auth helpers, account handlers, customer docs and API middleware were inspected. Current branches/open PRs were fetched/read before edits; unrelated feed-key/FutureYou work was not changed. Shared WORKLOG/context files were not edited because this worker's explicit file ownership excludes them; this report records the workstream handoff instead.

## Changed files

- `src/profile-photo.js`: bounded PNG/JPEG/WebP inspection, incremental body limit, authenticated owner-only photo handler, binary persistence, stable account-generation key and transaction-aware email migration helper.
- `functions/api/customer/photo.js`: customer-cookie photo endpoint.
- `functions/api/profile-photo.js`: personal operator-cookie photo endpoint; shared demo and admin-key-only denied.
- `ui/profile-photo.js`: isolated exported mount module, 64px rounded avatar, accessible labeled upload/remove/status, browser preflight/resizing/metadata stripping, disposal and request cancellation.
- `src/customer-alert-email.js`: pure allowlisted/escaped HTML and text renderer with observation/source/freshness and critical/recovery/exercise labeling; fixed safe customer link.
- `scripts/preview-customer-email.mjs`: synthetic local HTML/text previews only, no sends or recipient resolution.
- `test/profile-photo.test.js`: request/auth/storage/format/migration tests and real Chrome widget/raster checks.
- `test/customer-alert-email.test.js`: escaping, facts, labels, time boundaries, URL restrictions and deterministic output.
- `docs/PROFILE_PHOTOS.md`: API, limits, storage, UI hooks, migration and verification limitations.
- `docs/CUSTOMER_ALERT_EMAIL.md`: renderer input contract, preview command and future delivery prerequisites.
- This report, explicitly requested even though `.superpowers` is ignored by default.

## Targeted verification

Final command:

```sh
node --test test/profile-photo.test.js test/customer-alert-email.test.js test/account.test.js test/operator-login.test.js
```

27 tests passed, zero failed/skipped: 19 new tests plus 8 existing operator/account regressions. Tests use disposable local MongoDB; the photo suite uses a one-node replica set to verify migration transaction success and rollback. No application/provider secrets or production databases were used.

Coverage includes:

- Anonymous, cross-role, shared-demo, admin-key-only and revoked/deleted customer access; middleware strips customer Authorization and denies demo photo reads.
- Same-origin PUT/DELETE, self-only GET/DELETE despite foreign query selectors, BSON Binary roundtrip and private no-store/nosniff headers.
- Streaming byte bounds even without trusted Content-Length, unsupported MIME, mismatched magic, truncated/animated/extreme raster structures, PNG CRC and bounded inflation/scanlines, WebP canvas disagreement.
- Persistent legacy operator photo generation across password salt change, absent-photo legacy migration no-op, account generation separation and transaction rollback/copy/delete behavior.
- Installed Chrome generated real PNG/JPEG/WebP images, mounted the module, uploaded a PNG carrying synthetic private text metadata, verified a 256×150 JPEG with that metadata absent, announced invalid-file errors, removed the photo and disposed the mount. Browser test ran, not skipped. This is an isolated widget/API-response test, not a deployed screen check.
- Escaped label injection, unknown/prototype-like enums, ignored raw HTML/unsupported notes, fixed customer URL, missing/future/stale time, 15-minute threshold, last-known critical, review-only recovery and EXERCISE labeling.

Browser module bundled successfully with esbuild into `/private/tmp/homebeacon-task2-build/profile-photo.js`.

Cloudflare Pages Functions build succeeded with:

```sh
npx wrangler pages functions build functions --outdir=/private/tmp/homebeacon-task2-functions --compatibility-date=2026-11-07 --compatibility-flags=nodejs_compat
```

It retained the existing `unenv/whatwg-url` default-export warning. Outputs were outside the shared checkout. Full product build and full suite remain parent integration checks because other files are concurrently changing.

The parent's script was exercised:

```sh
npm run email:preview -- /private/tmp/homebeacon-task2-email-preview
```

It produced three HTML and three text files using only synthetic values. No email was sent. Initial browser verification identified a legitimate Chrome WebP ICC color-profile flag; support was added with a 16 KiB bound, then browser and targeted checks passed. No manual visual/screen-reader review is claimed. Per the final user correction, customer-facing email copy uses colons instead of em dashes; a renderer assertion guards this and previews were regenerated.

## Parent integration hooks

### Mount in customer/operator screens

```js
import { mountProfilePhoto } from './profile-photo.js';
const disposePhoto = mountProfilePhoto(container, {kind: 'customer'});
// Or {kind:'operator'} for the personal operator profile.
// Before replacing/unmounting the account screen:
disposePhoto();
```

Do not mount for the shared demo. Existing entrypoint bundling imports this module automatically. It reuses the current kit classes and appends a single section; no stylesheet/build entry modification is required. Mount once per screen and preserve disposal when the parent rerenders. Final read-only scan observed the parent’s customer mount with cleanup and operator mount guarded against demo. Those existing UI files remain outside this commit.

### Preserve photo on customer email change

In `src/customer-self-service.js`, import `migrateProfilePhoto` from `./profile-photo.js`. Within the existing `accountHandler` transaction, after inserting the copied account with `_id: next`, before deleting the old account:

```js
await migrateProfilePhoto(db, {
  kind: 'customer', oldEmail: email, newEmail: next,
  account: current, session,
});
```

Pass the original account document and same transaction session. Preserve `createdAt` and any `profilePhotoId` on copied account documents (the existing spread already does this). Retain the parent's existing session revocation/reissue. No-photo migration is a no-op; duplicate destination fails without overwrite; transaction rollback restores the old row. This worker did not edit the parent-owned account handler. Final read-only scan observed the parent’s helper import and migration call using the existing transaction session.

Storage is the ordinary `profile_photos` collection, unique built-in `_id`, one bounded BSON Binary per role/email/generation. Legacy operator profiles without `createdAt` initialize `profilePhotoId` on first valid upload, so password changes do not change their photo key. No new explicit index/bootstrap migration is needed.

### Connect renderer without sending

Import `renderCustomerAlertEmail` from `src/customer-alert-email.js`, map supported event/fact enums from the parent engine, and pass actual `observedAt` plus an explicit `now`. Return value is `{subject,html,text}`. Use `source:'simulation'` for exercise previews. Input/enum contract is in `docs/CUSTOMER_ALERT_EMAIL.md`. The renderer performs no network or queue operations. If underlying facts have different timestamps, do not label all of them with one newer observation.

The parent-added package script already calls the correct preview CLI and was left untouched.

## Concerns and limits

- Parent mount and transaction migration edits were observed but remain outside this worker commit; parent should validate the complete combined screen/email-change flows. Deployed behavior remains unverified.
- JPEG/WebP validation checks structure/magic/dimensions with strict byte/pixel caps; it does not fully decode compressed pixels server-side. Some malformed bitstreams may be accepted and then fail browser decoding. PNG inflation is additionally bounded to exact expected scanline output. Browser-supported uploads normalize to a small JPEG.
- Client canvas removes source metadata; direct API callers can retain JPEG metadata/allowed color data in the private binary. Do not describe all API uploads as server-sanitized.
- Upload racing email migration can leave an unreachable old-generation row; it cannot select/expose another account's image. Photo account-deletion/orphan retention cleanup remains future work.
- Current customer emails are not verified. Before delivery: explicit alert opt-in, verified recipient/re-verification, server-only recipient resolution, idempotency/retry controls, unsubscribe/preferences enforcement, provider/sender setup and privacy/retention review. No automatic outbox or recipients are enabled.
- Full combined product checks/deployment are parent responsibilities; existing unenv warning remains.

## Round 1 correction: account isolation and rename/upload concurrency

November 8, 2026. Addresses P1 and P2 in `task-2-review.md`. This section supersedes the original report's timestamp-based identity, image-move migration and tolerated-orphan claims. The review reproduced a real authorization failure and a user-visible lost upload; those outcomes were not acceptable cleanup limitations.

### Final changes

- `src/operator-session.js`: session issuance persists a random immutable `sessionGeneration` on account records and signs that value as `accountGeneration`. Actual account generation, rather than timestamp equality, distinguishes deleted/recreated accounts. Legacy configured operators receive an account generation too; deleting their profile invalidates their cookie. Added shared exact-account authorization checks for generation, creation/password-change times, expiry, disablement and operator role. Retained the explicit PR37 customer `createdAt` check. Photo access and persisted database-account session checks require a bound generation and a new sign-in for pre-fix cookies; signature-only fixture helpers retain their prior behavior outside the photo API.
- `src/profile-photo.js`: v2 keys hash namespace/role/generation and are independent of email. Each operation checks the signed generation against the exact account snapshot used to derive its key. Upload bytes are fully bounded/validated before opening a transaction. PUT/DELETE increment the account's `photoRevision` and mutate the image in one snapshot transaction; rename's account deletion, revocation, disablement and replacement conflict with that write. Automatic transaction retry rechecks authorization. A stale mutation returns 401, never saved:true. If the mutation commits first, rename preserves the same photo key.
- `migrateProfilePhoto` keeps the parent's existing signature and call order. It now checks that the copied destination account retained the original generation. No binary move occurs. An account without a generation cannot own a v2 photo and needs no migration. No parent-owned source was edited.
- `test/profile-photo.test.js`: added deterministic database/body scheduling reproductions using the actual parent's `accountHandler`, plus operation/role variants. No timing sleeps or production access are used.
- `test/operator-login.test.js`: actual operator sign-in tests demonstrate revocation after same-email/identical-timestamp recreation for both provisioned and configured legacy operators.
- `docs/PROFILE_PHOTOS.md`: updated identity, transaction, migration and upgrade contracts. Email renderer, preview, existing UI and image parser were not changed in this round.

### Reproduction evidence

1. **P1 customer lookup:** pause the second, transaction-scoped customer lookup after initial cookie authorization. Run actual password-confirmed email rename, recreate the freed email with identical creation timestamp/credentials and a fresh random generation, and save its own different photo. Resume original GET, PUT and DELETE independently. All return 401; replacement GET returns the exact replacement bytes, unchanged. Subsequent old-cookie GET also returns 401.
2. **P1 operator recreation:** both account-backed and configured legacy operator cookies are issued before deleting/recreating the same email, role, timestamp and credentials. Old GET/PUT/DELETE all return 401; a newly signed-in replacement retains its own photo. Separate operator-login tests exercise the real sign-in endpoint rather than only the token helper.
3. **P2 blocked body:** pause first upload and replacement upload while their bounded bodies are unread. Complete the actual parent rename, then release valid raster bytes. Both old-cookie uploads return 401. The new cookie sees no photo for the first-upload case, or the exact prior image for replacement. No extra image row is written. Retrying with the new cookie succeeds and becomes visible under the same immutable owner key.
4. **P2 account-write conflict:** pause PUT/DELETE after reading the transaction account snapshot but immediately before the guarded account increment. Commit the actual rename, resume the write, and let MongoDB retry its conflict. Reauthorization returns 401 and the renamed account's previous image remains unchanged. This covers the gap that merely moving body reads would leave open.
5. **Other lifecycle checks:** disablement/password revocation between initial auth and the exact lookup is rejected for customer/operator reads. Pre-fix unbound customer/operator cookies cannot GET/PUT/DELETE bound account photos. Existing photo roundtrip, parser, browser, origin and role checks still run.

### Targeted tests and build

Final regression command:

```sh
node --test test/profile-photo.test.js test/operator-login.test.js test/account.test.js test/customer-connect.test.js test/customer.test.js test/homebeacon.test.js test/portal.test.js
```

61 tests passed, zero failed/skipped. This includes the complete photo suite, customer-connect suite requested for the authentication change, actual operator login/recovery, customer registration/authentication, and portal/session tests. All databases were disposable local test databases. Installed Chrome's widget test ran successfully. No application credentials or production accounts were used.

Cloudflare Pages Functions compiled successfully to `/private/tmp/homebeacon-task2-round1-functions` with the existing `unenv/whatwg-url` warning. Source whitespace checks passed. Full combined product testing/deployment remains parent-owned.

### Parent integration and upgrade concerns

No change is needed to the currently observed parent `accountHandler` call: it already inserts `{...current, _id:next, ...}`, invokes `migrateProfilePhoto(db,{oldEmail:email,newEmail:next,account:current,session})`, then deletes the old account in the same transaction. Preserve `sessionGeneration` in that spread and preserve the transactional deletion; both are part of the concurrency contract. All independent new registrations must receive a new generation, never a copied one. The helper lazily initializes missing generations at trusted session issuance. Existing UI mounts stay unchanged.

Security upgrade behavior is explicit: pre-fix email/timestamp-keyed photo rows are not read or automatically adopted because their owner cannot be proven across email/timestamp reuse. Previously uploaded pre-fix images require re-upload after sign-in; those old rows remain inaccessible until a separately scoped cleanup. Bound v2 photos retain their key across subsequent renames. Existing unbound cookies require signing in again before photo access. No claim is made that old-format images migrate transparently.

The earlier report described an unreachable successful upload as future cleanup. That is now corrected: stale writes are rejected, and successful v2 writes remain attached to the immutable account identity. Physical hardware/history work, simulation fixes, parent UI/account files, email delivery and deployment remain outside this worker change. No subagents were used. The report was already tracked and is staged normally, without force-adding ignored files.

## Round 2 scoped authentication correction

November 8, 2026. Addresses the remaining P1 issuance race in `task-2-rereview.md`. P2's transaction/immutable-photo-key fix is unchanged. Implementation and endpoint regressions pass; independent scoped re-review remains pending.

### Verified snapshot contract

- `src/operator-session.js`: `authenticationAccount` initializes/captures the immutable generation before a password or recovery code is checked. Database-backed issuers now require an explicit `verifiedAccount` snapshot. They conditionally match generation, password hash/salt, creation/password-change times, role, disablement and recovery state on every issuance, including accounts with an existing generation. No email-only identity lookup occurs during signing. Missing/mismatched snapshots fail with 401.
- Legacy operator login supplies `verifiedLegacy`, captured from the environment before verification. Issuance checks that same expected environment state before/after its DB guard. Verified absence uses insert-only creation; a concurrent replacement cannot be adopted by an upsert.
- The signed cookie also carries a domain-separated HMAC of the verified credential/lifecycle state. Readers and the exact photo-account check compare it against the current state. A change after the issuance guard invalidates the cookie even if creation/revocation timestamps are identical. No raw credential material is put in cookies, responses or logs.
- `src/customer.js`: customer login and both registration paths carry the verified existing account or exact newly inserted document into issuance. New registrations assign generation before insertion.
- `functions/api/session.js`: real operator login verifies the captured DB/environment snapshot and passes it unchanged to the issuer. A failed issuance guard returns 401 without Set-Cookie.
- `src/customer-self-service.js`: the rename transaction matches the password-verified source snapshot, retains the exact inserted destination document, and passes that committed snapshot to session reissue. The parent's existing `migrateProfilePhoto` import/call and other logic are preserved. Those two pre-existing parent integration lines are retained in this now-authorized file, not claimed as new worker implementation.
- `functions/api/recovery.js`: recovery does not issue a new session. Its password reset now conditionally targets the exact generation/credential snapshot whose recovery code was verified, then retains existing cookie clearing behavior.
- `src/profile-photo.js`: awaits the credential-state-aware exact-account check; its photo key and transactional write logic remain unchanged.
- Fixture issuance in `test/account.test.js`, `test/customer-connect.test.js`, `test/customer.test.js`, and `test/profile-photo.test.js` now supplies explicit trusted snapshots. Signature-only no-database fixture helpers remain unchanged and cannot authenticate a production photo endpoint. `docs/PROFILE_PHOTOS.md` records the updated contract.

### Real-endpoint race evidence

Nine round-2 regressions in `test/profile-photo.test.js` pass:

1. Actual customer login verifies password A; at the guarded issuance operation, the actual parent rename runs, the freed email is recreated with password B and a different generation/photo. Original login returns 401 with no cookie; replacement photo remains accessible only to its owner.
2. Actual operator login verifies password A; account deletion/replacement with password B happens before issuance. Original login returns 401/no cookie; replacement is signed in through the real endpoint and its photo stays private.
3. Actual configured legacy login sees an absent DB profile; a provisioned replacement appears before insert-only issuance. Login cannot adopt it and returns 401/no cookie.
4. Actual legacy login's environment password changes after verification. Expected-environment comparison rejects issuance with 401/no cookie.
5. Actual profile-only registration's inserted account is replaced before issuance. Registration returns 401/no cookie rather than binding the replacement.
6. Actual rename commits, then the destination email is replaced before session reissue. Reissue returns 401/no cookie; no replacement-authorized session is produced.
7. Actual recovery verifies a code, then a different generation is inserted with even the same code material. Guarded reset returns 400, preserving the replacement's password and generation.
8. Both database-backed issuer APIs reject omitted verified snapshots (401).
9. Actual operator login passes its guard, then credentials change before signing with no timestamp movement. The signed cookie still represents only the original verified state and is rejected by session/photo readers (401); signing in with the new password works. This is revocation after the linearized guard, not adoption of new credentials.

Tests use disposable local MongoDB and restored in-process database scheduling hooks. Password A/B are synthetic and different. No credentials/cookies were printed, and no production data or services were accessed.

### Final verification

`node --test test/profile-photo.test.js test/operator-login.test.js test/account.test.js test/customer-connect.test.js test/customer.test.js test/homebeacon.test.js test/portal.test.js`: **70 passed, 0 failed, 0 skipped**. The photo file contains 27 passing tests, including all nine round-2 cases and prior P1/P2 coverage. The real Chrome widget test ran.

Pages Functions build passed to `/private/tmp/homebeacon-task2-round2-functions`; only the pre-existing `unenv/whatwg-url` warning remains. Parent separately reported the current-tree full suite at **367/367, zero skips**, log `/tmp/simulation-fulltests.log`; that full-suite run is parent-reported, not rerun by this worker.

Only the scoped authentication/photo callsites, needed tests, photo documentation and this report are included in the worker commit. Parent history/simulation/firmware/UI changes are excluded. No subagents, delivery, deployment or extra feature work occurred. Existing cookies lacking the new credential-state binding need sign-in; pre-fix photo re-upload limitation remains unchanged. Ready for Bohr's scoped re-review, then parent combined browser/release checks.
