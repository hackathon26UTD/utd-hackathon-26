---
status: current
relevance: high
created: 2026-09-29
last-verified: 2026-09-29
tags: [portal, frontend, design-system, kit, ui-library]
---

# ARGUS UI library

> **Current as of:** 2026-09-29 · **Code:** `apps/portal-frontend/css/kit.css`,
> `apps/portal-frontend/css/kit-standards.css`, `apps/portal-frontend/js/kit/`, `apps/portal-frontend/js/ui-library/`,
> `apps/portal-frontend/ui-library.html`, `apps/portal-frontend/ui-library-frame.html`
> · **Picks:** `docs/ui-library/standards.md` (generated) · **Design:**
> `docs/superpowers/specs/2026-09-28-argus-ui-library-design.md`
>
> Living doc. Change history is in `CHANGELOG.md` and the PRs.

## What it is

One standard for every basic part of the portal, picked by the owner on
2026-09-28 (108 roles in 20 families: buttons, date ranges, dropdowns, tables,
tabs, banners and so on). Each standard lives in the kit, and a staging-only
page shows it in every state it has, in dark and light, like a design file.

- Library page: `https://staging.useargus.co/ui-library.html` (staging only).
- The picks and the reason for each: `docs/ui-library/standards.md` and
  `docs/ui-library/picked-variants.json`.

Step 1 (this doc) is the library. Step 2 moves each screen onto the standards,
one PR per family per area.

## How it works

1. **The kit is the source of truth and only grows.** A standard is either an
   existing kit part (renderer and registry entry only, e.g. `ArgusTable`,
   `Kit.balance`, `Kit.select`, `Kit.confirm`, `Kit.helpBanner`) or a copy of
   the picked part under a new kit name. The screen it was copied from is
   never edited.
2. **Two sheets.** Existing kit parts stay in `css/kit.css`, which every
   customer page loads. The new standards live in `css/kit-standards.css`:
   their rules, their tokens (both theme blocks) and their entries in the
   kit's shared lists (focus ring, touch floors, reduced motion). It loads after
   `kit.css` and only where it is used, like a route sheet, so customer pages
   don't download ~300 KB of parts no live screen uses yet (it kept the
   customer CSS under the 600 KB budget). `index.html` never links it. A
   rollout PR adds it to the route sheets of the routes it moves
   (`ROUTE_STYLES` / `_NEXUS_ASSETS` in `js/main.js`), first in each list, so
   the load order is: `kit.css` (global), then `kit-standards.css`, then the
   route's own sheets. That is the order the library frame uses too.
   `__tests__/kit/kit-standards.contract.test.js` pins which rules live where,
   and that nothing on master's `kit.css` ever leaves it.
3. **The registry** (`js/ui-library/registry.json`) maps each role
   (`<family>__<role>`) to its kit name, classes, states, variants, route
   sheets, usage line, source and notes. `kitNote` holds the builder's notes;
   `note` is only ever the owner's words. `standards.md` is generated from it
   (`node scripts/ui-library/standards-md.mjs`).
4. **Two kinds.** `kit`: other screens adopt it. `reference`: drawn by its home
   module with made-up data and never copied. The charts (FinCharts,
   `Kit.balance`'s chart, the stock health bar) and the main side menu (the real
   `js/system/rail.js`) are references.
5. **States.** Hover, keyboard focus and pressed are forced with
   `data-kit-force~='hover|focus|pressed'`, written
   `:is(:hover, [data-kit-force~='hover'])` in the kit. Only
   `js/ui-library/` and the library HTML may set that attribute (a test scans
   for it). Other states use their real class or ARIA attribute. Charts and
   other references are driven by real pointer and keyboard events instead.
6. **The page.** `ui-library.html` is the shell: a list of families, a spec
   panel, and two stacked frames (dark over light). Each frame is
   `ui-library-frame.html?std=<key>&theme=dark|light`, loading the same global
   sheets as `index.html` (synced by `sync-frame-head.mjs` and pinned by a test),
   then `css/kit-standards.css` (for every standard, after the global sheets,
   where a rollout route will load it), then the standard's route sheets. It
   never loads `main.js`, the real `api.js` or Clerk, and it makes no API calls.

## One of each

Some standards replaced several near-copies in this branch. Build on these,
never beside them:

| Thing                 | The one part                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| Icon line style       | `Kit.glyph(name, {size})` (1.7 stroke). A guard pins every other stroke to master. |
| Pop-out shell         | `kit-pop-out`, opened by `openPopOut` (menus, filter button, filter chip)          |
| Hover tip for labels  | `Kit.hoverTip` (charts keep their own tips)                                        |
| Loading bars          | `Kit.loadingPlaceholder`                                                           |
| A figure nobody knows | `Kit.missingFigure`                                                                |
| Save note             | `Kit.saveNote` (`Kit.settingRow` uses it)                                          |
| File drop             | `Kit.fileDrop` and its helper (profile photo and store logo use it)                |
| Status dot            | `Kit.statusDot` (tones ok, warn, bad, info, accent, muted)                         |
| Keycap                | `Kit.keyHint`                                                                      |
| Focus ring            | the kit's one shared ring                                                          |

## Design and rationale

- The owner's picks overrule older written rules: the main action is the white
  box (`kit-main-action`) and delete is solid red (`kit-danger-warning`, the
  only red-filled button the guards allow).
- Additions only, so Financials and Employees, which are drawn with the kit,
  cannot change by accident. Where an existing part was hooked for forced
  states, the change was selectors only and was proved pixel-identical.
- Colours come from the rendered pick, not the source file: Financials and
  Inventory sit inside `.mod-skin`, which redefines the `--crm-*` colours.
- Every text colour reaches 4.5:1 and every mark 3:1 in both themes. Where a
  pick fell short, the kit copy was darkened slightly and the entry says so.

## Guards

- `__tests__/ui-library/`: registry contract (`standards.md` matches, every
  role has a kit name), frame head (same sheets as `index.html`), force hook
  (every forced state has a hooked rule; only the library sets the attribute),
  serving (static copies, no-cache headers, staging-only redirects), frame and
  shell renders, and the check rules.
- `__tests__/kit/`: tokens in both themes, buttons and touch floors, the line
  style, and the kit's naming rules. Every guard reads both kit sheets
  (`__tests__/kit/helpers/kit-sheets.js`), so a rule moved between them stays
  covered. Class names may not contain `card`, `tile`,
  `panel` or `-page`, because the shell repaints those.
- Local only (CI cannot run it): `node apps/portal-frontend/scripts/ui-library-check.mjs [--family f]`.
  It uses standalone headless Chromium. Every expected state and variant cell
  must exist, keyboard focus must be visible, and colours must come from kit
  tokens (references skip only the colour check). It writes screenshots to
  `/private/tmp/uil-shots/`.

## Serving

- Both pages, `js/ui-library/*`, `css/ui-library.css` and `assets/ui-library/*`
  are copied as static files (never Vite inputs), with no-cache headers.
- `css/kit-standards.css` is a portal sheet, not a library file: Vite copies and
  minifies it with the rest of `css/`, it is served on every host with the
  `/css/*` immutable cache, and no library redirect reaches it, so a rollout
  can load it anywhere. Both library pages link it with a `?v=` stamp, and
  `scripts/cache-bust.mjs` audits that stamp (`--write` bumps it on both).
- `vercel.json` sends every library path to `/` (307) on every host except
  `staging.useargus.co` and `rion-portal-staging.vercel.app`. `js/ui-library/guard.js`
  also refuses to draw anywhere else. The pages carry `noindex` and are not in the
  customer navigation.

## Adding a standard

1. Read the pick's source and look (`picked-variants.json`, the picker).
2. Grep the whole tree for the new class name first. A class already used
   without CSS must not be defined.
3. Write the renderer in `js/ui-library/render.js`, then add the part to the kit
   in `css/kit-standards.css`, never `css/kit.css`: tokens in both of its theme
   blocks, hook-form states, the shared ring, the touch floor (that sheet's own
   focus rule and coarse-pointer blocks, at its end).
4. Fill the registry entry, then run the kit and library tests, the whole
   suite, and the local check. Read every screenshot.
5. Regenerate `standards.md`, restamp (`cache-bust.mjs --write <stamp>`, audit to
   0), `sync-frame-head.mjs`.

## Owner's standing rules

- Financials never changes unless the owner says so.
- Employees doesn't change.
- Charts stay different. Only font, text and axis are shared.
- Keep the Financials timeline ruler; every other custom range uses the range dialog.
- The empty tick box is grey in dark and white in light.
- Keep the illustrated default faces.
- UI stays on staging.
- The library shows no real people, footage or finances. Its pictures are
  abstract stand-ins in `assets/ui-library/`, and a test holds every library
  picture to them.

## Limitations and known gaps

- Nothing on a live screen uses the new standards yet; that is step 2. Each
  rollout PR adds `css/kit-standards.css` to the routes it moves, after
  `kit.css` and before the route's own sheets.
- The shared table (`ArgusTable`) has five accessibility gaps that would change
  Financials to fix, so they wait for the owner. The focus ring is 2.4:1 in
  light and 1.8:1 in dark, every clickable row is a Tab stop, the pager doesn't
  say the page, the empty fade squares the corners, and the failed message is
  always an alert.
- Two chart looks are not drawn, because drawing them would copy chart CSS: the
  share-bar row tint under the pointer, and the mini-trend's draw-in.
- The app's toast (`main.js`) and `Kit.notify` are two copies until the
  rollout points one at the other.
- The local check is not run by CI. Run it before every library PR.
