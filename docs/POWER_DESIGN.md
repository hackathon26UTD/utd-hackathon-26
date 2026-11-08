# Low-power design and the self-deciding runtime

Status: design and software are written and unit tested. **No battery life has been measured.** Every milliwatt figure here is an estimate until someone logs it with a USB power meter (section 7). Do not quote a runtime in the demo as a result. Quote it as "the plan says, and here is what it assumes".

This covers the Arduino Uno Q hub (the Linux side) and the guidance for the boxes. The code is `agents/unoq/hbagent/power.py`; the agent that uses it is described in [UNOQ_AGENT.md](UNOQ_AGENT.md).

## 1. What matters most

- **The Linux side is the cost.** A quad-core Linux board with Wi-Fi idles at watts, not milliwatts. Our estimates put the hub between about 1.2 W (beacon) and 2.7 W (full). Slowing uploads saves only a few milliwatts. The big levers are the supply path (buck, not LDO), switching off what is not needed (display, camera, Bluetooth), the CPU governor, and Wi-Fi power save.
- **The boxes keep sensing regardless.** Sensing, the buzzer, the help button, the microSD log and ESP-NOW receive are the safety record. The hub's power mode never turns any of that off. The hub is the second copy and the offline dashboard.
- **Unknown stays unknown.** Missing battery data gives "no runway estimate", never a guess dressed up as a number. Stale readings are shown as stale. Unknown wall power is treated as lost, the same as `firmware/common/power_policy.h`.

## 2. Modes

| Mode | Reports | Message check (minimum) | Wi-Fi retry gap | Display | Where it comes from |
| --- | --- | --- | --- | --- | --- |
| full | 30 s | 10 s (server may ask) | 60 s | on | Mirrors firmware Normal and `normal` in `domain/system-policy.js` |
| eco | 120 s | 60 s | 300 s | off | Mirrors firmware Saver and `saver` |
| survival | 300 s | 120 s | 600 s | off | Hub only. Not a firmware mode |
| beacon | 900 s | 300 s | 900 s | off | Hub only. Heartbeat plus critical events |
| hazard cadence | 30 s | as mode | 60 s | as mode | Mirrors firmware Critical, but only while there is runway |

Constants are checked against the header and the JavaScript policy by `agents/unoq/tests/test_power.py`, so they cannot drift silently.

**Differences from the firmware, on purpose.**
- The firmware keeps Critical on for as long as a hazard is latched. The hub does not: a hazard raises its reporting only while the battery still has `hazard_min_runway_h` (3 h) of runway. Below that, it keeps its last-gasp beacon alive instead, because the boxes still hold the record on their own microSD.
- `survival` and `beacon` exist only on the hub.
- The cloud sees only the three server words: `normal`, `saver`, `critical` (the `power_mode` reading the server already understands). `agent_mode` carries the real hub mode.
- Critical events (a hazard seen by any box) always trigger an immediate upload attempt in every mode, at most once every 15 s.

## 3. Estimated load model

Average draw at the 5 V rail, in milliwatts. **Estimates**: typical for this class of board, not measured on ours.

| Component | full | eco | survival | beacon |
| --- | ---: | ---: | ---: | ---: |
| SoC, RAM and MCU idle | 1800 | 1400 | 1100 | 900 |
| Wi-Fi associated, between bursts | 250 | 120 | 60 | 40 |
| Display and LEDs | 150 | 0 | 0 | 0 |
| USB peripherals (box A and sensors) | 450 | 350 | 300 | 250 |
| Uplink bursts (1500 mJ each, amortised) | 50 | 12.5 | 5 | 1.7 |
| Message checks (400 mJ each, amortised) | 13 | 6.7 | 3.3 | 1.3 |
| **Average** | **2713** | **1889** | **1468** | **1193** |

Why the spread is small: the lower modes assume a lighter CPU governor, Wi-Fi power save and peripherals trimmed. None of that is applied by the unprivileged agent. `packaging/apply-power-profile.sh <mode> --apply` (run by an operator as root) applies a governor, Wi-Fi power save and Bluetooth off. It is untested on a real Uno Q, so by default it prints what it would do.

**Replace estimates with measurements.** Put USB-meter averages for **all four modes** in the config and the agent switches its basis to `bench_measurement`:

```toml
[power.measured_mw]
full = 2400
eco = 1700
survival = 1300
beacon = 1000
```

Fewer than four modes gives `partial_measurement`: the unmeasured modes stay estimates and confidence is capped at `medium`. Setting `load_basis = "bench_measurement"` without all four modes is a config error, so an estimate can never be labelled as measured. `power-plan --measured full=2400,eco=1700,survival=1300,beacon=1000` does the same for one-off plans.

## 4. Runtime estimator

```
usable Wh   = capacity mAh x nominal V / 1000 x state of charge x chemistry derating x converter efficiency
reserve Wh  = larger of (15 % of usable) and (the last-gasp energy)
last gasp   = beacon average x last_gasp_hours (default 2 h) + one final status upload
hours       = (usable - reserve) / average W of the chosen mode and interval
```

The `15 %` and the formula match `powerBudget()` in `domain/system-policy.js`. The extra last-gasp floor is new. The derating figures (alkaline 70 %, NiMH 85 %, Li-ion 90 %, LiFePO4 95 %, lead acid 50 %) and the 88 % buck efficiency are planning assumptions. They are printed with every plan.

**Charge without a gauge is counted down, not held still.** With no gauge the starting charge is `assumed_soc_pct` (100 if unset). While off mains (unknown counts as off), the agent adds the average draw of the running mode, times the time passed, to an energy-used counter and subtracts it from the starting charge. The result is labelled `integrated_estimate`: it uses assumed loads, so it is only as good as the milliwatt figures. The counter is saved every five minutes and at shutdown, survives restarts, and restarts from zero when you enter a new `assumed_soc_pct` (do that after charging the pack). With a gauge or a voltage reading the counter is not used.

**Confidence** is `high` only if charge comes from a real gauge and all four loads were measured, `medium` if one of those holds (a partial measurement does not count as measured), `low` otherwise, and always `low` when charge was guessed from voltage. With no battery information the agent says it has no estimate. It never turns a voltage into usable energy on its own: the voltage-to-percent map exists only to label a guess.

## 5. How the hub decides

1. **Wall power present** (a fresh box reading, a fuel gauge, or `assume_mains` in the config): full service. The battery is a backup.
2. **Wall power lost or unknown, battery known:** pick the highest mode whose runway covers `need_hours` (default 24). If none does, run beacon mode and stretch the report interval as far as its limit (1800 s), then say how far short it is and how many watt-hours would close the gap.
3. **Stretch only as far as needed:** inside the chosen mode the report interval grows only until the target is met with 5 % margin.
4. **Hazard:** reporting rises to the hazard cadence only while the runway at that mode is at least 3 h. Otherwise the saved-power rate stays, and the decision says so.
5. **Last gasp:** when usable energy falls to the reserve, only the heartbeat runs. One final status and an `agent.last_gasp` event are queued once and sent at the next chance.
6. **Hysteresis:** stepping down is quick (60 s, or at once if the current mode cannot meet the target). Stepping up needs 10 minutes and 20 % extra runway. A hazard raise is immediate. This stops flapping.
7. **Requests:** an operator can hold a mode for up to four hours (`mode eco 60`). A lower mode is always allowed. A higher mode than the plan is refused if the battery could not run it for an hour.

Every decision carries plain sentences, for example: "Mains power is lost. Eco mode can last about 12.7 hours, which covers the 12 hour outage target." They show in the live view, the status endpoint and the cloud event `agent.mode`.

### Worked plans (estimates, from `power-plan`)

| Pack | Outage | Plan |
| --- | --- | --- |
| 6x AA alkaline, 2500 mAh at 9 V, buck | 24 h | Beacon only, about 9.6 h, then 2 h of heartbeat. About 20 Wh short |
| 10000 mAh Li-ion at 3.7 V, boost (85 %) | 24 h | Beacon only, about 20 h. About 5.4 Wh short |
| 20000 mAh at 7.4 V, buck | 24 h | Full service, about 37 h |
| 20000 mAh at 7.4 V, buck | 72 h | Beacon only, about 84 h |

So a 24 hour target on the Uno Q needs roughly a 40 to 60 Wh pack even in the lighter modes. The 6x AA holder alone will not do it. This is the reason for the guidance below.

## 6. Hardware guidance

**Power path.** Feed the Uno Q 5 V from a buck converter, not an LDO, and only from a pack of 5.5 V or more (for example 2S Li-ion, 7.4 V). A buck or LDO cannot make 5 V from one 3.7 V cell: use a boost converter there. The agent refuses that setup (`use boost, or a 2S pack`). From a 9 V pack an LDO is about 56 % efficient (5 / 9), so 44 % of the pack energy becomes heat. A buck is typically high 80s percent. Check the exact HARP power module (regulator type, output rails, peak current) before connecting anything; the pickup record does not say. Keep the diode-OR from [HARDWARE.md](HARDWARE.md) so USB and the pack cannot back-feed each other, and never put raw pack voltage on a GPIO.

**Battery.** Li-ion or LiFePO4 with a protection board and a real fuel gauge (coulomb counter) beat AA cells here: AA capacity collapses at hundreds of milliamps and in the cold, and voltage tells you little. Derate for cold, age and the converter. Do not run a pack to zero: leave the last-gasp reserve.

**Sleep states.** The Uno Q's Linux side has no deep sleep we can rely on in this build, and waking it back up from the cloud is not possible (devices only dial out). So the plan is to keep it awake at low load, not to suspend it. On the ESP32 boxes, light and deep sleep power down the radio. A box must keep ESP-NOW receive awake, so do not deep-sleep a relaying box without a tested wake schedule (see [SYSTEM_INTELLIGENCE.md](SYSTEM_INTELLIGENCE.md)). The MCU on the Uno Q can stay in its own low-power loop while Linux idles; this is unverified.

**Sensor power gating.** The water sensor is already powered from a GPIO only while reading, which also stops corrosion. Do the same for other probes that allow it. Keep the PIR and the flame sensor on only if the reading matters; both draw continuously.

**Radio scheduling.** The cost of an upload is the wake, the TLS handshake and the response. Batch readings (the agent sends up to 50 per request), keep the connection short, and avoid polling faster than needed. Message checks are the cheapest lever the operator controls: `PATCH /api/ops/device-settings` sets 10 to 300 s. ESP-NOW and Wi-Fi share one radio on the ESP32, so schedule uploads in bursts.

**Display.** Off in every mode except full. It is the first thing to cut. The OLED and any Uno Q LED matrix draw even when showing nothing useful.

**Camera.** Only on a trigger and only with mains (Normal), as in the firmware policy. The camera and its flash are the largest optional load on box A.

**Things to remove from the Linux image for battery use:** Bluetooth, unused USB devices, desktop services, and any logging to flash that writes constantly. The agent keeps its log under 1 MB and its queue under 2 MB.

## 7. What to measure (do this before the demo if you can)

You need a USB-C power meter that logs average power (a meter that shows only instantaneous watts works, but write down ten readings).

1. Power the hub from the meter. Boot, let it settle for 5 minutes with nothing running. Record **idle**.
2. Start the agent with the box connected. For each mode (`homebeacon-unoq cmd mode full 30`, then `eco`, `survival`, `beacon`) wait 5 minutes and record the average mW over the next 10 minutes. Note whether `apply-power-profile.sh` was applied.
3. Record the peak at an upload (a meter with a graph helps). Compare with the 1500 mJ estimate.
4. Plug box A in and out to read the **peripheral** share.
5. Enter the numbers in `[power.measured_mw]`. `homebeacon-unoq power-plan --mah ... --volts ...` now reports `bench_measurement` loads.
6. **Endurance test:** full charge, unplug wall power, run a mode, note the hour the hub stops. Compare with the plan. Repeat once more before trusting it.

Record every run: date, pack, chemistry, converter, temperature, mode, settings, mW, hours. Until a row exists here, the figure is an estimate.

| Date | Pack and converter | Mode | Measured mW | Hours to stop | Who |
| --- | --- | --- | --- | --- | --- |
| (none yet) | | | | | |

## 8. What this does not do

- It does not change CPU governor, Wi-Fi power save or Bluetooth by itself (needs root).
- It does not read a battery gauge unless one exists. Supported inputs: Linux `power_supply` entries, or a JSON file written by a gauge helper (`/run/homebeacon/battery.json`). Otherwise the config values are used and confidence is low.
- It does not shut the Uno Q down at the reserve. The heartbeat keeps running until the supply collapses. Add a shutdown policy only after the hardware cut-off behaviour is known.
- It does not predict the length of an outage. `need_hours` is a number an operator chooses.
