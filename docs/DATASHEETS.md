# Component datasheets

Links checked November 7, 2026. "Key facts" are the numbers our wiring and firmware depend on; confirm against the PDF before changing a circuit. Wiring and tests: [firmware/TESTING.md](../firmware/TESTING.md).

| Part | Datasheet / reference | Key facts for us |
| --- | --- | --- |
| Seeed XIAO ESP32S3 Sense (box A) | [Seeed wiki](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/) · [ESP32-S3 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf) | 3.3 V I/O, **not 5 V tolerant**. D0–D5 are ADC1. microSD on the Sense board uses D8–D10 + CS GPIO21. Camera on its own pins (PSRAM must be OPI). |
| ESP32 dev board (box B) | [ESP32 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf) | 3.3 V I/O. ADC2 is unusable while Wi-Fi/ESP-NOW is on: analog only on GPIO 32–39. GPIO 34–39 are input-only. |
| ESP-NOW | [ESP-IDF ESP-NOW guide](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/network/esp_now.html) | 250-byte payload. Encryption: PMK + per-peer LMK (CCMP AES-128), limited number of encrypted peers. Peers must share a channel. |
| DS1307 real-time clock | [Analog Devices DS1307](https://www.analog.com/media/en/technical-documentation/data-sheets/DS1307.pdf) | **VCC 4.5–5.5 V** (not a 3.3 V part). I2C address 0x68. Seconds register bit 7 = clock halt. The breakout's pull-ups go to VCC: measure SDA/SCL before connecting to an ESP32. |
| GY-521 (MPU-6050) | [Product spec](https://cdn.sparkfun.com/datasheets/Components/General%20IC/PS-MPU-6000A.pdf) · [Register map](https://cdn.sparkfun.com/datasheets/Sensors/Accelerometers/RM-MPU-6000A.pdf) | I2C 0x68, **0x69 with AD0 high** (needed alongside the DS1307). WHO_AM_I reg 0x75 = 0x68. Wake: write 0 to 0x6B. ±2 g → 16384 LSB/g. Accel data from 0x3B. |
| SSD1306 OLED | [SSD1306 controller](https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf) | I2C 0x3C (some boards 0x3D). 128×64. |
| HC-SR501 PIR | [Adafruit PIR guide (PDF)](https://cdn-learn.adafruit.com/downloads/pdf/pir-passive-infrared-proximity-motion-sensor.pdf) | **Supply 5 V** (4.5–20 V); output 3.3 V high. Time pot ≈3 s–5 min; H = retrigger. 30–60 s warm-up with false triggers. Detects movement and heat change, not presence. |
| Flame sensor / sound sensor modules | [TI LM393 comparator](https://www.ti.com/lit/ds/symlink/lm393.pdf) | Both modules are an LM393 comparator: the blue pot sets the DO threshold; AO is the raw level. Run at 3.3 V for ESP32 inputs. The flame sensor is an IR photodiode: sunlight and IR remotes trigger it. |
| ELEGOO Power MB V2 | [AMS1117 regulator](http://www.advanced-monolithic.com/pdf/ds1117.pdf) | Linear regulators (dropout ≈1.1 V). Barrel jack 6.5–12 V; jumpers select 3.3 V or 5 V per rail. |
| Water level sensor | No manufacturer datasheet (generic module) | Exposed traces form a resistive divider into S; reading rises with immersion depth. Power only while sampling to limit electrolysis/corrosion. |
| Arduino Uno Q (hub) | [Arduino UNO Q docs](https://docs.arduino.cc/hardware/uno-q/) | Linux side runs the Python hub (`firmware/hub/hub.py`); program both sides with Arduino App Lab. |
| Tilt switch (ball type) | No datasheet (generic module) | Contact closes/opens with orientation; digital; debounce in firmware. |
