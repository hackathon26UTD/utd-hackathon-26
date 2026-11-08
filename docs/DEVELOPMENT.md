# Development and logging plan

## System investigation workstream

See [SYSTEM_INTELLIGENCE.md](SYSTEM_INTELLIGENCE.md). `npm run system:demo` exercises an isolated MongoDB-backed, explicitly simulated four-tool investigation; `npm run nvidia:check` is an opt-in live model check once a private key exists. New operator endpoints expose evidence and persist review checkpoints without modifying the map UI. The next hardware gate is a verified AA power path and measured current draw; reference power policies are not yet wired into sketches. Coordinate with Dhruv before firmware integration and Ayan before adding map controls.

## Immediate infrastructure work

1. Use the private `hackathon26UTD/utd-hackathon-26` organization repo; bring across the prepared starter and logs through a reviewed PR.
2. Confirm Atlas organization/project and complete Cloudflare login.
3. Prepare requested management credentials and document actual permissions/expiration, without logging values. Complete the browser's final credential-creation confirmation if required.
4. Keep runtime database credentials separate from provider-management tokens. Atlas management keys do not authenticate application database reads/writes.
5. Select one problem, one user, and one short demo journey before adding application endpoints or tables/collections.

## Proposed 24-hour build sequence

This is a proposed working sequence, not the official event schedule or assigned team commitments.

- First 1–2 hours: agree problem, team owners, track rules, hardware availability, one happy-path API contract, and demo success condition.
- Next 3–5 hours: build one end-to-end path using clearly labeled sample data; deploy early.
- Middle portion: connect one real sensor/input and the actual data store; add useful history/alerts only if needed for the core journey.
- Final portion: stop new features, handle main error/empty states, rehearse demo, record backup video, prepare submission and third-party credits.

Do not equate a polished dashboard with working hardware or an AI moat. Demonstrate one measured input and one useful resulting action.

## Team coordination

Use small branches and PRs. Keep main working. One owner per workstream; assignments are still pending. Pull/rebase before changes and avoid overwriting another teammate's active files. Check in with done/next/blocked; keep blocker and decision logs current. Do not migrate repos or delete cloud services based only on a tentative plan.

## API/data contract when product is selected

Record: endpoint, input validation, authentication, device identity if any, response shape, limits, timeout, owner, storage collection, and error behavior. Label mocks and generated data. Keep ingestion tokens and management tokens distinct. Do not expose an unrestricted administrative credential to devices or frontend code.

## Ongoing Markdown logging

After meaningful work, append date/time (America/Chicago), actor/source, request, actual result, verification, blockers, and next action to WORKLOG.md. Update PROJECT_CONTEXT.md for the current handoff, DECISIONS.md for changes/reversals, ARCHITECTURE.md for real stack choices, and HARDWARE.md for reservations, wiring, and failures.

Record identifiers and URLs only when useful; never token values, passwords, database URIs with passwords, cookies, auth headers, private invite URLs, QR credentials, or resume contents. Keep contacts in the private team file. Mark unverified claims, stale inventory, and suggested designs explicitly. Do not rewrite failed or abandoned work as completed.
