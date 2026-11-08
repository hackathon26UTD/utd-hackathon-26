// HomeBeacon MESH TEST: just the encrypted ESP-NOW mesh, no sensors, no cloud.
// Flash the same sketch to two (or more) ESP32 boards; change only MY_NODE_ID per board.
//
//  - Every box sends a numbered "hello" into the mesh every 3 s.
//  - The box that has WIFI_PASS and connects is the GATEWAY: it prints every hello it
//    receives (with hop count) and ACKs it back through the mesh.
//  - The other box prints "ACK from gateway" for each hello, or keeps it and re-sends until one does.
//  - Turn the hotspot off: hellos pile up as "waiting". Turn it back on: they are all delivered.
//
// Steps:
//  1. Flash to both boards with placeholder MACs. Serial Monitor 115200, type `mac`, write both down.
//  2. Fill the two MACs below (same on both boards), set MY_NODE_ID "A" on one and "B" on the other.
//  3. Put the hotspot name in WIFI_SSID on BOTH boards (the non-gateway uses it to find the gateway's
//     channel). Put WIFI_PASS only on the gateway board; leave it "" on the other.
//  4. Watch both serial monitors. Commands: help | mac | mesh | ping | wifi
// Works on ESP32 Dev Module and XIAO ESP32S3 (any ESP32 board).

// ───────── edit these ─────────
#define MY_NODE_ID   "A"          // "A" on one board, "B" on the other
#define WIFI_SSID    ""           // hotspot name (2.4 GHz) on BOTH boards
#define WIFI_PASS    ""           // only on the gateway board; "" on the other
#define MAC_A        "AA:BB:CC:DD:EE:01"   // from `mac` on board A
#define MAC_B        "AA:BB:CC:DD:EE:02"   // from `mac` on board B
// Test keys: identical on both boards. Change one digit on one board to prove encryption (no ACKs).
#define ESPNOW_PMK   "00112233445566778899aabbccddeeff"
#define ESPNOW_LMK   "0f1e2d3c4b5a69788796a5b4c3d2e1f0"
#define FALLBACK_CHANNEL 1
#define HELLO_MS     3000
// ──────────────────────────────

#include <WiFi.h>
#include "mesh.h"

static const MeshNodeCfg NODES[] = {
  { "A", MAC_A, "", "" },
  { "B", MAC_B, "", "" },
};

uint32_t lastHello = 0, lastWifiTry = 0, helloCount = 0, ackedBefore = 0;

bool deliver(const MeshMsg &m) {  // runs on the gateway
  Serial.printf(">>> GATEWAY got %-12s from box %s  seq %u  hops %u  -> ACK\n", m.event, m.origin, m.seq, m.hops);
  return true;
}
void observe(const MeshMsg &m, bool own) {
  if (!own && !mesh::isOnline) Serial.printf("    relaying %s from box %s seq %u (hops %u)\n", m.event, m.origin, m.seq, m.hops);
}
void setClock(uint32_t epoch) { struct timeval tv = { (time_t)epoch, 0 }; settimeofday(&tv, nullptr); Serial.println("[time] set from gateway"); }

void setChannel(uint8_t ch) { esp_wifi_set_promiscuous(true); esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE); esp_wifi_set_promiscuous(false); }

// Gateway joins Wi-Fi. Non-gateway sits on the hotspot's channel if it can see it, else the fallback.
void manageWifi() {
  if (WiFi.status() == WL_CONNECTED || millis() - lastWifiTry < 20000) return;
  lastWifiTry = millis();
  if (strlen(WIFI_SSID) && strlen(WIFI_PASS)) {
    Serial.println("[wifi] connecting...");
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint32_t t0 = millis(); while (WiFi.status() != WL_CONNECTED && millis() - t0 < 10000) { delay(100); mesh::processRx(); }
    if (WiFi.status() == WL_CONNECTED) { Serial.printf("[wifi] connected on channel %d -> this box is the GATEWAY\n", WiFi.channel()); configTime(0, 0, "pool.ntp.org"); return; }
    WiFi.disconnect(false, false);
  }
  uint8_t ch = FALLBACK_CHANNEL;
  int n = WiFi.scanNetworks(false, false, false, 120);
  for (int i = 0; i < n; i++) if (strlen(WIFI_SSID) && WiFi.SSID(i) == WIFI_SSID) { ch = WiFi.channel(i); break; }
  WiFi.scanDelete(); setChannel(ch);
  Serial.printf("[wifi] not connected; mesh on channel %u\n", ch);
}

void setup() {
  Serial.begin(115200); delay(1500);
  Serial.printf("\n=== HomeBeacon mesh test: box %s ===\n", MY_NODE_ID);
  WiFi.mode(WIFI_STA);
  Serial.printf("my MAC: %s\n", WiFi.macAddress().c_str());
  mesh::onDeliver = deliver; mesh::onObserve = observe; mesh::onTime = setClock;
  if (!mesh::begin(MY_NODE_ID, NODES, 2, ESPNOW_PMK, ESPNOW_LMK)) Serial.println("mesh init FAILED (check keys)");
  lastWifiTry = millis() - 20000; manageWifi();
  Serial.println("Commands: help | mac | mesh | ping | wifi");
}

void loop() {
  mesh::loop();
  manageWifi();
  mesh::setOnline(WiFi.status() == WL_CONNECTED);  // in the test, Wi-Fi = gateway (no cloud upload)

  if (millis() - lastHello > HELLO_MS) {
    lastHello = millis();
    MeshMsg m = {}; m.type = MSG_EVENT; snprintf(m.event, sizeof m.event, "hello#%u", ++helloCount);
    mesh::send(m);
    if (!mesh::isOnline) Serial.printf("sent hello#%u  (waiting for ACK: %d)\n", helloCount, mesh::pendingCount());
  }
  if (mesh::statAcked != ackedBefore) {
    Serial.printf("<<< ACK from gateway %s (%u hops away) - total acked %u, still waiting %d\n", mesh::gatewayId, mesh::gatewayHops, mesh::statAcked, mesh::pendingCount());
    ackedBefore = mesh::statAcked;
  }

  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n'); cmd.trim();
    if (cmd == "mac") Serial.printf("[mac] %s\n", WiFi.macAddress().c_str());
    else if (cmd == "mesh") mesh::printStatus();
    else if (cmd == "wifi") Serial.printf("[wifi] %s channel %d\n", WiFi.status() == WL_CONNECTED ? "connected" : "not connected", WiFi.channel());
    else if (cmd == "ping") { MeshMsg m = {}; m.type = MSG_EVENT; strcpy(m.event, "ping"); mesh::send(m); Serial.println("ping sent"); }
    else Serial.println("Commands: help | mac | mesh | ping | wifi");
  }
  delay(5);
}
