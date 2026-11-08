---
status: accepted
relevance: high
created: 2026-09-28
tags: [portal, frontend, design-system, kit, ui-library, figma, 2026-Q3]
---

# ARGUS UI library: design

> **Status:** Accepted; Plan 1 built 2026-09-29 (the living doc is
> [`docs/portal-ui-library.md`](../../portal-ui-library.md)). **Owner decisions:**
> the 108 standards ([`docs/ui-library/standards.md`](../../ui-library/standards.md),
> picked on the standards picker); the library lives on a staging portal page
> (the Figma file was dropped on 2026-09-28).

## Split into plans

1. **Plan 1: tokens, kit parts, registry, library page, guards.** Prerequisite:
   #3315 merged (it adds `Kit.helpBanner.into()` and changes picked Financials
   parts; standards are copied from master after it lands).
2. ~~Plan 2: Figma file.~~ **Dropped** (owner, 2026-09-28: "dont worry about
   figma"). The portal library page is the only library.
3. **Plans 3+: rollout, one per family**, range pickers first.

## Goal

One library of the owner's 108 picked standards. Every picked part is shown in
every state, dark and light, "like Figma, for future use". Every screen is then
moved onto those standards, except the parts the owner said not to touch.

## Hard constraints (owner, 2026-09-28)

- ⛔ **Financials is never changed unless the owner says so.** Many standards
  come FROM Financials. The library copies them; it never edits `js/financials/*`
  or `css/financials-*`.
- ⛔ **Charts stay different from each other.** Only font, text and axis are
  shared. The library documents one chart grammar (type scale, axis, gridline,
  hover tip); it does not merge chart types.
- ⛔ **Employees does not change.**
- Keep the Financials timeline ruler. Every other custom date range uses the
  picked `kit-range-dialog`.
- Tick box: the empty box is grey in dark mode and white in light mode (the
  checked state keeps the picked look).
- The illustrated default faces stay in the profile photo picker.
- UI and Dashboard work stays on staging ([`feedback-promote-backend-ui-stays-staging`]).
  The library page is never linked from the customer navigation.

## Architecture

### 1. The kit is the source of truth, and only grows

- ⛔ **Additions only.** Financials and Employees are drawn with the kit
  (`css/employees.css` uses `--kit-*` 414 times; Financials uses Kit.balance,
  Kit.guide, Kit.helpBanner, Kit.segs and ArgusTable). So an existing kit token,
  class or factory is never retuned. Every standard that differs from today's kit
  is ADDED under a new name. If an existing kit rule ever must change, that PR
  carries before and after screenshots of Financials and Employees in both themes.
- **One exception: adding the state hook.** About 20 picks are already kit parts
  (kit-select, the date field, the range dialog, the status tag, the framed and
  ArgusTable tables, Kit.guide, Kit.balance, Kit.confirm, the small kit button).
  Their existing `:hover`, `:focus-visible` and `:active` selectors are rewritten
  to `:is(:hover, [data-kit-force~="hover"])` and so on. This changes nothing on
  screen: the weight is the same and nothing outside the library sets the
  attribute. It still carries the Financials and Employees screenshots, as proof.
- **A registry** (`js/ui-library/registry.js`) is the machine-readable map, keyed
  by role (`buttons__main-action`, the key the picker saved), holding the picked
  variant slug (`white-box-primary`), kind, kit name, states it has, route sheets
  and scripts it needs, where it came from, and the owner's note. `standards.md`
  is generated from the registry for people, and a test checks the two match row
  for row on role and variant slug.
- **Two kinds of standard:**
    - `kit`: anything other screens will adopt. Picks that live outside the kit
      today (Financials `fc-*`/`ftx-*`, Settings `tp-*`, `crm-btn--primary`, the
      solid red delete) are **copied** into the kit under a kit name. Their
      original files are left alone.
    - `reference`: charts. The owner wants charts to stay different, so chart
      code is not copied. The library shows each picked chart rendered by its own
      home module (read-only use, synthetic data) and documents the shared chart
      grammar as kit tokens: type scale, axis, gridline and the hover tip.

- **Tokens first.** Colours, radii (control 8px, tag 6px), type scale, focus
  ring, spacing and elevation are kit tokens defined for BOTH themes. A standard
  may only use tokens, never a literal colour (existing kit rule).
- **Every state is part of the standard.** Default, hover, keyboard focus,
  pressed, selected/open, disabled, busy, error and empty, as each part has them.
  Only hover, keyboard focus and pressed need a forcing hook, because a page
  cannot show them at rest: those rules are written
  `:is(:hover, [data-kit-force~="hover"])`, `:is(:focus-visible,
[data-kit-force~="focus"])`, `:is(:active, [data-kit-force~="pressed"])`.
  (`.is-hover`, `.is-focus` and `.is-active` already mean other things in the
  portal.) Open, selected, disabled, busy and error keep their real class or ARIA
  attribute. A guard test allows only `js/ui-library/` and the library HTML to
  SET `data-kit-force` (it scans JS and HTML); CSS selectors that read it are
  allowed anywhere in the kit.
  Parts a class cannot force (the native video player, scrollbars) are shown in
  their default state only, and marked so.

### 2. The library page (source of truth, staging only)

- Two pages: `ui-library.html` (the shell: left list of families and roles,
  spec panel, code snippet, notes) and `ui-library-frame.html?std=<slug>&theme=dark|light`
  (the canvas). The portal sets the theme once per page (`body.light-mode`;
  `shell-theme.css` alone has 732 rules keyed on it), so the shell shows the
  selected standard in **two stacked frames, dark over light**, each drawing its
  state matrix (states across).
- **Same cascade as customers get.** The frame's global sheets are generated
  from `index.html` by a script (the way `scripts/make-shell-harness.mjs` does),
  pinned by a test, then each standard's route sheets from the registry (the
  sheets `main.js` loads per route: `_NEXUS_ASSETS`, `ROUTE_STYLES`), so rules
  that override the kit on real screens show up here too. Stamps follow the
  cache-bust rules.
- **Scripts:** the kit scripts in `index.html`'s order, and for chart references
  the globals `index.html` already loads (`window.FinCharts`,
  `InventoryAnalyticsReports._internal.healthBand`). Never `main.js`, Clerk or the
  real `api.js` (loading the real `api.js` over a harness stub has broken a
  harness here before).
- The Dashboard hover tip pick is a `kit` standard (every chart and label uses it);
  it is also the hover tip named in the chart grammar.
- **Serving on staging:** both pages are COPIED as static files
  (`copyStaticAssets` in `vite.config.js`), never Rollup inputs: a Vite input
  sharing `index.html`'s sheets changes how Vite bundles and orders the
  customer page's CSS (found in plan review, 2026-09-28). Add a `vercel.json`
  rewrite for `/ui-library` BEFORE the catch-all, no-cache headers for the
  library's own files (`/js/*` and `/css/*` are otherwise immutable for a
  year), and budgets in `check-html-budget.mjs`. `vercel.json` is shared with production, so the pages
  refuse to render on the production portal host; they carry `noindex` and are
  not in the customer navigation.
- The existing harness pages stay as they are.

### 3. The Figma file: dropped

The owner dropped the Figma file on 2026-09-28 ("dont worry about figma"). The
portal library page (section 2) is the library.

### 4. Rollout, screen by screen, staging only

One PR per family per module area, in this order: **range pickers first** (the
owner's first ask), then buttons, text boxes and dropdowns, tabs and tables,
then the rest. Each PR:

1. swaps that area's old versions for the standard, and deletes the dead CSS;
2. skips Financials, Employees and chart shapes;
3. adds the area to a **no-new-old-versions guard** (a contract test listing the
   replaced classes and factories; the list only shrinks; Financials and
   Employees files are exempt, since they keep `fc-*`, `crm-tab` and `emp-*`);
4. is checked live on staging by screenshot in both themes before the next one.

The help banner rollout also moves every module onto `Kit.helpBanner.into()`, so
a second banner is impossible everywhere, not just Financials (#3315).

## Guards and docs that change on purpose

The owner's picks overrule three written rules. Plan 1 amends each in the same PR
as the kit addition, citing the pick:

- `__tests__/kit/buttons.contract.test.js` fails any `.kit-btn` filled with red:
  allow the new solid red delete button, and only that one.
- `docs/ARGUS_PORTAL_DESIGN_SYSTEM.md` says red is "a STATE, never a button fill"
  and that the primary is a tint: rewrite both to the picks (main action = white
  box, delete = solid red).
- The solid wine "hero" button lost the main-action pick. It is retired during
  the buttons rollout (Financials keeps its own), and
  `pill-buttons.contract.test.js`'s wine pin is updated then, not in Plan 1.
- `buttons.contract.test.js` matches selectors literally (`.kit <sel>`): the
  `:is(...)` state rules are checked against it first.

## Testing

- **Where tests run:** jsdom (vitest, in CI) cannot resolve cascaded colours or
  see a focus ring, and CI's Playwright job points at production, where the
  library refuses to render. So:
    - vitest (CI): structure. Every registry entry renders every state it lists,
      the registry matches `standards.md` one to one, `data-kit-force` appears only
      in `js/ui-library/`, and the frame's global sheet list equals `index.html`'s.
    - A local headless-Chromium script (`scripts/ui-library-check.mjs`, static
      server on the built pages): every state's computed colours come from kit
      tokens in both themes, keyboard focus is visible, and it saves one screenshot
      per standard per theme for review. Running it is a named step in every
      plan's checklist, since CI does not run it.
- A contract test that every standard in `standards.md` has a kit name and a
  library entry (the library cannot silently fall behind the picks).
- The no-new-old-versions guard, per rolled-out area.
- Existing style guards keep passing (`no-pill-controls`, `portal-invisible-animation`,
  `widget-hover-no-box`, no native controls).
- Screenshots of the library page (standalone headless browser, both themes),
  and a live look on staging after each merge.

## Out of scope

- Changing Financials, Employees, or any chart's shape.
- Production portal deploys.
- New components that were not picked.

## Open questions

None blocking. Two picks read against older memory rules and are taken as the
owner's new rule: main action = white box (not the pale tint), delete = solid red.
