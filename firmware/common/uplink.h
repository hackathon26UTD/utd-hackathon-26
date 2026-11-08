// HomeBeacon uplink (header-only; include once from the sketch, after mesh.h).
// Wi-Fi + verified HTTPS + an upload queue (microSD if available, RAM otherwise) + conversion of
// mesh messages into team API requests. Any box with this module can act as the mesh gateway.
#pragma once
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SD.h>
#include <ArduinoJson.h>
#include "root_ca.h"
#include "mesh.h"

namespace uplink {

constexpr uint32_t WIFI_RETRY_MS = 30000, UPLOAD_RETRY_MS = 4000, HEALTH_MS = 20000;
constexpr int RAM_Q = 40;

const char *ssid, *pass, *apiBase;
uint8_t fallbackChannel = 1;
bool useSd = false, apiHealthy = false;
uint32_t lastWifiTry = 0, lastUploadTry = 0, lastHealth = 0, lastOk = 0;
String ramQ[RAM_Q]; int ramHead = 0, ramCount = 0;
uint32_t statSent = 0, statFailed = 0, statDroppedPermanent = 0;

bool wifiUp() { return WiFi.status() == WL_CONNECTED; }
bool online() { return wifiUp() && apiHealthy; }

String isoTime(uint32_t epoch) {
  time_t t = epoch; struct tm v; gmtime_r(&t, &v);
  char buf[32]; strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &v); return String(buf);
}

// ── queue: one line per request: <originId>\t<path>\t<json> ──
size_t sdPos() { if (!SD.exists("/queue.pos")) return 0; File f = SD.open("/queue.pos"); size_t p = f ? f.readString().toInt() : 0; if (f) f.close(); return p; }
void sdSetPos(size_t p) { File f = SD.open("/queue.pos", FILE_WRITE); if (f) { f.print(p); f.close(); } }

void enqueueLine(const char *origin, const char *path, const String &json) {
  String line = String(origin) + "\t" + path + "\t" + json;
  if (useSd) { File f = SD.open("/queue.txt", FILE_APPEND); if (f) { f.println(line); f.close(); return; } }
  if (ramCount == RAM_Q) { ramHead = (ramHead + 1) % RAM_Q; ramCount--; }
  ramQ[(ramHead + ramCount) % RAM_Q] = line; ramCount++;
}

size_t queued() {
  size_t n = ramCount;
  if (useSd && SD.exists("/queue.txt")) {
    File f = SD.open("/queue.txt"); if (f) { f.seek(sdPos()); while (f.available()) if (f.read() == '\n') n++; f.close(); }
  }
  return n;
}

// ── HTTPS ──
int request(const char *method, const String &path, const String &body, const char *deviceKey) {
  if (!wifiUp()) return -1;
  WiFiClientSecure tls; tls.setCACert(ROOT_CA_BUNDLE);  // refuses servers not signed by the pinned roots
  HTTPClient http; http.setTimeout(10000);
  if (!http.begin(tls, String(apiBase) + path)) return -2;
  if (deviceKey) http.addHeader("X-Device-Key", deviceKey);
  int code;
  if (!strcmp(method, "GET")) code = http.GET();
  else { http.addHeader("Content-Type", "application/json"); code = http.POST(body); }
  http.end();
  return code;
}

bool permanent(int c) { return c == 400 || c == 403 || c == 404 || c == 409 || c == 413 || c == 422; }

// Send one queued line. true = done with it (sent or permanently rejected).
bool sendLine(const String &line) {
  int t1 = line.indexOf('\t'), t2 = line.indexOf('\t', t1 + 1);
  if (t1 < 0 || t2 < 0) return true;
  String origin = line.substring(0, t1), path = line.substring(t1 + 1, t2), body = line.substring(t2 + 1);
  const MeshNodeCfg *n = mesh::nodeCfg(origin.c_str());
  if (!n || !n->deviceKey || !strlen(n->deviceKey)) { Serial.printf("[upload] no device key for box %s; dropping\n", origin.c_str()); return true; }
  int code = request("POST", path, body, n->deviceKey);
  if (code >= 200 && code < 300) { statSent++; apiHealthy = true; lastOk = millis(); return true; }
  if (permanent(code)) { statDroppedPermanent++; Serial.printf("[upload] box %s %s rejected HTTP %d (dropped)\n", origin.c_str(), path.c_str(), code); return true; }
  statFailed++;
  if (code < 0 || code >= 500) apiHealthy = false;  // network/TLS/server outage: let another gateway take over
  Serial.printf("[upload] %s -> %d, will retry\n", path.c_str(), code);
  return false;
}

void drain() {
  if (!wifiUp() || millis() - lastUploadTry < UPLOAD_RETRY_MS) return;
  lastUploadTry = millis();
  for (int i = 0; i < 6; i++) {
    if (ramCount) {
      if (!sendLine(ramQ[ramHead])) return;
      ramQ[ramHead] = ""; ramHead = (ramHead + 1) % RAM_Q; ramCount--; continue;
    }
    if (!useSd || !SD.exists("/queue.txt")) return;
    File f = SD.open("/queue.txt"); if (!f) return;
    size_t pos = sdPos();
    if (pos >= f.size()) { f.close(); SD.remove("/queue.txt"); SD.remove("/queue.pos"); return; }
    f.seek(pos); String line = f.readStringUntil('\n'); size_t next = f.position(); f.close(); line.trim();
    if (!sendLine(line)) return;
    sdSetPos(next);
  }
}

// ── mesh message → API requests ──
void addReading(JsonArray a, const char *sensor, float v, const char *unit, uint32_t ep) {
  JsonObject o = a.add<JsonObject>(); o["sensor"] = sensor; o["value"] = v; if (unit) o["unit"] = unit; if (ep) o["ts"] = isoTime(ep);
}

bool enqueueMsg(const MeshMsg &m) {
  const MeshNodeCfg *n = mesh::nodeCfg(m.origin);
  if (!n) return false;
  // An old untimed message must not acquire the reconnect time as its observation.
  // Omission uses canonical server_fallback provenance, excluded from learned baselines.
  uint32_t ep = (m.flags & F_TIME_VALID) ? m.epoch : 0;
  String eventId = String(m.origin) + "-" + m.boot + "-" + m.seq;
  if (m.type == MSG_READING) {
    if (m.flags & (F_WATER_VALID | F_MAINS_VALID) || m.batteryMv) {  // HomeBeacon telemetry needs one of these
      JsonDocument t; t["device_id"] = n->deviceId; t["event_id"] = eventId; t["sequence"] = (uint64_t)m.boot * 1000000ULL + m.seq;
      if (ep) t["observed_at"] = isoTime(ep);
      if (m.flags & F_WATER_VALID) t["water_detected"] = (bool)(m.flags & F_WATER);
      if (m.flags & F_MAINS_VALID) t["main_power_available"] = (bool)(m.flags & F_MAINS);
      if (m.batteryMv) t["battery_pct"] = constrain(map(m.batteryMv, 6000, 9000, 0, 100), 0, 100);
      String s; serializeJson(t, s); enqueueLine(m.origin, "/api/beacon/ingest", s);
    }
    JsonDocument r; JsonArray a = r["readings"].to<JsonArray>();
    if (m.flags & F_WATER_VALID) addReading(a, "water_raw", m.waterRaw, nullptr, ep);
    if (m.flags & F_MOTION_VALID) addReading(a, "motion", (m.flags & F_MOTION) ? 1 : 0, nullptr, ep);
    if (m.flags & F_FLAME_VALID) { addReading(a, "flame", (m.flags & F_FLAME) ? 1 : 0, nullptr, ep); addReading(a, "flame_raw", m.flameRaw, nullptr, ep); }
    if (m.flags & F_TILT_VALID) addReading(a, "tilt", (m.flags & F_TILT) ? 1 : 0, nullptr, ep);
    if (m.flags & F_ACCEL_VALID) addReading(a, "accel_dev_mg", m.accelMilliG, "mg", ep);
    if (m.flags & F_SOUND_VALID) addReading(a, "sound_hits", m.soundHits, nullptr, ep);
    if (m.batteryMv) addReading(a, "battery_mv", m.batteryMv, "mV", ep);
    addReading(a, "mesh_hops", m.hops, nullptr, ep);
    String s; serializeJson(r, s); enqueueLine(m.origin, "/api/ingest", s);
  } else if (m.type == MSG_EVENT) {
    JsonDocument e; e["type"] = m.event; JsonObject d = e["data"].to<JsonObject>();
    d["box"] = m.origin; d["event_id"] = eventId; d["mesh_hops"] = m.hops; d["gateway"] = mesh::myId;
    if (ep) d["observed_at"] = isoTime(ep);
    String s; serializeJson(e, s); enqueueLine(m.origin, "/api/events", s);
  } else return false;
  return true;
}

// ── Wi-Fi ──
void connect() {
  Serial.println("[wifi] connecting...");
  // Join on a quiet radio: no ESP-NOW transmissions, no promiscuous channel pinning, and no
  // background auto-reconnect racing our own retry/channel logic (seen as reason 2/201 loops).
  mesh::txPaused = true;
  esp_wifi_set_promiscuous(false);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, true);
  delay(100);
  WiFi.begin(ssid, pass);
  uint32_t t0 = millis();
  while (!wifiUp() && millis() - t0 < 25000) { delay(100); mesh::processRx(); }  // phone hotspots can be slow to hand out an address
  if (wifiUp()) {
    Serial.printf("[wifi] connected, channel %d\n", WiFi.channel());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    lastHealth = 0;
  } else {
    WiFi.disconnect(false, true);  // stop the driver's own retries until our next attempt
    // Stay on the hotspot's channel if it is visible (so we can still reach boxes that are online),
    // otherwise on the shared fallback channel.
    uint8_t ch = fallbackChannel;
    int n = WiFi.scanNetworks(false, false, false, 120);
    for (int i = 0; i < n; i++) if (WiFi.SSID(i) == ssid) { ch = WiFi.channel(i); break; }
    WiFi.scanDelete();
    esp_wifi_set_promiscuous(true); esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE); esp_wifi_set_promiscuous(false);
    Serial.printf("[wifi] offline; mesh on channel %u\n", ch);
  }
  mesh::txPaused = false;
}

void loop() {
  if (!wifiUp() && millis() - lastWifiTry > WIFI_RETRY_MS) { lastWifiTry = millis(); connect(); }
  if (!wifiUp()) apiHealthy = false;
  // Internet check: Wi-Fi can be up with no Internet (hotspot with mobile data off).
  if (wifiUp() && millis() - lastHealth > HEALTH_MS) {
    lastHealth = millis();
    apiHealthy = request("GET", "/api/health", "", nullptr) > 0;  // any HTTP answer = our API is reachable
  }
  drain();
  mesh::setOnline(online());
}

void begin(const char *s, const char *p, const char *base, bool sd, uint8_t fallbackCh) {
  ssid = s; pass = p; apiBase = base; useSd = sd; fallbackChannel = fallbackCh;
  // Say exactly why Wi-Fi drops or refuses us (2=auth expired, 15=4-way handshake timeout: usually wrong password, 201=AP not found, 202=auth fail).
  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t info) { Serial.printf("[wifi] disconnected, reason %u\n", info.wifi_sta_disconnected.reason); }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  lastWifiTry = millis(); connect();
}

int selftest(const char *deviceId, const char *deviceKey) {
  if (!wifiUp()) { Serial.println("[api] FAIL: Wi-Fi not connected"); return -1; }
  int h = request("GET", "/api/health", "", nullptr);
  Serial.printf("[api] GET /api/health -> %d %s\n", h, h < 0 ? "(TLS/DNS failure: wrong CA or no Internet)" : "");
  JsonDocument t; t["device_id"] = deviceId; t["event_id"] = String("selftest-") + mesh::myId + "-" + millis(); t["water_detected"] = false;
  String s; serializeJson(t, s);
  int c = request("POST", "/api/beacon/ingest", s, deviceKey);
  Serial.printf("[api] POST /api/beacon/ingest -> %d %s\n", c, c == 202 ? "PASS" : c == 401 ? "(device key rejected: re-provision)" : c == 409 ? "(device has no home: provision)" : c == 403 ? "(device_id does not match key)" : "");
  return c;
}

}  // namespace uplink
