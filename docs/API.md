# API contract

Product-agnostic backend on Cloudflare Pages Functions + MongoDB Atlas, so hardware and software work can start before the product is final. Code: `src/app.js` (router + routes), `functions/api/[[path]].js` (Cloudflare entry). Tests: `npm test`.

Base URL: local `http://127.0.0.1:8788/api` (`npm run dev:local`), hosted `https://<pages-project>.pages.dev/api`.

## Auth

| Caller | Header | Can do |
| --- | --- | --- |
| Admin / backend / scripts | `Authorization: Bearer <API_ADMIN_KEY>` | Everything |
| Device (ESP32, Pi, phone) | `X-Device-Key: dk_...` (from `POST /devices`) | `POST /ingest`, `POST /events` |
| Browser dashboard | none, if `API_PUBLIC_READ=true` | All `GET` routes |

Device keys are shown once and stored only as SHA-256 hashes. Never ship `API_ADMIN_KEY` to a browser or device. Turn `API_PUBLIC_READ` off if data is sensitive.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Pings MongoDB; reports latency and auth config |
| POST | `/setup` | admin | Create indexes (run once after first deploy) |
| POST | `/devices` | admin | `{name, type?, meta?}` → `{device, deviceKey}` |
| GET | `/devices`, `/devices/:id` | read | List / get (with `lastSeen`, `readingCount`) |
| PATCH | `/devices/:id` | admin | `{name?, disabled?, meta?, rotateKey?: true}` |
| POST | `/ingest` | device | Readings: one object, an array, or `{readings: [...]}` (max 500) |
| GET | `/readings` | read | `?deviceId&sensor&since&until&limit(≤1000)&order=asc` |
| GET | `/readings/latest` | read | Latest value per device+sensor, `?deviceId` |
| GET | `/readings/stats` | read | Chart series: `?sensor&deviceId&since&bucket=<sec>` → avg/min/max/n |
| POST | `/rules` | admin | `{sensor, op: > >= < <= == !=, threshold, deviceId?, severity?, message?}` |
| GET / DELETE | `/rules`, `/rules/:id` | read / admin | List / remove rules |
| GET | `/alerts` | read | `?status=open,ack&deviceId&limit` |
| PATCH | `/alerts/:id` | admin | `{status: open\|ack\|resolved, note?}` |
| POST | `/events` | device or admin | `{type: "door.open", data?}` discrete happenings |
| GET | `/events` | read | `?type&deviceId&since&limit` |
| GET / POST | `/store/:collection` | read / admin | Generic JSON docs. `?filter={"status":"open"}&sort=-createdAt&limit&skip` |
| GET / PATCH / DELETE | `/store/:collection/:id` | read / admin | Get, merge-update, delete |

Reading shape: `{"sensor": "temp_c", "value": 4.2, "unit": "C", "ts": "2026-11-07T21:00:00Z"}`. `sensor` matches `[A-Za-z0-9_.:-]{1,64}`; `value` is a number, boolean or short string; `ts` defaults to server time (future timestamps are clamped).

Rules evaluate on every ingest. A matching reading opens one alert per rule+device; further hits increment `count` and update `lastValue` until the alert is resolved.

`/store/<name>` writes to Mongo collection `store_<name>`, so software features (users' items, tasks, scam reports, incident tickets…) need no new backend code. Keys starting with `$`, containing `.`, or named `_id` are dropped; filters allow scalar equality only.

Responses use `id` instead of `_id`. Errors are `{"error": "..."}` with 400/401/404/405/413/503.

## Examples

```sh
B=http://127.0.0.1:8788/api; A="Authorization: Bearer $API_ADMIN_KEY"
curl -X POST $B/devices -H "$A" -H 'Content-Type: application/json' -d '{"name":"Fridge ESP32","type":"esp32"}'
curl -X POST $B/rules   -H "$A" -H 'Content-Type: application/json' -d '{"sensor":"temp_c","op":">","threshold":8,"severity":"critical"}'
curl -X POST $B/ingest  -H "X-Device-Key: $DEVICE_KEY" -H 'Content-Type: application/json' -d '{"readings":[{"sensor":"temp_c","value":9.1,"unit":"C"}]}'
curl "$B/alerts?status=open"
```

Clients: `clients/esp32/esp32_client.ino` (WiFi + reed switch + temp), `clients/python/hack_api.py` (Pi/laptop; `demo` mode streams synthetic anomalies).

## Running it

- `npm ci` then `npm test`: 9 end-to-end tests against an in-memory MongoDB.
- `npm run dev:local`: real Cloudflare runtime + throwaway MongoDB, no Docker or Atlas needed. Admin key `ak_local_dev_only`.
- Against Atlas: put `MONGODB_URI`, `MONGODB_DB`, `API_ADMIN_KEY`, `API_PUBLIC_READ` in `.dev.vars`, then `npm run dev`.
- `npm run keygen` prints a fresh admin key.

## Deploy checklist (Cloudflare Pages)

1. Atlas: create an app database user with `readWrite` on `utd_hackathon_26`. Cloudflare egress IPs are not fixed, so Network Access needs `0.0.0.0/0` (protected by the user's password). This is the usual pattern for serverless; rotate the password after the event.
2. Pages project → Settings → Variables and Secrets: `MONGODB_URI` (secret), `MONGODB_DB`, `API_ADMIN_KEY` (secret), `API_PUBLIC_READ`, optional `CORS_ORIGINS`.
3. Ensure the project has the `nodejs_compat` compatibility flag (from `wrangler.jsonc`).
4. Deploy, then `curl https://<project>.pages.dev/api/health` → `reachable: true`, then `POST /api/setup` once.

## Runtime notes

Each request opens and closes one MongoDB connection (Workers cannot reuse sockets across requests), so expect ~100–300 ms per call to Atlas from the edge. Batch readings (e.g. every 5 s) instead of one request per sample.
