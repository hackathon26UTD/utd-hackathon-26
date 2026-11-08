# HomeBeacon hardware: build, flash and test

Two boxes and a hub:

```
Box B (ESP32) ──encrypted ESP-NOW──> Box A (XIAO ESP32S3 Sense) ──USB──> Uno Q hub (local dashboard)
                                         │  └── microSD: /log.csv (black box), /queue.txt (offline uploads), /img/*.jpg
                                         └──HTTPS (verified CA)──> https://utd-hackathon-26.pages.dev/api
```

| | Box A (`firmware/box_a`) | Box B (`firmware/box_b`) |
| --- | --- | --- |
| Board (Arduino IDE 2) | **XIAO_ESP32S3**, PSRAM **OPI PSRAM** | **ESP32 Dev Module** |
| Sensors | water (D0, powered from D1), sound DO (D2), mains sense (D3), button (D6), buzzer (D7), camera + microSD | PIR (26), flame DO/AO (27/34), tilt (25), mains sense (35), battery (32) |
| I2C (shared bus) | D4 SDA / D5 SCL: DS1307 0x68, GY-521 **0x69**, SSD1306 0x3C | 21 SDA / 22 SCL: GY-521, SSD1306 |
| Talks to | API over Wi-Fi + box B over ESP-NOW | Box A only (no Wi-Fi join, no cloud key) |

I2C saves pins: the clock, accelerometer and screen all share two wires. Everything on I2C is auto-detected at boot, so a missing part is reported, not fatal. **GY-521 on box A: wire its AD0 pin to 3.3 V** so it moves to 0x69; otherwise it collides with the DS1307 at 0x68.

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

## 3. Provision (needs `API_ADMIN_KEY` from Ayan)

Add to `.env`: `API_ADMIN_KEY`, `WIFI_SSID`, `WIFI_PASS` (a **2.4 GHz** hotspot; iPhone: Personal Hotspot → Maximize Compatibility). Then:

```bash
npm run provision -- --a-mac <box A MAC> --b-mac <box B MAC> --lat 32.9857 --lon -96.7502
```

This creates a synthetic demo home and a device for each box, assigns them, generates the ESP-NOW AES keys, and writes `firmware/box_a/secrets.h` and `firmware/box_b/secrets.h` (git-ignored; device keys are never printed). Re-flash both boards.

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
| `espnow` / `queue` | Link to box B / pending uploads | box B seen N s ago; queue 0 when online |

### Box B
| Command | What it checks | Expect |
| --- | --- | --- |
| `sensors` / `watch` | All inputs (once / 10 s live) | Wave at the PIR (after 60 s warm-up), lighter at 30 cm for flame, tilt the board |
| `i2c` | GY-521 present | `0x68` or `0x69` |
| `ping` | **Encrypted link to box A** | `PASS: box A acknowledged` |
| `link` | Channel, sent/acked counts, time sync | pending 0, time "synced from box A" |

## 5. System tests (the demo scenarios)

| # | Test | Steps | Pass when |
| --- | --- | --- | --- |
| S1 | End-to-end | Both boxes on, hotspot on | Command center shows both homes updating; hub page shows both boxes "live" |
| S2 | Flood | Dip box A's water sensor | Buzzer ×3, `water.detected` event, photo in `/img`, incident in the command center |
| S3 | Fire (box B) | Lighter near flame sensor | Box A prints `[event] box B: flame.detected`, event in API marked `relayed_via: A` |
| S4 | Help button | Short press box A button | `help.request` event + photo; long press (2 s) → `ok.report` |
| S5 | Power loss | Pull USB from a box running on the AA pack | `power.lost` event, `main_power_available: false` in telemetry |
| S6 | **Internet outage** | Turn the phone's **mobile data** off (keep the hotspot Wi-Fi on) for 2 min, trigger S2/S3, then turn data back on | During: `queue` grows, hub still updates. After: queue drains to 0 and events appear in the cloud **with their original timestamps** and no duplicates |
| S7 | Full Wi-Fi loss | Turn the hotspot off entirely | Box A logs "fallback channel 1"; box B rescans and keeps getting ACKs (`ping` PASS); everything is on SD. Turn the hotspot back on: uploads resume |
| S8 | Box silent | Unplug box B for 30 s | Box A raises `box_b.silent`; hub shows box B **SILENT** (unknown, not safe) |
| S9 | Reboot replay safety | Reset box B mid-run | Box A keeps accepting (boot counter increased); no duplicate events in the API |

## 6. Security tests (prove the encryption claim)

| # | Test | Steps | Pass when |
| --- | --- | --- | --- |
| E1 | Wrong key rejected | Change one hex digit of `ESPNOW_LMK` in **box B's** `secrets.h` only, flash, run `ping` | `FAIL: no ACK`; box A stores nothing from B. Restore the key → `PASS` |
| E2 | Unknown device rejected | Flash a third ESP32 (or box B with a different `BOX_A_MAC`) | Box A ignores it (`espnow` shows no new data; `rejected` may increase) |
| E3 | Replay rejected | Box A keeps the last (boot, seq) from box B in flash; old sequence numbers are re-ACKed but never stored | After S9, the API has exactly one copy of each event_id |
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
- **`ping` FAIL:** MACs swapped, keys differ between the two `secrets.h`, or the boxes are on different channels (`channel` on box B rescans).
- **Water reads 4095 constantly:** sensor + wired to 3.3 V instead of D1, or S and + swapped.
