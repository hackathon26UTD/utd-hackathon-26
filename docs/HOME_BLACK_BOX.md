# Current concept: a home disaster incident recorder

Updated November 7, 2026. This is the team's current direction, described by Ayan; it is not a validated insurance product. State Farm is the intended track, with other tracks under consideration. The exact current State Farm prompt has not yet been verified in this chat.

## What problem it solves

During a regional disaster, an insurer has reports of the weather event but incomplete, uneven information from individual properties. A home's electricity and internet may fail at the moment observations become most useful. A battery-backed box records local conditions, raises alerts while a communication path exists, and preserves an incident timeline when disconnected.

Proposed buyer/operator: insurer catastrophe-response staff or property-response teams. Homeowners benefit from earlier awareness and a retained record. Integration with State Farm, emergency dispatch, or a carrier network does not exist yet.

State Farm publicly describes mobilizing catastrophe claim teams. Property-level observations could inform where to stage outreach, inspections and recovery support. This is a proposed application of the company's stated response process, not confirmation that it wants or will deploy this product.

Reference: https://www.statefarm.com/claims/weather-catastrophe

## Define the scores by the decision they support

Prefer **response priority** over an unexplained “house risk” percentage. Keep three separate dimensions:

1. **Observed hazard indicators:** water detected/rising, temperature or air-quality anomalies, power interruption. These indicate possible active or worsening property damage; they do not establish structural safety, fire location, a probability of loss, or a dollar amount.
2. **Visibility/confidence:** last contact time, sensor health, backup-network availability, how fresh the observations are. A silent box is unknown, not safe. Retain its last known hazard and show that it is stale.
3. **Device endurance:** battery state, measured consumption, and estimated remaining runtime. A failing battery is a device condition, not proof that the house is more damaged.

Each map marker should say what happened and what to do: “water rising; mains power lost; last report 2 minutes ago; contact/inspection priority high.” Explain the reasons, rather than showing an uncalibrated 93% risk score. Weather context can raise attention but should not overwrite contradictory local measurements or make a low-confidence observation look certain.

## Why an insurer would care

- Prioritize customer outreach and inspection planning across many affected properties.
- Recognize clusters where recovery resources may be needed, while respecting safe access conditions.
- Preserve a time-stamped event record that may support claim review and customer documentation.
- Reduce the time between a local damaging condition and someone becoming aware of it, where a usable communication path exists.

Do not promise that sensor data proves causation, determines insurance coverage, prices a claim, or authorizes a payout/denial. Insurers do not automatically control emergency responders or restoration crews. A command center can suggest a follow-up and retain evidence of who acted; actual dispatch/coordination is outside this prototype.

## Occupancy and evacuation

Show `unknown`, `resident reports evacuated`, or `responder confirmed`, with the source and timestamp. Sensors cannot establish that everybody is safe or that a home is empty. An evacuation report changes the kind of follow-up; it does not erase property hazards or remove the home from the map.

## User-proposed capabilities

- Continuous low-voltage power-presence monitoring.
- Network reachability, degraded connection, and complete outage detection.
- Air-quality/temperature observations for possible fire-related anomalies.
- Water/moisture observations for flooding/leaks.
- Local inference and storage, including during WAN loss.
- Battery-backed operation and selective shutdown of nonessential functions.
- Cloud command center with device registry, neighborhood map, hazard priority, last-seen status, incident timeline and weather overlays.

These are the concept inventory, not the committed 24-hour feature list.

## The critical networking constraint

A battery keeps the box alive; it does not keep the home's router, modem, ISP or cellular network alive. A disconnected Wi-Fi box cannot report live to a remote command center without another working route.

For the prototype, explicitly choose one:

- An independently working fallback (for example a cellular connection/hotspot), demonstrated separately from home Wi-Fi; or
- Store-and-forward: timestamp and buffer locally, show stale/unknown state remotely, then replay records after reconnection.

Do not label simulated fallback, delayed records, or a buffered replay as live disaster connectivity. LoRa needs an appropriate reachable gateway and backhaul; it is not a standalone replacement for internet connectivity. Wi-Fi link quality, router reachability and internet reachability are different measurements. Frequent speed tests can waste battery and bandwidth; lightweight health checks are a better minimum demo.

## Power policy: conserve energy without hiding emergencies

The user described “cutting off limbs” to preserve critical operation. Implement this first as a deterministic state machine, with explicit transitions and observable reasons. AI may classify anomalies or summarize events; it should not be required for basic logging, a critical alert, or the power failover itself.

| State | Proposed behavior |
| --- | --- |
| Mains available | Normal sensor sampling and upload; charge a supported battery system. |
| Mains lost, no observed hazard | Turn off optional screen/camera/heavy inference, reduce radio activity and keep sampling/logging. |
| Mains lost, hazard detected | Send an immediate alert when a route exists, retain essential sensing, and transmit short priority beacons. Avoid continuous Wi-Fi polling or permanent heavy inference. |
| Battery reserve | Preserve essential measurements and incident records; use deliberately bounded communication attempts. |
| Offline | Append local records and retry on a bounded schedule; never pretend a message reached the command center. |

Separate severity from energy allocation. The objective is useful hazard information delivered over the longest feasible period, not keeping every component powered in critical conditions. A simple estimated runtime is usable battery Wh divided by measured average load W; do not claim a duration until measured on the actual hardware and duty cycle.

## Hardware implications

- A dedicated sensor controller (ESP32/Pico) suits always-on sensing and low-power logging. A Pi can provide heavier local compute if needed, but is not automatically necessary for the black-box role.
- Pi 5 was previously suggested for a touchscreen fridge app; that recommendation does not automatically carry over to this battery-first recorder.
- Confirm actual sensor types, wiring and voltages. Pi GPIO has no built-in analog input; analog moisture/smoke-proxy modules need an ADC or a microcontroller.
- Verify a proper battery power path/UPS, seamless transfer and a reliable low-voltage indication of input-power loss. An ordinary power bank may not support safe pass-through or uninterrupted transfer. Test for resets and data loss when unplugging external power.
- Never connect prototype GPIO directly to mains. Demonstrate power loss by removing a safe low-voltage supply.
- Generic air-quality/VOC or humidity sensors do not establish fire or flooding by themselves. Label proxy data correctly. The prototype is not a certified smoke alarm, rescue beacon, structural assessment instrument, or fireproof recorder.
- Validate local log durability after an unplanned restart. A queue retained only in memory disappears when the battery fails. Sequence numbers and event timestamps support replay and deduplication.
- Physical survivability and sensor placement during a real fire/flood remain unvalidated. “Black box” is a concept name, not a tested enclosure rating.

## Proposed 24-hour MVP

One physical box, two independently demonstrable observations (safe power-loss input and water detection), local durable event recording, a bounded battery mode, and a map/dashboard with several clearly labeled simulated houses plus the real device.

Single demo journey:

1. A house is online; dashboard shows fresh measurements and normal status.
2. Disconnect external low-voltage power; show verified continuity on battery and the changed power state.
3. Trigger the water sensor safely; emit an urgent hazard event and show the actual evidence on the map.
4. Disconnect internet; the dashboard becomes stale/unknown while the box continues local logging.
5. Restore connectivity; buffered events replay in order without duplicates.
6. Optionally demonstrate a measured drop in power consumption after disabling a genuinely optional component. Do not equate a UI label change with measured energy savings.

Weather overlays, additional air-quality sensing, network failover, occupancy reporting and AI explanation are stretch goals after this sequence works. There is no promise of all of them in 24 hours.

## Fit with existing code and team work

Current shared infrastructure: Cloudflare Pages/Functions, MongoDB Atlas, verified API/CLI access, and CI/CD with hosted readiness checks. The teammate's draft PR #9 proposes device registration, authenticated ingestion, rules/alerts, event history and generic storage; inspect and coordinate that work rather than rebuilding the same backend in parallel. Its conflicts are not resolved by this concept document.

Do not expose raw sensor writes or insurer control actions without authentication. The prototype should use synthetic property addresses/coordinates for the map; no customer/home registry has been provided or verified.

## Decisions still needed

- Exact State Farm challenge and required submission criteria.
- Hardware currently secured, including battery/UPS and available sensor interfaces.
- Whether the MVP uses only a microcontroller, only a Pi, or both.
- Connectivity demo: real fallback or honestly labeled offline replay.
- Target response action and priority labels; no unsupported damage probabilities.
- Which teammate owns firmware, backend ingestion, dashboard/map, and integration/demo.
