// NVS checkpoint adapter; include after mesh.h. No network traffic or secret output.
#pragma once
#include <Preferences.h>
#include "local_history_core.h"

namespace local_history {
static State state;
static Policy policy;
static Preferences storage;
static bool storageOk = false, identityReady = false, dirty = false, attempted = false;
static uint32_t lastAttemptMs = 0, writeFailures = 0;
static int activeSlot = -1;
inline bool validDeviceId(const char *id) {
  if (!id || strlen(id) != 24) return false;
  for (int i = 0; i < 24; ++i) if (!((id[i] >= '0' && id[i] <= '9') || (id[i] >= 'a' && id[i] <= 'f') || (id[i] >= 'A' && id[i] <= 'F'))) return false;
  return true;
}
inline void begin(Policy p, const char *deviceId) {
  policy = p;
  state = State{}; activeSlot = -1; dirty = false; attempted = false;
  identityReady = false; storageOk = false;
  if (!validDeviceId(deviceId)) { Serial.println("[history] invalid device identity; restore/sync disabled"); return; }
  storageOk = storage.begin("hb_history", false);
  if (!storageOk) { Serial.println("[history] NVS unavailable; RAM only, sync disabled"); return; }
  char expected[25] = {}, savedId[25] = {};
  for (int i = 0; i < 24; ++i) expected[i] = deviceId[i] >= 'A' && deviceId[i] <= 'F' ? deviceId[i] + ('a' - 'A') : deviceId[i];
  const bool sameIdentity = storage.getBytesLength("identity") == sizeof(savedId) &&
    storage.getBytes("identity", savedId, sizeof(savedId)) == sizeof(savedId) && !memcmp(savedId, expected, sizeof(savedId));
  if (!sameIdentity) {
    // Delete both old slots BEFORE committing the new identity. Interrupted reset
    // cannot associate old-home samples with the newly provisioned device.
    for (const char *key : {"slot0", "slot1"}) {
      if (storage.getBytesLength(key) && (!storage.remove(key) || storage.getBytesLength(key))) {
        storageOk = false; Serial.println("[history] identity reset failed; restore/sync disabled"); return;
      }
    }
    if (storage.putBytes("identity", expected, sizeof(expected)) != sizeof(expected) ||
        storage.getBytes("identity", savedId, sizeof(savedId)) != sizeof(savedId) || memcmp(savedId, expected, sizeof(savedId))) {
      storageOk = false; Serial.println("[history] identity binding failed; restore/sync disabled"); return;
    }
    Serial.println("[history] new/changed identity: prior unbound or other-device history cleared");
  }
  identityReady = true;
  State candidate;
  for (int slot = 0; slot < 2; ++slot) {
    const char *key = slot ? "slot1" : "slot0";
    if (storage.getBytesLength(key) == sizeof(State) && storage.getBytes(key, &candidate, sizeof(candidate)) == sizeof(candidate) && valid(candidate)) {
      if (activeSlot < 0 || int32_t(candidate.generation - state.generation) > 0) { state = candidate; activeSlot = slot; }
    }
  }
  Serial.printf("[history] NVS %s retained=%u capacity=%u checkpoint=15min samples=5min\n", activeSlot < 0 ? "new/invalid" : "restored", state.count, CAPACITY);
}
inline void checkpoint(uint32_t now) {
  if (!dirty || !storageOk || (attempted && uint32_t(now - lastAttemptMs) < HISTORY_CHECKPOINT_MS)) return;
  attempted = true; lastAttemptMs = now;
  State saved = state; saved.generation++; saved.checksum = checksum(saved);
  const int next = activeSlot == 0 ? 1 : 0;
  if (storage.putBytes(next ? "slot1" : "slot0", &saved, sizeof(saved)) == sizeof(saved)) {
    state.generation = saved.generation; state.checksum = saved.checksum; activeSlot = next; dirty = false;
  } else { increment(writeFailures); Serial.println("[history] checkpoint failed; recent samples remain RAM only"); }
}
inline void observe(const MeshMsg &m, bool own) {
  if (!own) return;
  const uint32_t now = millis();
  const bool retained = observe(state, m, own, now, policy);
  dirty = true;
  // First retained reading is saved immediately; subsequent attempts are rate limited.
  if (retained) checkpoint(now);
}
inline void loop() { checkpoint(millis()); }
inline void print() {
  Serial.printf("[history] retained=%u/%u overwritten=%u decimated=%u duplicates=%u unknown_time=%u nvs=%d identity_ready=%d unsaved=%d write_failures=%u bytes_per_slot=%u\n",
    state.count, CAPACITY, state.overwritten, state.skipped, state.duplicates, state.unknownTime, storageOk, identityReady, dirty, writeFailures, unsigned(sizeof(State)));
  const char *names[] = {"water_raw", "flame_raw", "accel_dev_mg", "battery_mv"};
  const char *units[] = {"ADC", "ADC", "mg", "mV"};
  for (int i = 0; i < METRIC_COUNT; ++i) {
    const MetricStats &m = state.metrics[i];
    if (!m.count) { Serial.printf("[history] %s insufficient_history count=0\n", names[i]); continue; }
    Serial.printf("[history] %s %s count=%u mean=%.2f min=%d max=%d unit=%s first_epoch=%u last_epoch=%u%s\n", names[i], m.reference() ? "observed_reference" : "insufficient_history", m.count, m.mean(), m.min, m.max, units[i], m.firstEpoch, m.lastEpoch, m.count == UINT32_MAX ? " aggregate_full" : "");
  }
  for (uint16_t i = 0; i < state.count; ++i) {
    const Sample &s = state.samples[(state.head + CAPACITY - state.count + i) % CAPACITY];
    Serial.printf("[history-sample] boot=%u seq=%u epoch=%u time=%s uptime_ms=%u flags=%u water_raw=%u flame_raw=%u accel_dev_mg=%d battery_mv=%u sound_hits=%u\n", s.boot, s.seq, s.epoch, (s.flags & F_TIME_VALID) ? "device" : "unknown", s.uptimeMs, s.flags, s.waterRaw, s.flameRaw, s.accelMilliG, s.batteryMv, s.soundHits);
  }
  Serial.println("[history] Observed reference only. Fixed alarms unchanged. Not an upload queue. Up to 15min since checkpoint can be lost on power failure.");
}
} // namespace local_history
