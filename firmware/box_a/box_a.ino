// HomeBeacon Box A: XIAO ESP32S3 Sense. Sensors + camera + microSD black box, on the box mesh.
//
//  - Sensors: water (powered only while sampling), sound (possible alarm), wall-power loss,
//    button (short = help, long = OK), buzzer, and the shared I2C bus: DS1307 clock (0x68),
//    GY-521 accelerometer (0x69), SSD1306 OLED (0x3C), auto-detected.
//  - Mesh (common/mesh.h): talks to every provisioned box over AES-128 ESP-NOW. If this box has
//    Internet it is a gateway and uploads for everyone; if not, its messages hop through other
//    boxes until one with Internet acknowledges them. Nothing is dropped while waiting.
//  - Uplink (common/uplink.h): verified HTTPS, upload queue on microSD (/queue.txt).
//  - Black box: every message this box sees goes to /log.csv; photos to /img on events.
//  - USB serial: `HB {json}` lines for the Uno Q hub. Type `help` for test commands.
//
// Board: XIAO_ESP32S3, PSRAM: OPI PSRAM. Libraries: ArduinoJson 7, Adafruit SSD1306 + GFX.

#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#warning "secrets.h missing: using secrets.example.h placeholders (compile check only)"
#include "secrets.example.h"
#endif
#include "mesh.h"
#include "uplink.h"
#include "local_history.h"
#include "history_sync.h"
#if USE_CAMERA
#include "esp_camera.h"
#endif

static const MeshNodeCfg NODES[] = MESH_NODES;
constexpr int NODE_COUNT = sizeof(NODES) / sizeof(NODES[0]);

bool sdOk = false, camOk = false, oledOk = false, rtcOk = false, mpuOk = false;
uint8_t mpuAddr = 0;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

struct Snapshot { int waterRaw = 0; bool water = false; bool mainsValid = false, mains = true; int mainsMv = 0; int accelMg = 0; bool shaking = false; int soundHits = 0; } cur, prev;
uint32_t lastSample = 0, lastTelemetry = 0, soundWindowStart = 0, buttonDownAt = 0;
int soundHitsWindow = 0, lastSoundLevel = -1; bool buttonWasDown = false;
uint32_t lastHeard[mesh::MAX_NODES] = {0}; bool silentFlagged[mesh::MAX_NODES] = {false};

// ───────── time (DS1307 optional) ─────────
uint8_t bcd2dec(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }
uint8_t dec2bcd(uint8_t v) { return ((v / 10) << 4) | (v % 10); }
bool rtcRead(uint32_t &epoch) {
  Wire.beginTransmission(0x68); Wire.write(0); if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(0x68, 7) != 7) return false;
  uint8_t r[7]; for (int i = 0; i < 7; i++) r[i] = Wire.read();
  if (r[0] & 0x80) return false;  // clock halted (never set)
  struct tm t = {}; t.tm_sec = bcd2dec(r[0] & 0x7F); t.tm_min = bcd2dec(r[1]); t.tm_hour = bcd2dec(r[2] & 0x3F);
  t.tm_mday = bcd2dec(r[4]); t.tm_mon = bcd2dec(r[5]) - 1; t.tm_year = bcd2dec(r[6]) + 100;
  time_t e = mktime(&t); if (e < 1700000000) return false; epoch = e; return true;
}
void rtcWrite(uint32_t epoch) {
  time_t t = epoch; struct tm v; gmtime_r(&t, &v);
  Wire.beginTransmission(0x68); Wire.write(0);
  Wire.write(dec2bcd(v.tm_sec)); Wire.write(dec2bcd(v.tm_min)); Wire.write(dec2bcd(v.tm_hour)); Wire.write(dec2bcd(v.tm_wday + 1));
  Wire.write(dec2bcd(v.tm_mday)); Wire.write(dec2bcd(v.tm_mon + 1)); Wire.write(dec2bcd(v.tm_year - 100)); Wire.endTransmission();
}
void setClock(uint32_t epoch) { struct timeval tv = { (time_t)epoch, 0 }; settimeofday(&tv, nullptr); Serial.println("[time] set from mesh gateway"); }

// ───────── I2C ─────────
bool i2cPresent(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }
uint8_t i2cRead8(uint8_t a, uint8_t reg) { Wire.beginTransmission(a); Wire.write(reg); if (Wire.endTransmission(false) != 0) return 0xFF; if (Wire.requestFrom(a, (uint8_t)1) != 1) return 0xFF; return Wire.read(); }
void i2cWrite8(uint8_t a, uint8_t reg, uint8_t v) { Wire.beginTransmission(a); Wire.write(reg); Wire.write(v); Wire.endTransmission(); }
void detectI2C() {
  // GY-521: wire AD0 to 3.3 V so it answers at 0x69 and does not collide with the DS1307 at 0x68.
  if (i2cPresent(0x69) && i2cRead8(0x69, 0x75) == 0x68) mpuAddr = 0x69;
  if (i2cPresent(0x68)) { if (!mpuAddr && i2cRead8(0x68, 0x75) == 0x68) mpuAddr = 0x68; else rtcOk = true; }
  if (mpuAddr) { i2cWrite8(mpuAddr, 0x6B, 0x00); i2cWrite8(mpuAddr, 0x1C, 0x00); mpuOk = true; }
  if (i2cPresent(0x3C) && oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { oledOk = true; oled.clearDisplay(); oled.display(); }
}
int readAccelDeviationMg() {
  if (!mpuOk) return -1;
  Wire.beginTransmission(mpuAddr); Wire.write(0x3B); if (Wire.endTransmission(false) != 0) return -1;
  if (Wire.requestFrom(mpuAddr, (uint8_t)6) != 6) return -1;
  int16_t ax = (Wire.read() << 8) | Wire.read(), ay = (Wire.read() << 8) | Wire.read(), az = (Wire.read() << 8) | Wire.read();
  float g = sqrtf((float)ax * ax + (float)ay * ay + (float)az * az) / 16384.0f;
  return (int)fabsf((g - 1.0f) * 1000.0f);
}

// ───────── sensors ─────────
int readWaterRaw() {
  digitalWrite(PIN_WATER_PWR, HIGH); delay(10);
  long sum = 0; for (int i = 0; i < 8; i++) sum += analogRead(PIN_WATER_SIG);
  digitalWrite(PIN_WATER_PWR, LOW); return sum / 8;
}
void sampleSensors() {
  cur.waterRaw = readWaterRaw(); cur.water = cur.waterRaw >= WATER_WET_RAW;
#if USE_MAINS_SENSE
  cur.mainsMv = analogReadMilliVolts(PIN_MAINS_SENSE); cur.mainsValid = true; cur.mains = cur.mainsMv >= MAINS_PRESENT_MV;
#endif
  cur.accelMg = readAccelDeviationMg(); cur.shaking = mpuOk && cur.accelMg >= SHAKE_MILLI_G;
}
void pollSound() {
#if USE_SOUND
  int lvl = digitalRead(PIN_SOUND_DO);
  if (lvl != lastSoundLevel) { if (lvl == SOUND_ACTIVE_LEVEL) soundHitsWindow++; lastSoundLevel = lvl; }
#endif
}
void beep(int times, int onMs = 120) { for (int i = 0; i < times; i++) { digitalWrite(PIN_BUZZER, HIGH); delay(onMs); digitalWrite(PIN_BUZZER, LOW); delay(onMs); } }

// ───────── camera ─────────
#if USE_CAMERA
bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0; c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = 15; c.pin_d1 = 17; c.pin_d2 = 18; c.pin_d3 = 16; c.pin_d4 = 14; c.pin_d5 = 12; c.pin_d6 = 11; c.pin_d7 = 48;
  c.pin_xclk = 10; c.pin_pclk = 13; c.pin_vsync = 38; c.pin_href = 47; c.pin_sccb_sda = 40; c.pin_sccb_scl = 39;
  c.pin_pwdn = -1; c.pin_reset = -1; c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG; c.frame_size = FRAMESIZE_SVGA; c.jpeg_quality = 12; c.fb_count = 1;
  c.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM; c.grab_mode = CAMERA_GRAB_LATEST;
  return esp_camera_init(&c) == ESP_OK;
}
#endif
String snapshot(const char *reason) {
#if USE_CAMERA
  if (!camOk || !sdOk) return "";
  camera_fb_t *fb = esp_camera_fb_get(); if (!fb) return "";
  if (!SD.exists("/img")) SD.mkdir("/img");
  String path = "/img/" + String(mesh::bootCount) + "-" + String(millis()) + "-" + reason + ".jpg";
  File f = SD.open(path, FILE_WRITE); bool ok = f; if (f) { f.write(fb->buf, fb->len); f.close(); }
  esp_camera_fb_return(fb); return ok ? path : "";
#else
  return "";
#endif
}

// ───────── mesh callbacks ─────────
void logLine(const String &line) { if (sdOk) { File f = SD.open("/log.csv", FILE_APPEND); if (f) { f.println(line); f.close(); } } }

int nodeIndex(const char *id) { for (int i = 0; i < mesh::nodeCount; i++) if (!strncmp(mesh::nodes[i].id, id, NODE_ID_LEN)) return i; return -1; }

// Every new reading/event this box sees (own or relayed): black-box log + hub line.
void observe(const MeshMsg &m, bool own) {
  local_history::observe(m, own);
  int i = nodeIndex(m.origin); if (i >= 0) { lastHeard[i] = millis(); silentFlagged[i] = false; }
  logLine(String(m.epoch) + "," + millis() + "," + m.origin + "," + (m.type == MSG_EVENT ? "event" : "reading") + "," + m.boot + "," + m.seq + "," + m.hops + "," +
          m.flags + "," + m.waterRaw + "," + m.flameRaw + "," + m.accelMilliG + "," + m.batteryMv + "," + m.event);
  JsonDocument h; h["box"] = m.origin; h["type"] = m.type == MSG_EVENT ? "event" : "reading"; h["seq"] = m.seq; h["hops"] = m.hops; h["epoch"] = m.epoch;
  if (m.type == MSG_EVENT) h["event"] = m.event;
  if (m.flags & F_WATER_VALID) h["water"] = (bool)(m.flags & F_WATER);
  if (m.flags & F_MAINS_VALID) h["mains"] = (bool)(m.flags & F_MAINS);
  if (m.flags & F_MOTION_VALID) h["motion"] = (bool)(m.flags & F_MOTION);
  if (m.flags & F_FLAME_VALID) h["flame"] = (bool)(m.flags & F_FLAME);
  if (m.batteryMv) h["battery_mv"] = m.batteryMv;
  h["gateway"] = mesh::isOnline ? mesh::myId : (mesh::gatewayKnown() ? mesh::gatewayId : "none");
  Serial.print("HB "); serializeJson(h, Serial); Serial.println();
  if (!own && m.type == MSG_EVENT) {
    Serial.printf("[event] box %s: %s (%u hops)\n", m.origin, m.event, m.hops);
    if (!strncmp(m.event, "flame", 5)) { snapshot("flame_remote"); beep(3, 80); }
  }
}
bool deliver(const MeshMsg &m) { return uplink::enqueueMsg(m); }

// ───────── sending ─────────
void sendReading() {
  MeshMsg m = {}; m.type = MSG_READING;
  m.flags |= F_WATER_VALID; if (cur.water) m.flags |= F_WATER; m.waterRaw = cur.waterRaw;
  if (cur.mainsValid) { m.flags |= F_MAINS_VALID; if (cur.mains) m.flags |= F_MAINS; }
  if (mpuOk && cur.accelMg >= 0) { m.flags |= F_ACCEL_VALID; m.accelMilliG = cur.accelMg; }
#if USE_SOUND
  m.flags |= F_SOUND_VALID; m.soundHits = cur.soundHits;
#endif
  mesh::send(m);
}
void sendEvent(const char *name, bool photo = false) {
  String img = photo ? snapshot(name) : "";
  MeshMsg m = {}; m.type = MSG_EVENT; strncpy(m.event, name, sizeof m.event - 1);
  if (cur.mainsValid) { m.flags |= F_MAINS_VALID; if (cur.mains) m.flags |= F_MAINS; }
  m.flags |= F_WATER_VALID; if (cur.water) m.flags |= F_WATER;
  mesh::send(m);
  Serial.printf("[event] %s%s\n", name, img.length() ? (" photo " + img).c_str() : "");
}

// ───────── display ─────────
void drawOled() {
  if (!oledOk) return;
  static uint32_t last = 0; if (millis() - last < 1000) return; last = millis();
  oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE); oled.setCursor(0, 0);
  oled.printf("HomeBeacon box %s\n", mesh::myId);
  oled.printf("Net:%s q:%u\n", mesh::isOnline ? "GATEWAY" : uplink::wifiUp() ? "no internet" : "offline", (unsigned)uplink::queued());
  oled.printf("Mesh gw:%s p:%d\n", mesh::isOnline ? "me" : mesh::gatewayKnown() ? mesh::gatewayId : "none", mesh::pendingCount());
  oled.printf("Water:%s (%d)\n", cur.water ? "WET" : "dry", cur.waterRaw);
  oled.printf("Power:%s\n", !cur.mainsValid ? "n/a" : cur.mains ? "wall" : "BATTERY");
  oled.printf("%s", mesh::timeValid() ? uplink::isoTime(mesh::nowEpoch()).substring(11, 19).c_str() : "time not set");
  oled.display();
}

// ───────── serial tests ─────────
void printHelp() { Serial.println(F("Commands: help | mac | i2c | sensors | water | mains | sound | button | beep | sd | cam | wifi | time | api | mesh | ping | history | queue | selftest")); }
void cmdI2C() { Serial.print("[i2c] found:"); for (uint8_t a = 1; a < 127; a++) if (i2cPresent(a)) Serial.printf(" 0x%02X", a); Serial.printf("  rtc=%d mpu=%s oled=%d\n", rtcOk, mpuOk ? (mpuAddr == 0x69 ? "0x69" : "0x68") : "no", oledOk); }
bool cmdSd() {
  if (!sdOk) { Serial.println("[sd] FAIL: no card (FAT32, <=32 GB, seated in the Sense board)"); return false; }
  File f = SD.open("/selftest.txt", FILE_WRITE); bool ok = f && f.print("ok"); if (f) f.close();
  f = SD.open("/selftest.txt"); String s = f ? f.readString() : ""; if (f) f.close(); SD.remove("/selftest.txt");
  ok = ok && s == "ok"; Serial.printf("[sd] %s, %llu MB\n", ok ? "PASS" : "FAIL write/read", SD.cardSize() / (1024 * 1024)); return ok;
}
void cmdSensors() {
  sampleSensors();
  Serial.printf("[sensors] water_raw=%d wet=%d | mains=%s (%d mV) | accel_dev=%d mg%s | sound_do=%d | button=%s\n", cur.waterRaw, cur.water,
    cur.mainsValid ? (cur.mains ? "present" : "LOST") : "n/a", cur.mainsMv, cur.accelMg, mpuOk ? "" : " (no GY-521)", digitalRead(PIN_SOUND_DO), digitalRead(PIN_BUTTON) == LOW ? "pressed" : "up");
}
const MeshNodeCfg *selfCfg() { return mesh::nodeCfg(MY_NODE_ID); }
void cmdPing() {
  uint32_t before = mesh::statAcked; mesh::send([] { MeshMsg m = {}; m.type = MSG_EVENT; strncpy(m.event, "test.ping", 23); return m; }());
  if (mesh::isOnline) { Serial.println("[ping] this box is the gateway: delivered locally (PASS)"); return; }
  uint32_t t0 = millis(); while (millis() - t0 < 6000 && mesh::statAcked == before) { mesh::loop(); delay(10); }
  Serial.printf("[ping] %s\n", mesh::statAcked > before ? (String("PASS: acknowledged by gateway ") + mesh::gatewayId).c_str() : "no ACK yet: no box has Internet (message is held and will retry)");
}
void selftest() {
  Serial.println("=== selftest ===");
  cmdI2C(); bool sd = cmdSd();
  Serial.printf("[cam] %s\n", camOk ? "PASS" : (USE_CAMERA ? "FAIL (seat camera board, PSRAM: OPI)" : "disabled"));
  cmdSensors(); mesh::printStatus();
  Serial.printf("[time] %s\n", mesh::timeValid() ? uplink::isoTime(mesh::nowEpoch()).c_str() : "not set");
  int api = selfCfg() ? uplink::selftest(selfCfg()->deviceId, selfCfg()->deviceKey) : -1;
  Serial.printf("=== %s ===\n", sd && api == 202 && mesh::ready ? "core PASS" : "see FAIL lines above");
}
void handleSerial() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read(); if (c != '\n' && c != '\r') { buf += c; continue; }
    String cmd = buf; buf = ""; cmd.trim(); if (!cmd.length()) continue;
    if (cmd == "help") printHelp();
    else if (cmd == "mac") Serial.printf("[mac] %s\n", WiFi.macAddress().c_str());
    else if (cmd == "i2c") cmdI2C();
    else if (cmd == "sensors") cmdSensors();
    else if (cmd == "water") { for (int i = 0; i < 10; i++) { Serial.printf("[water] raw=%d (threshold %d)\n", readWaterRaw(), WATER_WET_RAW); delay(300); } }
    else if (cmd == "mains") { for (int i = 0; i < 10; i++) { Serial.printf("[mains] %d mV (present >= %d)\n", analogReadMilliVolts(PIN_MAINS_SENSE), MAINS_PRESENT_MV); delay(300); } }
    else if (cmd == "sound") { int hits = 0, last = digitalRead(PIN_SOUND_DO); uint32_t t0 = millis(); while (millis() - t0 < 5000) { int l = digitalRead(PIN_SOUND_DO); if (l != last && l == SOUND_ACTIVE_LEVEL) hits++; last = l; } Serial.printf("[sound] %d triggers in 5 s (alarm needs %d)\n", hits, SOUND_HITS_ALARM); }
    else if (cmd == "button") { Serial.println("[button] press within 5 s"); uint32_t t0 = millis(); bool seen = false; while (millis() - t0 < 5000) if (digitalRead(PIN_BUTTON) == LOW) { seen = true; break; } Serial.printf("[button] %s\n", seen ? "PASS" : "not pressed"); }
    else if (cmd == "beep") beep(2);
    else if (cmd == "sd") cmdSd();
    else if (cmd == "cam") { String p = snapshot("test"); Serial.printf("[cam] %s\n", p.length() ? ("saved " + p).c_str() : "FAIL (camera or SD missing)"); }
    else if (cmd == "wifi") Serial.printf("[wifi] %s ch=%d rssi=%d internet=%s\n", uplink::wifiUp() ? "connected" : "offline", WiFi.channel(), WiFi.RSSI(), uplink::apiHealthy ? "yes" : "no");
    else if (cmd == "time") Serial.printf("[time] %s rtc=%d\n", mesh::timeValid() ? uplink::isoTime(mesh::nowEpoch()).c_str() : "not set", rtcOk);
    else if (cmd == "api") { if (selfCfg()) uplink::selftest(selfCfg()->deviceId, selfCfg()->deviceKey); }
    else if (cmd == "mesh") mesh::printStatus();
    else if (cmd == "ping") cmdPing();
    else if (cmd == "history") { local_history::print(); history_sync::print(); }
    else if (cmd == "queue") Serial.printf("[queue] %u uploads waiting (%s); %d own messages waiting for a gateway ACK\n", (unsigned)uplink::queued(), sdOk ? "SD" : "RAM", mesh::pendingCount());
    else if (cmd == "selftest") selftest();
    else Serial.println("unknown command; type help");
  }
}

// ───────── setup / loop ─────────
void setup() {
  Serial.begin(115200); delay(1500);
  Serial.println("\nHomeBeacon box " MY_NODE_ID " (XIAO ESP32S3 Sense) starting");
  pinMode(PIN_WATER_PWR, OUTPUT); digitalWrite(PIN_WATER_PWR, LOW);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_BUTTON, INPUT_PULLUP); pinMode(PIN_SOUND_DO, INPUT);
  analogReadResolution(12);
  setenv("TZ", "UTC0", 1); tzset();

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000); detectI2C();
  uint32_t rtcEpoch; if (rtcOk && rtcRead(rtcEpoch)) { setClock(rtcEpoch); Serial.println("[rtc] time loaded from DS1307"); }
  sdOk = SD.begin(PIN_SD_CS);
#if USE_CAMERA
  camOk = initCamera();
#endif

  uint32_t historyFlags = F_WATER_VALID | F_MAINS_VALID;
#if USE_SOUND
  historyFlags |= F_SOUND_VALID;
#endif
  if (mpuOk) historyFlags |= F_ACCEL_VALID;

  WiFi.mode(WIFI_STA);
  mesh::onDeliver = deliver; mesh::onObserve = observe; mesh::onTime = setClock;
  mesh::begin(MY_NODE_ID, NODES, NODE_COUNT, ESPNOW_PMK, ESPNOW_LMK);
  const MeshNodeCfg *historyNode = mesh::nodeCfg(MY_NODE_ID);
  local_history::begin({historyFlags, false, SHAKE_MILLI_G, SOUND_HITS_ALARM}, historyNode ? historyNode->deviceId : nullptr);
  uplink::begin(WIFI_SSID, WIFI_PASS, API_BASE, sdOk, FALLBACK_CHANNEL);

  Serial.printf("boot #%u | sd=%d cam=%d rtc=%d mpu=%d oled=%d mesh=%d (%d boxes) | MAC %s\n", mesh::bootCount, sdOk, camOk, rtcOk, mpuOk, oledOk, mesh::ready, NODE_COUNT, WiFi.macAddress().c_str());
  printHelp();
  sendEvent("box.boot");
  beep(1);
}

void loop() {
  handleSerial();
  local_history::loop();
  mesh::loop();
  uplink::loop();
  history_sync::loop();
  pollSound();

  bool down = digitalRead(PIN_BUTTON) == LOW;
  if (down && !buttonWasDown) buttonDownAt = millis();
  if (!down && buttonWasDown && millis() - buttonDownAt > 50) {
    if (millis() - buttonDownAt >= LONG_PRESS_MS) { sendEvent("ok.report"); beep(1, 300); }
    else { sendEvent("help.request", true); beep(2); }
  }
  buttonWasDown = down;

  if (millis() - soundWindowStart >= SOUND_WINDOW_MS) {
    cur.soundHits = soundHitsWindow;
    if (soundHitsWindow >= SOUND_HITS_ALARM) sendEvent("alarm.sound");
    soundHitsWindow = 0; soundWindowStart = millis();
  }

  if (millis() - lastSample >= SAMPLE_MS) {
    lastSample = millis(); sampleSensors();
    bool changed = false;
    if (cur.water != prev.water) { sendEvent(cur.water ? "water.detected" : "water.cleared", cur.water); if (cur.water) beep(3); changed = true; }
    if (cur.mainsValid && cur.mains != prev.mains) { sendEvent(cur.mains ? "power.restored" : "power.lost"); changed = true; }
    if (cur.shaking && !prev.shaking) { sendEvent("shaking.detected"); changed = true; }
    if (changed || millis() - lastTelemetry >= TELEMETRY_MS) { sendReading(); lastTelemetry = millis(); }
    prev = cur;
  }

  for (int i = 0; i < mesh::nodeCount; i++) {
    if (i == mesh::selfIdx || !lastHeard[i] || silentFlagged[i] || millis() - lastHeard[i] < NODE_STALE_MS) continue;
    silentFlagged[i] = true;
    String name = String("box_") + mesh::nodes[i].id + ".silent"; sendEvent(name.c_str());
  }

  static bool rtcSynced = false;
  if (!rtcSynced && rtcOk && uplink::wifiUp() && mesh::timeValid()) { rtcWrite(time(nullptr)); rtcSynced = true; Serial.println("[rtc] set from NTP"); }
  drawOled();
  delay(5);
}
