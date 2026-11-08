# Safe Home name and compatibility

Current as of November 8, 2026. Ayan requested **Safe Home** as the name across the website and organization documentation. Capitalize it exactly this way: two words, capital S and H. HomeBeacon is the former product name.

## Presentation

Use Safe Home in navigation, page titles, metadata, account/assistant setup, source labels, prepared email copy and first-party brand assets. Keep the existing house mark, Argus components and neutral/green design. This is a name change, not a new stack or a claim of safety certification.

The checked-in share card is `public/social-preview.png`; its source is `ui/brand/social-card.html`. Regenerate it with `node scripts/build-brand-assets.mjs`, then build. The old JPEG is historical and no longer referenced by active page metadata. The compatibility-named SVG wordmark files now draw Safe Home.

## Stable technical names

Do not change these as a text cleanup:

- GitHub organization/repository, Cloudflare project, production URL and MongoDB database.
- Existing API routes, device IDs, cookies, session-signing labels, OAuth scopes and MCP tool names.
- Local-storage keys, simulation export schema identifiers, audit names and provider request identifiers.
- `window.HomeBeaconKit`, CSS/file paths containing `homebeacon`, and `clients/esp32/HOMEBEACON.md`.
- `X-HomeBeacon-Data`, an existing synthetic-response header.

Renaming those is a separate migration with compatibility and security consequences. Existing profiles, paired boxes, assistant connections and shared links must keep working after this release. User-entered device names and historical records are not rewritten in the database.

## Documentation rules

Current entry-point and product docs use Safe Home. Historical worklogs, dated handoffs, screenshots, provenance and older contract filenames retain their original names for traceability. Do not rewrite past evidence to imply the project always had the new name. Vendor/third-party notices and teammate attribution are unchanged. [Rename decision](decisions/0001-safe-home-name.md).
