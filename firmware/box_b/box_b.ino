// HomeBeacon Box B (and any extra ESP32 box: C, D... set MY_NODE_ID). Sensors on the box mesh.
//
//  - PIR motion, flame (digital + analog), tilt, optional GY-521 on I2C, wall-power loss and
//    9 V battery voltage through resistor dividers.
//  - Mesh (common/mesh.h): AES-128 ESP-NOW to every provisioned box. Messages hop box to box until
//    a box with Internet acknowledges them; unacknowledged messages are kept and re-sent.
//  - Uplink (common/uplink.h): if this box finds Wi-Fi with working Internet it becomes a gateway
//    and uploads for the whole neighbourhood (RAM queue, verified HTTPS).
// Board: ESP32 Dev Module, Partition Scheme "Huge APP". Type `help` in the serial monitor.

#include <Wire.h>
#include "config.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#warning "secrets.h missing: using secrets.example.h placeholders (compile check only)"
#include "secrets.example.h"
#endif
#include "mesh.h"
#include "uplink.h"

static const MeshNodeCfg NODES[] = MESH_NODES;
constexpr int NODE_COUNT = sizeof(NODES) / sizeof(NODES[0]);

bool mpuOk = false; uint8_t mpuAddr = 0;
uint32_t lastReading = 0, lastSample = 0, bootMs = 0;
struct State { bool motion, flame, tilt, mains, shaking; int flameRaw, accelMg, batteryMv, mainsMv; } cur = {}, prev = {};

// ── sensors ──
bool i2cPresent(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }
uint8_t i2cRead8(uint8_t a, uint8_t reg) { Wire.beginTransmission(a); Wire.write(reg); if (Wire.endTransmission(false) != 0) return 0xFF; if (Wire.requestFrom(a, (uint8_t)1) != 1) return 0xFF; return Wire.read(); }
void detectMpu() {
  for (uint8_t a : { (uint8_t)0x68, (uint8_t)0x69 }) if (i2cPresent(a) && i2cRead8(a, 0x75) == 0x68) { mpuAddr = a; break; }
  if (!mpuAddr) return;
  Wire.beginTransmission(mpuAddr); Wire.write(0x6B); Wire.write(0); Wire.endTransmission(); mpuOk = true;
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

// ── mesh ──
void fillState(MeshMsg &m) {
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
}
void sendReading() { MeshMsg m = {}; m.type = MSG_READING; fillState(m); mesh::send(m); }
void sendEvent(const char *name) { MeshMsg m = {}; m.type = MSG_EVENT; strncpy(m.event, name, sizeof m.event - 1); fillState(m); mesh::send(m); Serial.printf("[event] %s\n", name); }

void observe(const MeshMsg &m, bool own) {
  if (!own) Serial.printf("[mesh] %s from box %s seq %u (%u hops)%s\n", m.type == MSG_EVENT ? m.event : "reading", m.origin, m.seq, m.hops, mesh::isOnline ? " -> uploading" : " -> relayed");
}
bool deliver(const MeshMsg &m) { return uplink::enqueueMsg(m); }
void setClock(uint32_t epoch) { struct timeval tv = { (time_t)epoch, 0 }; settimeofday(&tv, nullptr); Serial.println("[time] set from mesh gateway"); }

// ── serial tests ──
void cmdSensors() {
  sample();
  Serial.printf("[sensors] motion=%s flame=%d (raw %d) tilt=%d accel_dev=%d mg%s mains=%s (%d mV) battery=%d mV\n",
    pirReady() ? (cur.motion ? "YES" : "no") : "warming up", cur.flame, cur.flameRaw, cur.tilt, cur.accelMg, mpuOk ? "" : " (no GY-521)",
    cur.mains ? "present" : "LOST", cur.mainsMv, cur.batteryMv);
}
void cmdPing() {
  uint32_t before = mesh::statAcked;
  MeshMsg m = {}; m.type = MSG_EVENT; strncpy(m.event, "test.ping", 23); mesh::send(m);
  if (mesh::isOnline) { Serial.println("[ping] this box is the gateway: delivered locally (PASS)"); return; }
  uint32_t t0 = millis(); while (millis() - t0 < 6000 && mesh::statAcked == before) { mesh::loop(); delay(10); }
  Serial.printf("[ping] %s\n", mesh::statAcked > before ? (String("PASS: acknowledged by gateway ") + mesh::gatewayId).c_str() : "no ACK yet: no box has Internet, or keys/MACs/channel differ (message is held and retried)");
}
void handleSerial() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read(); if (c != '\n' && c != '\r') { buf += c; continue; }
    String cmd = buf; buf = ""; cmd.trim(); if (!cmd.length()) continue;
    if (cmd == "help") Serial.println(F("Commands: help | mac | i2c | sensors | watch | mesh | ping | wifi | api | queue | selftest"));
    else if (cmd == "mac") Serial.printf("[mac] %s\n", WiFi.macAddress().c_str());
    else if (cmd == "i2c") { Serial.print("[i2c]"); for (uint8_t a = 1; a < 127; a++) if (i2cPresent(a)) Serial.printf(" 0x%02X", a); Serial.printf("  mpu=%s\n", mpuOk ? "yes" : "no"); }
    else if (cmd == "sensors") cmdSensors();
    else if (cmd == "watch") { for (int i = 0; i < 20; i++) { cmdSensors(); delay(500); } }
    else if (cmd == "mesh") mesh::printStatus();
    else if (cmd == "ping") cmdPing();
    else if (cmd == "wifi") Serial.printf("[wifi] %s ch=%d internet=%s\n", uplink::wifiUp() ? "connected" : "offline", WiFi.channel(), uplink::apiHealthy ? "yes" : "no");
    else if (cmd == "api") { const MeshNodeCfg *n = mesh::nodeCfg(MY_NODE_ID); if (n) uplink::selftest(n->deviceId, n->deviceKey); }
    else if (cmd == "queue") Serial.printf("[queue] %u uploads waiting (RAM); %d own messages waiting for a gateway ACK\n", (unsigned)uplink::queued(), mesh::pendingCount());
    else if (cmd == "selftest") { Serial.println("=== selftest ==="); Serial.printf("[mesh] %s\n", mesh::ready ? "PASS" : "FAIL"); cmdSensors(); mesh::printStatus(); Serial.println("Run `ping` to test delivery through the mesh."); }
    else Serial.println("unknown command; type help");
  }
}

void setup() {
  Serial.begin(115200); delay(1000);
  Serial.println("\nHomeBeacon box " MY_NODE_ID " (ESP32) starting");
  bootMs = millis();
  pinMode(PIN_LED, OUTPUT); pinMode(PIN_PIR, INPUT); pinMode(PIN_FLAME_DO, INPUT); pinMode(PIN_TILT, INPUT_PULLUP);
  analogReadResolution(12);
  setenv("TZ", "UTC0", 1); tzset();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000); detectMpu();
  WiFi.mode(WIFI_STA);
  mesh::onDeliver = deliver; mesh::onObserve = observe; mesh::onTime = setClock;
  mesh::begin(MY_NODE_ID, NODES, NODE_COUNT, ESPNOW_PMK, ESPNOW_LMK);
  uplink::begin(WIFI_SSID, WIFI_PASS, API_BASE, false, FALLBACK_CHANNEL);
  Serial.printf("boot #%u | mesh=%d (%d boxes) mpu=%d | MAC %s | PIR warming up %d s\n", mesh::bootCount, mesh::ready, NODE_COUNT, mpuOk, WiFi.macAddress().c_str(), PIR_WARMUP_MS / 1000);
  sample(); prev = cur;
  sendEvent("box.boot");
}

void loop() {
  handleSerial();
  mesh::loop();
  uplink::loop();
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
  digitalWrite(PIN_LED, (mesh::isOnline || mesh::gatewayKnown()) ? LOW : HIGH);
  delay(5);
}
