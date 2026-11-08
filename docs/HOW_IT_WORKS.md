# How HomeBeacon works

For judges and teammates. Plain language, end to end. Exact numbers live in [THRESHOLDS.md](THRESHOLDS.md); what a person does for each situation is in [RUNBOOK.md](RUNBOOK.md).

HomeBeacon is a home disaster black box and a neighborhood command center. Small sensor boxes record what happens at a home even when the internet is down. A person at a console sees which homes to review first. Everything is advisory: a person decides.

## What it never claims

It never says who is home, whether a building is safe to enter, how much damage there is, what insurance covers, or that anyone was dispatched. A quiet box is unknown, not safe. Flame and sound inputs are proxies, not certified detectors. Power runtime targets (24 hour design target, 72 hour stretch) are not measured.

## The path of one reading

This is the design. The hardware path is not fully bench-verified: physical power-pull, internet-removal, replay and endurance tests are listed as pending in [HARDWARE.md](HARDWARE.md).

1. **The box.** An ESP32 box reads its sensors (the planned set is water, temperature and humidity, flame, sound, external power and tilt; what is fitted varies by box) and Box A keeps a local journal on an SD card. Box A (ESP32-S3 Sense) is the flagship and the gateway. Box B (ESP32) is a second home.
2. **The mesh.** Box B sends to Box A over ESP-NOW, a short-range radio that needs no router. A gateway still needs its own internet to upload. ESP-NOW is not an internet service.
3. **The hub.** The Arduino Uno Q takes readings from Box A over USB serial, serves an offline local dashboard, and forwards to the cloud when it has internet.
4. **Ingest.** The cloud accepts readings with a per-device key. It stores the time the box saw the reading and the time the cloud received it as two separate times, so a late upload is never shown as fresh. Repeated uploads are ignored.
5. **Rules.** The risk engine turns the newest valid readings into a status for each box with plain reasons and a priority tier.
6. **Areas.** Boxes group into small map cells. A cell needs 3 or more boxes before it is reported, so one home never stands for an area.
7. **Feeds and overlays.** Cached public data (weather alerts, flood zones, river gauges, earthquakes, shelters, fire detections, air quality, grid demand) adds regional context. It can add priority points. It never changes a box status.
8. **Command center.** Operators see boxes on a map, open a box, apply fixed observation views, send short messages to boxes, and set a human help status.
9. **Customer portal.** A customer sees only their own box in plain words, never other homes, raw ids or operator notes. With no recent signal they see "no recent signal", never "normal".
10. **Messages.** Operators send short information messages. Boxes poll and pull them (boxes only dial out). Each message has a state: queued, delivered, acked, expired or cancelled.
11. **Power.** The server proposes normal, saver or critical profiles. They are proposals and are not applied to hardware yet. Alarms, logging, the help button and peer receive are never shed.
12. **AI.** NVIDIA Nemotron helps in two ways. It suggests which fixed view matches a natural-language request, and it runs a four-tool investigation that ends in a pending review draft. The server validates every output.

## Status ladder

Lowest to highest: unknown, normal, watch, elevated, critical. The highest triggered rule wins.

- Missing data is unknown.
- A stale critical reading stays critical and is shown as "last reported N minutes ago" until a newer fresh reading replaces it.
- A stale watch or elevated reading makes the box unknown with priority 70, never normal.
- A box silent for more than 15 minutes is offline. Offline alone is never critical and never normal.
- A reading outside its valid range is discarded and logged, not clamped.

Priority is separate from status. P1 (score 80 or more) is review now, P2 (40 or more) is check soon, P3 is routine. Evacuation zones, flood hazard areas, flood or fire weather alerts and heavy rain with a water signal add points, up to 100.

## Why there are several clocks

Different screens answer different questions, so they use different freshness rules. The risk ladder gives each sensor its own stale time. The map card calls a box stale after 300 seconds. The power policy treats a reading as fresh for 120 seconds. The customer email says stale or offline after 15 minutes. [THRESHOLDS.md](THRESHOLDS.md) lists all four side by side.

## Operator views and the model

A view is a read-only filter over the latest recorded observations, built from six fixed names: power_lost, water, connectivity_lost, stale, battery_low and critical. The model picks 1 to 3 names and "all" or "any". The server runs them on the recorded values and returns the evidence. The model never runs a database query and never changes a status.

## Roles and credentials

Operators, customers and devices are separate. Device keys let a box upload and pull its own messages. Operator sessions use the command center. Customer sessions see only their own box. Provider tokens stay on the server. The public demo account is read-only and sees fictional exercise data only. Secrets are never placed on boards or in the browser bundle.

## Where to read more

- Thresholds and units: [THRESHOLDS.md](THRESHOLDS.md)
- What to do in each situation: [RUNBOOK.md](RUNBOOK.md)
- The NVIDIA grounding harness and evals: [HARNESS.md](HARNESS.md)
- Risk rules: [risk.md](risk.md). Feeds: [FEEDS.md](FEEDS.md). Live polling and messages: [LIVE_DOWNLINK.md](LIVE_DOWNLINK.md)
- Hardware and power: [HARDWARE.md](HARDWARE.md), [SYSTEM_INTELLIGENCE.md](SYSTEM_INTELLIGENCE.md)
