# HomeBeacon developer CLI

One command for day-to-day operations: `npm run hb -- <command> [args] [flags]`. Node built-ins only. Code: `scripts/hb.mjs` (dispatcher), `scripts/commands/*.mjs` (one file per command), `scripts/lib/hb-*.mjs` (helpers). Tests: `node --test test/hb-cli.test.js`.

## Global flags

| Flag | Meaning |
| --- | --- |
| `--site <url>` | Target site. Default `https://utd-hackathon-26.pages.dev` (or `HB_SITE`). |
| `--local` | Use `http://127.0.0.1:8788` (`npm run dev:local`). Uses `HB_LOCAL_ADMIN_KEY`, default `ak_local_dev_only`. |
| `--json` | Machine output on stdout. Progress text goes to stderr. |
| `--no-color`, `NO_COLOR` | Plain text. Color is also off when output is not a terminal (`FORCE_COLOR=1` forces it). |
| `--verbose`, `--quiet`, `--help` | Stack traces, less chatter, per-command usage. |

Exit codes: `0` ok, `1` failed, `2` usage error, `3` network or server error, `4` missing or rejected credential.

## Credentials

Keys come from the environment by name (`scripts/env.mjs` reads real env, then `.env`, then `.dev.vars`). `API_ADMIN_KEY` authorizes operator calls. `DATA_JOB_TOKEN` authorizes only `refresh`. Every printed line and JSON value passes through a redactor that masks known secret values and key shapes (bearer tokens, `ak_`/`dk_` keys, database URIs, `nvapi-`/`re_` keys). Credentials are never sent over plain http to a non-local host. `devices register` saves the one-time device key to a mode 600 file under `.secrets/` (git-ignored) and does not print it.

## Commands

Run `npm run hb -- help` for the live list. It shows every file in `scripts/commands/`, including `bench`, `agent`, `email` and `harness` when present, and lists any command file that fails to load instead of crashing.

| Command | What it does |
| --- | --- |
| `status` | Site readiness, latest deployment (via `scripts/site.mjs`), feed freshness, device online and offline counts. `--no-deployment` skips the Cloudflare lookup. |
| `health [--samples 3]` | Pings `/api/ready` and `/api/health`, reports min, median and max latency. Flags a median over 1500 ms. |
| `devices [list] [--exercise]` | Registered devices with online state, last seen and risk tier. |
| `devices show <id>` | Latest value per sensor with age, plus risk. No readings means unknown, not safe. |
| `devices register <name> [--type esp32] [--key-file path] [--dry-run]` | Creates a device. Key goes to a private file. |
| `send-message <deviceId> <text> [--title] [--severity info\|advisory\|urgent] [--ttl 6h] [--ack] [--dry-run]` | Queues a text box for the device (title up to 20 characters, text up to 80, plain characters, no links). Delivered is not acknowledged. |
| `simulate [device]` | Wraps `scripts/simulate-device.mjs` (fake devices over HTTP). Needs `--yes` for a non-local site. Options: `--scenario`, `--devices`, `--once`, `--ticks`. |
| `simulate scenario` / `simulate demo` | Wraps `scripts/simulations.mjs` (offline frames, `--schema`, `--minute`) and `scripts/system-demo.mjs` (in-memory exercise, `--nvidia` opt-in). |
| `feeds [sourceId] [--stale]` | Every data source with state (fresh, stale, needs_key, never), last success age and cadence. Fresh means within 2x cadence. |
| `refresh [sourceId] [--limit 1-5] [--admin]` | Calls `POST /api/ops/data-refresh` with the job token header (`--admin` uses the operator key). The server refreshes whichever sources are due; a single source cannot be forced. |
| `thresholds [filter]` | All alert, risk, power, link, messaging and firmware thresholds. See below. |
| `docs [list]`, `docs search <term>`, `docs path <name>` | Doc index with one-line descriptions, line search, absolute paths. |
| `deploy-check [--skip-tests] [--skip-build] [--offline]` | Gate before deploy: git state, syntax of every JS file, tests, build, production `/api/ready`, and deployed commit equals `origin/main` (read with `git ls-remote`). Exit 1 if any check fails. Missing Cloudflare access shows SKIP, not PASS. |
| `completion zsh\|bash` | Shell completion. `eval "$(npm run --silent hb -- completion zsh)"`. |
| `help [command]` | Grouped command list. |

### Thresholds: single source of truth

`thresholds` imports the real modules and does not keep a copy of any number. Sensor rules in `src/risk/config.js` are read by probing each rule's own test function across the sensor's range, so a changed rule changes the output. It also shows `domain/system-policy.js` (freshness window, power profiles, the critical temperature and sound limits found by probing `devicePolicy`), `src/live.js` and `src/messages.js` limits, firmware `#define` values from `firmware/*/config.h` and any `*policy*.h`, and any new `domain/*.js` module with upper-case constants. Add a new threshold file there and it appears automatically. Example: `npm run hb -- thresholds co_ppm`.

## Writing a new command

Add `scripts/commands/<name>.mjs`:

```js
export default {
  name: 'mything', summary: 'One line for help', usage: 'hb mything [--flag]',
  booleans: ['flag'],            // optional: flags that never take a value
  group: 'Hardware and agent',   // optional: help section
  async run(args, ctx) { ctx.emit({ ok: true }, () => ctx.out('done')); return 0; },
};
```

`ctx` has `env`, `repoRoot`, `flags`, `log(msg)`, `json(obj)`, plus `out`, `error`, `emit(data, textRenderer)`, `api(path, opts)` and `api.ok(...)` (throws a friendly error), `c` (colors), `site`, `redact`. Throw `HbError` from `scripts/lib/hb-errors.mjs` for a clean message and exit code. Files starting with `_` are ignored.

## Limits

- `refresh` cannot force one source; the server picks due ones.
- `status` and `deploy-check` read the deployment through `scripts/site.mjs`, so they need Cloudflare and MongoDB access in `.env`; without it they report unavailable.
- The CLI reads and queues data only through existing endpoints. It does not dispatch, infer occupancy or safe entry, or change thresholds.

See also: [TOMORROW.md](TOMORROW.md) (demo day runbook), [PERFORMANCE.md](PERFORMANCE.md), [UNOQ_AGENT.md](UNOQ_AGENT.md), [EMAIL.md](EMAIL.md), [HARNESS.md](HARNESS.md).
