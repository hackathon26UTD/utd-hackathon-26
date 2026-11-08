// Copy to secrets.h (git-ignored) or generate it with `npm run provision`.
// Box B never stores a cloud API key: it only talks to box A over encrypted ESP-NOW.
#pragma once

// Only used to find the hotspot's channel (box B does not join Wi-Fi).
#define WIFI_SSID   "your-2.4GHz-hotspot"

// Must match box A's secrets.h
#define ESPNOW_PMK  "00112233445566778899aabbccddeeff"
#define ESPNOW_LMK  "ffeeddccbbaa99887766554433221100"

// Box A's Wi-Fi station MAC (run `mac` on box A's serial monitor).
#define BOX_A_MAC   "AA:BB:CC:DD:EE:FF"
