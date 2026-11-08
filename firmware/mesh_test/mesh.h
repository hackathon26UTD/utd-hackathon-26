// HomeBeacon ESP-NOW mesh (header-only; include once from the sketch).
//
// Every box relays for its neighbours. A box whose Internet works is a *gateway*: it uploads
// messages (its own and relayed ones) and sends an ACK back through the mesh. Until an ACK
// arrives, the origin box keeps the message and re-floods it, so data survives a period where
// no box has Internet and is delivered once any box finds a connection.
//
// Security: every link is a unicast AES-128 (CCMP) encrypted ESP-NOW peer from the provisioned
// MAC list; frames from unknown or wrongly keyed senders are discarded by the radio. Messages
// carry (origin, boot, seq): duplicates and replays are ignored, and TTL bounds flooding.
// Limitation: all boxes must share a Wi-Fi channel (the hotspot's when visible, else fallback).
#pragma once
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_idf_version.h>
#include <Preferences.h>
#include "box_protocol.h"

namespace mesh {

constexpr int MAX_NODES = 8;           // ESP-NOW allows ~7 encrypted peers by default
constexpr int PENDING_MAX = 48;        // own messages waiting for an ACK
constexpr int SEEN_MAX = 128;          // recently forwarded message keys
constexpr int DELIVERED_MAX = 256;     // messages this gateway already queued for upload
constexpr uint32_t FORWARD_WINDOW_MS = 1500;   // suppress re-forwarding the same key (loop guard)
constexpr uint32_t RESEND_MS = 4000;           // re-flood unacknowledged own messages
constexpr uint32_t BEACON_MS = 5000;           // gateway announcement interval
constexpr uint32_t GATEWAY_STALE_MS = 20000;   // forget a gateway after this

struct Node { char id[NODE_ID_LEN]; uint8_t mac[6]; const MeshNodeCfg *cfg; };
struct Rx { uint8_t mac[6]; int len; MeshMsg m; };
struct Pending { MeshMsg m; uint32_t lastSent; uint16_t tries; bool used; };

// ── state ──
Node nodes[MAX_NODES]; int nodeCount = 0; int selfIdx = -1;
char myId[NODE_ID_LEN] = {0};
uint32_t bootCount = 0, seqCounter = 0;
bool isOnline = false, ready = false;
volatile bool txPaused = false;  // set by the uplink while Wi-Fi is joining: ESP-NOW traffic breaks the join handshake
QueueHandle_t rxq;
Pending pending[PENDING_MAX];
struct Seen { uint32_t key; uint32_t ms; } seen[SEEN_MAX]; int seenNext = 0;
uint32_t delivered[DELIVERED_MAX]; int deliveredNext = 0;
uint32_t lastBeaconSent = 0, gatewaySeenAt = 0; char gatewayId[NODE_ID_LEN] = {0}; uint8_t gatewayHops = 0;
uint32_t statRx = 0, statForwarded = 0, statRejected = 0, statAcked = 0, statDropped = 0;
volatile uint32_t statTxOk = 0, statTxFail = 0; uint32_t statSendErr = 0;  // radio-level delivery to the next box
uint32_t lastRxAt = 0;

// Callbacks provided by the sketch.
bool (*onDeliver)(const MeshMsg &) = nullptr;           // gateway: queue for upload; return true to ACK
void (*onObserve)(const MeshMsg &, bool own) = nullptr; // every new data message (logging / hub)
void (*onTime)(uint32_t epoch) = nullptr;               // time learned from a gateway beacon/ACK

// ── helpers ──
bool timeValid() { return time(nullptr) > 1700000000; }
uint32_t nowEpoch() { return timeValid() ? (uint32_t)time(nullptr) : 0; }
const Node *nodeByMac(const uint8_t *mac) { for (int i = 0; i < nodeCount; i++) if (!memcmp(nodes[i].mac, mac, 6)) return &nodes[i]; return nullptr; }
const MeshNodeCfg *nodeCfg(const char *id) { for (int i = 0; i < nodeCount; i++) if (!strncmp(nodes[i].id, id, NODE_ID_LEN)) return nodes[i].cfg; return nullptr; }
bool gatewayKnown() { return gatewaySeenAt && millis() - gatewaySeenAt < GATEWAY_STALE_MS; }

bool recentlyForwarded(uint32_t key) {
  uint32_t now = millis();
  for (auto &s : seen) if (s.key == key && s.ms && now - s.ms < FORWARD_WINDOW_MS) return true;
  seen[seenNext] = { key, now ? now : 1 }; seenNext = (seenNext + 1) % SEEN_MAX;
  return false;
}
bool alreadyDelivered(uint32_t key) { for (auto k : delivered) if (k == key) return true; return false; }
void markDelivered(uint32_t key) { delivered[deliveredNext] = key; deliveredNext = (deliveredNext + 1) % DELIVERED_MAX; }

void sendTo(const uint8_t *mac, const MeshMsg &m) { if (esp_now_send(mac, (const uint8_t *)&m, sizeof m) != ESP_OK) statSendErr++; }

// Radio-level result for each unicast frame: OK = the next box's radio acknowledged it.
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 5, 0)
void onSent(const esp_now_send_info_t *, esp_now_send_status_t st) { if (st == ESP_NOW_SEND_SUCCESS) statTxOk++; else statTxFail++; }
#else
void onSent(const uint8_t *, esp_now_send_status_t st) { if (st == ESP_NOW_SEND_SUCCESS) statTxOk++; else statTxFail++; }
#endif
void flood(const MeshMsg &m, const uint8_t *exceptMac = nullptr) {
  if (txPaused) return;  // held messages stay pending and are re-sent after the join
  for (int i = 0; i < nodeCount; i++) {
    if (i == selfIdx || (exceptMac && !memcmp(nodes[i].mac, exceptMac, 6))) continue;
    sendTo(nodes[i].mac, m);
  }
}

MeshMsg blank(uint8_t type) {
  MeshMsg m = {}; m.version = BOX_PROTOCOL_VERSION; m.type = type; m.ttl = MESH_TTL; m.hops = 0;
  strncpy(m.origin, myId, NODE_ID_LEN - 1);
  return m;
}

void sendAck(const MeshMsg &data) {
  MeshMsg a = blank(MSG_ACK);
  strncpy(a.dest, data.origin, NODE_ID_LEN - 1); strncpy(a.via, myId, NODE_ID_LEN - 1);
  a.boot = data.boot; a.seq = data.seq; a.epoch = nowEpoch(); if (a.epoch) a.flags |= F_TIME_VALID;
  recentlyForwarded(meshKey('K', a.dest, a.boot, a.seq));
  flood(a);
}

// ── receive path (radio task → queue → loop) ──
void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  Rx r; memcpy(r.mac, info->src_addr, 6); r.len = len;
  if (len == sizeof(MeshMsg)) memcpy(&r.m, data, len);
  xQueueSendFromISR(rxq, &r, nullptr);
}

void handleData(const Rx &r) {
  const MeshMsg &m = r.m;
  uint32_t key = meshKey('D', m.origin, m.boot, m.seq);
  if (!strncmp(m.origin, myId, NODE_ID_LEN)) return;  // my own message echoed back
  if (isOnline) {
    if (alreadyDelivered(key)) { sendAck(m); return; }  // ACK may have been lost: repeat it
    if (onObserve) onObserve(m, false);
    if (onDeliver && onDeliver(m)) { markDelivered(key); sendAck(m); }
    return;
  }
  if (recentlyForwarded(key)) return;
  if (onObserve) onObserve(m, false);
  if (m.ttl > 1) { MeshMsg f = m; f.ttl--; f.hops++; flood(f, r.mac); statForwarded++; }
}

void handleAck(const Rx &r) {
  const MeshMsg &a = r.m;
  if (onTime && (a.flags & F_TIME_VALID) && !timeValid()) onTime(a.epoch);
  gatewaySeenAt = millis(); strncpy(gatewayId, a.via, NODE_ID_LEN - 1); gatewayHops = a.hops + 1;
  if (!strncmp(a.dest, myId, NODE_ID_LEN)) {
    for (auto &p : pending) if (p.used && p.m.boot == a.boot && p.m.seq == a.seq) { p.used = false; statAcked++; }
    return;
  }
  if (recentlyForwarded(meshKey('K', a.dest, a.boot, a.seq))) return;
  if (a.ttl > 1) { MeshMsg f = a; f.ttl--; f.hops++; flood(f, r.mac); }
}

void handleBeacon(const Rx &r) {
  const MeshMsg &b = r.m;
  if (onTime && (b.flags & F_TIME_VALID) && !timeValid()) onTime(b.epoch);
  if (!gatewayKnown() || b.hops + 1 <= gatewayHops || !strncmp(gatewayId, b.via, NODE_ID_LEN)) {
    gatewaySeenAt = millis(); strncpy(gatewayId, b.via, NODE_ID_LEN - 1); gatewayHops = b.hops + 1;
  }
  if (recentlyForwarded(meshKey('B', b.via, b.boot, b.seq))) return;
  if (b.ttl > 1) { MeshMsg f = b; f.ttl--; f.hops++; flood(f, r.mac); }
}

void processRx() {
  Rx r;
  while (xQueueReceive(rxq, &r, 0) == pdTRUE) {
    if (!nodeByMac(r.mac) || r.len != sizeof(MeshMsg) || r.m.version != BOX_PROTOCOL_VERSION) { statRejected++; continue; }
    r.m.origin[NODE_ID_LEN - 1] = 0; r.m.dest[NODE_ID_LEN - 1] = 0; r.m.via[NODE_ID_LEN - 1] = 0; r.m.event[23] = 0;
    statRx++; lastRxAt = millis();
    switch (r.m.type) {
      case MSG_READING: case MSG_EVENT: handleData(r); break;
      case MSG_ACK: handleAck(r); break;
      case MSG_BEACON: handleBeacon(r); break;
      default: statRejected++;
    }
  }
}

// ── own messages ──
// Fill sensor fields and type; origin/boot/seq/ttl are set here. Delivered locally when this
// box is a gateway, otherwise flooded and kept until a gateway ACKs it.
void send(MeshMsg m) {
  m.version = BOX_PROTOCOL_VERSION; m.ttl = MESH_TTL; m.hops = 0;
  memset(m.origin, 0, NODE_ID_LEN); strncpy(m.origin, myId, NODE_ID_LEN - 1);
  m.boot = bootCount; m.seq = ++seqCounter;
  if (!m.epoch) { m.epoch = nowEpoch(); if (m.epoch) m.flags |= F_TIME_VALID; }
  if (onObserve) onObserve(m, true);
  if (isOnline && onDeliver && onDeliver(m)) { markDelivered(meshKey('D', m.origin, m.boot, m.seq)); return; }
  int slot = -1, victim = -1;
  for (int i = 0; i < PENDING_MAX; i++) {
    if (!pending[i].used) { slot = i; break; }
    // When full, drop the oldest READING first; events (help, flood, fire) are kept longest.
    if (victim < 0 || (pending[i].m.type == MSG_READING && pending[victim].m.type != MSG_READING) ||
        (pending[i].m.type == pending[victim].m.type && pending[i].m.seq < pending[victim].m.seq)) victim = i;
  }
  if (slot < 0) { slot = victim; statDropped++; }
  pending[slot] = { m, millis(), 1, true };
  flood(m);
}

int pendingCount() { int n = 0; for (auto &p : pending) n += p.used; return n; }

// Call when this box gains/loses working Internet.
void setOnline(bool on) {
  if (on == isOnline) return;
  isOnline = on;
  Serial.printf("[mesh] this box is %s\n", on ? "a GATEWAY (Internet OK)" : "offline: relaying through the mesh");
  if (!on) return;
  for (auto &p : pending) if (p.used && onDeliver && onDeliver(p.m)) { markDelivered(meshKey('D', p.m.origin, p.m.boot, p.m.seq)); p.used = false; }
}

void loop() {
  processRx();
  uint32_t now = millis();
  // Re-send a few held messages per pass (oldest first) so a large backlog does not flood the air.
  static uint32_t lastResendPass = 0;
  if (now - lastResendPass >= 500) {
    lastResendPass = now;
    for (int sent = 0; sent < 3; sent++) {
      Pending *oldest = nullptr;
      for (auto &p : pending) if (p.used && now - p.lastSent >= RESEND_MS && (!oldest || p.lastSent < oldest->lastSent)) oldest = &p;
      if (!oldest) break;
      oldest->lastSent = now; oldest->tries++;
      MeshMsg f = oldest->m; flood(f);
    }
  }
  if (isOnline && now - lastBeaconSent > BEACON_MS) {
    lastBeaconSent = now;
    MeshMsg b = blank(MSG_BEACON); strncpy(b.via, myId, NODE_ID_LEN - 1);
    b.boot = bootCount; b.seq = ++seqCounter; b.epoch = nowEpoch(); if (b.epoch) b.flags |= F_TIME_VALID;
    recentlyForwarded(meshKey('B', b.via, b.boot, b.seq));
    flood(b);
  }
}

// nodesCfg: every box in the neighbourhood (including this one). Call after WiFi.mode(WIFI_STA).
bool begin(const char *selfId, const MeshNodeCfg *nodesCfg, int n, const char *pmkHex, const char *lmkHex) {
  uint8_t pmk[16], lmk[16];
  strncpy(myId, selfId, NODE_ID_LEN - 1);
  if (!parseKey16(pmkHex, pmk) || !parseKey16(lmkHex, lmk)) { Serial.println("[mesh] bad ESP-NOW keys in secrets.h"); return false; }
  Preferences p; p.begin("mesh", false); bootCount = p.getUInt("boot", 0) + 1; p.putUInt("boot", bootCount); p.end();
  rxq = xQueueCreate(24, sizeof(Rx));
  // Keep the radio listening: with modem sleep an unconnected ESP32 can miss ESP-NOW frames.
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  if (esp_now_init() != ESP_OK) return false;
  esp_now_set_pmk(pmk);
  for (int i = 0; i < n && nodeCount < MAX_NODES; i++) {
    Node &nd = nodes[nodeCount];
    memset(nd.id, 0, NODE_ID_LEN); strncpy(nd.id, nodesCfg[i].id, NODE_ID_LEN - 1); nd.cfg = &nodesCfg[i];
    if (!parseMac(nodesCfg[i].mac, nd.mac)) { Serial.printf("[mesh] bad MAC for %s\n", nodesCfg[i].id); continue; }
    if (!strcmp(nd.id, myId)) { selfIdx = nodeCount; nodeCount++; continue; }
    esp_now_peer_info_t peer = {}; memcpy(peer.peer_addr, nd.mac, 6); peer.channel = 0; peer.ifidx = WIFI_IF_STA;
    peer.encrypt = true; memcpy(peer.lmk, lmk, 16);  // CCMP: unencrypted or wrongly keyed frames are dropped
    if (esp_now_add_peer(&peer) != ESP_OK) { Serial.printf("[mesh] could not add peer %s\n", nd.id); continue; }
    nodeCount++;
  }
  esp_now_register_recv_cb(onRecv);
  esp_now_register_send_cb(onSent);
  if (selfIdx < 0) Serial.printf("[mesh] warning: MY_NODE_ID %s is not in MESH_NODES\n", myId);
  ready = true;
  return true;
}

void printStatus() {
  Serial.printf("[mesh] me=%s boot=%u role=%s peers=%d pending=%d rx=%u fwd=%u acked=%u rejected=%u dropped=%u\n",
    myId, bootCount, isOnline ? "GATEWAY" : "relay", nodeCount - (selfIdx >= 0), pendingCount(), statRx, statForwarded, statAcked, statRejected, statDropped);
  Serial.printf("[mesh] radio: sent ok=%u failed=%u send-errors=%u (failed = next box did not hear it)\n", (unsigned)statTxOk, (unsigned)statTxFail, (unsigned)statSendErr);
  Serial.printf("[mesh] gateway: %s\n", isOnline ? "this box" : gatewayKnown() ? (String(gatewayId) + " (" + gatewayHops + " hops, " + (millis() - gatewaySeenAt) / 1000 + " s ago)").c_str() : "none heard: holding messages until one appears");
}

}  // namespace mesh
