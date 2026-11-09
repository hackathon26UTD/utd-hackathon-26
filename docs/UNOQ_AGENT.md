# Uno Q agent

A small Python 3 program for the Linux side of the Arduino Uno Q. It watches the sensor boxes, shows live values in a terminal, uploads to the HomeBeacon API, receives operator information boxes, runs a short list of safe control commands, decides for itself how long it can stay live on a battery, and looks after itself: it installs, updates, rolls back, describes its own environment, uploads that description, diagnoses problems and packs a masked support bundle.

Pattern from the owner's Argus streaming agent: a config file, CLI subcommands, a local status endpoint, reconnect with backoff and jitter, a versioned release with a checksum, an allowlist for remote commands, a boot-failure guard with rollback, an environment report, a doctor and a support bundle. Standard library only, so there is no `pip install` on the board and it works with no internet at install time (use `--file`).

**Status:** unit tested (see section 13), run end to end on a laptop against a mock API with a fake box link, a real packaged release installed by the updater into a temp folder, a bad release rolled back, and a doctor run against good and broken setups. **Not yet run on a real Uno Q.**

## 1. Install on the Uno Q

On the board's Linux side (Python 3.11 or newer, which Debian 12 has):

Recommended (pins both the installer and the release, so a compromised download host cannot hand you different code):

```sh
curl -fsSLO https://utd-hackathon-26.pages.dev/downloads/unoq/install.sh
sha256sum install.sh            # must equal installerSha256 in the manifest, which the team shares out of band
sudo sh install.sh --sha256 <tarball sha256 from the team chat>
```

Quick form (checksums come from the same host, so this only protects against a corrupted download, not a hostile one):

```sh
curl -fsSL https://utd-hackathon-26.pages.dev/downloads/unoq/install.sh | sudo sh
```

The installer downloads the release, checks its size and sha256 against the manifest, refuses unsafe archives, installs to `/opt/homebeacon-unoq/releases/<version>` (with `current` and `previous` links), creates a service user `homebeacon` (no login, serial access only), runs the agent self test, arms the boot guard on upgrades, and enables a systemd service. It does **not** start until the board has a device id and key.

Then:

1. Register the hub as its own device (admin key, on your laptop, never on the board). Use a separate device from the sensor boxes: `POST /api/devices` with `{"name":"Uno Q hub","type":"unoq"}`, then assign it a home (`PATCH /api/beacon/devices/:id/home`). See [clients/esp32/HOMEBEACON.md](../clients/esp32/HOMEBEACON.md).
2. On the board: `sudo nano /etc/homebeacon/unoq.toml` and set `api.device_id` (24 characters).
3. `sudo homebeacon-unoq setup` and paste the device key (hidden input, stored `root:homebeacon` mode 640 in `/etc/homebeacon/unoq.env`). Never type the key on a command line.
4. `sudo systemctl start homebeacon-unoq` then `homebeacon-unoq live`.

The installer accepts only an `https://` base (plain `http://` only for exactly `127.0.0.1` or `localhost`), never follows a redirect to `http://`, and reads the manifest without executing any of it.

Stricter installs: pin the checksum (`--sha256 <hex from the team chat>`) and/or verify a signature (`--pubkey key.pem`). Offline (no internet on the board): copy the tarball over with `scp`, then `sudo sh install.sh --file homebeacon-unoq-X.Y.Z.tar.gz --sha256 <hex>`.

Try it without hardware, on any computer with Python 3.11+:

```sh
npm run hb -- agent simulate          # fake box link against a mock API, prints PASS/FAIL checks
python3 agents/unoq/run_agent.py --state-dir /tmp/hbdemo run --fake --no-uplink   # then, in another shell: run_agent.py live
```

Re-running the installer is an upgrade (section 11). To remove the service: `sudo sh install.sh --uninstall`. It leaves `/opt/homebeacon-unoq`, `/etc/homebeacon` and `/var/lib/homebeacon-unoq` alone, so delete those by hand if you want a clean slate.

After the first start run `sudo homebeacon-unoq doctor` (section 12). It should end with `HEALTHY`.

## 2. What it does

```
Box B --ESP-NOW--> Box A --USB serial "HB {json}"--> agent --HTTPS, X-Device-Key--> API --> command center
                                                       |  \-- 127.0.0.1:8765 read-only status, `live`
                                                       |  \-- control socket for `say` and `cmd` (owner only)
                                                       \-- SQLite: offline queue, message cursor
                                                       \-- self-update, boot guard, environment report, doctor
```

- **Monitor.** Reads `HB {json}` lines from box A over USB, the same lines `firmware/hub/hub.py` stores. Keeps the latest value and age per box, 300 recent messages in memory, and the hub's own gauges (CPU temperature, load, memory). Stale boxes show as "unknown, not safe", never as fine.
- **Uplink.** Uses only the hub's own `X-Device-Key`. Sends batched readings (`POST /api/ingest`), beacon telemetry with unique event ids (`POST /api/beacon/ingest`) and events (`POST /api/events`). Failed sends stay in a bounded queue and replay in order; the same payload is retried with the same event id, so a replay is a duplicate, not a double count.
- **Messages.** Polls `GET /api/device/messages`, prints them, reports `shown`. A message that needs acknowledging stays open until a person runs `homebeacon-unoq ack` (a button press equivalent). Commands (below) are acknowledged by the agent after they run.
- **Settings.** Applies the operator's message-check interval from `GET /api/device/settings` and reports the applied revision with `POST`.
- **Look after itself.** Checks for new releases (section 11), keeps a boot guard that rolls a bad update back, reports its environment (section 9), keeps uploading through a bad network (section 10) and can diagnose itself (section 12).
- **Power.** Decides its own mode and intervals from battery, wall power and hazards. See [POWER_DESIGN.md](POWER_DESIGN.md).

What goes to the cloud as readings: `power_mode` (`normal`, `saver` or `critical`, the words the server knows), `agent_mode`, `runway_h` (hours left; with no gauge it counts down from the entered starting charge using assumed loads, labelled `integrated_estimate` in the status view), `soc_pct` (only if a real gauge exists), `load_mw_est`, `cpu_temp_c`, `queue_depth`, `hazard_active` (1 while a hazard is latched, 0 only when a box was heard in the last two minutes and none is latched, and left out when the hub has no data, because unknown is not "no hazard"). Beacon telemetry carries `main_power_available` only when a box or gauge actually reported it, and `battery_pct` only from a gauge. A mains value that was merely assumed in the config is never uploaded.

## 3. Commands for people

`homebeacon-unoq <command>` (or `python3 agents/unoq/run_agent.py <command>`):

| Command | What it does |
| --- | --- |
| `run` | Run the agent (the service does this). `--fake` uses a fake box link; `--no-uplink` stays local; `--no-lifecycle` turns off self-update, boot guard and environment report |
| `live` | Terminal live view; refreshes every 2 s from the local status endpoint |
| `status [--json]` | Print current status once, plus the uplink guard line (works from the saved file when the agent is down) |
| `doctor [--json] [--offline]` | Check everything that can stop data reaching the cloud. PASS/WARN/FAIL/SKIP, a plain cause and the exact fix. Exit 0 healthy, 1 look at it, 2 broken |
| `support-bundle` | Write a masked `.tar.gz` for a human to read. Never uploaded |
| `logs [-n N] [-f]` | Log tail with secrets masked |
| `env [--json]` | What the hub knows about itself |
| `update check\|apply\|rollback\|status` | Check for, install, undo and show updates (section 11) |
| `check-update [--download]` | Older manual flow: look for a release, optionally stage it. Never installs |
| `say <text>` | Show a note on the hub (bench use, local only) |
| `cmd <command...>` | Run an allowlisted control command locally. No arguments lists them |
| `ack [id]` | Acknowledge the latest message that asked for it |
| `power-plan --mah N --volts V ...` | Print a runtime plan for a battery without running anything |
| `setup` | Store the device key (hidden input) |
| `config-example`, `selftest`, `version` | Utilities |

From the repo (Node): `npm run hb -- agent package | verify | simulate | power-plan | test`.

## 4. Control commands (allowlist)

An operator sends an information box (`POST /api/ops/messages`) with `kind: "instruction"`, title `CMD` and the command in the body (80 plain characters, no links, as for any box message):

```json
{"kind":"instruction","severity":"info","title":"CMD","body":"mode eco 60",
 "requiresAck":true,"expiresInMin":30,"scope":{"type":"device","deviceIds":["<hub device id>"]}}
```

| Command | Effect |
| --- | --- |
| `poll <10-300>` | Message check interval in seconds, for one hour. Typed setting alternative: `PATCH /api/ops/device-settings` |
| `mode <auto\|full\|eco\|survival\|beacon> [minutes]` | Hold a power mode up to 240 minutes. `auto` releases. Refused if the battery cannot run a higher mode for an hour |
| `identify [seconds 1-30]` | Marks the live view, rings the terminal bell, and sends `mcu.identify_line` (for example `beep`) to box A if you configured one |
| `mute <on\|off>` | Quiet the terminal notices (the inbox and log still record everything) |
| `status` | Queue a status report now |
| `resync` | Re-read messages and settings and flush the queue |
| `reboot-agent` | Exit with code 75 so systemd restarts the agent. **Off** unless `commands.allow_reboot_agent = true` |

Anything else is refused with a plain sentence, reported to the cloud as `agent.cmd_refused`, and never executed. Nothing is ever passed to a shell: commands are parsed into a fixed set of typed actions. A command is run once even if the message is redelivered (processed ids are kept). Set `commands.allow = false` to ignore all remote commands. Power control from the cloud cannot stop box sensing, alarms, logging or the help button, because the hub does not own them.

Locally on the bench, `homebeacon-unoq cmd poll 60` uses the same parser through an owner-only socket.

## 5. Safety rules the agent keeps

- Missing data is unknown. A box not heard from for 120 s is "unknown, not safe". A stale battery file is ignored, not trusted.
- A hazard seen earlier does not turn safe because time passed. It clears only after a newer reading shows the field false and a 10 minute hold.
- No inference of occupancy, safe entry, damage or dispatch. The live view says a clear panel is "not a safety guarantee".
- Messages are advisory text. The agent does not act on message text except through the allowlist above.
- Credentials stay separate: only the hub's device key is used; no operator session, customer session or provider token is ever read or sent. The key never appears in config, logs, the status endpoint or this package.
- Demo/exercise devices cannot use `/api/device/settings` (the server refuses them); the agent logs the refusal and carries on.

## 6. Configuration

`/etc/homebeacon/unoq.toml` (print a commented example with `homebeacon-unoq config-example`). Unknown keys are rejected so a typo does not silently do nothing. Highlights:

| Key | Meaning |
| --- | --- |
| `api.base_url` | Must be `https://`; `http://` only for 127.0.0.1 or localhost |
| `api.device_id` | The registered 24 character id, not a board serial |
| `mcu.source` | `serial` (box A over USB), `bridge` (Arduino App Lab, unverified), `fake`, `none` |
| `status.port` | Read-only endpoint on 127.0.0.1 only (default 8765, 0 = off) |
| `uplink.relay_water_from` | Box id whose water flag is gap-filled under the hub device (off by default) |
| `power.battery_mah`, `nominal_v`, `chemistry`, `converter` | Describes the pack. 0 means unknown, so no runway claims. `buck` and `ldo` need a pack of 5.5 V or more; a single 3.7 V cell needs `boost` (anything else is refused) |
| `power.need_hours` | Outage length to plan for (default 24) |
| `power.assume_mains` | Set `present` if the hub is on a wall supply and no box reports mains |
| `power.measured_mw` | USB meter averages per mode. All four modes switch the basis to measured; fewer is `partial_measurement`. `load_basis = "bench_measurement"` without all four is a config error |

Limits that keep it light: queue 2000 rows or 2 MB, log 3 files of 256 KB, ring buffer 300 messages, at most 6 requests per wake, 10 s network timeout, `Nice=10`, `CPUQuota=25%`, `MemoryMax=96M` and a hardened systemd unit.

## 7. Status endpoint

`GET http://127.0.0.1:8765/status` (also `/readings`, `/healthz`). Loopback only, GET only, Host header checked, no key or secret in any field. Use `homebeacon-unoq live` instead of curl for people.

## 8. Building a release

`npm run hb -- agent package` builds `public/downloads/unoq/`: `homebeacon-unoq-X.Y.Z.tar.gz`, its `.sha256`, `manifest.json` and `install.sh`. The tarball is reproducible (same bytes for the same sources) and about 40 KB. `npm run hb -- agent verify` recomputes everything, unpacks the tarball into a temp folder and runs the agent self test. Run `package` again after any change under `agents/unoq/` or to this file, then commit the output.

`homebeacon-unoq check-update` (the older manual flow; `update check` is the new one) reads the manifest and says whether a newer release exists. `--download` fetches the tarball over https, verifies size and sha256 and stages it under the state folder. It prints the install command. `check-update` itself installs nothing; the self-update in section 11 is separate and on by default (`auto_apply = false` in `update.toml` turns the install off).

Signing is optional. With `UNOQ_SIGNING_KEY=/path/to/ed25519.pem` the packager writes an Ed25519 signature; `install.sh --pubkey` verifies it with openssl 3. A signing key is a credential: create it outside the repo, keep it mode 600 and add its row to `~/.claude/CREDENTIALS.md`. No signing key was created for this release, so it is checksum-only.

## 9. Environment and health

The hub can describe itself (`hbagent/envreport.py`): agent version and build, Python, OS and kernel, board model, CPU, memory, disk (state folder and root), temperature, clock and time sync, network interfaces and local addresses, default route, DNS, Wi-Fi signal, API reachability (DNS, TLS, `/api/ready` latency and clock skew), USB devices, serial ports (and whether the agent user may open them), box link and last message age, queue depth and oldest age, power mode and runway, and service state with restart count.

- **Unknown stays unknown.** Each reading is `{value, source, ok}`. Anything missing or unreadable is `unknown` (null in the upload). Runway is never guessed. Throttling and under-voltage use `vcgencmd`, which the Q is assumed not to have, so they show unknown.
- **Privacy.** Host name and Wi-Fi network name go out only as salted hashes. Set `env_send_ssid` to also send the network name (config key not exposed in the toml yet). No passwords, no device key, no public IP. All text passes through a mask for URL credentials, `X-Device-Key`, Bearer tokens, password and token assignments, and long hex or base64 tokens.
- **Light.** Each reading has a time limit and cannot raise. The API check is cached for 15 minutes and sends no key (it only calls the public `/api/ready`). A full snapshot is cached for 60 seconds. The collection runs in a worker thread, never in the sensor loop.
- **Upload.** One `agent.environment` event, under 4 KB, sent at boot (not more than every 5 minutes), when something important changes (disk low, clock drift, Wi-Fi network or address, API reachable or not, serial or box link, service restarts; at most every 15 minutes), and at least every 6 hours.
- **Local view.** `status.env` on the 127.0.0.1 status endpoint, three lines in `homebeacon-unoq live`, and `homebeacon-unoq env [--json]` for a full printout.

## 10. Uploading data

How the hub gets data to the cloud without wasting battery or hammering a broken link:

- **Batched.** Readings go up to 50 at a time, at most 6 requests per wake, and only when the power mode says it is time. Between wakes nothing is open: the one HTTPS connection is reused inside a burst (one TLS handshake per burst) and dropped after 15 seconds idle.
- **Queued and ordered.** Anything unsent waits in a bounded local queue (2000 rows or 2 MB, oldest low-priority rows dropped first, critical rows last) and is replayed oldest first. Beacons and events keep one id for life, so a resend is a duplicate and not a double count. Event rows also get a stored id when queued. The agent sends it as an `Idempotency-Key` header with every event. The server does not use that header yet, so a retry after a lost reply can still double an event on the cloud side.
- **Circuit breaker.** After 5 failed calls in a row (no answer, 5xx, 429) the agent stops calling for a capped, jittered rest (20 s growing to 5 minutes), then sends one probe. While a critical row (water, smoke) is queued it still tries every 15 seconds.
- **Rejected key.** On 401 or 403 the agent stops uploading, keeps the data, shows `device key rejected: re-run setup` in `status` and `doctor`, and tries one request every 15 minutes in case the key was fixed. One event (`agent.key_rejected`) is queued per day, and `agent.uplink_recovered` follows when it works again.
- **Stall self-heal.** If rows have waited 10 minutes and the server never answers, but a TCP connect to it works, the agent rebuilds its HTTP connection (at most every 30 minutes) and records the attempt (`agent.uplink_selfheal`). If the TCP connect fails the network is down, so it only notes that and waits.
- **Where to look.** `<state_dir>/uplink_health.json` (mode 600, no secrets) mirrors the guard for `doctor` and `status` even when the agent is stopped.

## 11. Install, update and rollback

**Layout.** `/opt/homebeacon-unoq/releases/<version>/` holds one folder per release. `current` and `previous` are symlinks, and the service runs `current/run_agent.py`. The last 2 releases are kept. The folder belongs to the service user so the agent can update itself (it runs as that user anyway). The boot guard script is copied to `/usr/local/libexec/homebeacon-unoq/bootguard.py` (root-owned, outside the install folder and every release), so a broken release cannot disable it and a compromised agent cannot change it. The install script writes that copy; a self-update does not replace it (it is small and kept stable on purpose), so it only changes when someone re-runs `install.sh`.

**Who runs what.** The install folder belongs to the service user, so anything in it can be rewritten by a compromised agent. Root therefore never runs code from it. `install.sh` takes root-owned copies of the boot guard, the key setup script, the unit file and the example config from the verified tarball before handing the tree over, and arms the boot guard as the service user. The `homebeacon-unoq` command is a root-owned wrapper: `sudo homebeacon-unoq setup` runs the root-owned setup script (the only part that needs root, because it writes the key file), and every other command (`doctor`, `update ...`, `support-bundle`, `env`, `live`) drops to the `homebeacon` user first, so files it writes keep the right owner. The key file is `root:homebeacon` mode 640: systemd reads it as root, and the CLI reads it as the service user. Lock and state files written by root are given the state folder's owner, and a lock that cannot be opened reads as "another update is running" instead of an error. `logs` as the service user reads the log file if one is set; for the systemd journal use `sudo journalctl -u homebeacon-unoq`. After `update apply` or `update rollback`, restart with `sudo systemctl restart homebeacon-unoq` (the CLI no longer restarts the service itself unless it is run as root).

**Install and upgrade.** `install.sh` is re-runnable. Same version is a no-op (`--force` reinstalls). An older version is refused unless `--allow-downgrade`. The new release must pass its own self test before it becomes `current`; if it fails, nothing changes. On an upgrade the old release becomes `previous` and the boot guard is armed before the switch. `--channel beta` reads `manifest-beta.json`. `--pubkey key.pem` is kept as `/etc/homebeacon/update-pubkey.pem` so later self-updates are verified too.

**Self-update (agent).** The agent checks about every 6 hours (first check 2 to 10 minutes after start, 20 percent jitter, 15 minute floor). Settings live in `/etc/homebeacon/update.toml` (`channel`, `check_interval_s`, `auto_apply`, `pubkey`, `require_signature`). Environment overrides: `HB_UPDATE_CHANNEL`, `HB_UPDATE_INTERVAL_S`, `HB_UPDATE_PUBKEY`, `HB_UPDATE_CONF`, and `HB_PREFIX` / `HB_BASE` for tests or a non-default install folder. Each step can stop the update:

1. Manifest over https (`/downloads/unoq/manifest.json`) must be newer, in the right channel, and not a version that was rolled back before.
2. Not during an active hazard, unless the manifest says `"critical": true`. It retries after 15 minutes.
3. Streamed download with a 2 MB cap, a free disk check, and a sha256 match.
4. If a public key is configured: Ed25519 signature checked with the `openssl` program, and an unsigned release is refused. With no key it is checksum only, and status says so ("unsigned").
5. Safe unpack (no links, no odd paths, size and file count caps), then the new release's own self test.
6. Previous pointer, armed guard, atomic `current` swap, a `started` event, and the agent exits 75 so systemd starts the new release.

Only one update runs at a time (`update.lock`, shared with `install.sh`). An update never downgrades. Another update waits until the last one is confirmed. Updates are not held back for low battery.

**Boot guard and rollback.** A start counts as failed when the previous start of that version never became healthy and did not stop cleanly. Healthy means the cloud accepted a request, or (after 3 minutes with no uplink) the local self test passed AND an independent probe of the cloud API (DNS, TLS, `/api/ready`) shows the cloud cannot be reached from this hub anyway (Wi-Fi down, no DNS, API answering 5xx). If the network is up but the new release never got an upload through, the update stays pending and is rolled back at the deadline. A rejected device key counts as reached, and a hub with no cloud link configured accepts the self test alone. A failing or missing probe never confirms an update. An unconfirmed update is rolled back after 3 failed starts, or if it is not healthy 10 minutes after starting. Rollback restores `previous`, records the reason, remembers the bad version so it is not installed again, and queues a `rolled_back` event. Releases that were healthy are never rolled back automatically. Manual rollback: `sudo homebeacon-unoq update rollback`, then `sudo systemctl restart homebeacon-unoq`.

**Events.** Outcomes (`started`, `succeeded`, `rolled_back`, `failed`, `deferred`) go to a small file queue (`update_events.json`, 20 entries) and are handed to the normal uplink as `agent.update` events with the versions and a short masked reason. No keys or URLs with credentials are ever included.

**How it is wired.** `hbagent/lifecycle.py` hooks the agent loop without editing it. It records the start, runs the health check about every 30 s, the environment report about every 60 s and the update check about every 60 s (the check itself decides if one is due). All three run in their own worker threads so the sensor loop never waits. A result with `restart_required`, or a health check that rolled back, makes the agent exit with code 75 and systemd starts whichever release is `current`. It switches itself off when the folder was not made by `install.sh` (for example a source checkout), so running from git never touches an install.

**What is not proven.** The signature path was tested with a local openssl key only; no signing key exists yet, so real releases are checksum only. A checksum from the same site as the file does not stop a compromised site. The rollback and install paths were tested with real packaged releases in a temp folder on a laptop, not on a real Uno Q under systemd.

Publishing a release: bump `agents/unoq/VERSION`, run `npm run hb -- agent package` then `npm run hb -- agent verify`, commit `public/downloads/unoq/`, deploy. Hubs pick it up on their next check.

## 12. Troubleshooting

Start with `homebeacon-unoq doctor` (use `sudo` so it can read the key file). It prints one line per check, PASS, WARN, FAIL or SKIP, a plain cause, and the exact command to fix it. Exit code 0 means healthy, 1 means something needs a look, 2 means something is broken. `--json` gives the same for scripts, `--offline` skips the network checks.

```
FAIL key_accepted        The cloud said no: the key was rejected, or this device is not registered under that key.
                         fix: sudo homebeacon-unoq setup (paste the key shown at registration), check device_id, then sudo systemctl restart homebeacon-unoq
```

Checks, in order: config file, key file permissions (owner only, or `root:homebeacon` mode 640; never printed), device id shape, service enabled and running, serial port present and openable by the `homebeacon` user, disk space, clock sync, DNS, TLS to the API host, `/api/ready`, clock skew against the server, key accepted (an authenticated `GET /api/device/settings`), cloud visibility, queue depth and oldest age, last uplink success, box A link age, update status, recent crash restarts. The Command Center's own last-seen time cannot be read with the hub key, so `cloud_visible` reports what the hub last had accepted and says so.

Other tools:

| Command | What it does |
| --- | --- |
| `support-bundle` | Writes a masked `.tar.gz` under `<state_dir>/support/` (mode 600, 400 KB cap, newest 5 kept): doctor report, config without secrets, environment, versions, queue counts and ages (never payloads), uplink health, update status, last 300 log lines. It is **never uploaded**: copy it off yourself. Fails closed if the key would appear in it |
| `logs [-n N] [-f]` | Log tail (log file or systemd journal) with keys, tokens, bearer headers and URL passwords masked |
| `env [--json]` | What the hub knows about itself: OS, disk, memory, Wi-Fi, time sync, serial devices |
| `update check\|apply\|rollback\|status` | Update tooling (section 11) |
| `status` | Live status plus the uplink guard line (works from the file when the agent is down) |

| Symptom | Likely cause |
| --- | --- |
| Live view says box link not connected | Box A not plugged in, wrong group (`homebeacon` needs `dialout`), or another program (the old `hub.py`) holds the port. `doctor` names which |
| `device key rejected: re-run setup` | Key typed wrong, device disabled or not registered. Run `sudo homebeacon-unoq setup`, then restart the service. Queued data is kept and uploads resume by themselves |
| `beacon telemetry refused (409)` | Usually the device has no home (assign one; new routine beacons pause for an hour). Other 409s mean the server is still processing the same event. Refused beacons are kept and resent with the same event id, never dropped |
| Queue keeps growing | `doctor` shows `dns`, `tls` or `key_accepted` failing. A wrong clock (no battery clock on this board) also breaks TLS: `sudo timedatectl set-ntp true` |
| Runs in beacon mode on a good battery | `need_hours` is longer than the pack allows, or wall power is unknown (set `assume_mains`). The live view lists the reasons |
| Nothing after install | The service waits for `device_id` and the key; see the printed steps, then run `doctor` |

## 13. Verified, and what needs a real Uno Q

**Verified on a laptop (macOS and Linux CI, Python 3.12):**

- 209 Python tests (`python3 -m pytest agents/unoq/tests`) and the Node tests `test/unoq-package.test.js` and `test/ops-review.test.js`.
- A real packaged release installed by the updater into a temp folder from a local web server, then its own self test.
- Update to a newer release, same or older release refused, tampered download refused, a release that crashes on start rolled back and not offered again, a release that runs but never gets healthy rolled back after the deadline, manual rollback.
- The agent loop confirms a pending update when the (mock) hub accepts data, asks for a restart after an automatic rollback, and does nothing risky when not installed by the installer.
- Rejected key (401), network outage with ordered replay, circuit breaker and self-heal (unit tests with a local server).
- Doctor against a working mock hub, against a rejected key and against a broken config (each failure has a fix). A support bundle scanned for the key, bearer tokens and URL passwords.
- `npm run hb -- agent simulate` for the `mixed`, `flood`, `outage` and `quiet` scenarios.

**Needs a real Uno Q:**

- Serial reading from box A on the Uno Q, and `stty` behaviour on its Debian image.
- The Arduino App Lab Bridge adapter (`mcu.source = "bridge"`). It is written to the documented Python API but has never run on a board, and the matching MCU sketch does not exist.
- The systemd unit's sandbox settings (including writing to `/opt/homebeacon-unoq` and the boot guard step) and the installer run as root on the board's actual image. The installer is syntax checked and its logic tested, not run as root on a Uno Q.
- Real output of `ip`, `iw`, `nmcli`, `timedatectl` and `systemctl show`, `/proc/net/wireless`, thermal files and whether `vcgencmd` exists (envreport and doctor assume the common formats and show unknown otherwise).
- Whether `/api/events` accepts the `agent.environment`, `agent.update`, `agent.key_rejected` and `agent.uplink_*` shapes (the mock accepts anything).
- All power figures (section 7 of [POWER_DESIGN.md](POWER_DESIGN.md)), the Uno Q's real idle draw, and any battery gauge.
- Real Wi-Fi loss and reconnection on the board.
- Displaying messages on the box OLED: no firmware command exists, so messages show in the terminal and live view only.

**Known limits:**

- Without a configured public key, updates are checksum only. No signing key exists yet.
- Update events are not held back for low battery, and the Command Center's last-seen time cannot be read with the hub key.
- One queued row that the server keeps answering with a 5xx still blocks the head of the queue. There is no expiry yet.
- The older 0.1.0 tarball has no updater, so an old hub needs one `install.sh` run to join this scheme.

## 14. Files

| Path | Purpose |
| --- | --- |
| `agents/unoq/hbagent/` | The agent: `agent.py` loop, `power.py` manager, `protocol.py`, `commands.py`, `uplink.py`, `store.py`, `mcu.py`, `servers.py`, `live.py`, `config.py`, `system.py`, `cli.py`; self-care: `updater.py`, `bootguard.py`, `lifecycle.py`, `envreport.py`, `doctor.py`, `support.py`, `watchdog.py` |
| `agents/unoq/packaging/` | `install.sh`, systemd unit, `apply-power-profile.sh`, example config |
| `agents/unoq/tests/` | Unit and end-to-end tests (`python3 -m pytest agents/unoq/tests`); `mockhub.py` is the local stand-in for the API and download site |
| `scripts/package-unoq.mjs`, `scripts/commands/agent.mjs` | Packager and the `hb agent` command |
| `test/unoq-package.test.js` | Packaging, verification, installer and simulation tests |
| `public/downloads/unoq/` | Published release |
