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
