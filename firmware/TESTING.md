# HomeBeacon hardware: build, flash and test

Boxes form an encrypted ESP-NOW **mesh**; any box with working Internet is the **gateway** and uploads for everyone. A message hops box to box (up to 5 hops) until a gateway acknowledges it; until then the box that created it keeps it and re-sends it, subject to finite queue capacity and power loss. A separate bounded local-history recorder preserves sampled readings and syncs them when its own Wi-Fi reconnects; see [DEVICE_HISTORY.md](../docs/DEVICE_HISTORY.md).

```
House C ──► House B ──► House A (gateway: has Internet) ──HTTPS──► API ──► command center
  (no Wi-Fi)  (no Wi-Fi)        └──USB──► Uno Q hub (local dashboard, works offline)
```

If A loses Internet and B gets it, B becomes the gateway automatically and A's messages flow through B.

| | Box A (`firmware/box_a`) | Box B (`firmware/box_b`) |
| --- | --- | --- |
| Board (Arduino IDE 2) | **XIAO_ESP32S3**, PSRAM **OPI PSRAM** | **ESP32 Dev Module**, Partition Scheme **Huge APP** |
| Sensors | water (D0, powered from D1), sound DO (D2), mains sense (D3), button (D6), buzzer (D7), camera + microSD | PIR (26), flame DO/AO (27/34), tilt (25), mains sense (35), battery (32) |
| I2C (shared bus) | D4 SDA / D5 SCL: DS1307 0x68, GY-521 **0x69**, SSD1306 0x3C | 21 SDA / 22 SCL: GY-521, SSD1306 |
| Role | Mesh node; gateway when it has Internet (upload queue on microSD) | Mesh node; gateway when it has Internet (RAM queue). Extra boxes (C, D...) use this sketch |

I2C saves pins: the clock, accelerometer and screen all share two wires. Everything on I2C is auto-detected at boot, so a missing part is reported, not fatal. **GY-521 on box A: wire its AD0 pin to 3.3 V** so it moves to 0x69; otherwise it collides with the DS1307 at 0x68.

## 0. Quick mesh test (two bare ESP32s, no sensors, no API keys)

`firmware/mesh_test/mesh_test.ino` tests only the encrypted ESP-NOW mesh. Same sketch on both boards:

1. Flash it to both boards (any ESP32: "ESP32 Dev Module" or "XIAO_ESP32S3"). Serial Monitor 115200, type `mac` on each.
2. At the top of the sketch: put both MACs in `MAC_A` / `MAC_B` (same on both), `MY_NODE_ID` `"A"` on one board and `"B"` on the other.
3. Put the hotspot name (2.4 GHz) in `WIFI_SSID` on **both** boards (the other board uses it to find the gateway's channel), and `WIFI_PASS` **only** on the gateway board. Flash both again.

| Try | Expect |
| --- | --- |
| Both on | Gateway: `>>> GATEWAY got hello#N from box B ... hops 0 -> ACK`. Other: `<<< ACK from gateway A` |
| Turn the hotspot off | Gateway loses Wi-Fi; other box prints `sent hello#N (waiting for ACK: N)` with the count growing |
| Hotspot back on | Gateway reconnects and both sides catch up: every waiting hello is delivered and ACKed |
| Change one digit of `ESPNOW_LMK` on one board | No messages get through (encryption works). Put it back: works again |
| `mesh` command | Role, peers, pending, rx / forwarded / acked / rejected counters |

**Attach the antennas.** XIAO ESP32S3/C3 boards have a U.FL connector and barely transmit or receive without the antenna clicked on: our first test delivered 0-10% of frames without them and 100% with them. `mesh` shows `radio: sent ok / failed`; any failures on boards a metre apart mean an antenna problem.

Easiest: plug both boards in and run `npm run mesh-test` (or `--no-flash --watch 60` to just watch). XIAO ESP32C3 boards need USB CDC on boot (the script sets it).

If nothing arrives: MACs swapped or mistyped, the two boards have different keys, or they are on different Wi-Fi channels (wait 20 s; the non-gateway rescans for the hotspot's channel).

## Wiring rules (read before powering)

- **DS1307 needs 5 V, and its board pulls SDA/SCL up to 5 V.** Power it, then measure SDA→GND and SCL→GND with the multimeter **before** connecting to the XIAO. If either reads above 3.6 V, leave the clock disconnected: the box gets time from the Internet (NTP), and box B gets time from box A.
- **PIR (HC-SR501): VCC 5 V**, OUT is 3.3 V (safe). Turn the time pot fully counter-clockwise; jumper on H.
- **Flame, tilt, water, sound modules: 3.3 V.**
- **Mains sense:** USB/wall 5 V → 10 kΩ → *pin* → 10 kΩ → GND (≈2.5 V when present). Run the board from the AA pack through the Power MB with diodes so it keeps running when USB is pulled. Measure the pin voltage before connecting. No divider wired? Set `USE_MAINS_SENSE 0` in `config.h`.
- **Battery sense (box B):** 9 V pack → 20 kΩ → pin 32 → 10 kΩ → GND (≈3 V max). Set `USE_BATTERY 0` if not wired.
- **Water sensor + goes to D1, not 3.3 V.** The firmware powers it only while reading so the traces do not corrode.

## 1. One-time setup

```bash
npm ci
npm run firmware:build      # compile check for both boxes (uses arduino-cli)
```

Arduino IDE 2 users: install "esp32 by Espressif Systems" and the libraries **ArduinoJson**, **Adafruit SSD1306**, **Adafruit GFX Library**, then open `firmware/box_a/box_a.ino` or `firmware/box_b/box_b.ino`. Edit shared headers only in `firmware/common/`, then run `npm run firmware:sync`.

## 2. Get the MAC addresses

Flash both boards once (they boot with placeholder secrets), open Serial Monitor at **115200**, type `mac` on each. Note box A's and box B's MAC.

## 3. Provision with the existing private admin key

Settings load from environment, `.env`, then `.dev.vars`. Add privately: `API_ADMIN_KEY`, `WIFI_SSID`, `WIFI_PASS` (a **2.4 GHz** hotspot; iPhone: Personal Hotspot → Maximize Compatibility). Then:

```bash
npm run provision -- --check  # read-only access check; no board details needed
npm run provision -- --box A=<box A MAC> --box B=<box B MAC> [--box C=<MAC>] --lat 32.9857 --lon -96.7502
```

This creates a synthetic demo home and a device for each box, assigns them, generates the shared ESP-NOW AES keys, and writes `firmware/box_a/secrets.h`, `firmware/box_b/secrets.h` and `firmware/box_b/secrets.<ID>.h` for extra boxes (all git-ignored; device keys are never printed). Every box gets every box's device key so any of them can upload for the neighbourhood: a deliberate demo trade-off (a stolen box exposes the neighbourhood's keys; disable them with `PATCH /api/devices/<id>`). Re-flash every board.

## 4. Bench tests (serial commands)

Type these in each board's Serial Monitor. Run them in order; each prints PASS/FAIL or a value.

### Box A
| Command | What it checks | Expect |
| --- | --- | --- |
| `selftest` | Everything below in one go | `core PASS` |
| `i2c` | Which I2C parts answered | `0x3C` OLED, `0x68` clock, `0x69` GY-521 (only what is wired) |
| `sd` | microSD write/read | `[sd] PASS` (FAT32, ≤32 GB) |
| `cam` | Camera snapshot to SD | `saved /img/...jpg`; open it on a PC afterwards |
| `water` | 10 raw water readings | Dry ≈ 0–300; dip in a cup → rises. Set `WATER_WET_RAW` midway |
| `mains` | Wall-power divider | ≈2500 mV on USB/wall power, ≈0 when unplugged (board on battery) |
| `sound` | Loud-sound triggers in 5 s | Play a smoke-alarm sound on a phone: ≥6 triggers. Adjust the module pot |
| `button` | Button wiring | `PASS` when pressed |
| `beep` | Buzzer | Two beeps |
| `wifi` / `time` | Hotspot and NTP | `connected`, real UTC time |
| `api` | HTTPS + certificate + device key | `GET /api/health -> 200` and `POST /api/beacon/ingest -> 202 (PASS)` |
| `mesh` | Role, peers, gateway, counters | `role=GATEWAY` when online; otherwise the gateway box and hop count |
| `ping` | Delivery through the mesh | `PASS` (delivered locally or ACKed by a gateway) |
| `queue` | Pending uploads + own messages awaiting ACK | Both 0 when online |

### Box B
| Command | What it checks | Expect |
| --- | --- | --- |
| `sensors` / `watch` | All inputs (once / 10 s live) | Wave at the PIR (after 60 s warm-up), lighter at 30 cm for flame, tilt the board |
| `i2c` | GY-521 present | `0x68` or `0x69` |
| `ping` | **Encrypted delivery through the mesh** | `PASS: acknowledged by gateway A` |
| `mesh` / `wifi` / `queue` | Role, gateway, Internet, pending | Gateway known, pending 0 |

## 5. System tests (the demo scenarios)

| # | Test | Steps | Pass when |
| --- | --- | --- | --- |
| S1 | End-to-end | Both boxes on, hotspot on | Command center shows both homes updating; hub page shows both boxes "live" |
| S2 | Flood | Dip box A's water sensor | Buzzer ×3, `water.detected` event, photo in `/img`, incident in the command center |
| S3 | Fire (box B) | Lighter near flame sensor | Gateway prints the event (`[event] box B: flame.detected (1 hops)` on box A); API event has `mesh_hops` and `gateway` |
| S4 | Help button | Short press box A button | `help.request` event + photo; long press (2 s) → `ok.report` |
| S5 | Power loss | Pull USB from a box running on the AA pack | `power.lost` event, `main_power_available: false` in telemetry |
| S6 | **Internet outage** | Turn the phone's **mobile data** off (keep the hotspot Wi-Fi on) for 2 min, trigger S2/S3, then turn data back on | During: `queue` grows, hub still updates. After: queue drains to 0 and events appear in the cloud **with their original timestamps** and no duplicates |
| S7 | Full Wi-Fi loss | Turn the hotspot off entirely | Both boxes log `offline; mesh on channel 1`; `mesh` shows pending messages growing (held, not lost); hub still shows both boxes. Hotspot back on: a box becomes GATEWAY, pending drains to 0, everything appears in the cloud with original timestamps |
| S8 | Box silent | Unplug box B for 30 s | Box A raises `box_B.silent`; hub shows box B **SILENT** (unknown, not safe) |
| S9 | Reboot safety | Reset box B mid-run | Its boot counter increases so new messages get new ids; no duplicate events in the API |


## 5b. Mesh tests

| # | Test | Steps | Pass when |
| --- | --- | --- | --- |
| M1 | Gateway handover | Both online; then give **only box B** Internet (e.g. move box A out of hotspot range, or flash A with a wrong `WIFI_PASS`) | A: `mesh` shows `gateway: B (1 hops)`; A's water/help events appear in the cloud with `mesh_hops: 1` and `gateway: B` |
| M2 | Store and forward | Hotspot off; trigger events on both boxes for 2 min; hotspot on | During: `queue` shows own messages waiting, nothing lost. After: all events in the cloud once, in order, original timestamps |
| M3 | Multi-hop (needs a 3rd ESP32 as box C) | Place C near B but out of A's range; only A has Internet | C's events arrive with `mesh_hops: 2` |
| M4 | Duplicate suppression | Run M1/M2 | Each `event_id` (`<box>-<boot>-<seq>`) appears once in `/api/beacon/ingest` telemetry |
| M5 | Time without Internet | Boot box B with the hotspot off, then bring box A online | B prints `[time] set from mesh gateway` |

Limits to state honestly: all boxes must share one Wi-Fi channel (the hotspot's when visible, else channel 1), so boxes far from the hotspot can miss a gateway that sits on another channel; ESP-NOW range is ~100–200 m open air per hop; real deployments would use LoRa or Thread (ESP32-C6/H2) radios.

## 6. Security tests (prove the encryption claim)

| # | Test | Steps | Pass when |
| --- | --- | --- | --- |
| E1 | Wrong key rejected | Change one hex digit of `ESPNOW_LMK` in **box B's** `secrets.h` only, flash, run `ping` | `FAIL: no ACK`; box A stores nothing from B. Restore the key → `PASS` |
| E2 | Unknown device rejected | Flash a third ESP32 whose MAC is not in `MESH_NODES` | Other boxes ignore it (`mesh`: rx does not grow, `rejected` may) |
| E3 | Duplicates / replays | Run S9 and M2 | A gateway ignores messages it delivered recently (last 256 ids) and re-ACKs them; the API keeps one telemetry record per `event_id`. Not a full replay defense: an attacker would also need the AES keys to forge new frames |
| E4 | Certificate check | Point `API_BASE` at a site that is not ours (e.g. `https://example.com`) and run `api` | `GET` returns a negative code (TLS refused: example.com is not signed by our pinned CAs), so the device key is never sent. Restore `API_BASE` afterwards |
| E5 | Stolen key | Disable box A: `PATCH /api/devices/<id>` `{"disabled": true}` with the admin key, then `api` | `401 device key rejected`. Re-enable afterwards |

## 7. Hub (Uno Q)

Copy `firmware/hub/hub.py` to the Uno Q's Linux side, plug box A into the Uno Q by USB, then:

```bash
python3 hub.py --selftest            # no hardware needed: parser + database + page
HUB_PASSWORD='pick-8+-chars' python3 hub.py
```

Open `http://<uno-q-ip>:8080` (user `hub`). It refreshes every 3 s and keeps working with the Internet off.

## Troubleshooting

- **Upload fails on the XIAO:** hold BOOT, tap RESET, upload again.
- **`cam` FAIL:** press the camera board firmly onto the XIAO; PSRAM must be "OPI PSRAM".
- **`api` → negative code:** Wi-Fi up but TLS failed. If Cloudflare changed certificate authority, regenerate `firmware/common/root_ca.h` (see its header) and `npm run firmware:sync`.
- **`api` → 409:** device not assigned to a home: rerun provisioning.
- **`ping` no ACK:** no box has Internet yet (message is held and retried), or `MESH_NODES`/keys differ between boxes, or boxes sit on different channels (`mesh` shows peers and rx counts; boxes rescan for the hotspot every 30 s).
- **Water reads 4095 constantly:** sensor + wired to 3.3 V instead of D1, or S and + swapped.
