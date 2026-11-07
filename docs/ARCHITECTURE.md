# FutureYou architecture

React client state feeds a pure integer-cent forecast engine. A custom SVG chart, health indicators, and ledger all consume the same result. Dates use UTC, and the demo deliberately fixes the planning window to May 15–August 12, 2027.

## Data flow

- `lib/model.ts`: bounded Zod schemas shared by client storage and server requests.
- `lib/forecast.ts`: dated cash events, balances, minimum, cushion gaps, and deterministic explanation.
- `lib/nessie.ts`: server-only Nessie reads and normalization. Monthly rent is separated from other bills to avoid double counting. Unsupported non-monthly bills are disclosed and omitted.
- `components/future-you.tsx`: editable scenarios, source selection, snapshot saving, and four workspace views.
- `components/cash-chart.tsx`: scenario/baseline/cushion comparison with mouse and keyboard exploration.
- `lib/export.ts`: dated CSV ledger; text cells neutralize spreadsheet formulas.

## API

| Route | Behavior |
| --- | --- |
| `GET /api/status` | Configuration booleans only; not a health or credential check |
| `GET /api/nessie` | Imports the configured fictional customer; server result cached for 60 seconds |
| `GET /api/plans` | Lists up to 20 plans belonging to the anonymous browser session |
| `POST /api/plans` | Validates and saves one scenario plus its portfolio snapshot |
| `DELETE /api/plans` | Removes a plan only within the requesting browser session |
| `POST /api/insights` | Recomputes the forecast and requests an optional Gemini explanation; deterministic fallback on errors |

No external API key is sent to the browser. The Nessie key is supplied to Nessie's required query parameter only on the server. Gemini receives only selected dates and formatted calculated aggregates, without account IDs, profile names, or user-entered plan names. Completed explanations are cached for ten minutes; truncated outputs fall back to the deterministic summary.

## Persistence

Browser storage keeps the current scenario and up to 20 saved snapshots. When `MONGODB_URI` is configured, the app also stores plans in `futureyou.plans`. A random, HttpOnly, SameSite=Lax cookie scopes cloud reads and writes; the cookie is Secure in production. This provides anonymous demo-session separation, not end-user account authentication or multi-device recovery.

MongoDB uses a reused native-driver connection with a seven-second selection timeout. The schema is `{id, savedAt, sessionId, scenario, portfolio}`. For a longer-lived deployment, create a compound index on `{sessionId:1,savedAt:-1}`, add an expiry/retention policy, authenticated accounts, and durable rate limits before accepting real user data.

## Forecast assumptions

Checking plus optionally selected savings form available cash. Credit-card balances are debt and are not added to cash. Recurring credit minimum payments remain expenses. Internship payroll repeats every 14 days from the chosen first payday. Campus employment stops at internship start. Moving and deposit costs are paid two days before the move. New rent is charged on move-in and the first of subsequent months. Weekly essentials occur on Mondays; monthly bills clamp to a month's final date when needed.

Balances are end-of-day, so bank processing order is not modeled. There is no rent proration, partial final campus paycheck, deposit refund, tax calculation, inflation, interest, or overdraft fee. The cash cushion is a target, not an expense. Explanations describe a simulation under these assumptions.

## Hosting and operational limits

Vercel runs Next.js and its Node.js API routes. A Node runtime supports the MongoDB native driver's network connections. Use production secrets in Vercel settings; `.env.local`, `.vercel`, build output, and dependencies are excluded from Git and deployment source as appropriate.

Nessie and Gemini have bounded timeouts and visible fallbacks. AI explanation generation is disabled without a key. The demo caches repeated results and caps each running instance at 60 generation requests per hour and three concurrent calls. These are per-instance protections, not a global spending cap; configure provider quotas and durable abuse controls for broader use. The Gemini 2.5 Flash request disables thinking to reserve its bounded output budget for the explanation, following the [official API guidance](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en). Atlas must have both an app credential and network access from the runtime. A configured URI does not prove the database is reachable.
