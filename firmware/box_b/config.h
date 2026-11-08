// Box B hardware map: generic ESP32 dev board.
// Arduino IDE: board "ESP32 Dev Module", Tools → Partition Scheme → "Huge APP" (TLS needs the space).
// Analog inputs must be on ADC1 (GPIO 32-39); ADC2 pins stop working while the radio is on.
#pragma once

#define PIN_PIR          26   // HC-SR501 OUT (module powered from 5 V; OUT is 3.3 V, safe)
#define PIN_FLAME_DO     27   // flame sensor DO (module at 3.3 V)
#define PIN_FLAME_AO     34   // flame sensor AO (ADC1, input only)
#define PIN_TILT         25   // tilt switch S
#define PIN_MAINS_SENSE  35   // USB/wall 5 V through 10k/10k divider (ADC1, input only)
#define PIN_BATTERY      32   // 9 V AA pack through 20k/10k divider (≈3 V max) (ADC1)
#define PIN_I2C_SDA      21   // GY-521 (0x68 or 0x69), optional SSD1306 (0x3C)
#define PIN_I2C_SCL      22
#define PIN_LED           2   // on-board LED: on = no gateway heard yet (messages held)

#define USE_PIR          1
#define USE_FLAME        1
#define USE_TILT         1
#define USE_MAINS_SENSE  1
#define USE_BATTERY      1

#define FLAME_ACTIVE_LEVEL LOW    // most flame modules pull DO LOW when they see flame
#define TILT_ACTIVE_LEVEL  LOW
#define MAINS_PRESENT_MV   1800
#define BATTERY_DIVIDER    3.0f   // (20k + 10k) / 10k
#define SHAKE_MILLI_G      400
#define PIR_WARMUP_MS      60000  // HC-SR501 gives false triggers for ~30-60 s after power-up

#define SAMPLE_MS          500
#define READING_MS         10000  // periodic snapshot into the mesh
#define FALLBACK_CHANNEL   1      // must match every box
