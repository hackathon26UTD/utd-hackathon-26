// Box A hardware map: Seeed XIAO ESP32S3 Sense (camera + microSD expansion board).
// Board in Arduino IDE: "XIAO_ESP32S3", PSRAM: "OPI PSRAM" (needed by the camera).
#pragma once

// ── Pins (XIAO label → GPIO). D8/D9/D10 are used by the microSD card. ──
#define PIN_WATER_SIG    1   // D0  water sensor S (analog)
#define PIN_WATER_PWR    2   // D1  water sensor + (powered only while reading; prevents corrosion)
#define PIN_SOUND_DO     3   // D2  sound sensor DO
#define PIN_MAINS_SENSE  4   // D3  USB/wall 5 V through a 10k/10k divider (≈2.5 V when present)
#define PIN_I2C_SDA      5   // D4  shared I2C bus: DS1307 (0x68), GY-521 (0x69), SSD1306 (0x3C)
#define PIN_I2C_SCL      6   // D5
#define PIN_BUTTON      43   // D6  button to GND (internal pull-up). Short = help, long = OK
#define PIN_BUZZER      44   // D7  active buzzer +
#define PIN_SD_CS       21   // microSD chip select on the Sense board

// ── Feature switches: set to 0 for anything not wired, so it is reported as "not measured". ──
#define USE_MAINS_SENSE  1
#define USE_SOUND        1
#define USE_CAMERA       0   // off: privacy, power and demo risk outweigh a photo nobody sees (set 1 to re-enable)

// ── Thresholds (calibrate with the `water` and `mains` serial commands) ──
#define WATER_WET_RAW      1500   // analog 0-4095; read dry and in a cup of water, pick the midpoint
#define MAINS_PRESENT_MV   1800   // divider output above this = external power present
#define SOUND_HITS_ALARM   6      // DO triggers within SOUND_WINDOW_MS that count as a possible alarm
#define SOUND_WINDOW_MS    5000
#define SOUND_ACTIVE_LEVEL HIGH   // most modules drive DO HIGH when loud; flip if yours is inverted
#define SHAKE_MILLI_G      400    // |accel| deviation from 1 g that counts as shaking
#define LONG_PRESS_MS      2000

// ── Timing ──
#define SAMPLE_MS          2000    // read sensors
#define TELEMETRY_MS       30000   // send a full snapshot even when nothing changes

#define NODE_STALE_MS      30000   // a neighbour box is "silent" after this

// ESP-NOW channel when no box can see the hotspot. Must match on every box.
#define FALLBACK_CHANNEL   1
