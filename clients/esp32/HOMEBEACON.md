# HomeBeacon HTTPS telemetry

Use the existing ESP32 client for generic sensors, or this additive HomeBeacon contract. The real board and sensors have not been verified. Only the API backend connects to Atlas. `DEVICE_ID` is the ObjectId returned by registration, not a board serial number. Use the matching device key in `X-Device-Key`.

## Local/Atlas end-to-end example

Run explicit database setup first (see `docs/mongodb-architecture.md`). Set `BASE_URL`, `API_ADMIN_KEY` and later `DEVICE_KEY` locally; never print or commit secret values. Use localhost HTTP only for development; hardware uses HTTPS with a trusted root CA.

```sh
BASE_URL=http://localhost:8788
curl -fsS "$BASE_URL/api/ready"
# Read the returned home.id. Coordinates are longitude, latitude.
curl -fsS -X POST "$BASE_URL/api/beacon/homes" \
  -H "Authorization: Bearer $API_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"label":"Fictional bench home","location":{"type":"Point","coordinates":[-96.75,32.98]}}'
# Save device.id and deviceKey from this one-time response privately.
curl -fsS -X POST "$BASE_URL/api/devices" \
  -H "Authorization: Bearer $API_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"ESP32 bench device","type":"esp32"}'
# Set HOME_ID, DEVICE_ID and DEVICE_KEY locally from those responses.
curl -fsS -X PATCH "$BASE_URL/api/beacon/devices/$DEVICE_ID/home" \
  -H "Authorization: Bearer $API_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d "{\"home_id\":\"$HOME_ID\"}"
# Missing observed_at deliberately demonstrates the marked server-time fallback.
# Repeat this exact request: first duplicate=false, second duplicate=true.
curl -fsS -X POST "$BASE_URL/api/beacon/ingest" \
  -H "X-Device-Key: $DEVICE_KEY" -H 'Content-Type: application/json' \
  -d "{\"device_id\":\"$DEVICE_ID\",\"event_id\":\"bench-boot1-1\",\"sequence\":1,\"water_detected\":true,\"battery_pct\":83}"
curl -fsS "$BASE_URL/api/beacon/devices/$DEVICE_ID/telemetry" -H "Authorization: Bearer $API_ADMIN_KEY"
curl -fsS "$BASE_URL/api/beacon/homes/$HOME_ID/incidents" -H "Authorization: Bearer $API_ADMIN_KEY"
curl -fsS "$BASE_URL/api/beacon/homes/nearby?lat=32.98&lon=-96.75&radius_m=1000" -H "Authorization: Bearer $API_ADMIN_KEY"
```

## ESP32 pseudocode

```cpp
// Provision device ID, deviceKey and CA certificate through local secrets.h.
// Never use WiFiClientSecure::setInsecure(). Do not provision Atlas credentials.
onSample() {
  event = {
    device_id: DEVICE_ID,
    event_id: DEVICE_ID + "-" + persistentBootId + "-" + sequence,
    sequence: sequence++,
    observed_at: trustedUtcIsoTimestamp, // omit if clock has never synced
    temperature_c: temperature,
    humidity_pct: humidity,
    water_detected: wet,
    main_power_available: mainsAvailable,
    battery_pct: batteryPercent
  };
  persistToBoundedOfflineQueue(event); // preserve original event ID and timestamp
}
whenConnected() {
  // HTTPS POST /api/beacon/ingest, JSON, X-Device-Key: deviceKey
  response = postOldestQueuedEventWithVerifiedTLS();
  if (response.code == 202 && response.accepted) removeOldestQueuedEvent();
  // 503/network error: exponential backoff; retry the exact payload.
  // 409: back off, flag reconciliation/payload conflict for the operator.
  // 400: quarantine invalid packet; 401/403: stop and check provisioning.
}
```

Queue persistence and board firmware are pseudocode here, not flashed hardware. The backend accepts offline observations within the 30-day retention window. Send a unique event ID across reboots; sequence alone does not establish identity. Never mark a response accepted until its acknowledgement was received.
