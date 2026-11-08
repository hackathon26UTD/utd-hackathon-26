// HomeBeacon Uno Q sensor reader (MCU side). Flash with Arduino App Lab (or Arduino IDE, board "Arduino UNO Q").
//
// Reads the sensors wired to the Uno Q and sends one JSON line per second out of header pin D1 (TX)
// to the XIAO ESP32S3 (box A) on its D7. The XIAO puts it into the encrypted mesh / uploads it.
// The same line is printed on the USB serial monitor for debugging.
//
// Wiring (as built):
//   A0  water level sensor S        (sensor + to 3.3 V)
//   A1  flame sensor AO             (module at 3.3 V; lower value = stronger IR on most modules)
//   D13 tilt switch S               (module at 3.3 V)
//   D11 buzzer +                    (active buzzer: beeps on water or flame)
//   A4/A5 DS1307 clock (I2C SDA/SCL) (optional; reported as rtc:false if not answering)
//   D1 (TX) -> XIAO D7, GND -> XIAO GND
//
// Output line example:
//   {"src":"unoq","seq":12,"water_raw":512,"water":true,"flame_raw":980,"flame":false,"tilt":false,"rtc":false}

#include <Wire.h>

// ── calibrate these by watching the serial monitor ──
const int WATER_WET_RAW   = 300;   // water_raw at or above this = wet (dry is near 0)
const int FLAME_SEEN_RAW  = 400;   // flame_raw at or below this = flame (no flame reads high)
const int TILT_ACTIVE     = LOW;   // tilt switch level that means "tilted/shaken"
const unsigned long SEND_MS = 1000;
const bool BUZZER_ENABLED = false;      // off: pin left floating so neither active-high nor active-low modules sound
const int  BUZZER_ON_LEVEL = LOW;        // many buzzer modules sound when the pin is LOW; flip to HIGH if yours is active-high

const int PIN_WATER = A0, PIN_FLAME = A1, PIN_TILT = 13, PIN_BUZZER = 11;
const uint8_t DS1307 = 0x68;

unsigned long seq = 0, lastSend = 0;
bool rtcOk = false;

uint8_t bcd2dec(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }

bool readRtc(char *out, size_t n) {
  Wire.beginTransmission(DS1307); Wire.write(0);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(DS1307, (uint8_t)7) != 7) return false;
  uint8_t r[7]; for (int i = 0; i < 7; i++) r[i] = Wire.read();
  if (r[0] & 0x80) return false;  // clock halted: never set
  snprintf(out, n, "20%02u-%02u-%02uT%02u:%02u:%02u", bcd2dec(r[6]), bcd2dec(r[5]), bcd2dec(r[4]), bcd2dec(r[2] & 0x3F), bcd2dec(r[1]), bcd2dec(r[0] & 0x7F));
  return true;
}

int readAvg(int pin) { long s = 0; for (int i = 0; i < 8; i++) s += analogRead(pin); return s / 8; }

void setup() {
  Serial.begin(115200);    // USB serial monitor (debug)
  Serial1.begin(115200);   // header D0/D1: D1 TX -> XIAO D7
  pinMode(PIN_TILT, INPUT_PULLUP);
  if (BUZZER_ENABLED) { pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, !BUZZER_ON_LEVEL); }
  else pinMode(PIN_BUZZER, INPUT);  // silent
  Wire.begin();
  Wire.beginTransmission(DS1307); rtcOk = Wire.endTransmission() == 0;
  Serial.println(rtcOk ? "DS1307 found" : "DS1307 not answering (fine: time comes from the network)");
}

void loop() {
  if (millis() - lastSend < SEND_MS) return;
  lastSend = millis();
  int water = readAvg(PIN_WATER), flame = readAvg(PIN_FLAME);
  bool wet = water >= WATER_WET_RAW, fire = flame <= FLAME_SEEN_RAW, tilt = digitalRead(PIN_TILT) == TILT_ACTIVE;
  if (BUZZER_ENABLED) digitalWrite(PIN_BUZZER, (wet || fire) ? BUZZER_ON_LEVEL : !BUZZER_ON_LEVEL);  // local alarm

  char rtc[24] = ""; bool haveTime = rtcOk && readRtc(rtc, sizeof rtc);
  char line[200];
  snprintf(line, sizeof line,
    "{\"src\":\"unoq\",\"seq\":%lu,\"water_raw\":%d,\"water\":%s,\"flame_raw\":%d,\"flame\":%s,\"tilt\":%s,\"rtc\":%s%s%s}",
    ++seq, water, wet ? "true" : "false", flame, fire ? "true" : "false", tilt ? "true" : "false",
    haveTime ? "\"" : "", haveTime ? rtc : "false", haveTime ? "\"" : "");
  Serial1.println(line);
  Serial.println(line);
}
