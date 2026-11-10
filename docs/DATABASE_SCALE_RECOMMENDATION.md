# Safe Home: performance and database direction

November 10, 2026. Recommendation based on the current code, read-only live measurements, and the official references below. This is an architecture recommendation; no database migration or paid provisioning was performed.

## Recommendation

**Keep MongoDB Atlas while improving the current product. Prefer managed PostgreSQL for the long-term central product database once tenancy, fleet management and production requirements are defined. Use SQLite for a Linux gateway’s local offline journal, not one shared database file for all boxes.** ESP32 microcontrollers should retain a bounded flash/SD event log rather than assuming they can run desktop SQLite.

Atlas already is managed MongoDB. Moving to managed PostgreSQL changes the data model and connection path; it does not automatically make the service scalable. MongoDB remains a valid option for high-volume telemetry. Its existing time-series storage, 30-day retention, geospatial indexes and separate duplicate-receipt collection are useful work, not a prototype to discard.

The strongest case for PostgreSQL here is the growing relationship model: organizations, homes, owners, household permissions, boxes, credentials, firmware releases, incidents, messages, acknowledgements and audit records. Database constraints and transactions suit those relationships. PostgreSQL also supports indexed JSONB for changing sensor payloads, row security policies for tenant separation, and partitioning for large histories. These features still require correct application design; database owners can bypass row security.

## Comparison for this product

| Choice | Good fit | Main tradeoff | Decision |
|---|---|---|---|
| Existing MongoDB Atlas | Current application and flexible, compressed telemetry history | Current Worker path opens a database connection per request; existing reads still examine history. Product relationships are enforced in application code. | Keep now; tune and measure. |
| Managed PostgreSQL | Shared product data, transactional ownership, fleet operations, incident/message consistency | Migration is substantial; retained high-rate telemetry still needs indexes, retention and possibly partitions. | Preferred central product direction. |
| Ordinary SQLite | One Linux gateway, local durable queue, offline replay and diagnostics | One writer per database file; avoid multiple computers sharing a file across a network. | Use locally where the hardware supports it. |
| Cloudflare D1 | Small serverless SQL applications or deliberately separated tenant databases | Managed SQLite service, distinct from sharing a local file. Current size limits are 500 MB per Free database and 10 GB per Paid database; a single central telemetry archive would outgrow those quickly. | Possible bounded product store, not the first choice for one large fleet history database. |

## What the current evidence says

The public site’s existing map illustration loads approximately 308 KB of compressed MapLibre JavaScript and 104 KB of command-workspace JavaScript, plus tiles, fonts and shared code. That map is a requested part of the design. This change preserves it; no claim is made that its initial download became smaller. The Chrome sample was unthrottled and had extensions, so it is diagnostic evidence, not a clean Lighthouse/Core Web Vitals score.

Three warm live samples through the established Pages hostname measured approximately 499 ms median for readiness, 1,897 ms for a full live dashboard snapshot and 748 ms for the older dashboard endpoint. A separate snapshot/delta run measured 727–751 ms for unchanged incremental polls, with a 201-byte response. These are small samples from one location, not a fleet load test or an SLA.

The MongoDB connection helper correctly respects Cloudflare request-bound sockets, shares one client within a request, caches DNS seeds and memoizes index setup. It cannot safely keep that socket for unrelated requests. A pooled database path such as Hyperdrive plus PostgreSQL is therefore worth benchmarking. This does not prove that switching engines alone would make queries faster.

The dashboard currently limits a response to 500 devices. National overview aggregation, viewport scoping and pagination are required before assuming a larger fleet will be fully represented. A database switch does not remove this application limit.

## Optimizations implemented in this pass

1. Added an index aligned with the latest-reading query’s device, sensor, timestamp and tie-breaking ID order. A disposable local MongoDB test with 50,000 readings removed the blocking sort and reduced median query time from 54.4 ms to 45.7 ms, about 16%. Both variants still examined all 50,000 matching records: this is a useful query improvement, not a bounded-history solution. The additional index consumes storage and adds write work. Existing indexes were preserved.
2. Coalesced overlapping live refresh triggers, so tab-resume events and the normal timer share one request and one subsequent schedule. Request errors release the guard so refreshes can recover.
3. Paused preview status/age/overlay refresh work when the homepage illustration is off-screen, with immediate recomputation when it returns. Reduced-motion settings remain separate from visibility; pausing animation does not permanently freeze freshness. Before the change, the hidden preview’s status element still generated six mutations during a 2.5-second observation. Post-release results are recorded in the work log.
4. Renamed the personal forwarding alias from ayan@ to abasheer@safehomemesh.us. Standard aliases and the Gmail destination were preserved.

Tests specifically retain timestamp tie behavior, stale critical readings, the 30-day boundary, duplicate refresh protection and error recovery. No sensor records or ownership records were migrated.

## Scale model

Assumption: one accepted report per box per minute, with all sensor values batched into that report. This is a planning scenario, not a measured hardware reporting rate.

| Boxes | Reports/second | Reports/day | Reports in 30 days |
|---:|---:|---:|---:|
| 100 | 1.7 | 144,000 | 4.32 million |
| 1,000 | 16.7 | 1.44 million | 43.2 million |
| 10,000 | 166.7 | 14.4 million | 432 million |

At an illustrative 1 KiB per report, 1,000 boxes produce about 44 GB in 30 days before indexes and replicas, without accounting for compression. Storing five separate sensor rows instead of one report multiplies row count by five. Offline replay can create large short bursts. Reporting frequency, aggregation and retention matter more than choosing a database by name.

## Proposed eventual architecture

Boxes retain immutable local events with device/event identity, sequence and original observation time. A Linux gateway may use SQLite; ESP32 nodes retain their existing bounded logs. Accepting an HTTP report must continue to mean a documented durable receipt, not merely that work was started in memory.

A central service authenticates the device, rejects conflicting retries, stores the receipt and event, and updates a small latest-state record. Dashboards read this small latest-state store, scoped to the user and viewport; history pages read bounded time ranges. Preserve last-known critical evidence and explicitly label stale data. Do not cache private household responses in a public edge cache.

For PostgreSQL, keep core product relationships and latest states in ordinary tables. Start with an indexed history table and partition only when volume justifies it. Keep duplicate receipts separately keyed by device and event: a unique key on a partitioned telemetry table must include its partition key, so a separate receipt table preserves retry uniqueness across partitions. Export older history to object storage under an explicit retention policy; maintain useful summaries separately.

Benchmark a same-region managed PostgreSQL service through Hyperdrive if the API remains on Workers. Its transaction pooling changes session behavior: tenant context must be set within the transaction, not left on a reused session. Do not move credentials, ownership or authorization logic into a new provider just to obtain PostgreSQL.

## Migration gate

Do not start by copying the production database. First benchmark both designs against the same synthetic workload, including 1,000-box steady traffic, a 10x replay burst, concurrent dashboards, duplicate/conflicting events and missing data. Track p50/p95/p99 latency, error rate, connection count, Worker CPU, database storage and monthly cost. Define pass/fail budgets before selecting a provider.

If PostgreSQL wins, build an adapter and rehearse an export/backfill in a separate environment. Verify counts, event identities, ownership, constraints, retention, replay and stale/critical behavior. Test recovery and rollback. Define the consistency and reconciliation rules before any dual-write period. A production cutover needs a concrete reviewed migration plan; this audit does not perform one.

## Official references

- [MongoDB time-series bucketing](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-bucketing/) and [limitations](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-limitations/).
- [PostgreSQL JSONB](https://www.postgresql.org/docs/current/datatype-json.html), [partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html), [row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
- [SQLite appropriate uses and concurrency](https://www.sqlite.org/whentouse.html).
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
- [Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/) and [pooling](https://developers.cloudflare.com/hyperdrive/configuration/tune-connection-pool/).
