# Hardware plan, constraints, and observed inventory

No hardware has been requested or reserved through this chat. Product and final board remain undecided. Stock below is a November 7, 2026 snapshot from signed-in HARP and can change at any time.

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
