// Copy to secrets.h (git-ignored) or generate it with `npm run provision`. Never commit secrets.h.
// Every box in the neighbourhood gets the same MESH_NODES table; only MY_NODE_ID differs.
#pragma once

#define MY_NODE_ID  "A"

#define WIFI_SSID   "your-2.4GHz-hotspot"
#define WIFI_PASS   "hotspot-password"
#define API_BASE    "https://utd-hackathon-26.pages.dev"

// ESP-NOW encryption (AES-128), 32 hex chars each, identical on every box.
#define ESPNOW_PMK  "00112233445566778899aabbccddeeff"
#define ESPNOW_LMK  "ffeeddccbbaa99887766554433221100"

// { id, Wi-Fi station MAC, API device id, API device key } for every box.
// Any box with Internet uploads for the others, so each box carries every box's device key.
#define MESH_NODES { \
  { "A", "AA:BB:CC:DD:EE:01", "000000000000000000000000", "dk_placeholder_a" }, \
  { "B", "AA:BB:CC:DD:EE:02", "000000000000000000000000", "dk_placeholder_b" }, \
}
