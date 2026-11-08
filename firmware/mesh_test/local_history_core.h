// Portable bounded recorder. It never changes detection thresholds or upload queues.
#pragma once
#include "box_protocol.h"
#include <stdint.h>
#include <limits.h>

namespace local_history {
constexpr uint32_t HISTORY_SAMPLE_MS = 5 * 60 * 1000, HISTORY_CHECKPOINT_MS = 15 * 60 * 1000;
constexpr uint16_t CAPACITY = 64;
constexpr uint32_t MAGIC = 0x48424831, VERSION = 1;
enum Metric { WATER_RAW, FLAME_RAW, ACCEL_DEV_MG, BATTERY_MV, METRIC_COUNT };
struct Policy { uint32_t requiredFlags; bool batteryRequired; int shakeMg; int soundHits; };
struct Sample {
  uint32_t boot, seq, epoch, uptimeMs, flags;
  uint16_t waterRaw, flameRaw, batteryMv, soundHits;
  int16_t accelMilliG;
};
struct MetricStats {
  uint32_t count, firstEpoch, lastEpoch;
  int32_t min, max;
  int64_t sum;
  double mean() const { return count ? double(sum) / count : 0; }
  bool reference() const { return count >= 30 && lastEpoch >= firstEpoch && lastEpoch - firstEpoch >= 172800; }
  void add(int value, uint32_t epoch) {
    if (count == UINT32_MAX) return; // bounded aggregate; no overflow or silent reset
    if (!count) { min = max = value; firstEpoch = epoch; }
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value; count++; lastEpoch = epoch;
  }
};
struct State {
  uint32_t magic = MAGIC, version = VERSION;
  uint32_t generation = 0, checksum = 0;
  uint32_t lastBoot = 0, lastSeq = 0, sampleBoot = 0, sampleMs = 0;
  uint32_t alertBoot = 0, alertMs = 0, latestQualifiedEpoch = 0;
  uint32_t overwritten = 0, skipped = 0, duplicates = 0, unknownTime = 0;
  uint16_t head = 0, count = 0;
  Sample samples[CAPACITY] = {};
  MetricStats metrics[METRIC_COUNT] = {};
};
inline void increment(uint32_t &n) { if (n != UINT32_MAX) ++n; }
inline uint32_t checksum(State s) {
  s.checksum = 0;
  const uint8_t *p = reinterpret_cast<const uint8_t *>(&s);
  uint32_t h = 2166136261u;
  for (unsigned i = 0; i < sizeof(s); ++i) { h ^= p[i]; h *= 16777619u; }
  return h;
}
inline bool valid(const State &s) {
  return s.magic == MAGIC && s.version == VERSION && s.count <= CAPACITY && s.head < CAPACITY && s.checksum == checksum(s);
}
inline bool hazardEvent(const MeshMsg &m) {
  return !strcmp(m.event, "water.detected") || !strcmp(m.event, "flame.detected") ||
    !strcmp(m.event, "tilt.detected") || !strcmp(m.event, "shaking.detected") ||
    !strcmp(m.event, "alarm.sound") || !strcmp(m.event, "power.lost") || !strcmp(m.event, "help.request");
}
inline bool observe(State &s, const MeshMsg &m, bool own, uint32_t uptimeMs, const Policy &policy) {
  if (!own || (m.type != MSG_READING && m.type != MSG_EVENT)) return false;
  if (!boxMsgIsNewer(m.boot, m.seq, s.lastBoot, s.lastSeq)) { increment(s.duplicates); return false; }
  s.lastBoot = m.boot; s.lastSeq = m.seq;
  if (m.type == MSG_EVENT) {
    if (hazardEvent(m)) { s.alertBoot = m.boot; s.alertMs = uptimeMs; }
    return false;
  }
  if (s.count && s.sampleBoot == m.boot && uint32_t(uptimeMs - s.sampleMs) < HISTORY_SAMPLE_MS) { increment(s.skipped); return false; }
  s.sampleBoot = m.boot; s.sampleMs = uptimeMs;
  const bool timed = (m.flags & F_TIME_VALID) && m.epoch >= 1700000000u;
  Sample sample = { m.boot, m.seq, timed ? m.epoch : 0, uptimeMs, m.flags,
    m.waterRaw, m.flameRaw, m.batteryMv, m.soundHits, m.accelMilliG };
  if (!timed) { sample.flags &= ~F_TIME_VALID; increment(s.unknownTime); }
  if (s.count == CAPACITY) increment(s.overwritten); else ++s.count;
  s.samples[s.head] = sample; s.head = (s.head + 1) % CAPACITY;
  const bool alertHold = s.alertBoot && (s.alertBoot != m.boot || uint32_t(uptimeMs - s.alertMs) < HISTORY_CHECKPOINT_MS);
  // After reboot retain an alert exclusion for the first checkpoint interval.
  const bool alert = alertHold && (s.alertBoot == m.boot || uptimeMs < HISTORY_CHECKPOINT_MS);
  const uint32_t hazards = F_WATER | F_FLAME | F_TILT;
  const bool qualified = timed && m.epoch >= s.latestQualifiedEpoch && !alert &&
    (m.flags & policy.requiredFlags) == policy.requiredFlags &&
    (m.flags & F_MAINS_VALID) && (m.flags & F_MAINS) && !(m.flags & hazards) &&
    (!(m.flags & F_ACCEL_VALID) || (m.accelMilliG >= 0 && m.accelMilliG < policy.shakeMg)) &&
    (!(m.flags & F_SOUND_VALID) || m.soundHits < policy.soundHits) &&
    (!policy.batteryRequired || (m.batteryMv >= 6600 && m.batteryMv <= 12000));
  if (qualified) {
    s.latestQualifiedEpoch = m.epoch;
    if ((m.flags & F_WATER_VALID) && m.waterRaw <= 4095) s.metrics[WATER_RAW].add(m.waterRaw, m.epoch);
    if ((m.flags & F_FLAME_VALID) && m.flameRaw <= 4095) s.metrics[FLAME_RAW].add(m.flameRaw, m.epoch);
    if (m.flags & F_ACCEL_VALID) s.metrics[ACCEL_DEV_MG].add(m.accelMilliG, m.epoch);
    if (m.batteryMv >= 6600 && m.batteryMv <= 12000) s.metrics[BATTERY_MV].add(m.batteryMv, m.epoch);
  }
  return true;
}
} // namespace local_history
