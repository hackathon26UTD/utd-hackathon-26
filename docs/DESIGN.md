# HomeBeacon design contract

## Direction

An operational recovery map, built for comparing affected homes and deciding the next follow-up. HomeBeacon is the product name. Avoid promotional claims, decorative gradients, invented risk percentages, and em dashes.

## Argus source

The publicly delivered https://argus.build/ui includes its Oracle Design System component library. Inspected its button variants, segmented tabs, tags, data tables, forms, dialogs, focus styles and motion rules on November 7, 2026. The media CLI is a separate asset tool and is not authenticated. HomeBeacon implements adapted component patterns and its own theme; it does not claim a licensed component package or retrieved private Argus assets.

## Tokens

Ink #182f3b; paper #f4f6f7; white #ffffff; teal #21665f; critical #b9413b; amber #925d1a; muted #526974. Bricolage Grotesque headings and Geist body, self-hosted. Component corners 6-10 px, 44 px controls, 4 px spacing grid. Response colors always have written labels and symbols. Motion is 150-220 ms for state changes, with reduced-motion support.

## Layout

Desktop: narrow navigation rail, compact situation summary, property queue, real geographic map, selected-property evidence panel, incident replay control. On small screens, the property list and details remain usable without the map. The map is an optional spatial view; every property is keyboard reachable through the list.

## Required states

Exercise versus live data clearly separated. Unknown is not safe. Stale critical observations remain visible. No measurements, missing coordinates, provider failure, session expiry, queued records, low battery and confirmed human status need separate treatments. Login, privacy, terms, accessibility and cookie settings share the same component tokens.

## Accessibility

Target WCAG 2.2 AA. Semantic landmarks, skip links, text labels, keyboard filters/tabs, visible focus, non-color severity, bounded motion, accessible dialogs, error feedback, and a list alternative to WebGL are required. Automated checks and manual keyboard testing do not establish legal ADA certification.

## Marketing experience revision

The public homepage is distinct from operator sign-in. Paper #f4f6f7, ink #182f3b, teal #21665f, mist #dceae6 and alert red #b9413b continue the command center palette. Bricolage carries large, closely spaced headlines; Geist carries navigation and copy. A left-aligned editorial hero faces a custom neighborhood cutaway. Scenario controls animate observations through home, local record and operator view. Below it, a three-step explanation leads into an actual command-center preview, hardware details and FAQ. Sticky top navigation provides product sections, exercise access and a portal action. Motion is concentrated in the interactive scene, with a pause control and reduced-motion alternative. No fictional customer logos, adoption statistics or safety claims.
