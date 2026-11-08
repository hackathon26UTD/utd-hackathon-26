# Safe Home design contract

> November 8 current direction: white lower-48 street map, state zoom and a full device workspace with actual Argus tabs. The public homepage has a non-interactive animated overview, three example readings, compact rounded actions, upper-right theme/motion Settings, and team/event/intent/services below. The sidebar collapses with a reduced-motion-aware transition. See [homepage refinement](design/HOMEPAGE_CLEANUP.md), [MARKETING.md](MARKETING.md) and [MAP_V2_SPEC.md](MAP_V2_SPEC.md). These supersede the older satellite, drawer and interactive-homepage descriptions below.

## Direction

An operational recovery map, built for comparing affected homes and deciding the next follow-up. Safe Home is the product name. Avoid promotional claims, decorative gradients, invented risk percentages, and em dashes.

## Argus source

The owner's actual Argus kit is vendored unchanged under `ui/kit/vendor`. Safe Home uses Kit.select, Kit main tabs, Kit section navigation and existing product glue. Read [UI_KIT.md](UI_KIT.md) and `ui/kit/PROVENANCE.md` before changing components. The public reference is https://argus.build/ui; its media CLI is unrelated.

## Tokens

Current November 8 identity: red #d62311, hover #a11b13, ink #212121, ground #f7f7f7, white #ffffff; muted #626060. Hanken Grotesk headings/body, self-hosted; Spline Sans Mono readouts. This follows Ayan's State Farm/Drive Safe & Save reference with a distinct Safe Home house and stacked wordmark. See BRAND.md for reference and font provenance. Generated light/dark kit tokens control actions, while response colors retain their separate green/amber/red/unknown meanings and written labels. Component corners 6-10 px, 44 px controls, 4 px spacing grid. Motion is 150-220 ms for state changes, with reduced-motion support.

## Layout

Desktop: narrow navigation rail, compact situation summary, property queue, real geographic map, selected-property evidence panel, incident replay control. On small screens, the property list and details remain usable without the map. The map is an optional spatial view; every property is keyboard reachable through the list.

## Required states

Exercise versus live data clearly separated. Unknown is not safe. Stale critical observations remain visible. No measurements, missing coordinates, provider failure, session expiry, queued records, low battery and confirmed human status need separate treatments. Login, privacy, terms, accessibility and cookie settings share the same component tokens.

## Accessibility

Target WCAG 2.2 AA. Semantic landmarks, skip links, text labels, keyboard filters/tabs, visible focus, non-color severity, bounded motion, accessible dialogs, error feedback, and a list alternative to WebGL are required. Automated checks and manual keyboard testing do not establish legal ADA certification.

## Marketing experience revision

See [MARKETING.md](MARKETING.md) for the current homepage. Its preview is read-only and simulated, with optional playback. Team/event attribution appears once in About. Product intent, prototype limits and actual service context belong in dedicated sections, not decorative hero/footer badges. Unknown and stale-critical labels remain visible as plain text in the command center.
