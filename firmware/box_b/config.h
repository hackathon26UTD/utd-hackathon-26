// Box B hardware map: Seeed XIAO ESP32-C3 (antenna attached!).
// Arduino IDE: board "XIAO_ESP32C3", USB CDC On Boot "Enabled", Partition Scheme "Huge APP".
//
// For the demo box B carries NO sensors: it is a mesh node that relays/originates heartbeats
// (box.boot, a reading every READING_MS, `ping`) so the AES ESP-NOW mesh and gateway failover can
// be shown. Every sensor sits behind a USE_* switch, all 0. To add one later: wire it (3.3 V only),
// set its switch to 1 and rebuild.
//
// C3 pins: D0=GPIO2 D1=GPIO3 D2=GPIO4 D3=GPIO5 D4=GPIO6(SDA) D5=GPIO7(SCL) D6=GPIO21 D7=GPIO20
//          D8=GPIO8 D9=GPIO9 D10=GPIO10. Analog only on D0-D2 (ADC1). D8/D9 are strapping pins
//          (D9 = BOOT button): don't pull them low at boot. No user LED on the XIAO C3.
#pragma once

#define PIN_PIR          D3   // HC-SR501 OUT (module on 5 V; OUT is 3.3 V, safe)
#define PIN_FLAME_DO     D6   // flame sensor DO (module at 3.3 V)
#define PIN_FLAME_AO     D0   // flame sensor AO (ADC1)
#define PIN_TILT         D7   // tilt switch S (internal pull-up)
#define PIN_MAINS_SENSE  D1   // 3.3 V from a wall-powered source (ADC1); ≥ MAINS_PRESENT_MV = present
#define PIN_BATTERY      D2   // 9 V pack through 20k/10k divider (≈3 V max) (ADC1)
#define PIN_I2C_SDA      D4   // GY-521 (0x68 or 0x69)
#define PIN_I2C_SCL      D5
#define PIN_LED          -1   // XIAO C3 has no user LED; set a GPIO here to get the "no gateway" LED

#define USE_PIR          0
#define USE_FLAME        0
#define USE_TILT         0
#define USE_MPU          0
#define USE_MAINS_SENSE  0
#define USE_BATTERY      0

#define FLAME_ACTIVE_LEVEL LOW    // most flame modules pull DO LOW when they see flame
#define TILT_ACTIVE_LEVEL  LOW
#define MAINS_PRESENT_MV   1800
#define BATTERY_DIVIDER    3.0f   // (20k + 10k) / 10k
#define SHAKE_MILLI_G      400
#define PIR_WARMUP_MS      60000  // HC-SR501 gives false triggers for ~30-60 s after power-up

// Demo: box B never joins Wi-Fi or uploads. Everything it sends (box.boot, heartbeats, ping)
// travels over the mesh to box A, which uploads it. It still scans for the hotspot (WIFI_SSID)
// to sit on the same channel as box A. Set 1 to let it become a gateway itself (failover).
#define CAN_BE_GATEWAY     0
#define CHANNEL_SCAN_MS    30000  // relay-only: re-scan for the hotspot channel while no gateway is heard

#define SAMPLE_MS          500
#define READING_MS         10000  // periodic snapshot (heartbeat) into the mesh
#define FALLBACK_CHANNEL   1      // must match every box
