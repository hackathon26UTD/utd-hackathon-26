# Performance

How to measure: `npm run hb -- bench --target live` (API plus raw Atlas), `npm run hb -- bench --target local --url http://127.0.0.1:8788 --no-db` (a local server only, never production), `npm run hb -- bench --site --profile mobile` or `node scripts/bench-site.mjs --profile mobile` (page weight, FCP, LCP, CLS, TBT). Set `DB_TRACE=1` on a local dev server to get an `X-DB-Trace` response header listing connections and database commands per request. Never set it in production.

## Where the time went

- Atlas free cluster is AWS us-east-1. From this machine one round trip is about 40 ms.
- A fresh connection costs about 400 ms (about 10 round trips: TCP, TLS, hello, 3-step SCRAM login). A ping after that is 40 ms. Seed-list, direct and polled-monitoring variants all measured 405 to 445 ms, so the handshake itself cannot be shaved from code.
- Workers cannot reuse sockets across requests, so the lever is **fewer connections and fewer commands per request**.

Findings (live site, before):

| Finding | Evidence |
| --- | --- |
| Catalog endpoint ran 8 index builds, a collection listing and about 55 upserts on every read | 63 commands, 3.1 s; also returned Cloudflare error 1102 (CPU limit) intermittently |
| Index setup repeated per request (live, feeds) because memo was keyed by a per-request object | 12 and 4 `createIndexes` per request |
| Browser sessions opened two connections per API call: auth middleware, then the handler | `readSession` and `withDb` each connect |
| Command center sorted the whole readings collection in memory and filtered it per box | COLLSCAN + SORT; quadratic loop |

## Baseline vs after (ms, p50 unless noted)

API, local dev server against the real Atlas cluster (same machine, old code vs new code; 12 runs). **Only data-catalog and feeds improved.** The other rows are unchanged within run-to-run noise (a re-measure of command-center gave 580 old and 591 new). The feeds row is partly confounded: main reads 18 sources and this branch 16, so part of that drop is fewer sources, not faster code.

| Endpoint | Before | After |
| --- | --- | --- |
| static, no database | 5 | 5 |
| /api/ready | 398 | 376 (noise) |
| /api/health | 395 | 374 (noise) |
| /api/ops/live | 390 | 379 (noise) |
| /api/command-center | 597 | 581 (noise) |
| /api/ops/data-catalog | 3110 | 423 |
| /api/feeds | 699 | 419 (partly fewer sources) |

Live site before (15 runs): ready 474, health 462, command-center 663, ops/live 463, data-catalog 2831 (p95 2929; one run in several returned a 503 from the CPU limit), feeds 1031 once, static 38. Re-run `bench --target live` after deploy for the live "after" column; it was not deployed from this worktree.

First request after an isolate starts still pays setup once (ops/live 1.2 s, catalog 3.1 s), then drops to the numbers above.

Site, mobile profile (1.6 Mbps, 150 ms RTT, 4x CPU), cold cache, median of 3. This compares the live site (before) with a local server running this branch (after), so network path and hosting differ between the columns. Re-measure live after deploy for a like-for-like number:

| Page | Metric | Live before | Local after |
| --- | --- | --- | --- |
| /simulations | FCP / LCP | 3760 / 4092 | 3372 / 3712 |
| /demo | FCP / LCP | 3936 / 4268 | 3380 / 3724 |
| /login | FCP | 1192 | 1128 |
| / | FCP | 1388 | 1424 (no change) |

Page weight is about 15 KB smaller than before (now / 851 KB, /simulations 788 KB, /login 148 KB). CLS is 0 everywhere.

## What changed

- `lib/mongodb.js`: one client per API request, shared by the session check and the handler (`withRequestDatabase`, wired in `functions/api/_middleware.js`); polled monitoring; `createIndex` asked once per isolate; seed-list address resolved once per isolate (falls back to the SRV address on any failure; set `MONGODB_SEED_URI` to skip even that lookup).
- `src/db.js`: `withDb` uses the shared client; `ensureOnce` for one-time setup.
- `src/data-api.js`: catalog setup once per isolate.
- `functions/api/command-center.js`: index-backed latest-reading query, no in-memory sort, grouped lookups. Ties on identical timestamps for one box and sensor are now arbitrary instead of ordered by id.
- Site: map library, command code, stylesheet and session check now download in parallel; tile host preconnect on map pages; hashed files under `/assets/chunks` and `/assets/media` are cached immutable; hero preview iframe is lazy.

## Not improved, and why

- Connection handshake (about 350 to 400 ms per request) cannot be cut from code. Real options: Smart Placement (`placement.mode = "smart"`) to run the Worker near us-east-1, which trades faster database time for a longer user-to-Worker hop; not verified because it needs a deployed preview. Verify with `bench --target live` before and after.
- Command center still makes 6 sequential commands over one connection (parallel connections cost more than they save).
- Home page still loads the full map demo in its hero iframe (about 700 KB). Making it lazy changed nothing at phone width because it sits within the browser's lazy-load distance. Replacing it with a static poster is a marketing decision.
- Entry bundles (`app.js`, `kit.css`, `design.css`) keep stable names so they revalidate on every visit. Hashing entry names needs HTML rewriting at build time.
- Readings still scans its index end to end for latest values; fine at 1,200 rows, revisit near 1 million (store a latest value per box and sensor).
- Index memo means a manually dropped index returns on the next isolate start, not immediately.


## November 10 query and refresh pass

The live latest-reading lookup now follows an aligned device/sensor/time/id index rather than sorting the entire matching history in memory. A disposable 50,000-reading benchmark on MongoDB8.2.6 measured medians54.4→45.7ms with no blocking sort in the new execution plan. Both still examined50,000 rows; see DATABASE_SCALE_RECOMMENDATION.md for the required eventual latest-state read model. This is not a claim of a16% overall page-speed gain.

Live refreshes share an in-flight operation across visibility and timer triggers. Off-screen embedded previews skip their status/age/overlay timers and recompute when visible again. Synthetic age and stale critical semantics remain unchanged. Focused tests pass56/56 and the Functions/UI build passes with the existing unenv warning. Production and browser evidence follow in WORKLOG.
