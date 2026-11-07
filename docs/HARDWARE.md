# Hardware plan, constraints, and observed inventory

## Current plan: home disaster blackbox (State Farm track) — updated November 7, 2026 evening

Concept and honesty constraints are in [HOME_BLACK_BOX.md](HOME_BLACK_BOX.md). This section records the hardware we have, what was requested from HARP, and how the boards talk to each other. Everything below is planned and unverified on real hardware until the work log says otherwise.

### Already on hand (team-owned)

| Item | Qty | Role |
| --- | ---: | --- |
| ESP32-S3 Sense (camera module + microSD) | 1 | Box A: flagship box and ESP-NOW gateway. Camera snapshot on trigger, SD-card blackbox log. |
| ESP32 (second board) | 1 | Box B: second house, sends to box A over ESP-NOW. |
| Arduino Uno Q | 1 | Neighborhood hub: Linux side buffers readings, serves an offline local dashboard, forwards to the cloud API. |
| microSD card | 1 | Durable local log on box A. |
| Push button | 1 | "Need help / I'm OK" input → `POST /api/events`. |
| Sound sensor | 1 | Detects smoke-alarm beeping (proxy, not a certified detector). |
| Buzzer | 1 | Local alarm. |

### HARP request (drafted in the team cart; confirm submission/approval status in HARP)

The cart held 37 units when the request form was filled. Approved requests are held at the hardware desk for one hour.

| HARP item | Qty | Role |
| --- | ---: | --- |
| Temp and Humidity (DHT11) | 2 | One per box |
| Water Level Sensor | 2 | Flooding, one per box |
| GY-521 Module (MPU-6050) | 1 | Shaking / structural tilt (box B, I2C) |
| Tilt Switch | 1 | Cheap shake/tilt input for box A |
| Flame | 1 | Fire proxy (box B) |
| HC-SR501 PIR Motion Sensor | 1 | Occupancy proxy; never proves a home is empty |
| DS-1307 RTC Module | 2 | Correct timestamps while offline (evidence timeline) |
| SSD1306 0.96in OLED Display | 2 | Status screen per box (optional; first thing to shut off on battery) |
| 6xAA Battery Holder w/ Switch | 2 | Battery backup (9 V pack) |
| Power Supply Module | 2 | Regulates the pack to 5 V / 3.3 V |
| Diode | 4 | Diode-OR between USB power and battery |
| Resistor | 10 | Voltage divider on USB 5 V so firmware detects loss of external power |
| 830-pt Breadboard | 1 | |
| Breadboard Jumper Wire Set (65pc) | 1 | |
| Jumper Wires (F-F), (M-F) | 1 each | Few loose wires; borrow more for sensor modules if needed |
| USB-C Cable, 6ft | 1 | |
| Digital Multimeter | 1 | Verify power path and divider voltages before connecting to GPIO |
| Hot Glue Gun | 1 | Enclosure assembly |

Also planned: a HARP **3D print** request for the box enclosure.

Request-form answers submitted with the cart: the project is a neighborhood disaster-response network for the State Farm track (home blackboxes that log offline and report to a command center that ranks who needs help first); hardware roles as in the table above.

### Gaps

- **No air-quality / gas sensor on HARP** (no MQ-2, MQ-135, BME680, SGP30). Borrow one or drop air quality from the pitch; use flame + alarm-sound detection and outdoor AirNow data in the command center instead.
- **No LiPo.** AA pack is the backup. The ESP32-S3 Sense has battery pads if a LiPo turns up.
- **No LoRa.** ESP-NOW is the short-range stand-in; say so in the pitch.
- **Box A pins are scarce:** the camera and SD card use most of the ESP32-S3 Sense GPIO. Keep box A to DHT11, water level, sound, button, buzzer, tilt switch. Put GY-521, flame, PIR and OLED on box B.

### Communication design

```
Box B (ESP32) --ESP-NOW--> Box A (ESP32-S3 Sense) --USB serial--> Uno Q hub --Wi-Fi--> Cloudflare API --> command center
                                  \--> microSD log (durable, sequence-numbered)
```

- **Normal mode:** each box joins Wi-Fi and batches readings to `POST /api/ingest` every ~5 s with its `X-Device-Key` (see [API.md](API.md)). Use a phone hotspot, not campus Wi-Fi (eduroam/captive portal). ESP32 radios are **2.4 GHz only**; on iPhone enable Personal Hotspot → *Maximize Compatibility*.
- **ESP-NOW:** Espressif peer-to-peer radio built into every ESP32, no router needed, ~100–200 m open air, 250-byte frames. When a box is also connected to Wi-Fi, ESP-NOW peers must use the access point's channel.
- **Uno Q:** its Wi-Fi lives on the Linux side and cannot speak ESP-NOW, so box A bridges ESP-NOW frames to it over USB serial. The Uno Q stores them, serves a LAN dashboard, and forwards to the cloud when internet is available.
- **Offline behavior (store-and-forward):** boxes keep logging to SD with RTC timestamps and sequence numbers; on reconnection the backlog is replayed in order and deduplicated. The command center must show a silent box as *stale/unknown*, never safe. Do not label ESP-NOW relay or buffered replay as live internet connectivity.
- **Power-loss detection:** USB 5 V through a resistor divider into an ADC pin (keep the pin under 3.3 V; check with the multimeter first) while the diode-OR'd AA pack keeps the board running. Report `power.mains` readings and a `power.lost` event.

### Sensor → API mapping

| Reading / event | Sensor | Unit / values |
| --- | --- | --- |
| `temp_c`, `humidity_pct` | DHT11 | °C, % |
| `water_level` | Water Level Sensor (ADC) | raw 0–4095 (calibrate dry/wet) |
| `accel_g`, `tilt` | GY-521, tilt switch | g, boolean |
| `flame` | Flame sensor | boolean |
| `motion` | PIR | boolean |
| `sound_level`, event `alarm.beeping` | Sound sensor | raw / event |
| `power.mains`, event `power.lost` | Divider on USB 5 V | boolean |
| event `help.request`, `ok.report` | Button | — |
| `battery_v`, `rssi` | Divider on pack, Wi-Fi | V, dBm |

Suggested rules: `water_level > <wet threshold>` (critical), `flame == 1`, `temp_c > 50`, `accel_g > 1.5`.

### Firmware toolchain

- **ESP32s: Arduino IDE 2.** Boards Manager → install "esp32 by Espressif Systems".
  - ESP32-S3 Sense: board **XIAO_ESP32S3**, **PSRAM → OPI PSRAM** (camera will not start otherwise).
  - Second ESP32: board matching its silkscreen, usually **ESP32 Dev Module**.
  - Libraries: ArduinoJson, DHT sensor library, Adafruit MPU6050, Adafruit SSD1306, RTClib. ESP-NOW, WiFi and SD ship with the ESP32 core.
  - Serial Monitor 115200 baud. If an S3 upload fails: hold BOOT, tap RESET, upload.
- **Alternative: PlatformIO in VS Code** pins library versions in a committed `platformio.ini`; about 15 minutes more setup.
- **Arduino Uno Q: Arduino App Lab** for both halves (MCU sketch + Linux-side Python hub). Arduino IDE 2 can still program the MCU side.
- Device keys: register each box with `POST /api/devices` using `API_ADMIN_KEY` (from Ayan), then put the returned `dk_...` key in `clients/esp32/secrets.h` (git-ignored).

---

## Earlier exploration (historical)

Stock below is a November 7, 2026 afternoon snapshot from signed-in HARP and can change at any time.

## Initial smart-fridge proposal

A magnetic device on the fridge, with display and camera/barcode scanning. Proposed features: inventory, expiration entry, nutrition, recipes. Earlier conversation proposed Pi 4, 3.5–5-inch touchscreen, and camera. Later recommendation favored Pi 5 for a smooth touchscreen/camera app. These are proposals, not the final bill of materials.

Ayan's concern: a phone can cover the same workflow and scanning creates effort. The team has not validated that a dedicated magnet solves a sufficiently important problem.

## Board comparison

- Pico / Pico 2: microcontrollers for sensors/buttons/simple displays. Pico 2 has 520 KB RAM and 4 MB flash. Building a rich camera/touchscreen workflow is substantially more constrained than on a full Pi.
- Pi 5: full computer, approximately 85 × 56 mm board. Recommended for initial display/camera hackathon prototype; include space for connections, mounting, and cooling.
- Zero 2 W: approximately 65 × 30 mm with CSI camera connector. Smaller alternative, but limited memory/performance and display compatibility must be checked. It does not have the Pi 5's DSI display connector; the official DSI Touch Display 2 is not a drop-in choice for it.
- Display, enclosure, cable clearance, power lead, and magnets can determine overall size more than the board itself.

## HARP stock snapshot

| Relevant item | Available when checked |
| --- | ---: |
| Raspberry Pi 5 (4 GB) | 4 |
| Raspberry Pi Pico 2 WH | 10 |
| Raspberry Pi Touch Display 2, 7-inch | 1 |
| Raspberry Pi Camera Module 3 | 2 |
| Pi 5 camera cable, 200 mm, 22-pin to 15-pin | 3 |
| Pi 27 W USB-C supply | 4 |
| Pi Active Cooler | 1 |
| 64 GB microSD, described as preflashed | 5 |
| ESP32-S3-DevKitC-1 | 9 |
| ESP32 | 1 |
| DS18B20 temperature module | 6 |
| Magnetic Spring / reed switch module | 6 |
| DHT11 temperature/humidity module | 5 |
| GY-521 accelerometer/gyro | 6 |

Portal stated a team can have 3 simultaneous requests. Team request page showed none. Stock does not establish track eligibility or guaranteed checkout. The portal descriptions can contain mistakes: e.g., a generic USB-C cable description listed Pico 2, while the Pico 2 WH item itself listed Micro-USB. Verify the actual board connector before checkout.

## Important integration constraints

- Grocery UPC/EAN barcodes normally identify the product, not its expiration date. Use manual expiration entry, clearly labeled estimates, or printed-date OCR; never silently claim barcode-derived expiration.
- Pi 5 Camera Module 3 needs the matching 22-pin-to-15-pin cable. Camera-box cable may not fit Pi 5.
- The available touchscreen was 7-inch, not the initially suggested 3.5–5-inch size. Confirm the Pi 5 display ribbon is supplied; camera and display cables are not interchangeable by assumption.
- Pi 5 requires appropriate power; the proposed supply is 27 W. Provide mounting and strain relief. Battery operation is not designed yet.
- Check sensor voltage levels before wiring. Portal claims such as ultrasonic modules working with any board do not prove safe 3.3 V input compatibility.
- Food-waste/recipe suggestions are not a proven safety assessment. A temperature demo must not claim validated food-safety compliance.
- A short motor-anomaly demo can show a changed signal, not validated predictive maintenance or reliable fault diagnosis.
- Mounting magnets, enclosure design, refrigeration-rated sensors, waterproofing, and cold-room battery behavior are unresolved.

## Alternative directions discussed

1. Cold-storage monitor: continuously measure temperature and door-open time; alert and retain incident history. Clear reason for dedicated hardware, customer need still unvalidated.
2. Equipment monitor: continuously measure vibration/temperature on a fan or motor; compare normal and deliberately changed conditions. Needs representative data before predictive claims.
3. Leak detector: detect water under a sink and alert. Simple physical demo, differentiation/customer segment undecided.

## References

- https://www.raspberrypi.com/products/raspberry-pi-pico-2/
- https://www.raspberrypi.com/documentation/computers/sbcs.html
- https://www.raspberrypi.com/documentation/computers/zero.html
- Inventory source: https://harp.hackutd.co/app/hardware
