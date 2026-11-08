// Retained raw snapshots only; never replay these through canonical/generic ingest.
// Include after uplink.h and local_history.h in an Arduino sketch.
#pragma once
#include <ArduinoJson.h>
#include "local_history_core.h"

namespace history_sync {
constexpr size_t MAX_BATCH = 8, MAX_BODY = 4096, MAX_RESPONSE = 2048;
constexpr uint32_t INTERVAL_MS = 30000;
struct Cursor { uint32_t boot = 0, seq = 0; };
struct Batch {
  char body[MAX_BODY] = {};
  uint32_t boots[MAX_BATCH] = {}, sequences[MAX_BATCH] = {};
  size_t count = 0, length = 0;
};
inline void clear(Batch &batch) { batch.count = 0; batch.length = 0; batch.body[0] = 0; }
inline bool newer(const local_history::Sample &sample, const Cursor &cursor) {
  return boxMsgIsNewer(sample.boot, sample.seq, cursor.boot, cursor.seq);
}
inline bool prepare(Batch &batch, const local_history::State &state, const Cursor &cursor) {
  if (batch.count) return true; // retain exact serialized batch through failures/overwrites
  JsonDocument doc;
  doc["version"] = 1;
  if (!state.lastBoot || !state.lastSeq) return false;
  JsonObject snapshot = doc["snapshot"].to<JsonObject>();
  snapshot["boot"] = state.lastBoot; snapshot["seq"] = state.lastSeq;
  JsonArray samples = doc["samples"].to<JsonArray>();
  for (uint16_t i = 0; i < state.count && batch.count < MAX_BATCH; ++i) {
    const auto &s = state.samples[(state.head + local_history::CAPACITY - state.count + i) % local_history::CAPACITY];
    if (!newer(s, cursor)) continue;
    // Reject inconsistent local state; never repair timestamps using reconnect time.
    if (boxMsgIsNewer(s.boot, s.seq, state.lastBoot, state.lastSeq) || !s.boot || !s.seq || bool(s.flags & F_TIME_VALID) != bool(s.epoch) ||
        (s.epoch && s.epoch < 1700000000u) || (s.flags & ~0x17f1fu)) { clear(batch); return false; }
    if (batch.count && !boxMsgIsNewer(s.boot, s.seq, batch.boots[batch.count - 1], batch.sequences[batch.count - 1])) { clear(batch); return false; }
    JsonObject row = samples.add<JsonObject>();
    row["boot"] = s.boot; row["seq"] = s.seq; row["epoch"] = s.epoch;
    row["uptimeMs"] = s.uptimeMs; row["flags"] = s.flags;
    row["waterRaw"] = s.waterRaw; row["flameRaw"] = s.flameRaw;
    row["accelMilliG"] = s.accelMilliG; row["batteryMv"] = s.batteryMv; row["soundHits"] = s.soundHits;
    batch.boots[batch.count] = s.boot; batch.sequences[batch.count] = s.seq; ++batch.count;
  }
  if (!batch.count) return false;
  JsonObject metrics = doc["metrics"].to<JsonObject>();
  const char *names[] = {"water_raw", "flame_raw", "accel_dev_mg", "battery_mv"};
  for (int i = 0; i < local_history::METRIC_COUNT; ++i) {
    const auto &m = state.metrics[i];
    if (!m.count || m.firstEpoch < 1700000000u || m.lastEpoch < m.firstEpoch) continue;
    JsonObject row = metrics[names[i]].to<JsonObject>();
    row["count"] = m.count; row["sum"] = m.sum; row["min"] = m.min; row["max"] = m.max;
    row["firstEpoch"] = m.firstEpoch; row["lastEpoch"] = m.lastEpoch;
  }
  doc["overwritten"] = state.overwritten;
  const size_t size = measureJson(doc);
  if (doc.overflowed() || size >= MAX_BODY) { clear(batch); return false; }
  batch.length = serializeJson(doc, batch.body, sizeof(batch.body));
  if (batch.length != size) { clear(batch); return false; }
  return true;
}
inline bool acknowledge(Batch &batch, Cursor &cursor, const char *response, size_t length) {
  if (!batch.count || !length || length > MAX_RESPONSE) return false;
  JsonDocument doc;
  if (deserializeJson(doc, response, length, DeserializationOption::NestingLimit(4))) return false;
  if (!doc["version"].is<int>() || doc["version"].as<int>() != 1 ||
      !doc["stored"].is<unsigned>() || doc["stored"].as<unsigned>() != batch.count || !doc["accepted"].is<JsonArray>()) return false;
  JsonArray accepted = doc["accepted"].as<JsonArray>();
  if (accepted.size() != batch.count) return false;
  for (size_t i = 0; i < batch.count; ++i) {
    char id[24]; snprintf(id, sizeof(id), "%u:%u", batch.boots[i], batch.sequences[i]);
    unsigned matches = 0;
    for (JsonVariant value : accepted) if (value.is<const char *>() && !strcmp(value.as<const char *>(), id)) ++matches;
    if (matches != 1) return false;
  }
  cursor.boot = batch.boots[batch.count - 1]; cursor.seq = batch.sequences[batch.count - 1];
  clear(batch);
  return true;
}

#ifdef ARDUINO
// Bound the HTTP response, including chunked bodies. Never getString().
class ResponseBuffer : public Stream {
 public:
  char bytes[MAX_RESPONSE + 1] = {};
  size_t length = 0;
  bool overflow = false;
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
  size_t write(uint8_t b) override { return write(&b, 1); }
  size_t write(const uint8_t *data, size_t n) override {
    if (n > MAX_RESPONSE - length) { overflow = true; return 0; }
    memcpy(bytes + length, data, n); length += n; bytes[length] = 0; return n;
  }
};
static Batch pending;
static Cursor cursor;
static bool stopped = false, attempted = false;
static uint32_t lastAttempt = 0, acknowledged = 0, failures = 0;
inline void print() {
  Serial.printf("[history-sync] cursor=%u:%u pending=%u acknowledged=%u failures=%u paused=%d; bounded retained samples only\n", cursor.boot, cursor.seq, unsigned(pending.count), acknowledged, failures, stopped);
}
inline void loop() {
  if (stopped || !local_history::identityReady || !uplink::wifiUp()) return;
  const uint32_t now = millis();
  if (attempted && uint32_t(now - lastAttempt) < INTERVAL_MS) return;
  attempted = true; lastAttempt = now;
  const MeshNodeCfg *self = mesh::nodeCfg(mesh::myId);
  if (!self || !self->deviceKey || !self->deviceKey[0]) return;
  if (!prepare(pending, local_history::state, cursor)) return;
  if (!uplink::apiBase || strncmp(uplink::apiBase, "https://", 8)) {
    stopped = true; Serial.println("[history-sync] paused: verified HTTPS base required"); return;
  }
  WiFiClientSecure tls; tls.setCACert(ROOT_CA_BUNDLE);
  HTTPClient http; http.setTimeout(5000); http.setConnectTimeout(5000);
  if (!http.begin(tls, String(uplink::apiBase) + "/api/device/history-sync")) { local_history::increment(failures); return; }
  http.addHeader("X-Device-Key", self->deviceKey);
  http.addHeader("Content-Type", "application/json");
  const int status = http.POST(reinterpret_cast<uint8_t *>(pending.body), pending.length);
  if (status == 409 || status == 400 || status == 401 || status == 403 || status == 404 || status == 413 || status == 422) {
    stopped = true;
    Serial.printf("[history-sync] HTTP %d paused for review; batch retained, no cursor advance\n", status);
  } else if (status == 200 && http.getSize() <= int(MAX_RESPONSE)) {
    ResponseBuffer response;
    const int read = http.writeToStream(&response);
    const size_t sent = pending.count;
    if (read >= 0 && !response.overflow && acknowledge(pending, cursor, response.bytes, response.length)) {
      for (size_t i = 0; i < sent; ++i) local_history::increment(acknowledged);
    } else { local_history::increment(failures); Serial.println("[history-sync] invalid/incomplete ACK; same batch retained"); }
  } else { local_history::increment(failures); Serial.printf("[history-sync] HTTP %d; same batch retained\n", status); }
  http.end();
}
#endif
} // namespace history_sync
