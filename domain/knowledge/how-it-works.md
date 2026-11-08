# How HomeBeacon works (short)

1. A box (ESP32) samples its sensors, keeps a local journal, and reports on a timer. It keeps recording without the cloud.
2. A second box relays over ESP-NOW to the first. A gateway needs its own internet to upload. The Arduino Uno Q hub buffers, serves a local dashboard and forwards when online.
3. Ingest accepts authenticated readings with a device key. Source time and receipt time are stored separately. Duplicates are ignored.
4. Rules turn readings into a status per box (unknown, normal, watch, elevated, critical) with plain reasons and a priority tier.
5. Areas group at least three boxes by geohash cell and report hot spots and possible outages.
6. Cached public feeds add regional context and can add priority points, never a status.
7. The command center shows boxes on a map. Operators can apply fixed observation views, send short messages to boxes, and set a human help status.
8. The customer portal shows a customer only their own box in plain words. Customers never see other homes, raw ids or operator notes.
9. Power: the server proposes normal, saver or critical profiles. They are proposals and are not yet applied to hardware. Alarms, logging, the help button and peer receive are never shed.
10. AI: Nemotron explains and suggests views. The server validates and computes. Demo data is exercise-only and read-only.
