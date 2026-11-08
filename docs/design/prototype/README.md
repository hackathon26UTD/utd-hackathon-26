# HomeBeacon map review prototype

Ayan's workstream. Isolated interaction proposal for the teammate using Astra. Ayan approved this direction for Astra to develop and refine. This is not a production implementation.

## Run

From the repository with dependencies installed:

```
node docs/design/prototype/build.mjs
python3 -m http.server 8797 --directory work/map-review
```

Open http://localhost:8797. Imagery requires an internet connection. No account or credentials are required. This is a dated alert snapshot and three fictional devices, not a production feed.

## Review

- Start on the U.S. imagery overview. No KPI cards, side rail, queue or selected device.
- Select Florida's grouped alert label, then inspect either actual alert boundary. Region selection zooms and opens an anchored summary.
- Tools > Find an area or home provides the keyboard/list path and searches this small sample only.
- Select HB-1003 to zoom into a fictional house location. View evidence expands the card at its geographic anchor. Close preserves camera context.
- Tools opens layers, source information, activity and privacy/access links on demand.
- Tools > Preview exercise report demonstrates one report-age/marker transition. It does not send anything or run a fake live loop. The camera and selection remain unchanged.
- Browser reduced-motion preference disables camera flights, entrance transitions and the event pulse.

## Actual component composition

| Interaction | Real Argus factory |
| --- | --- |
| Tools launcher | Kit.buttonMenu |
| Search | Kit.searchField |
| Layer visibility | Kit.tickBox |
| Geographic region/house content | Kit.sectionBox |
| Observation tone | Kit.pill |
| Expanded readings | Kit.details |
| Expansion control | Kit.foldOpen |
| Observation history | Kit.historyList |

The native close button and map geographic target are integration controls. The library has no geographic popup factory. Card placement/leader, map markers and responsive layout are HomeBeacon integration, not fabricated kit components. Vendor files remain unchanged.

## Data and attribution

USDA/USGS The National Map imagery supplies geographic context. It includes aerial orthoimagery, varies in age/resolution, and is not live imagery or current damage evidence. Attribution remains on the map. Consult source coverage/licensing before production adoption.

The NWS request and exact retrieval time are in alerts-snapshot.json. The request returned 322 features, two with geometry. Only that geometry subset is rendered, with issued times in selected summaries. No representation of nationwide completeness is made. The default national view is a design composition, not national integration.

Fictional devices are intentionally placed for review. They do not identify actual participating homes, their conditions or their occupants. No household data, secret keys or production API writes are included.

## Still needed

Detailed implementation review; national source/zone resolution; Alaska/Hawaii navigation; full failed/stale/retry states; message/zone/assistant flows; light-theme review; production integration and full role/data regression. This prototype does not complete the production redesign.

## Review evidence

Desktop/mobile captures cover national, region, compact house, expanded house and layers. Automated checks on these ten states reported no page errors, accessibility violations, horizontal overflow or card bounds violations. A separate 1920×1080 interaction check measured 97.7% unobstructed by app chrome at rest; the map canvas fills the viewport. Search selection, layer toggling, Escape closure and camera preservation during a requested exercise report were exercised with normal and reduced motion. These checks do not replace human design acceptance or complete accessibility certification.

Rendered critique caught overlapping alert labels and mobile map controls behind a region card. The prototype groups alert labels at national zoom and moves mobile zoom controls clear of an open card. Remaining critiques: national labels/state boundaries need treatment over imagery; dense regions and long summaries need larger fixtures; Alaska/Hawaii navigation remains absent. Review those before production adoption.
