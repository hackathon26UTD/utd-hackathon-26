// ESP32 / ESP32-S3 telemetry client for the team API.
// Arduino IDE: board "ESP32S3 Dev Module". Libraries: ArduinoJson (v7).
// Copy secrets.example.h to secrets.h (git-ignored) and fill it in.
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "secrets.h"  // WIFI_SSID, WIFI_PASS, API_BASE, DEVICE_KEY

const uint32_t SEND_EVERY_MS = 5000;
const int DOOR_PIN = 4;        // reed switch to GND, internal pull-up
uint32_t lastSend = 0;

float readTempC() {
  // Replace with DS18B20 / DHT11 read. Synthetic value keeps the pipeline testable.
  return 4.0 + (millis() % 10000) / 2000.0;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  for (int i = 0; WiFi.status() != WL_CONNECTED && i < 40; i++) { delay(250); Serial.print('.'); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " ok" : " FAILED");
}

bool postJson(const char* path, JsonDocument& doc) {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  WiFiClientSecure tls;
  tls.setInsecure();  // hackathon shortcut; pin Cloudflare's root CA for anything real
  HTTPClient http;
  http.begin(tls, String(API_BASE) + path);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("POST %s -> %d %s\n", path, code, http.getString().c_str());
  http.end();
  return code >= 200 && code < 300;
}

void setup() {
  Serial.begin(115200);
  pinMode(DOOR_PIN, INPUT_PULLUP);
  connectWifi();
}

void loop() {
  static int lastDoor = -1;
  int door = digitalRead(DOOR_PIN);  // HIGH = magnet away = open
  if (door != lastDoor) {
    JsonDocument ev;
    ev["type"] = door ? "door.open" : "door.close";
    postJson("/api/events", ev);
    lastDoor = door;
  }
  if (millis() - lastSend >= SEND_EVERY_MS) {
    lastSend = millis();
    JsonDocument doc;
    JsonArray readings = doc["readings"].to<JsonArray>();
    JsonObject t = readings.add<JsonObject>();
    t["sensor"] = "temp_c"; t["value"] = readTempC(); t["unit"] = "C";
    JsonObject d = readings.add<JsonObject>();
    d["sensor"] = "door"; d["value"] = (bool)door;
    JsonObject r = readings.add<JsonObject>();
    r["sensor"] = "rssi"; r["value"] = WiFi.RSSI(); r["unit"] = "dBm";
    postJson("/api/ingest", doc);
  }
  delay(50);
}
