# Provenance of ui/kit/vendor

This is the owner's own ARGUS UI library, vendored into the owner's team repo. Nothing in `vendor/` was edited. Glue lives only in `shims.js`, `glue.css`, `glue-reference.css`. The theme lives in `theme-homebeacon.css` (generated).

Source repo: `/Users/ayanbasheer/rion-nexus-worktrees/ui-library` (read-only), `apps/portal-frontend/` unless noted.
Source commit: `db1475849866f481831bfa869a7c95ca6088340f` (2026-09-30, "Inventory: the rebuilt Overview goes to the stores"). Working tree clean for every file below (only `.planning/STATE.md` was modified).

| Vendored at | Source path |
|---|---|
| vendor/css/kit.css | css/kit.css |
| vendor/css/kit-standards.css | css/kit-standards.css |
| vendor/css/kit-table.css | css/kit-table.css (the ArgusTable sheet; the registry loads it for the tables family) |
| vendor/js/kit/*.js (9 files) | js/kit/*.js |
| vendor/gallery/registry.json, render.js, frame.js, guard.js | js/ui-library/* |
| vendor/gallery/ui-library.css | css/ui-library.css |
| vendor/assets/{scene.svg,photo.svg,logo.svg,scene.webm} | assets/ui-library/* |
| vendor/assets/avatars/face-01..24.svg | assets/avatars/* (CC0 DiceBear Notionists, per the source) |
| vendor/reference/js/financials/{charts,format}.js | js/financials/ |
| vendor/reference/js/inventory/analytics.js | js/inventory/analytics.js |
| vendor/reference/js/system/rail.js | js/system/rail.js |
| vendor/reference/css/{argus-crm,financials-charts,financials,financials-insights,inventory-order,inventory-analytics,rail,chrome-v7}.css | css/ (same names) |
| vendor/docs/portal-ui-library.md | docs/portal-ui-library.md (repo root docs/) |
| vendor/docs/standards.md, picked-variants.json | docs/ui-library/ |
| vendor/docs/2026-09-28-argus-ui-library-design.md | docs/superpowers/specs/ |

Check: `diff -r` of each vendored file against its source path is empty.

## Portal dependency audit

What the kit reads from the portal, and what we do:

| Dependency | Where | Handling |
|---|---|---|
| `body.light-mode` (light = present, dark = absent) | every theme selector | `shims.js` theme switch |
| `window.Logger` | core.js 773 | optional, falls back to console.warn. No shim |
| `window.ArgusRangePicker` | components.js 450, forms.js 2699 | optional, local fallbacks. No shim |
| `window.lockBodyScroll/unlockBodyScroll` | forms.js 165 | optional, counted fallback. No shim |
| `window.ArgusTable` | table.js | defined by the kit itself |
| `--ground-*`, `--crm-*`, `--nx-red`, `--chrome-zoom`, `--axr-*`, `--surface-2`, `--sheet-surface` | kit-table.css, kit-standards.css, ui-library.css | aliased onto kit tokens in `glue.css` |
| main.css `* {margin:0;padding:0;box-sizing}`, 44px button floor, focus ring | whole kit | `glue.css`, zero-specificity `:where(.kit)` |
| `--font-sans`, `--font-mono` | kit.css | defined by the theme |
| Hard-coded `Fraunces`, `Inter`, `Lexend Peta`, mono stacks | 5 selectors | restated in the theme |
| `assets/logo/argus-*.png` (ARGUS brand art) | components.js 2786-2823 | `shims.js` points them at `ui/kit/brand/homebeacon-*.svg` |
| `/assets/ui-library/*`, `/assets/avatars/face-NN.svg` | render.js, components.js | copied to `public/assets/` by the build |
| FinCharts, FinFormat, InventoryAnalyticsReports, AxRail, `--crm-*` colours | render.js, 7 reference standards | vendored under `vendor/reference/`, re-tinted by `glue-reference.css`, gallery only |

## Not vendored
The other 60-odd portal sheets and modules. The 101 kit standards need none of them.

## Brand art
`brand/homebeacon-*.svg` is new HomeBeacon art (lantern mark, wordmark outlined from Young Serif with opentype.js). It replaces the ARGUS PNGs.
