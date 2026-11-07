# HomeBeacon UI kit

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
- Theme: `body.light-mode` is light, no class is dark. `HomeBeaconKit.setTheme('dark'|'light')`, `toggleTheme()`, event `hbkit:theme`. The choice is saved in `localStorage` key `hbkit-theme`. Paint it from a tiny inline script in head to avoid a flash (see `public/kit.html`).
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

| Role | Token | Dusk (dark) | Paper (light) |
|---|---|---|---|
| Page ground | `--kit-bg` | #14121c | #f5efe3 |
| Surface | `--kit-surface` | #1d1b28 | #fffcf5 |
| Raised / inset surface | `--kit-surface-2` | #191722 | #faf5e9 |
| Line, strong line | `--kit-line`, `--kit-line-2` | #2d2a3b, #423e55 | #e6dcc6, #d2c5a8 |
| Ink, ink 2, muted | `--kit-ink`, `-2`, `-3` | #f8f1e5, #d3cbdd, #aaa2ba | #1d1a26, #4a4557, #656072 |
| Accent (signal amber) | `--kit-accent`, `-ink` | #f6a623, #ffc660 | #b45f06, #8a4600 |
| Primary fill, its text | `--kit-hero`, `-fg` | #f6a623, #1c1204 | #9a5200, #ffffff |
| Info | `--kit-status-dot-info` | #7db7ff | #1f5fbf |
| Done (ok) | `--kit-ok` | #5fd3a6 | #12775a |
| Caution | `--kit-warn` | #e6cf55 | #6b5600 |
| Critical | `--kit-bad` | #ff8088 | #b4232c |

About 200 more component tokens in `kit-standards.css` are re-coloured by rule in the generator: neutrals go to the dusk or paper ramp, wine and red become amber, ARGUS green becomes teal-green, reds that mean "bad" stay red. Person-picture hues are left alone.

### Contrast (WCAG 2.x)
Full list with every pair: `docs/UI_KIT_CONTRAST.md`. Body pairs:

| Pair | Dark | Light | Need |
|---|---|---|---|
| Body text on page ground | 16.51:1 (#f8f1e5 on #14121c) | 14.93:1 (#1d1a26 on #f5efe3) | 4.5:1 |
| Body text on surface | 15.09:1 (#f8f1e5 on #1d1b28) | 16.69:1 (#1d1a26 on #fffcf5) | 4.5:1 |
| Body text on raised surface | 15.76:1 (#f8f1e5 on #191722) | 15.72:1 (#1d1a26 on #faf5e9) | 4.5:1 |
| Secondary text on surface | 10.77:1 (#d3cbdd on #1d1b28) | 8.99:1 (#4a4557 on #fffcf5) | 4.5:1 |
| Muted text on surface | 6.93:1 (#aaa2ba on #1d1b28) | 5.91:1 (#656072 on #fffcf5) | 4.5:1 |
| Muted text on page ground | 7.58:1 (#aaa2ba on #14121c) | 5.29:1 (#656072 on #f5efe3) | 4.5:1 |
| Accent text on surface | 10.89:1 (#ffc660 on #1d1b28) | 6.93:1 (#8a4600 on #fffcf5) | 4.5:1 |

(The generator exits non-zero if any text pair falls under 4.5:1.)

## Fonts
Self-hosted from npm, exact versions, latin and latin-ext only. Not Geist, Bricolage or Inter.
- Display: Young Serif 5.3.0 (`@fontsource/young-serif`), kit headings and the opening word.
- Body: Hanken Grotesk Variable 5.3.0 (`@fontsource-variable/hanken-grotesk`).
- Readouts: Spline Sans Mono Variable 5.3.0 (`@fontsource-variable/spline-sans-mono`), used for the kit's mono spots and the KPI numbers.
Tokens: `--font-display`, `--font-sans`, `--font-mono`, `--kit-chart-font`.

## Shims
See PROVENANCE.md. In short: the theme switch, the ARGUS logo images swapped for HomeBeacon art, and token aliases in glue.css. No kit file was edited.

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
