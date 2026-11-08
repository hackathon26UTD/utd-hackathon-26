// HomeBeacon Box B: ESP32 dev board. Sensors only; talks to box A over encrypted ESP-NOW.
//
//  - PIR motion, flame (digital + analog), tilt switch, optional GY-521 on I2C,
//    wall-power loss and 9 V battery voltage through resistor dividers.
//  - Sends a reading every READING_MS and an event immediately on any change.
//  - AES-128 encrypted peer (PMK + LMK); only box A's MAC is a peer.
//  - Every message has (boot, seq): boot is persisted, so replays after a reboot are rejected by box A.
//  - Keeps unacknowledged messages and resends them until box A ACKs (store-and-forward in RAM).
//  - Takes the time from box A's ACKs (box B has no Wi-Fi or clock).
// Type `help` in the serial monitor (115200) for test commands.

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include <Wire.h>
#include <sys/time.h>
#include "config.h"
#include "box_protocol.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#warning "secrets.h missing: using secrets.example.h placeholders (compile check only)"
#include "secrets.example.h"
#endif

Preferences prefs;
uint32_t bootCount = 0, seq = 0;
uint8_t macA[6], pmk[16], lmk[16];
bool espnowOk = false, mpuOk = false;
uint8_t mpuAddr = 0, channel = FALLBACK_CHANNEL;
uint32_t lastAckAt = 0, acked = 0, sentCount = 0, lastReading = 0, lastSample = 0, lastResend = 0, bootMs = 0;
volatile bool ackPending = false; volatile uint32_t ackBoot = 0, ackSeq = 0, ackEpoch = 0;

struct Pending { BoxMsg msg; uint8_t tries; bool used; };
#define PENDING_MAX 32
Pending pending[PENDING_MAX];

struct State { bool motion, flame, tilt, mains, shaking; int flameRaw, accelMg, batteryMv, mainsMv; } cur = {}, prev = {};

bool timeValid() { return time(nullptr) > 1700000000; }

// ── sensors ──
bool i2cPresent(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }
uint8_t i2cRead8(uint8_t a, uint8_t reg) {
  Wire.beginTransmission(a); Wire.write(reg); if (Wire.endTransmission(false) != 0) return 0xFF;
  if (Wire.requestFrom(a, (uint8_t)1) != 1) return 0xFF; return Wire.read();
}
void detectMpu() {
  for (uint8_t a : { (uint8_t)0x68, (uint8_t)0x69 }) if (i2cPresent(a) && i2cRead8(a, 0x75) == 0x68) { mpuAddr = a; break; }
  if (!mpuAddr) return;
  Wire.beginTransmission(mpuAddr); Wire.write(0x6B); Wire.write(0); Wire.endTransmission();
  mpuOk = true;
}
int accelDevMg() {
  if (!mpuOk) return 0;
  Wire.beginTransmission(mpuAddr); Wire.write(0x3B); if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom(mpuAddr, (uint8_t)6) != 6) return 0;
  int16_t ax = (Wire.read() << 8) | Wire.read(), ay = (Wire.read() << 8) | Wire.read(), az = (Wire.read() << 8) | Wire.read();
  float g = sqrtf((float)ax * ax + (float)ay * ay + (float)az * az) / 16384.0f;
  return (int)fabsf((g - 1.0f) * 1000.0f);
}

bool pirReady() { return millis() - bootMs > PIR_WARMUP_MS; }

void sample() {
#if USE_PIR
  cur.motion = pirReady() && digitalRead(PIN_PIR) == HIGH;
#endif
#if USE_FLAME
  cur.flame = digitalRead(PIN_FLAME_DO) == FLAME_ACTIVE_LEVEL; cur.flameRaw = analogRead(PIN_FLAME_AO);
#endif
#if USE_TILT
  cur.tilt = digitalRead(PIN_TILT) == TILT_ACTIVE_LEVEL;
#endif
  cur.accelMg = accelDevMg(); cur.shaking = mpuOk && cur.accelMg >= SHAKE_MILLI_G;
#if USE_MAINS_SENSE
  cur.mainsMv = analogReadMilliVolts(PIN_MAINS_SENSE); cur.mains = cur.mainsMv >= MAINS_PRESENT_MV;
#endif
#if USE_BATTERY
  cur.batteryMv = (int)(analogReadMilliVolts(PIN_BATTERY) * BATTERY_DIVIDER);
#endif
}

// ── messages ──
BoxMsg baseMsg(uint8_t type) {
  BoxMsg m = {}; m.version = BOX_PROTOCOL_VERSION; m.type = type; strncpy(m.box, "boxB", sizeof m.box);
  m.boot = bootCount; m.seq = ++seq; m.epoch = timeValid() ? (uint32_t)time(nullptr) : 0;
  if (timeValid()) m.flags |= F_TIME_VALID;
  return m;
}

void queueMsg(const BoxMsg &m) {
  int slot = -1, oldest = -1;
  for (int i = 0; i < PENDING_MAX; i++) {
    if (!pending[i].used) { slot = i; break; }
    if (oldest < 0 || pending[i].msg.seq < pending[oldest].msg.seq) oldest = i;
  }
  if (slot < 0) slot = oldest;  // full: overwrite oldest unacked
  pending[slot] = { m, 0, true };
  esp_now_send(macA, (const uint8_t *)&pending[slot].msg, sizeof(BoxMsg));
  pending[slot].tries = 1; sentCount++;
  digitalWrite(PIN_LED, HIGH); delay(5); digitalWrite(PIN_LED, LOW);
}

void sendReading() {
  BoxMsg m = baseMsg(MSG_READING);
#if USE_PIR
  if (pirReady()) { m.flags |= F_MOTION_VALID; if (cur.motion) m.flags |= F_MOTION; }
#endif
#if USE_FLAME
  m.flags |= F_FLAME_VALID; if (cur.flame) m.flags |= F_FLAME; m.flameRaw = cur.flameRaw;
#endif
#if USE_TILT
  m.flags |= F_TILT_VALID; if (cur.tilt) m.flags |= F_TILT;
#endif
  if (mpuOk) { m.flags |= F_ACCEL_VALID; m.accelMilliG = cur.accelMg; }
#if USE_MAINS_SENSE
  m.flags |= F_MAINS_VALID; if (cur.mains) m.flags |= F_MAINS;
#endif
#if USE_BATTERY
  m.batteryMv = cur.batteryMv;
#endif
  queueMsg(m);
}

void sendEvent(const char *name) {
  BoxMsg m = baseMsg(MSG_EVENT); strncpy(m.event, name, sizeof m.event - 1);
  queueMsg(m);
  Serial.printf("[event] %s (seq %u)\n", name, m.seq);
}

// ── ESP-NOW ──
void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (memcmp(info->src_addr, macA, 6) != 0 || len != sizeof(BoxMsg)) return;
  const BoxMsg *m = (const BoxMsg *)data;
  if (m->version != BOX_PROTOCOL_VERSION || m->type != MSG_ACK) return;
  ackBoot = m->boot; ackSeq = m->seq; ackEpoch = m->epoch; ackPending = true;
}

void handleAck() {
  if (!ackPending) return;
  ackPending = false;
  lastAckAt = millis(); acked++;
  for (int i = 0; i < PENDING_MAX; i++)
    if (pending[i].used && pending[i].msg.boot == ackBoot && pending[i].msg.seq == ackSeq) pending[i].used = false;
}

void resend() {
  if (millis() - lastResend < RESEND_MS) return;
  lastResend = millis();
  for (int i = 0; i < PENDING_MAX; i++) {
    if (!pending[i].used) continue;
    if (pending[i].tries >= MAX_TRIES) { Serial.printf("[link] gave up on seq %u\n", pending[i].msg.seq); pending[i].used = false; continue; }
    esp_now_send(macA, (const uint8_t *)&pending[i].msg, sizeof(BoxMsg));
    pending[i].tries++;
  }
}

int pendingCount() { int n = 0; for (auto &p : pending) n += p.used; return n; }

void setChannel(uint8_t ch) {
  esp_wifi_set_promiscuous(true); esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE); esp_wifi_set_promiscuous(false);
  channel = ch;
}

// Box A sits on the hotspot's channel when online, or FALLBACK_CHANNEL when offline.
void findChannel() {
  int n = WiFi.scanNetworks(false, true);
  uint8_t ch = FALLBACK_CHANNEL;
  for (int i = 0; i < n; i++) if (WiFi.SSID(i) == WIFI_SSID) { ch = WiFi.channel(i); break; }
  WiFi.scanDelete();
  setChannel(ch);
  Serial.printf("[link] using channel %u%s\n", ch, ch == FALLBACK_CHANNEL ? " (fallback / hotspot not found)" : " (hotspot)");
}

bool initEspNow() {
  if (!parseMac(BOX_A_MAC, macA) || !parseKey16(ESPNOW_PMK, pmk) || !parseKey16(ESPNOW_LMK, lmk)) { Serial.println("[espnow] bad MAC/key in secrets.h"); return false; }
  if (esp_now_init() != ESP_OK) return false;
  esp_now_set_pmk(pmk);
  esp_now_peer_info_t p = {}; memcpy(p.peer_addr, macA, 6); p.channel = 0; p.ifidx = WIFI_IF_STA;
  p.encrypt = true; memcpy(p.lmk, lmk, 16);
  if (esp_now_add_peer(&p) != ESP_OK) return false;
  esp_now_register_recv_cb(onRecv);
  return true;
}

// ── serial tests ──
void cmdSensors() {
  sample();
  Serial.printf("[sensors] motion=%s flame=%d (raw %d) tilt=%d accel_dev=%d mg%s mains=%s (%d mV) battery=%d mV\n",
    pirReady() ? (cur.motion ? "YES" : "no") : "warming up", cur.flame, cur.flameRaw, cur.tilt, cur.accelMg, mpuOk ? "" : " (no GY-521)",
    cur.mains ? "present" : "LOST", cur.mainsMv, cur.batteryMv);
}

void handleSerial() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { buf += c; continue; }
    String cmd = buf; buf = ""; cmd.trim(); if (!cmd.length()) continue;
    if (cmd == "help") Serial.println(F("Commands: help | mac | i2c | sensors | watch | link | ping | channel | selftest"));
    else if (cmd == "mac") Serial.printf("[mac] %s (put this in box A's BOX_B_MAC)\n", WiFi.macAddress().c_str());
    else if (cmd == "i2c") { Serial.print("[i2c]"); for (uint8_t a = 1; a < 127; a++) if (i2cPresent(a)) Serial.printf(" 0x%02X", a); Serial.printf("  mpu=%s\n", mpuOk ? "yes" : "no"); }
    else if (cmd == "sensors") cmdSensors();
    else if (cmd == "watch") { for (int i = 0; i < 20; i++) { cmdSensors(); delay(500); } }
    else if (cmd == "link") Serial.printf("[link] channel=%u sent=%u acked=%u pending=%d last ACK %lus ago, time %s\n", channel, sentCount, acked, pendingCount(), lastAckAt ? (millis() - lastAckAt) / 1000 : 0, timeValid() ? "synced from box A" : "not set");
    else if (cmd == "ping") { sendEvent("test.ping"); uint32_t t0 = millis(); uint32_t before = acked; while (millis() - t0 < 3000 && acked == before) { handleAck(); delay(10); } Serial.printf("[ping] %s\n", acked > before ? "PASS: box A acknowledged (encrypted link works)" : "FAIL: no ACK (check MACs, keys, channel, box A powered)"); }
    else if (cmd == "channel") findChannel();
    else if (cmd == "selftest") { Serial.println("=== selftest ==="); Serial.printf("[espnow] %s\n", espnowOk ? "PASS" : "FAIL"); cmdSensors(); Serial.println("Run `ping` to test the link to box A."); }
    else Serial.println("unknown command; type help");
  }
}

void setup() {
  Serial.begin(115200); delay(1000);
  Serial.println("\nHomeBeacon box B starting");
  bootMs = millis();
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_PIR, INPUT); pinMode(PIN_FLAME_DO, INPUT); pinMode(PIN_TILT, INPUT_PULLUP);
  analogReadResolution(12);
  prefs.begin("homebeacon", false);
  bootCount = prefs.getUInt("boot", 0) + 1; prefs.putUInt("boot", bootCount);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000); detectMpu();
  WiFi.mode(WIFI_STA); WiFi.disconnect();
  findChannel();
  espnowOk = initEspNow();
  Serial.printf("boot #%u | espnow=%d mpu=%d | MAC %s | PIR warming up %d s\n", bootCount, espnowOk, mpuOk, WiFi.macAddress().c_str(), PIR_WARMUP_MS / 1000);
  sample(); prev = cur;
  sendEvent("box.boot");
}

void loop() {
  handleSerial();
  handleAck();
  if (ackEpoch && !timeValid()) { struct timeval tv = { (time_t)ackEpoch, 0 }; settimeofday(&tv, nullptr); Serial.println("[time] synced from box A"); }

  if (millis() - lastSample >= SAMPLE_MS) {
    lastSample = millis(); sample();
    if (cur.motion && !prev.motion) sendEvent("motion.detected");
    if (cur.flame != prev.flame) sendEvent(cur.flame ? "flame.detected" : "flame.cleared");
    if (cur.tilt != prev.tilt) sendEvent(cur.tilt ? "tilt.detected" : "tilt.cleared");
    if (cur.shaking && !prev.shaking) sendEvent("shaking.detected");
#if USE_MAINS_SENSE
    if (cur.mains != prev.mains) sendEvent(cur.mains ? "power.restored" : "power.lost");
#endif
    prev = cur;
  }
  if (millis() - lastReading >= READING_MS) { lastReading = millis(); sendReading(); }
  resend();

  // Lost box A (it may have changed channel when Wi-Fi dropped): rescan.
  static uint32_t lastScan = 0;
  if (millis() - (lastAckAt ? lastAckAt : bootMs) > LINK_LOST_MS && millis() - lastScan > LINK_LOST_MS) { lastScan = millis(); findChannel(); }
  digitalWrite(PIN_LED, millis() - lastAckAt > LINK_LOST_MS ? HIGH : LOW);
  delay(5);
}
