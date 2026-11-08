# Demo day: readiness checklist and runbook

Written November 8, 2026 for the final demo on November 9. Everything below is labeled as verified, unverified or not claimed. Nothing here has been deployed from the `feat/ops-readiness` branch yet.

## 1. What is live and what is only in this branch

| Item | State |
|---|---|
| Production site `https://utd-hackathon-26.pages.dev` (main at last deploy) | Live. Does not include this branch. |
| Database speed-ups, caching headers, lazy hero frame | In branch. Measured on a local server against real Atlas. Not deployed. |
| Dev CLI (`npm run hb -- help`) | In branch. Works locally. |
| Uno Q agent and downloadable installer (`/downloads/unoq/`) | In branch. The installer URL only works after deploy. |
| Email templates and Resend sender | In branch. Off until the key is set on Pages. |
| NVIDIA grounding pack, thresholds doc, runbook doc, evals | In branch. Dry evals pass. Live model run not done. |

Deploy gate before pushing: `npm run hb -- deploy-check`.

## 2. Verified in this branch (integration run)

- Full test suite after the fix: 447 tests, 445 pass, 0 fail, 2 skipped. The first run had one real failure (new request tracing read the environment on demo requests); fixed.
- `npm run build`: exits 0 (one pre-existing dependency warning).
- `hb help`, `thresholds`, `docs`, `agent power-plan`, `email preview` (6 templates), `harness eval` (dry, 37 of 37) all run.
- Uno Q agent: 69 Python tests, package reproducible, tampered download refused, simulated run against a mock API.
- Three real Resend test emails went to sink addresses only.

## 3. Not verified (say so if asked)

- The Uno Q agent on a real Uno Q. No battery life has been measured; all power numbers are estimates.
- Reading box A over USB from the board, the App Lab bridge, the systemd sandbox settings, and the power profile script.
- A live NVIDIA model answer using the new grounding pack.
- Email appearance in Gmail and Outlook. Delivery to a real inbox.
- Database connection time on the live site after the changes. The roughly 400 ms to open a connection is unchanged.
- Messages cannot reach box A's screen. No firmware command exists for it.
- Power-cut persistence, outage and reconnect delivery, calibration on the ESP32 boxes (see work log, November 7 and 8).

## 4. Keys and settings (names only, never values)

| Name | Where | State |
|---|---|---|
| `MONGODB_URI`, `MONGODB_DB`, `SESSION_SECRET`, `API_ADMIN_KEY`, operator login values | `.env`, `.dev.vars`, Pages | Present locally and on Pages. |
| `CLOUDFLARE_*` tokens, `GITHUB_TOKEN`, `DATA_JOB_TOKEN` | `.env` | Present locally. |
| `RESEND_API_KEY` | Dev box env (outside the repo) | Not set on Pages. Email stays off until set. |
| `EMAIL_OPERATOR_TO`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_ENABLED`, `APP_ORIGIN` | Pages plain settings | Not set. Confirm the sender domain is verified in Resend first. |
| `NVIDIA_API_KEY`, `NVIDIA_BASE_URL` (or the Brev bindings) | Pages | Not in local `.env`. Check Pages bindings before the demo. |
| Uno Q device key | Board only (`/etc/homebeacon/unoq.env`, mode 600) | Not created. Register the hub device first. |

Setting any of these on Pages changes production configuration, so one person does it deliberately and records it in the work log.

## 5. Exact commands

```sh
npm run hb -- status                 # site ready, deployment, feeds, devices
npm run hb -- health                 # database and API latency
npm run hb -- feeds                  # which data sources are fresh
npm run hb -- thresholds             # every alert and power threshold
npm run hb -- docs search <word>     # find it in the docs
npm run hb -- bench                  # time the API and database
npm run hb -- devices list
npm run hb -- send-message <device> "text"
npm run hb -- simulate               # fake devices (live needs --yes)
npm run hb -- agent power-plan       # power plan for a 24 hour outage
npm run hb -- agent package          # rebuild the Uno Q download after edits
npm run hb -- email preview          # write the 6 email templates to look at
npm run hb -- harness eval           # dry check of the model grounding
npm run hb -- harness sync           # regenerate thresholds and runbook docs
npm run hb -- deploy-check           # gate before deploy
```

Full list and flags: [CLI.md](CLI.md).

## 6. Hardware test steps

### Uno Q agent (30 minutes, do first thing)

1. Register a separate device for the hub on your laptop (admin key, never on the board): `npm run hb -- devices register "Uno Q hub"`. The key is saved to a private file under `.secrets/`.
2. Deploy so the installer URL exists, or copy the tarball with `scp` and use `install.sh --file <tarball> --sha256 <hex>`.
3. On the board: run the installer, set `api.device_id` in `/etc/homebeacon/unoq.toml`, run `sudo homebeacon-unoq setup`, then `sudo systemctl start homebeacon-unoq`.
4. `homebeacon-unoq selftest`, then `homebeacon-unoq live`. Expect values, or an honest "unknown" if box A is not connected.
5. Send a message from the site with title `CMD` and body `poll 60`. Confirm the agent acknowledges it.
6. Pull wall power or Wi-Fi. Confirm it queues, then drains. Read [UNOQ_AGENT.md](UNOQ_AGENT.md) section 10 for known gaps.
7. Put a USB power meter in line and write the real watt figure into [POWER_DESIGN.md](POWER_DESIGN.md).

### ESP32 boxes A and B

Follow [firmware/TESTING.md](../firmware/TESTING.md). Minimum for the demo: both boxes powered, box A reports to the site, box B reaches box A, and the site shows both. Untested before the demo: power-outage sensing and sensor calibration, so do not claim them.

## 7. Two-minute demo script

1. (0:00) Problem: when the grid, Wi-Fi or a home goes quiet, nobody knows which homes need a check first.
2. (0:20) Open `/demo`. Pick the hurricane scenario. Say it is exercise data.
3. (0:45) Open one home. Show readings, the status and what the box last said. Point out that old critical readings never turn safe on their own.
4. (1:05) Show a box offline: status is "unknown", not "fine".
5. (1:20) Send an information box to a device. Show it arrive on the board or in the agent live view.
6. (1:40) Ask the assistant what to do. Show it cite thresholds and say a person decides.
7. (1:55) Close: what works today, what is next (batteries, real homes, review by responders).

## 8. Fallbacks

- Wi-Fi fails: use the phone hotspot. Boxes use the mesh and the Uno Q keeps a local view at its status endpoint. If the venue network blocks everything, show `/demo` from a saved screen recording.
- Data feeds stale: `npm run hb -- feeds`, then `npm run hb -- refresh`. If still stale, say the map shows last known data with its age. Do not hide staleness.
- Model fails or no key: `/demo` and all status logic work without it. Show `docs/RUNBOOK.md` and the dry eval instead, and say the model is advisory only.
- Database slow: the first request after a quiet period costs about 3 s extra. Open the site once before going on stage.
- Site down: `npm run hb -- status`, then roll back to the previous Pages deployment in Cloudflare (ask the deploy owner).

## 9. Who owns what

Roles are observed, not permanent (see [TEAM.md](TEAM.md)).

- Ayan: product, design, site, infrastructure, integration and deploys.
- Dhruv: core API, device clients, hardware and weather research, shared credential tools.
- Adyaan: organization and shared MongoDB setup.
- Saif: not verified in the repo. Ask.

Decide who runs the board demo, who speaks and who holds the backup recording before sleeping.

## 10. Known limits and non-claims

- We do not infer occupancy, safe entry, damage, insurance coverage or dispatch.
- Missing data is unknown. Old critical evidence stays critical until a person clears it.
- Model output is advice. People review it. Models never query or change data.
- The demo role is read-only exercise data, not real homes.
- Power figures are estimates. A 24 hour outage needs roughly a 40 to 60 Wh pack, not yet tested.
- The release download is checksum-checked, not signed.
- The grader for model answers is wording based and can miss unusual phrasings.
- There are four freshness clocks in the code; [THRESHOLDS.md](THRESHOLDS.md) lays them out side by side.

## 11. Order of work tomorrow

1. `npm test` and `npm run build` once more, then `npm run hb -- deploy-check`.
2. Deploy; open the site; run `hb status` and `hb bench`.
3. Set email settings on Pages if wanted; send one sink test with `hb email`.
4. Uno Q hardware test (section 6).
5. Rehearse the script twice, record a backup.
