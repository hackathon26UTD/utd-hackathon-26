// HomeBeacon Box A: XIAO ESP32S3 Sense. Local sensors + gateway for box B.
//
// What it does:
//  - Reads water (analog, powered only while sampling), sound (possible alarm), wall-power loss,
//    button (help / OK), and whatever is on the I2C bus: DS1307 clock, GY-521 accelerometer, OLED.
//  - Receives box B over ESP-NOW with AES-128 encryption, accepting only box B's MAC and only
//    messages newer than the last (boot, seq) seen: replayed packets are dropped.
//  - Logs every observation to microSD (/log.csv), the "black box".
//  - Uploads to the team API over verified HTTPS (pinned root CAs). Requests that cannot be sent
//    are queued on SD (/queue.txt) and replayed in order once Wi-Fi/Internet returns.
//  - Prints `HB {json}` lines on USB serial for the Uno Q hub. Type `help` for test commands.
//
// Libraries: ArduinoJson 7, Adafruit SSD1306 + Adafruit GFX. Everything else ships with the ESP32 core.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <time.h>
#include "config.h"
#include "box_protocol.h"
#include "root_ca.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#warning "secrets.h missing: using secrets.example.h placeholders (compile check only)"
#include "secrets.example.h"
#endif
#if USE_CAMERA
#include "esp_camera.h"
#endif

// ───────────────────────── state ─────────────────────────
Preferences prefs;
uint32_t bootCount = 0, seqA = 0;
bool sdOk = false, camOk = false, oledOk = false, rtcOk = false, mpuOk = false;
uint8_t mpuAddr = 0;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

struct Snapshot {
  int waterRaw = 0; bool water = false;
  bool mainsValid = false, mains = true; int mainsMv = 0;
  int accelMg = 0; bool shaking = false;
  int soundHits = 0;
} cur, prev;

uint32_t lastSample = 0, lastTelemetry = 0, lastUploadTry = 0, lastWifiTry = 0;
uint32_t soundWindowStart = 0; int soundHitsWindow = 0; int lastSoundLevel = -1;
uint32_t buttonDownAt = 0; bool buttonWasDown = false;

// Box B link state
uint8_t macB[6], pmk[16], lmk[16];
bool espnowOk = false;
uint32_t lastBootB = 0, lastSeqB = 0, lastSeenB = 0, rejectedB = 0;
QueueHandle_t rxQueue;
struct RxItem { uint8_t mac[6]; BoxMsg msg; int len; };

// RAM queue used only when the SD card is missing
#define RAM_Q 40
String ramQ[RAM_Q]; int ramHead = 0, ramCount = 0;

// ───────────────────────── time ─────────────────────────
bool timeValid() { return time(nullptr) > 1700000000; }

String isoTime(uint32_t epoch) {
  time_t t = epoch; struct tm tmv; gmtime_r(&t, &tmv);
  char buf[32]; strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tmv);
  return String(buf);
}

// DS1307: registers 0-6 BCD seconds..year. Only used if present on the bus.
uint8_t bcd2dec(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }
uint8_t dec2bcd(uint8_t v) { return ((v / 10) << 4) | (v % 10); }

bool rtcRead(uint32_t &epoch) {
  Wire.beginTransmission(0x68); Wire.write(0); if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(0x68, 7) != 7) return false;
  uint8_t r[7]; for (int i = 0; i < 7; i++) r[i] = Wire.read();
  if (r[0] & 0x80) return false;  // clock halted: never set
  struct tm t = {};
  t.tm_sec = bcd2dec(r[0] & 0x7F); t.tm_min = bcd2dec(r[1]); t.tm_hour = bcd2dec(r[2] & 0x3F);
  t.tm_mday = bcd2dec(r[4]); t.tm_mon = bcd2dec(r[5]) - 1; t.tm_year = bcd2dec(r[6]) + 100;
  setenv("TZ", "UTC0", 1); tzset();
  time_t e = mktime(&t);
  if (e < 1700000000) return false;
  epoch = e; return true;
}

void rtcWrite(uint32_t epoch) {
  time_t t = epoch; struct tm v; gmtime_r(&t, &v);
  Wire.beginTransmission(0x68); Wire.write(0);
  Wire.write(dec2bcd(v.tm_sec)); Wire.write(dec2bcd(v.tm_min)); Wire.write(dec2bcd(v.tm_hour));
  Wire.write(dec2bcd(v.tm_wday + 1)); Wire.write(dec2bcd(v.tm_mday)); Wire.write(dec2bcd(v.tm_mon + 1));
  Wire.write(dec2bcd(v.tm_year - 100));
  Wire.endTransmission();
}

uint32_t nowEpoch() { return timeValid() ? (uint32_t)time(nullptr) : 0; }

// ───────────────────────── I2C devices ─────────────────────────
bool i2cPresent(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }

uint8_t i2cRead8(uint8_t a, uint8_t reg) {
  Wire.beginTransmission(a); Wire.write(reg); if (Wire.endTransmission(false) != 0) return 0xFF;
  if (Wire.requestFrom(a, (uint8_t)1) != 1) return 0xFF;
  return Wire.read();
}

void i2cWrite8(uint8_t a, uint8_t reg, uint8_t v) { Wire.beginTransmission(a); Wire.write(reg); Wire.write(v); Wire.endTransmission(); }

void detectI2C() {
  // GY-521 (MPU6050) answers WHO_AM_I (0x75) with 0x68. Wire its AD0 pin to 3.3 V so it sits at
  // 0x69 and does not collide with the DS1307 clock at 0x68.
  if (i2cPresent(0x69) && i2cRead8(0x69, 0x75) == 0x68) mpuAddr = 0x69;
  if (i2cPresent(0x68)) {
    if (!mpuAddr && i2cRead8(0x68, 0x75) == 0x68) mpuAddr = 0x68;  // MPU alone at 0x68, no clock
    else rtcOk = true;
  }
  if (mpuAddr) { i2cWrite8(mpuAddr, 0x6B, 0x00); i2cWrite8(mpuAddr, 0x1C, 0x00); mpuOk = true; }  // wake, ±2 g
  if (i2cPresent(0x3C) && oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { oledOk = true; oled.clearDisplay(); oled.display(); }
}

int readAccelDeviationMg() {
  if (!mpuOk) return 0;
  Wire.beginTransmission(mpuAddr); Wire.write(0x3B); if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom(mpuAddr, (uint8_t)6) != 6) return 0;
  int16_t ax = (Wire.read() << 8) | Wire.read(), ay = (Wire.read() << 8) | Wire.read(), az = (Wire.read() << 8) | Wire.read();
  float g = sqrtf((float)ax * ax + (float)ay * ay + (float)az * az) / 16384.0f;  // ±2 g scale
  return (int)fabsf((g - 1.0f) * 1000.0f);
}

// ───────────────────────── sensors ─────────────────────────
int readWaterRaw() {
  digitalWrite(PIN_WATER_PWR, HIGH); delay(10);
  long sum = 0; for (int i = 0; i < 8; i++) sum += analogRead(PIN_WATER_SIG);
  digitalWrite(PIN_WATER_PWR, LOW);
  return sum / 8;
}

void sampleSensors() {
  cur.waterRaw = readWaterRaw();
  cur.water = cur.waterRaw >= WATER_WET_RAW;
#if USE_MAINS_SENSE
  cur.mainsMv = analogReadMilliVolts(PIN_MAINS_SENSE);
  cur.mainsValid = true;
  cur.mains = cur.mainsMv >= MAINS_PRESENT_MV;
#endif
  cur.accelMg = readAccelDeviationMg();
  cur.shaking = mpuOk && cur.accelMg >= SHAKE_MILLI_G;
}

void pollSound() {
#if USE_SOUND
  int lvl = digitalRead(PIN_SOUND_DO);
  if (lvl != lastSoundLevel) {
    if (lvl == SOUND_ACTIVE_LEVEL) soundHitsWindow++;
    lastSoundLevel = lvl;
  }
#endif
}

void beep(int times, int onMs = 120) {
  for (int i = 0; i < times; i++) { digitalWrite(PIN_BUZZER, HIGH); delay(onMs); digitalWrite(PIN_BUZZER, LOW); delay(onMs); }
}

// ───────────────────────── camera ─────────────────────────
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
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) return "";
  if (!SD.exists("/img")) SD.mkdir("/img");
  String path = "/img/" + String(bootCount) + "-" + String(millis()) + "-" + reason + ".jpg";
  File f = SD.open(path, FILE_WRITE);
  if (f) { f.write(fb->buf, fb->len); f.close(); }
  esp_camera_fb_return(fb);
  return f ? path : "";
#else
  return "";
#endif
}

// ───────────────────────── black-box log + upload queue ─────────────────────────
void logLine(const String &line) {
  if (sdOk) { File f = SD.open("/log.csv", FILE_APPEND); if (f) { f.println(line); f.close(); } }
}

// Queue line format: <who A|B>\t<path>\t<json>
void enqueue(char who, const char *path, const String &json) {
  String line = String(who) + "\t" + path + "\t" + json;
  if (sdOk) { File f = SD.open("/queue.txt", FILE_APPEND); if (f) { f.println(line); f.close(); return; } }
  int idx = (ramHead + ramCount) % RAM_Q;
  if (ramCount == RAM_Q) { ramHead = (ramHead + 1) % RAM_Q; ramCount--; }  // drop oldest
  ramQ[idx] = line; ramCount++;
}

size_t queuePos() { if (!SD.exists("/queue.pos")) return 0; File f = SD.open("/queue.pos"); size_t p = f ? f.readString().toInt() : 0; if (f) f.close(); return p; }
void setQueuePos(size_t p) { File f = SD.open("/queue.pos", FILE_WRITE); if (f) { f.print(p); f.close(); } }

size_t queuedCount() {
  if (!sdOk) return ramCount;
  if (!SD.exists("/queue.txt")) return 0;
  File f = SD.open("/queue.txt"); if (!f) return 0;
  size_t pos = queuePos(); f.seek(pos); size_t n = 0;
  while (f.available()) { if (f.read() == '\n') n++; }
  f.close(); return n;
}

// Returns HTTP status, or negative on network/TLS failure.
int postJson(const char *path, const String &body, const char *deviceKey) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure tls; tls.setCACert(ROOT_CA_BUNDLE);
  HTTPClient http; http.setTimeout(10000);
  if (!http.begin(tls, String(API_BASE) + path)) return -2;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", deviceKey);
  int code = http.POST(body);
  http.end();
  return code;
}

// 2xx = sent. 400/403/404/409/413/422 = permanent (log + drop). Anything else = retry later.
bool permanent(int code) { return code == 400 || code == 403 || code == 404 || code == 409 || code == 413 || code == 422; }

bool sendLine(const String &line) {
  int t1 = line.indexOf('\t'), t2 = line.indexOf('\t', t1 + 1);
  if (t1 < 0 || t2 < 0) return true;  // malformed: drop
  char who = line.charAt(0);
  String path = line.substring(t1 + 1, t2), body = line.substring(t2 + 1);
  int code = postJson(path.c_str(), body, who == 'B' ? BOX_B_DEVICE_KEY : BOX_A_DEVICE_KEY);
  if (code >= 200 && code < 300) return true;
  if (permanent(code)) { Serial.printf("[upload] dropped %c %s -> HTTP %d\n", who, path.c_str(), code); logLine("upload_dropped," + path + "," + code); return true; }
  Serial.printf("[upload] retry later: %s -> %d\n", path.c_str(), code);
  return false;
}

void drainQueue() {
  if (WiFi.status() != WL_CONNECTED || millis() - lastUploadTry < UPLOAD_RETRY_MS) return;
  lastUploadTry = millis();
  for (int sent = 0; sent < 5; sent++) {
    if (!sdOk) {
      if (!ramCount) return;
      if (!sendLine(ramQ[ramHead])) return;
      ramQ[ramHead] = ""; ramHead = (ramHead + 1) % RAM_Q; ramCount--;
      continue;
    }
    if (!SD.exists("/queue.txt")) return;
    File f = SD.open("/queue.txt"); if (!f) return;
    size_t pos = queuePos();
    if (pos >= f.size()) { f.close(); SD.remove("/queue.txt"); SD.remove("/queue.pos"); return; }
    f.seek(pos); String line = f.readStringUntil('\n'); size_t next = f.position(); f.close();
    line.trim();
    if (!sendLine(line)) return;
    setQueuePos(next);
  }
}

// ───────────────────────── building messages ─────────────────────────
String eventId(char who, uint32_t boot, uint32_t seq) { return String(who) + "-" + boot + "-" + seq; }
uint64_t sequenceNum(uint32_t boot, uint32_t seq) { return (uint64_t)boot * 1000000ULL + seq; }

void emitHub(const JsonDocument &d) { Serial.print("HB "); serializeJson(d, Serial); Serial.println(); }

// Box A periodic snapshot → beacon telemetry + extra readings.
void reportA() {
  seqA++;
  uint32_t ep = nowEpoch();
  JsonDocument t;
  t["device_id"] = BOX_A_DEVICE_ID; t["event_id"] = eventId('A', bootCount, seqA); t["sequence"] = sequenceNum(bootCount, seqA);
  if (ep) t["observed_at"] = isoTime(ep);
  t["water_detected"] = cur.water;
  if (cur.mainsValid) t["main_power_available"] = cur.mains;
  String tj; serializeJson(t, tj); enqueue('A', "/api/beacon/ingest", tj);

  JsonDocument r; JsonArray a = r["readings"].to<JsonArray>();
  auto add = [&](const char *s, float v, const char *u) { JsonObject o = a.add<JsonObject>(); o["sensor"] = s; o["value"] = v; if (u) o["unit"] = u; if (ep) o["ts"] = isoTime(ep); };
  add("water_raw", cur.waterRaw, nullptr);
  if (mpuOk) add("accel_dev_mg", cur.accelMg, "mg");
#if USE_SOUND
  add("sound_hits", cur.soundHits, nullptr);
#endif
  if (cur.mainsValid) add("mains_mv", cur.mainsMv, "mV");
  if (WiFi.status() == WL_CONNECTED) add("rssi", WiFi.RSSI(), "dBm");
  String rj; serializeJson(r, rj); enqueue('A', "/api/ingest", rj);

  logLine(String(ep) + "," + millis() + ",A,reading," + cur.waterRaw + "," + cur.water + "," + cur.mains + "," + cur.accelMg + "," + cur.soundHits);
  JsonDocument h; h["box"] = "A"; h["type"] = "reading"; h["seq"] = seqA; h["epoch"] = ep; h["water"] = cur.water; h["water_raw"] = cur.waterRaw;
  if (cur.mainsValid) h["mains"] = cur.mains; if (mpuOk) h["accel_mg"] = cur.accelMg; h["sound_hits"] = cur.soundHits; emitHub(h);
}

void eventA(const char *type, const char *detail = nullptr) {
  seqA++;
  uint32_t ep = nowEpoch();
  String img = (strcmp(type, "water.detected") == 0 || strcmp(type, "help.request") == 0) ? snapshot(type) : "";
  JsonDocument e; e["type"] = type; JsonObject d = e["data"].to<JsonObject>();
  d["box"] = "A"; d["event_id"] = eventId('A', bootCount, seqA); if (ep) d["observed_at"] = isoTime(ep);
  if (detail) d["detail"] = detail; if (img.length()) d["photo_on_sd"] = img;
  String ej; serializeJson(e, ej); enqueue('A', "/api/events", ej);
  logLine(String(ep) + "," + millis() + ",A,event," + type + "," + (detail ? detail : "") + "," + img);
  JsonDocument h; h["box"] = "A"; h["type"] = "event"; h["event"] = type; h["epoch"] = ep; if (img.length()) h["photo"] = img; emitHub(h);
  Serial.printf("[event] %s %s\n", type, detail ? detail : "");
}

// Box B message (already decrypted by ESP-NOW, sender + replay checked).
void handleB(const BoxMsg &m) {
  bool tv = m.flags & F_TIME_VALID;
  uint32_t ep = tv ? m.epoch : nowEpoch();
  String eid = eventId('B', m.boot, m.seq);
  if (m.type == MSG_READING) {
    if (m.flags & F_MAINS_VALID) {  // beacon telemetry needs at least one beacon field
      JsonDocument t; t["device_id"] = BOX_B_DEVICE_ID; t["event_id"] = eid; t["sequence"] = sequenceNum(m.boot, m.seq);
      if (ep) t["observed_at"] = isoTime(ep);
      t["main_power_available"] = (bool)(m.flags & F_MAINS);
      if (m.batteryMv) { int pct = constrain(map(m.batteryMv, 6000, 9000, 0, 100), 0, 100); t["battery_pct"] = pct; }
      String tj; serializeJson(t, tj); enqueue('B', "/api/beacon/ingest", tj);
    }
    JsonDocument r; JsonArray a = r["readings"].to<JsonArray>();
    auto add = [&](const char *s, float v, const char *u) { JsonObject o = a.add<JsonObject>(); o["sensor"] = s; o["value"] = v; if (u) o["unit"] = u; if (ep) o["ts"] = isoTime(ep); };
    if (m.flags & F_MOTION_VALID) add("motion", (m.flags & F_MOTION) ? 1 : 0, nullptr);
    if (m.flags & F_FLAME_VALID) { add("flame", (m.flags & F_FLAME) ? 1 : 0, nullptr); add("flame_raw", m.flameRaw, nullptr); }
    if (m.flags & F_TILT_VALID) add("tilt", (m.flags & F_TILT) ? 1 : 0, nullptr);
    if (m.flags & F_ACCEL_VALID) add("accel_dev_mg", m.accelMilliG, "mg");
    if (m.batteryMv) add("battery_mv", m.batteryMv, "mV");
    add("relayed_via_box_a", 1, nullptr);
    if (a.size()) { String rj; serializeJson(r, rj); enqueue('B', "/api/ingest", rj); }
    logLine(String(ep) + "," + millis() + ",B,reading," + m.flags + "," + m.flameRaw + "," + m.accelMilliG + "," + m.batteryMv);
    JsonDocument h; h["box"] = "B"; h["type"] = "reading"; h["seq"] = m.seq; h["epoch"] = ep; h["flags"] = m.flags;
    h["motion"] = (bool)(m.flags & F_MOTION); h["flame"] = (bool)(m.flags & F_FLAME); h["mains"] = (bool)(m.flags & F_MAINS); emitHub(h);
  } else if (m.type == MSG_EVENT) {
    char name[25]; memcpy(name, m.event, 24); name[24] = 0;
    JsonDocument e; e["type"] = name; JsonObject d = e["data"].to<JsonObject>();
    d["box"] = "B"; d["event_id"] = eid; d["relayed_via"] = "A"; if (ep) d["observed_at"] = isoTime(ep);
    String ej; serializeJson(e, ej); enqueue('B', "/api/events", ej);
    logLine(String(ep) + "," + millis() + ",B,event," + name);
    JsonDocument h; h["box"] = "B"; h["type"] = "event"; h["event"] = name; h["epoch"] = ep; emitHub(h);
    Serial.printf("[event] box B: %s\n", name);
    if (strncmp(name, "flame", 5) == 0) { snapshot("flame_B"); beep(3, 80); }
  }
}

// ───────────────────────── ESP-NOW ─────────────────────────
void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  RxItem it; memcpy(it.mac, info->src_addr, 6); it.len = len;
  if (len == sizeof(BoxMsg)) memcpy(&it.msg, data, len);
  xQueueSendFromISR(rxQueue, &it, nullptr);
}

void sendAck(uint32_t boot, uint32_t seq) {
  BoxMsg ack = {}; ack.version = BOX_PROTOCOL_VERSION; ack.type = MSG_ACK; strncpy(ack.box, "boxA", sizeof ack.box);
  ack.boot = boot; ack.seq = seq; ack.epoch = nowEpoch();  // box B sets its clock from this
  if (ack.epoch) ack.flags |= F_TIME_VALID;
  esp_now_send(macB, (uint8_t *)&ack, sizeof ack);
}

void processRx() {
  RxItem it;
  while (xQueueReceive(rxQueue, &it, 0) == pdTRUE) {
    if (memcmp(it.mac, macB, 6) != 0 || it.len != sizeof(BoxMsg) || it.msg.version != BOX_PROTOCOL_VERSION) { rejectedB++; continue; }
    const BoxMsg &m = it.msg;
    if (m.type != MSG_READING && m.type != MSG_EVENT) { rejectedB++; continue; }
    if (!boxMsgIsNewer(m.boot, m.seq, lastBootB, lastSeqB)) {  // duplicate or replay: re-ACK, do not store
      sendAck(m.boot, m.seq); continue;
    }
    lastBootB = m.boot; lastSeqB = m.seq; lastSeenB = millis();
    prefs.putUInt("bootB", lastBootB); prefs.putUInt("seqB", lastSeqB);
    handleB(m);
    sendAck(m.boot, m.seq);
  }
}

bool initEspNow() {
  if (!parseMac(BOX_B_MAC, macB) || !parseKey16(ESPNOW_PMK, pmk) || !parseKey16(ESPNOW_LMK, lmk)) { Serial.println("[espnow] bad MAC/key in secrets.h"); return false; }
  if (esp_now_init() != ESP_OK) return false;
  esp_now_set_pmk(pmk);
  esp_now_peer_info_t p = {}; memcpy(p.peer_addr, macB, 6); p.channel = 0; p.ifidx = WIFI_IF_STA;
  p.encrypt = true; memcpy(p.lmk, lmk, 16);  // AES-128 CCMP: unencrypted or wrongly keyed frames are discarded
  if (esp_now_add_peer(&p) != ESP_OK) return false;
  esp_now_register_recv_cb(onRecv);
  return true;
}

// ───────────────────────── Wi-Fi ─────────────────────────
void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED || millis() - lastWifiTry < WIFI_RETRY_MS) return;
  lastWifiTry = millis();
  Serial.println("[wifi] connecting...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) { delay(200); pollSound(); }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected, channel %d, ip %s\n", WiFi.channel(), WiFi.localIP().toString().c_str());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  } else {
    // Stay reachable for box B on a known channel while offline.
    WiFi.disconnect(false, false);
    esp_wifi_set_channel(FALLBACK_CHANNEL, WIFI_SECOND_CHAN_NONE);
    Serial.printf("[wifi] offline; ESP-NOW on fallback channel %d; queueing to %s\n", FALLBACK_CHANNEL, sdOk ? "SD" : "RAM");
  }
}

void syncRtcFromNtp() {
  static bool done = false;
  if (done || !rtcOk || !timeValid()) return;
  rtcWrite(time(nullptr)); done = true; Serial.println("[rtc] set from NTP");
}

// ───────────────────────── display ─────────────────────────
void drawOled() {
  if (!oledOk) return;
  static uint32_t last = 0; if (millis() - last < 1000) return; last = millis();
  oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE); oled.setCursor(0, 0);
  oled.printf("HomeBeacon box A\n");
  oled.printf("WiFi:%s q:%u\n", WiFi.status() == WL_CONNECTED ? "on" : "OFF", (unsigned)queuedCount());
  oled.printf("Water:%s (%d)\n", cur.water ? "WET" : "dry", cur.waterRaw);
  oled.printf("Power:%s\n", !cur.mainsValid ? "n/a" : cur.mains ? "wall" : "BATTERY");
  oled.printf("Box B:%s\n", lastSeenB && millis() - lastSeenB < BOX_B_STALE_MS ? "ok" : "silent");
  oled.printf("%s", timeValid() ? isoTime(nowEpoch()).substring(11, 19).c_str() : "time not set");
  oled.display();
}

// ───────────────────────── serial test commands ─────────────────────────
void printHelp() {
  Serial.println(F("Commands: help | mac | i2c | sensors | water | mains | sound | button | beep | sd | cam | wifi | time | api | espnow | queue | selftest"));
}

void cmdI2C() {
  Serial.print("[i2c] found:"); int n = 0;
  for (uint8_t a = 1; a < 127; a++) if (i2cPresent(a)) { Serial.printf(" 0x%02X", a); n++; }
  Serial.printf("  (%d)  rtc=%d mpu=%s oled=%d\n", n, rtcOk, mpuOk ? (mpuAddr == 0x69 ? "0x69" : "0x68") : "no", oledOk);
}

bool cmdSd() {
  if (!sdOk) { Serial.println("[sd] FAIL: no card (FAT32, <=32 GB, seated in the Sense board)"); return false; }
  File f = SD.open("/selftest.txt", FILE_WRITE); bool ok = f && f.print("ok"); if (f) f.close();
  f = SD.open("/selftest.txt"); String s = f ? f.readString() : ""; if (f) f.close(); SD.remove("/selftest.txt");
  ok = ok && s == "ok";
  Serial.printf("[sd] %s, size %llu MB, log %s\n", ok ? "PASS" : "FAIL write/read", SD.cardSize() / (1024 * 1024), SD.exists("/log.csv") ? "present" : "empty");
  return ok;
}

bool cmdApi() {
  if (WiFi.status() != WL_CONNECTED) { Serial.println("[api] FAIL: Wi-Fi not connected"); return false; }
  WiFiClientSecure tls; tls.setCACert(ROOT_CA_BUNDLE); HTTPClient http;
  http.begin(tls, String(API_BASE) + "/api/health"); int code = http.GET(); String body = code > 0 ? http.getString() : "";
  http.end();
  Serial.printf("[api] GET /api/health -> %d %s\n", code, body.substring(0, 120).c_str());
  if (code < 0) Serial.println("[api] negative code = TLS/DNS failure. If the certificate check fails, the site's CA changed: regenerate root_ca.h");
  JsonDocument t; t["device_id"] = BOX_A_DEVICE_ID; t["event_id"] = "selftest-" + String(bootCount) + "-" + millis(); t["water_detected"] = false;
  String tj; serializeJson(t, tj);
  int c2 = postJson("/api/beacon/ingest", tj, BOX_A_DEVICE_KEY);
  Serial.printf("[api] POST /api/beacon/ingest -> %d (%s)\n", c2,
    c2 == 202 ? "PASS" : c2 == 401 ? "device key rejected: re-provision" : c2 == 409 ? "device has no home: run provisioning" : c2 == 403 ? "device_id does not match key" : "see code");
  return code == 200 && c2 == 202;
}

void cmdSensors() {
  sampleSensors();
  Serial.printf("[sensors] water_raw=%d wet=%d | mains=%s (%d mV) | accel_dev=%d mg %s | sound_do=%d | button=%s\n",
    cur.waterRaw, cur.water, cur.mainsValid ? (cur.mains ? "present" : "LOST") : "n/a", cur.mainsMv, cur.accelMg, mpuOk ? "" : "(no GY-521)",
    digitalRead(PIN_SOUND_DO), digitalRead(PIN_BUTTON) == LOW ? "pressed" : "up");
}

void selftest() {
  Serial.println("=== selftest ===");
  cmdI2C(); bool sd = cmdSd();
  Serial.printf("[cam] %s\n", camOk ? "PASS" : (USE_CAMERA ? "FAIL (seat the camera board, set PSRAM: OPI)" : "disabled"));
  cmdSensors();
  Serial.printf("[espnow] %s, box B %s, rejected frames %u\n", espnowOk ? "PASS" : "FAIL", lastSeenB ? "heard" : "not heard yet", rejectedB);
  Serial.printf("[time] %s\n", timeValid() ? isoTime(nowEpoch()).c_str() : "not set (needs Wi-Fi or RTC)");
  bool api = cmdApi();
  Serial.printf("=== %s ===\n", sd && api && espnowOk ? "core PASS" : "see FAIL lines above");
}

void handleSerial() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { buf += c; continue; }
    String cmd = buf; buf = ""; cmd.trim(); if (!cmd.length()) continue;
    if (cmd == "help") printHelp();
    else if (cmd == "mac") Serial.printf("[mac] %s (put this in box B's BOX_A_MAC)\n", WiFi.macAddress().c_str());
    else if (cmd == "i2c") cmdI2C();
    else if (cmd == "sensors") cmdSensors();
    else if (cmd == "water") { for (int i = 0; i < 10; i++) { Serial.printf("[water] raw=%d (threshold %d)\n", readWaterRaw(), WATER_WET_RAW); delay(300); } }
    else if (cmd == "mains") { for (int i = 0; i < 10; i++) { Serial.printf("[mains] %d mV (present >= %d)\n", analogReadMilliVolts(PIN_MAINS_SENSE), MAINS_PRESENT_MV); delay(300); } }
    else if (cmd == "sound") { int hits = 0, last = digitalRead(PIN_SOUND_DO); uint32_t t0 = millis(); while (millis() - t0 < 5000) { int l = digitalRead(PIN_SOUND_DO); if (l != last && l == SOUND_ACTIVE_LEVEL) hits++; last = l; } Serial.printf("[sound] %d triggers in 5 s (alarm needs %d)\n", hits, SOUND_HITS_ALARM); }
    else if (cmd == "button") { Serial.println("[button] press within 5 s"); uint32_t t0 = millis(); bool seen = false; while (millis() - t0 < 5000) if (digitalRead(PIN_BUTTON) == LOW) { seen = true; break; } Serial.printf("[button] %s\n", seen ? "PASS" : "not pressed"); }
    else if (cmd == "beep") beep(2);
    else if (cmd == "sd") cmdSd();
    else if (cmd == "cam") { String p = snapshot("test"); Serial.printf("[cam] %s\n", p.length() ? ("saved " + p).c_str() : "FAIL (camera or SD missing)"); }
    else if (cmd == "wifi") Serial.printf("[wifi] %s ch=%d rssi=%d\n", WiFi.status() == WL_CONNECTED ? "connected" : "offline", WiFi.channel(), WiFi.RSSI());
    else if (cmd == "time") Serial.printf("[time] %s rtc=%d\n", timeValid() ? isoTime(nowEpoch()).c_str() : "not set", rtcOk);
    else if (cmd == "api") cmdApi();
    else if (cmd == "espnow") Serial.printf("[espnow] init=%d lastB boot=%u seq=%u seen %lus ago, rejected=%u\n", espnowOk, lastBootB, lastSeqB, lastSeenB ? (millis() - lastSeenB) / 1000 : 0, rejectedB);
    else if (cmd == "queue") Serial.printf("[queue] %u waiting (%s)\n", (unsigned)queuedCount(), sdOk ? "SD" : "RAM");
    else if (cmd == "selftest") selftest();
    else Serial.println("unknown command; type help");
  }
}

// ───────────────────────── setup / loop ─────────────────────────
void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\nHomeBeacon box A starting");
  pinMode(PIN_WATER_PWR, OUTPUT); digitalWrite(PIN_WATER_PWR, LOW);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_SOUND_DO, INPUT);
  analogReadResolution(12);

  prefs.begin("homebeacon", false);
  bootCount = prefs.getUInt("boot", 0) + 1; prefs.putUInt("boot", bootCount);
  lastBootB = prefs.getUInt("bootB", 0); lastSeqB = prefs.getUInt("seqB", 0);  // replay protection survives reboot

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000);
  detectI2C();
  uint32_t rtcEpoch;
  if (rtcOk && rtcRead(rtcEpoch)) { struct timeval tv = { (time_t)rtcEpoch, 0 }; settimeofday(&tv, nullptr); Serial.println("[rtc] time loaded from DS1307"); }

  sdOk = SD.begin(PIN_SD_CS);
#if USE_CAMERA
  camOk = initCamera();
#endif

  rxQueue = xQueueCreate(16, sizeof(RxItem));
  WiFi.mode(WIFI_STA);
  lastWifiTry = millis() - WIFI_RETRY_MS;  // connect immediately
  ensureWifi();
  espnowOk = initEspNow();

  Serial.printf("boot #%u | sd=%d cam=%d rtc=%d mpu=%d oled=%d espnow=%d | MAC %s\n", bootCount, sdOk, camOk, rtcOk, mpuOk, oledOk, espnowOk, WiFi.macAddress().c_str());
  printHelp();
  eventA("box.boot");
  beep(1);
}

void loop() {
  handleSerial();
  processRx();
  pollSound();

  // Button: short press = help request, long press = OK report.
  bool down = digitalRead(PIN_BUTTON) == LOW;
  if (down && !buttonWasDown) buttonDownAt = millis();
  if (!down && buttonWasDown && millis() - buttonDownAt > 50) {
    if (millis() - buttonDownAt >= LONG_PRESS_MS) { eventA("ok.report"); beep(1, 300); }
    else { eventA("help.request"); beep(2); }
  }
  buttonWasDown = down;

  if (millis() - soundWindowStart >= SOUND_WINDOW_MS) {
    cur.soundHits = soundHitsWindow;
    if (soundHitsWindow >= SOUND_HITS_ALARM) eventA("alarm.sound", "repeated loud sound; possible smoke alarm");
    soundHitsWindow = 0; soundWindowStart = millis();
  }

  if (millis() - lastSample >= SAMPLE_MS) {
    lastSample = millis();
    sampleSensors();
    bool changed = false;
    if (cur.water != prev.water) { eventA(cur.water ? "water.detected" : "water.cleared"); if (cur.water) beep(3); changed = true; }
    if (cur.mainsValid && cur.mains != prev.mains) { eventA(cur.mains ? "power.restored" : "power.lost"); changed = true; }
    if (cur.shaking && !prev.shaking) { eventA("shaking.detected"); changed = true; }
    if (changed || millis() - lastTelemetry >= TELEMETRY_MS) { reportA(); lastTelemetry = millis(); }
    prev = cur;
  }

  if (lastSeenB && millis() - lastSeenB > BOX_B_STALE_MS) {
    static uint32_t flagged = 0;
    if (flagged != lastSeenB) { eventA("box_b.silent", "no ESP-NOW frames from box B"); flagged = lastSeenB; }
  }

  ensureWifi();
  syncRtcFromNtp();
  drainQueue();
  drawOled();
  delay(5);
}
