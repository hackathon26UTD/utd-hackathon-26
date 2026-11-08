# Private profile photos

Implemented groundwork for Ayan's Safe Home workstream (November 8, 2026). Parent owns placement in existing customer/operator screens. No household/public image endpoint is introduced.

## API

- Customer: `/api/customer/photo`, authenticated with `readCustomerSession`.
- Operator: `/api/profile-photo`, authenticated with `readSession`; role must be `operator`.
- `GET`: own raw photo, or 404 if absent. `PUT`: raw binary body with exact `Content-Type: image/png|image/jpeg|image/webp`; returns `{saved:true,width,height}`. `DELETE`: idempotent 204. Other methods: 405 with Allow.
- PUT/DELETE require exact request Origin matching the API origin, even when middleware admits an admin key. Admin-key-only, cross-role and shared-demo requests cannot access images. Neither route accepts an account selector; query strings cannot select a different owner.
- All responses, including errors, have `Cache-Control: private, no-store`, `Vary: Cookie`, and `X-Content-Type-Options: nosniff`. Binary responses use an allowlisted content type and fixed inline filename.
- Errors: 400 invalid raster; 401 missing/revoked identity; 403 origin/demo; 409 missing bound identity or inconsistent rename; 413 body limit; 415 unsupported content type; 503 generic database failure. Provider/internal errors are not exposed.

## Bounds and format policy

Server uploads are at most 256 KiB, 512 pixels per dimension, one still image. Body reads enforce the limit incrementally, independent of Content-Length. SVG, animation, MIME/magic mismatches, zero/oversized dimensions, truncated structures and inconsistent WebP canvas dimensions fail closed.

PNG checks chunk bounds and CRCs, rejects interlacing, animation and compressed ancillary metadata, validates color depth, and inflates only up to the exact bounded scanline size. Excess deflate output and invalid scanline filters are rejected. JPEG accepts 8-bit baseline/progressive, one frame with 1 or 3 components and at most 16 scans; dimensions/marker boundaries are checked. WebP accepts still VP8/VP8L, bounded canvas/alpha, and optional ICC color profile up to 16 KiB. Both are constrained by payload/pixel limits. JPEG/WebP compressed pixels are not fully decoded server-side; invalid bitstreams can still fail browser decoding. This is structural validation, not a universal media sanitizer.

The browser accepts at most 5 MiB, 4096 pixels per side and 16 million declared pixels before decoding. It uses canvas to resize to at most 256 pixels and emits JPEG at quality 0.85, flattening transparency onto white and stripping source EXIF/text/location metadata. Direct API clients do not get server-side metadata stripping; JPEG metadata and allowed color data can remain in the private binary. Format restrictions intentionally reject some otherwise valid files; the supported UI's normalized JPEG avoids those restrictions.

## Storage, authentication and concurrency (round 1 correction)

`profile_photos` is an ordinary separate MongoDB collection using its standard unique `_id` index. Each row has `_id`, `bytes` (BSON Binary), `contentType`, `width`, `height`, `updatedAt`. No photo data is placed in account responses or telemetry.

Authentication captures/initializes a random immutable `sessionGeneration` before checking the password. Issuance requires that exact verified account snapshot, conditionally matches its generation, credentials and lifecycle fields, and signs `accountGeneration` plus a keyed credential-state binding. It never fetches a replacement by email after password verification. Customer and operator namespaces remain separate. Two independently created accounts receive different generations even with identical email, creation timestamps and credentials. Configured legacy operator login captures the expected environment credentials before checking the password. When its profile is absent, issuance inserts only the verified absent identity; a concurrent insert fails instead of being adopted. Profile deletion invalidates its cookies. Account-backed and legacy database operator readers reject generation mismatches; customer readers retain PR37's `createdAt` check and also reject generation mismatches. Disabled accounts, changed passwords and expired cookies are rejected. The keyed credential-state binding also invalidates a cookie if credentials change after the issuance guard, even when timestamps do not advance.

`profilePhotoKey(kind,email,account)` now hashes the version, role and `sessionGeneration`. The email argument remains for compatibility but does not influence the key. Preserve `sessionGeneration` on the copied account during a legitimate rename. A genuinely new account must not copy another account's generation. Timestamp equality is not treated as identity.

The handler initially authenticates, buffers/validates any bounded upload outside a transaction, then opens a MongoDB snapshot transaction. It reauthorizes the exact account snapshot used for the photo key against the signed generation, expiry, creation/password-change times, disablement and role. It never binds an old cookie to whichever account currently occupies an email.

PUT and DELETE increment `photoRevision` on that account in the same transaction as the binary mutation. This real write conflicts with the parent's account deletion during rename and with password/disable/replacement changes. A conflict retries the transaction and rechecks authorization. If rename wins, the stale upload/delete returns 401 rather than reporting success; if the photo write wins, rename preserves the immutable key. Reads use the same snapshot for account and image. MongoDB transactions require a replica set (production Atlas and existing local customer test/dev setup already use one).

### Parent email-change hook: existing call remains valid

Keep the existing import and transaction call:

```js
await migrateProfilePhoto(db, {
  kind: 'customer',
  oldEmail: email,
  newEmail: next,
  account: current,
  session,
});
```

Call after inserting the new account and before deleting the old account, using the same transaction session. The helper now verifies that the copied account retained the original `sessionGeneration`; it does not copy/delete any image. An account without an initialized generation cannot own a v2 photo, so its hook is a no-op. The parent's current `{...current, _id: next, ...}` copy already preserves generation. Round 2 additionally passes the exact committed destination document into customer session reissue; it must not reload that identity by email. Keep the existing password-change/session revocation and cookie reissue. No parent code change is required for the current call. Photo account-deletion retention cleanup is still future work; never delete/select images by reusable email or timestamps.

### Upgrade behavior

This security correction does not read or automatically adopt pre-fix email/timestamp-keyed photo rows. Their ownership cannot be proven when accounts and identical timestamps are reused. Those images need re-upload after sign-in; old rows remain inaccessible until retention cleanup. Pre-fix unbound cookies cannot access photos and require a fresh sign-in. Signature-only test environments retain helper behavior, but the photo routes always require a database-backed signed generation. Do not claim transparent image migration from the pre-fix format.

## UI mount hook

```js
import { mountProfilePhoto } from './profile-photo.js';
const disposePhoto = mountProfilePhoto(container, {kind: 'customer'});
// Use kind: 'operator' on the signed-in personal operator profile.
// Before leaving/replacing the screen:
disposePhoto();
```

This module imports no server code. Existing esbuild entries will include it when the parent imports it; no separate script tag is needed. It appends a scoped section with existing `kit`, `kit-field`, `kit-input` and `kit-btn` classes, a 64px rounded avatar, labeled file picker, Remove button and live status. Network errors are announced, controls serialize operations, and cleanup aborts requests/revokes object URLs. Mount once per account screen, dispose before remounting, and do not mount on shared demo. Parent owns existing UI edits.

## Verification

`node --test test/profile-photo.test.js` uses disposable local MongoDB only, including a replica-set transaction test. Browser test uses installed Chrome/Chromium when available (otherwise explicitly skips). Tests cover the routes, existing auth/middleware boundaries, origin checks, binary roundtrip, limits/magic/dimensions, generation isolation, actual parent rename/reuse interleavings, blocked upload bodies, write-conflict retries, rename rollback, actual browser PNG/JPEG/WebP output and widget upload/remove/error/metadata stripping/cleanup. Deployed behavior and manual screen-reader review are not established here.

## Homepage profile menu (November 8)

The upper-right avatar opens View profile and Settings. The homepage checks the existing customer session first, then the operator session, without storing account details. Authenticated profile images come from `/api/customer/photo` or `/api/profile-photo` with no-store and same-origin credentials. A missing/unavailable image leaves a bundled cartoon avatar. Four default choices persist only on this browser under `homebeacon-default-avatar`; they do not overwrite an uploaded photo. Customer View profile opens `/customer#profile`, expanding the existing photo section. No new photo format, upload permission or account contract is introduced.
