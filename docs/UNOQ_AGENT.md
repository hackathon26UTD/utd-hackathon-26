# Uno Q agent

A small Python 3 program for the Linux side of the Arduino Uno Q. It watches the sensor boxes, shows live values in a terminal, uploads to the HomeBeacon API, receives operator information boxes, runs a short list of safe control commands, and decides for itself how long it can stay live on a battery.

Pattern from the owner's Argus streaming agent: a config file, CLI subcommands, a local status endpoint, reconnect with backoff and jitter, a versioned release with a checksum, and an allowlist for remote commands. Standard library only, so there is no `pip install` on the board.

**Status:** unit tested and run end to end against a mock API with a fake box link. **Not yet run on a real Uno Q** (see section 10).

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

The installer downloads the release, checks its size and sha256 against the manifest, refuses unsafe archives, installs to `/opt/homebeacon-unoq`, creates a service user `homebeacon` (no login, serial access only), runs the agent self test, and enables a systemd service. It does **not** start until the board has a device id and key.

Then:

1. Register the hub as its own device (admin key, on your laptop, never on the board). Use a separate device from the sensor boxes: `POST /api/devices` with `{"name":"Uno Q hub","type":"unoq"}`, then assign it a home (`PATCH /api/beacon/devices/:id/home`). See [clients/esp32/HOMEBEACON.md](../clients/esp32/HOMEBEACON.md).
2. On the board: `sudo nano /etc/homebeacon/unoq.toml` and set `api.device_id` (24 characters).
3. `sudo homebeacon-unoq setup` and paste the device key (hidden input, stored mode 600 in `/etc/homebeacon/unoq.env`). Never type the key on a command line.
4. `sudo systemctl start homebeacon-unoq` then `homebeacon-unoq live`.

The installer accepts only an `https://` base (plain `http://` only for exactly `127.0.0.1` or `localhost`), never follows a redirect to `http://`, and reads the manifest without executing any of it.

Stricter installs: pin the checksum (`--sha256 <hex from the team chat>`) and/or verify a signature (`--pubkey key.pem`). Offline: `sudo sh install.sh --file homebeacon-unoq-X.tar.gz --sha256 <hex>`. Remove: `sudo sh install.sh --uninstall` (keeps config and state).

Try it without hardware, on any computer with Python 3.11+:

```sh
npm run hb -- agent simulate          # fake box link against a mock API, prints PASS/FAIL checks
python3 agents/unoq/run_agent.py --state-dir /tmp/hbdemo run --fake --no-uplink   # then, in another shell: run_agent.py live
```

## 2. What it does

```
Box B --ESP-NOW--> Box A --USB serial "HB {json}"--> agent --HTTPS, X-Device-Key--> API --> command center
                                                       |  \-- 127.0.0.1:8765 read-only status, `live`
                                                       |  \-- control socket for `say` and `cmd` (owner only)
                                                       \-- SQLite: offline queue, message cursor
```

- **Monitor.** Reads `HB {json}` lines from box A over USB, the same lines `firmware/hub/hub.py` stores. Keeps the latest value and age per box, 300 recent messages in memory, and the hub's own gauges (CPU temperature, load, memory). Stale boxes show as "unknown, not safe", never as fine.
- **Uplink.** Uses only the hub's own `X-Device-Key`. Sends batched readings (`POST /api/ingest`), beacon telemetry with unique event ids (`POST /api/beacon/ingest`) and events (`POST /api/events`). Failed sends stay in a bounded queue and replay in order; the same payload is retried with the same event id, so a replay is a duplicate, not a double count.
- **Messages.** Polls `GET /api/device/messages`, prints them, reports `shown`. A message that needs acknowledging stays open until a person runs `homebeacon-unoq ack` (a button press equivalent). Commands (below) are acknowledged by the agent after they run.
- **Settings.** Applies the operator's message-check interval from `GET /api/device/settings` and reports the applied revision with `POST`.
- **Power.** Decides its own mode and intervals from battery, wall power and hazards. See [POWER_DESIGN.md](POWER_DESIGN.md).

What goes to the cloud as readings: `power_mode` (`normal`, `saver` or `critical`, the words the server knows), `agent_mode`, `runway_h` (hours left; with no gauge it counts down from the entered starting charge using assumed loads, labelled `integrated_estimate` in the status view), `soc_pct` (only if a real gauge exists), `load_mw_est`, `cpu_temp_c`, `queue_depth`, `hazard_active` (1 while a hazard is latched, 0 only when a box was heard in the last two minutes and none is latched, and left out when the hub has no data, because unknown is not "no hazard"). Beacon telemetry carries `main_power_available` only when a box or gauge actually reported it, and `battery_pct` only from a gauge. A mains value that was merely assumed in the config is never uploaded.

## 3. Commands for people

`homebeacon-unoq <command>` (or `python3 agents/unoq/run_agent.py <command>`):

| Command | What it does |
| --- | --- |
| `run` | Run the agent (the service does this). `--fake` uses a fake box link; `--no-uplink` stays local |
| `live` | Terminal live view; refreshes every 2 s from the local status endpoint |
| `status [--json]` | Print current status once |
| `say <text>` | Show a note on the hub (bench use, local only) |
| `cmd <command...>` | Run an allowlisted control command locally. No arguments lists them |
| `ack [id]` | Acknowledge the latest message that asked for it |
| `power-plan --mah N --volts V ...` | Print a runtime plan for a battery without running anything |
| `check-update [--download]` | Look for a newer checksummed release. Never installs |
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

## 8. Releases and updates

`npm run hb -- agent package` builds `public/downloads/unoq/`: `homebeacon-unoq-X.Y.Z.tar.gz`, its `.sha256`, `manifest.json` and `install.sh`. The tarball is reproducible (same bytes for the same sources) and about 40 KB. `npm run hb -- agent verify` recomputes everything, unpacks the tarball into a temp folder and runs the agent self test. Run `package` again after any change under `agents/unoq/` or to this file, then commit the output.

`homebeacon-unoq check-update` reads the manifest and says whether a newer release exists. `--download` fetches the tarball over https, verifies size and sha256 and stages it under the state folder. It prints the install command. **Nothing is installed or executed automatically.**

Signing is optional. With `UNOQ_SIGNING_KEY=/path/to/ed25519.pem` the packager writes an Ed25519 signature; `install.sh --pubkey` verifies it with openssl 3. A signing key is a credential: create it outside the repo, keep it mode 600 and record its location in your private credential inventory. No signing key was created for this release, so it is checksum-only.

## 9. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Live view says box link not connected | Box A not plugged in, wrong group (`homebeacon` needs `dialout`), or another program (the old `hub.py`) holds the port |
| `the API rejected the device key (401/403)` | Key typed wrong or device disabled. Re-run `setup`. Queued data is kept |
| `beacon telemetry refused (409)` | Usually the device has no home (assign one; new routine beacons pause for an hour). Other 409s mean the server is still processing the same event. Refused beacons are kept and resent with the same event id, never dropped |
| Runs in beacon mode on a good battery | `need_hours` is longer than the pack allows, or wall power is unknown (set `assume_mains`). The live view lists the reasons |
| Nothing after install | The service waits for `device_id` and the key; see the printed steps |

## 10. Not verified (needs a real Uno Q)

- Serial reading from box A on the Uno Q, and `stty` behaviour on its Debian image.
- The Arduino App Lab Bridge adapter (`mcu.source = "bridge"`). It is written to the documented Python API but has never run on a board, and the matching MCU sketch does not exist.
- The systemd unit's sandbox settings and the installer on the board's actual image (it is syntax checked and its checksum logic is tested, not run as root on a Uno Q).
- All power figures (section 7 of [POWER_DESIGN.md](POWER_DESIGN.md)), the Uno Q's real idle draw, and any battery gauge.
- Displaying messages on the box OLED: no firmware command exists, so messages show in the terminal and live view only.
- Real Wi-Fi loss and reconnection on the board.

## 11. Files

| Path | Purpose |
| --- | --- |
| `agents/unoq/hbagent/` | The agent: `agent.py` loop, `power.py` manager, `protocol.py`, `commands.py`, `uplink.py`, `store.py`, `mcu.py`, `servers.py`, `live.py`, `updater.py`, `config.py`, `system.py`, `cli.py` |
| `agents/unoq/packaging/` | `install.sh`, systemd unit, `apply-power-profile.sh`, example config |
| `agents/unoq/tests/` | Unit tests (`python3 -m unittest discover -s tests` or `pytest`) |
| `scripts/package-unoq.mjs`, `scripts/commands/agent.mjs` | Packager and the `hb agent` command |
| `test/unoq-package.test.js` | Packaging, verification, installer and simulation tests |
| `public/downloads/unoq/` | Published release |
