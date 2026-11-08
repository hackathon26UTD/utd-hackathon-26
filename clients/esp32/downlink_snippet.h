// HomeBeacon downlink: pull operator "information boxes" and show them on the OLED.
// Include after your WiFi and secrets setup. Needs ArduinoJson 7 and a display routine you provide.
// Provide in secrets.h: API_BASE, DEVICE_KEY, CA_CERT (Cloudflare root CA PEM). Never use setInsecure().
// Contract: docs/LIVE_DOWNLINK.md and clients/esp32/DOWNLINK.md. Devices only dial out.
#pragma once
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "secrets.h"

// Provide these in your sketch. Title is at most 20 chars, body at most 80, printable ASCII.
void showBox(const char* title, const char* body, const char* severity);  // "info" | "advisory" | "urgent"
bool buttonPressed();                                                        // true when the person presses the ack button

static uint32_t hbCursor = 0;          // highest message seq already seen
static uint32_t hbPollAfterS = 30;     // server tells us how often to ask (10 while an urgent message is open)

static int hbRequest(const char* method, const String& path, const String& body, JsonDocument& out) {
  WiFiClientSecure tls;
  tls.setCACert(CA_CERT);
  HTTPClient http;
  http.begin(tls, String(API_BASE) + path);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.addHeader("Content-Type", "application/json");
  int code = String(method) == "GET" ? http.GET() : http.POST(body);
  if (code > 0) deserializeJson(out, http.getString());
  http.end();
  return code;
}

// Call after every accepted ingest. `pending` is messages_pending from the 202 response.
// On boot call it once with pending = 1 and hbCursor = 0 to pick up anything still live.
void hbPullMessages(int pending) {
  if (pending <= 0) return;
  JsonDocument doc;
  if (hbRequest("GET", "/api/device/messages?limit=3&after=" + String(hbCursor), "", doc) != 200) return;
  hbPollAfterS = doc["poll_after_s"] | 30;
  for (JsonObject m : doc["messages"].as<JsonArray>()) {
    showBox(m["title"] | "", m["body"] | "", m["severity"] | "info");
    JsonDocument ignore;
    String id = m["id"] | "";
    hbRequest("POST", "/api/device/messages", "{\"message_id\":\"" + id + "\",\"state\":\"shown\"}", ignore);
    if (m["requires_ack"] | false) {
      while (!buttonPressed()) delay(50);  // keep the screen up until confirmed; add your own timeout
      hbRequest("POST", "/api/device/messages", "{\"message_id\":\"" + id + "\",\"state\":\"acked\"}", ignore);
    }
  }
  hbCursor = doc["cursor"] | hbCursor;
}

// Optional: send up to 20 short log lines (msg is cut at 120 chars). level: debug|info|warn|error.
void hbLog(const char* level, const char* code, const char* msg) {
  JsonDocument ignore;
  String body = String("{\"entries\":[{\"level\":\"") + level + "\",\"code\":\"" + code + "\",\"msg\":\"" + msg + "\"}]}";
  hbRequest("POST", "/api/device/logs", body, ignore);
}
