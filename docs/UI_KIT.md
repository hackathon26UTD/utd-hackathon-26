# Safe Home UI kit

The owner's ARGUS UI library, vendored as-is and re-themed. Every part on the public site, command center and customer portal should come from here, not from lookalikes. Live gallery: `/kit.html` (noindex).

## What is vendored
- 20 families, 108 standards (101 kit parts, 7 references), the library's own registry and renderers.
- Kit JS: 9 files (`core, components, forms, chart, motion, balance, help, guide, table`). They extend one global, `window.Kit`.
- Kit CSS: `kit.css`, `kit-standards.css`, `kit-table.css`.
- Source, commit and the full dependency audit: `ui/kit/PROVENANCE.md`. Vendored files are byte-identical to the source.

## How a page loads it
```html
<link rel="stylesheet" href="/assets/kit.css">
<script defer src="/assets/kit.js"></script>
<body class="kit-body">
  <div class="kit"> ...use Kit.* factories or kit-* classes here... </div>
```
- Everything is scoped under `.kit`. Popovers and dialogs append their own `.kit` root to body.
- Theme: `body.light-mode` is light, no class is dark. `HomeBeaconKit.setTheme('dark'|'light')`, `toggleTheme()`, event `hbkit:theme`. The choice is saved in `localStorage` key `hbkit-theme`. The external `/theme-init.js` paints the saved setting before styles load. Light is the default.
- Build: `node scripts/build-ui.mjs` makes `public/assets/kit.{js,css}` (classic script, IIFE), plus gallery-only `kit-gallery` and `kit-reference` bundles, the fonts, and copies of the images the library draws.
- Rules from the library still apply: no innerHTML, no colours from JS (tone is a class), no native select/date/confirm.

## Files
| File | Job |
|---|---|
| `ui/kit/kit.entry.js` | bundle entry, fixes the load order |
| `ui/kit/fonts.css` | self-hosted faces |
| `ui/kit/glue.css`, `shims.js` | the only portal coupling fixes |
| `ui/kit/theme-homebeacon.css` | generated theme, do not hand edit |
| `ui/kit/tools/make-theme.mjs` | regenerates the theme and `docs/UI_KIT_CONTRAST.md` |
| `ui/kit/tools/check-gallery.mjs`, `shot.mjs` | console check and screenshots (Playwright) |

## Token map
The kit keeps every colour as a `--kit-*` token, written twice (light on `.kit`, dark on `body:not(.light-mode) .kit`). The theme repeats those two selectors after the kit sheets, so it wins by order. Anatomy, radii, motion and sizes are untouched.

| Role | Token | Dark | Light |
|---|---|---|---|
| Page | `--kit-bg` | #151c19 | #f6f7f7 |
| Surface | `--kit-surface` | #1c2520 | #ffffff |
| Subtle surface | `--kit-surface-2` | #18211c | #f0f3f1 |
| Border | `--kit-line` | #35433b | #dce2df |
| Text | `--kit-ink` | #edf3ef | #1d2926 |
| Muted text | `--kit-ink-3` | #abbcb0 | #52605b |
| Action | `--kit-hero` | #81d5b1 | #17634f |
| Action text | `--kit-hero-fg` | #11261b | #ffffff |

November 7 simplification: neutral surfaces and green actions replace the earlier dusk/paper palette. Status colors retain distinct red, amber, green and unknown treatments. Screen layouts live in their respective stylesheets; `product-kit.css` provides shared theme/component glue without command-center geometry overrides. The floating map controls use compact rounded shapes; account forms use modest radii.

### Contrast

The generator checks text and component pairs and exits non-zero on failure. Current measured values are in [UI_KIT_CONTRAST.md](UI_KIT_CONTRAST.md); do not duplicate them here.

## Fonts

Self-hosted from the existing pinned npm dependencies:
- Headings and body: Geist Variable, one consistent family.
- Technical readouts: Spline Sans Mono Variable.

Tokens: `--font-display`, `--font-sans`, `--font-mono`, `--kit-chart-font`. Vendored library sources remain unchanged.

## Shims
See PROVENANCE.md. In short: the theme switch, the ARGUS logo images swapped for Safe Home art, and token aliases in glue.css. No kit file was edited.

## Resync from source
1. `git -C /Users/ayanbasheer/rion-nexus-worktrees/ui-library pull`, note the new commit.
2. Copy the files in the PROVENANCE table over `ui/kit/vendor/` (same names).
3. `node ui/kit/tools/make-theme.mjs` (new tokens get re-coloured, new text pairs may need adding to its list).
4. `node scripts/build-ui.mjs` then `node ui/kit/tools/check-gallery.mjs` must print CLEAN. Fix any new coupling in glue.css or shims.js, never in vendor.
5. Update the commit in PROVENANCE.md.

## The 20 families
| # | Family | Title | Parts | Kit names |
|---|---|---|---|---|
| 1 | banners | Banners, notices and empty states | 6 | `Kit.guide`, `kit-could-not-load`, `ArgusTable.mount`, `kit-good-news`, `kit-notice`, `Kit.helpBanner` |
| 2 | bars | Toolbars, drop zones and inline notes | 6 | `Kit.fileDrop`, `Kit.listToolbar`, `Kit.photoPicker`, `Kit.saveNote`, `Kit.selectionBar`, `Kit.undo` |
| 3 | buttons | Buttons | 6 | `kit-danger-warning`, `kit-everyday`, `kit-icon`, `kit-main-action`, `kit-quiet`, `kit-btn` |
| 4 | charts | Charts | 6 | `null` |
| 5 | chips | Chips and tags | 6 | `kit-filter-chip`, `kit-number-badge`, `kit-overlay-label`, `kit-pick-chip`, `kit-plain-tag`, `Kit.pill` |
| 6 | feedback | Loading and feedback | 6 | `kit-loading-placeholder`, `kit-missing-figure`, `kit-notification`, `kit-opening-screen`, `kit-progress-bar`, `kit-working-sign` |
| 7 | history | History, show more, key hints and copy | 6 | `Kit.copyBox`, `Kit.copyIcon`, `Kit.foldOpen`, `Kit.historyList`, `Kit.keyHint, Kit.keyHints`, `Kit.showMore` |
| 8 | icons | Icons | 5 | `kit-icon`, `Kit.glyph`, `Kit.logoLockup`, `Kit.standaloneMark`, `Kit.statusDot` |
| 9 | inputs | Text boxes | 6 | `kit-money-number`, `kit-popup-search`, `kit-search-field`, `kit-sign-in`, `kit-table-cell`, `kit-text-box` |
| 10 | navigation | Navigation, back links and titles | 6 | `kit-back-link`, `null`, `kit-title-head`, `kit-section-heading`, `kit-section-menu`, `kit-skip-link` |
| 11 | overlays | Pop-ups, panels and tips | 6 | `Kit.fullScreen`, `Kit.hoverTip`, `Kit.buttonMenu, Kit.filterButton, Kit.filterChip`, `Kit.popUpWindow`, `Kit.sideSheet`, `Kit.confirm` |
| 12 | people-media | Avatars, camera tiles and thumbnails | 6 | `Kit.cameraView`, `Kit.clipThumb`, `Kit.largeStill`, `Kit.logoItemSquare`, `Kit.personPicture`, `Kit.profilePhoto` |
| 13 | range | Date ranges and pickers | 5 | `Kit.datePicker`, `kit-day-strip`, `kit-range-button`, `Kit.rangePicker`, `kit-range-presets` |
| 14 | selects | Dropdowns and menus | 5 | `kit-button-menu`, `kit-filter-button`, `Kit.select`, `atbl-combo`, `kit-toolbar-dropdown` |
| 15 | sliders | Sliders, video players and scrollbars | 4 | `kit-scrollbar`, `Kit.sidewaysScroll`, `Kit.slider`, `Kit.videoPlayer` |
| 16 | surfaces | Cards and sections | 5 | `Kit.clickBox`, `Kit.details`, `Kit.listBox`, `Kit.numberBox`, `Kit.sectionBox` |
| 17 | tables | Tables | 6 | `Kit.lineTable`, `ArgusTable.mount`, `Kit.table` |
| 18 | tabs | Tabs and switches | 4 | `kit-inline-switch`, `kit-main-tabs`, `kit-side-tabs`, `kit-sub-tabs` |
| 19 | tiles | Tiles | 4 | `Kit.balance`, `Kit.figureRow`, `Kit.plainFigure`, `Kit.statusFigure` |
| 20 | toggles | Switches, tick boxes and choices | 4 | `kit-pick-one`, `kit-setting-row`, `kit-switch`, `kit-tick-box` |

## Known gaps
- Synthetic sample copy inside the vendored renderers still says "Argus" in a few places (for example the to-do panel). The gallery is noindex and dev-only.
- Default aria labels such as "ARGUS home" come from the kit; pass `label` when using Kit.logoLockup.
- The 7 reference standards (charts, split bar, main menu) are gallery-only. Pages that need a chart use the kit's own `Kit.chart` and `Kit.balance`.
- The reference main menu still uses ARGUS module names as its sample items.
- Fonts: Young Serif has one weight, so display text never goes bold.


## Product runtime integration

Product pages now import `ui/kit/runtime.js` and load the actual generated `kit.css`, with compatibility layout in `ui/product-kit.css`. `ui/product-kit.js` applies real component classes and Kit.select factories to existing form-backed controls, and command actions use Kit.confirm. The library's original twelve core CSS/JS files were compared byte-for-byte against the recorded source commit. Legacy template/layout glue is retained and explicitly not represented as a complete rewrite into factories. Gallery hostname adaptation lives in `gallery/host.js`; CSP uses external theme initialization, not unsafe inline scripts.
