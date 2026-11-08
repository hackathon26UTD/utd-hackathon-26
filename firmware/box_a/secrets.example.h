// Copy to secrets.h (git-ignored) or generate it with `npm run provision`.
// Never commit secrets.h.
#pragma once

#define WIFI_SSID   "your-2.4GHz-hotspot"
#define WIFI_PASS   "hotspot-password"
#define API_BASE    "https://utd-hackathon-26.pages.dev"

// From POST /api/devices (provision script). Box A uploads its own data and, as the
// gateway, box B's data with box B's key. Keys never travel over the radio.
#define BOX_A_DEVICE_ID   "000000000000000000000000"
#define BOX_A_DEVICE_KEY  "dk_..."
#define BOX_B_DEVICE_ID   "000000000000000000000000"
#define BOX_B_DEVICE_KEY  "dk_..."

// ESP-NOW encryption (AES-128). 32 hex chars each; must match box B's secrets.h.
#define ESPNOW_PMK  "00112233445566778899aabbccddeeff"
#define ESPNOW_LMK  "ffeeddccbbaa99887766554433221100"

// Box B's Wi-Fi station MAC (run `mac` on box B's serial monitor).
#define BOX_B_MAC   "AA:BB:CC:DD:EE:FF"
