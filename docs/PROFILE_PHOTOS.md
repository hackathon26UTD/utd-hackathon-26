# Private profile photos

Implemented groundwork for Ayan's HomeBeacon workstream (November 8, 2026). Parent owns placement in existing customer/operator screens. No household/public image endpoint is introduced.

## API

- Customer: `/api/customer/photo`, authenticated with `readCustomerSession`.
- Operator: `/api/profile-photo`, authenticated with `readSession`; role must be `operator`.
- `GET`: own raw photo, or 404 if absent. `PUT`: raw binary body with exact `Content-Type: image/png|image/jpeg|image/webp`; returns `{saved:true,width,height}`. `DELETE`: idempotent 204. Other methods: 405 with Allow.
- PUT/DELETE require exact request Origin matching the API origin, even when middleware admits an admin key. Admin-key-only, cross-role and shared-demo requests cannot access images. Neither route accepts an account selector; query strings cannot select a different owner.
- All responses, including errors, have `Cache-Control: private, no-store`, `Vary: Cookie`, and `X-Content-Type-Options: nosniff`. Binary responses use an allowlisted content type and fixed inline filename.
- Errors: 400 invalid raster; 401 missing/revoked identity; 403 origin/demo; 409 unsupported identity; 413 body limit; 415 unsupported content type; 503 generic database failure. Provider/internal errors are not exposed.

## Bounds and format policy

Server uploads are at most 256 KiB, 512 pixels per dimension, one still image. Body reads enforce the limit incrementally, independent of Content-Length. SVG, animation, MIME/magic mismatches, zero/oversized dimensions, truncated structures and inconsistent WebP canvas dimensions fail closed.

PNG checks chunk bounds and CRCs, rejects interlacing, animation and compressed ancillary metadata, validates color depth, and inflates only up to the exact bounded scanline size. Excess deflate output and invalid scanline filters are rejected. JPEG accepts 8-bit baseline/progressive, one frame with 1 or 3 components and at most 16 scans; dimensions/marker boundaries are checked. WebP accepts still VP8/VP8L, bounded canvas/alpha, and optional ICC color profile up to 16 KiB. Both are constrained by payload/pixel limits. JPEG/WebP compressed pixels are not fully decoded server-side; invalid bitstreams can still fail browser decoding. This is structural validation, not a universal media sanitizer.

The browser accepts at most 5 MiB, 4096 pixels per side and 16 million declared pixels before decoding. It uses canvas to resize to at most 256 pixels and emits JPEG at quality 0.85, flattening transparency onto white and stripping source EXIF/text/location metadata. Direct API clients do not get server-side metadata stripping; JPEG metadata and allowed color data can remain in the private binary. Format restrictions intentionally reject some otherwise valid files; the supported UI's normalized JPEG avoids those restrictions.

## Storage and identity

`profile_photos` is an ordinary separate MongoDB collection using its standard unique `_id` index. Each row has `_id`, `bytes` (BSON Binary), `contentType`, `width`, `height`, `updatedAt`. No photo data is placed in account responses or telemetry.

`profilePhotoKey(kind,email,account)` hashes role, normalized email and account generation. Existing `createdAt` supplies generation. Legacy operator profiles without `createdAt` receive a persisted UUID `profilePhotoId` only during a valid upload; this survives password salt changes. Existing environment-provisioned operator authentication remains supported. Reads do not initialize identity fields. Preserve `createdAt` and `profilePhotoId` when copying accounts. Re-created customer email identities do not inherit the previous generation's image.

### Required parent email-change hook

Import `migrateProfilePhoto` from `src/profile-photo.js`. In the current customer email-change transaction, after creating the new account and before deleting the old one:

```js
await migrateProfilePhoto(db, {
  kind: 'customer',
  oldEmail: email,
  newEmail: next,
  account: current,
  session,
});
```

Pass the original account document and the same MongoDB transaction session. The helper copies the photo to the new identity and deletes the old row atomically with the parent transaction; absence is harmless, destination collision aborts instead of overwriting. Transaction rollback and successful migration are tested. Existing parent session revocation/reissue must remain. The helper does not change account email itself. An upload racing an email change can leave an unreachable old-generation row; it cannot expose it through the new owner. Retention/account-deletion cleanup is future work. The parent can use the exported key/collection to remove rows on account deletion. Do not delete photos by email alone.

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

`node --test test/profile-photo.test.js` uses disposable local MongoDB only, including a replica-set transaction test. Browser test uses installed Chrome/Chromium when available (otherwise explicitly skips). Tests cover the routes, existing auth/middleware boundaries, origin checks, binary roundtrip, limits/magic/dimensions, generation isolation, migration rollback, actual browser PNG/JPEG/WebP output and widget upload/remove/error/metadata stripping/cleanup. Deployed behavior and manual screen-reader review are not established here.
