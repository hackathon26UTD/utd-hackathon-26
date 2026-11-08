// Shared ESP-NOW mesh message format for HomeBeacon boxes.
// Edit in firmware/common/, then `npm run firmware:sync` copies it into each sketch.
#pragma once
#include <stdint.h>
#include <string.h>
#include <stdio.h>

#define BOX_PROTOCOL_VERSION 2
#define MESH_TTL 5          // max hops a message travels
#define NODE_ID_LEN 6       // "A", "B", "C"... (NUL-terminated)

enum MeshType : uint8_t {
  MSG_READING = 1,  // periodic sensor snapshot from `origin`
  MSG_EVENT   = 2,  // discrete event from `origin`
  MSG_ACK     = 3,  // gateway -> `dest`: your (boot, seq) reached the cloud queue
  MSG_BEACON  = 4,  // "I am a gateway with working Internet" (carries the time)
};

// Flag bits (MeshMsg.flags)
enum : uint32_t {
  F_MOTION = 1u << 0, F_FLAME = 1u << 1, F_TILT = 1u << 2, F_MAINS = 1u << 3, F_WATER = 1u << 4,
  F_MOTION_VALID = 1u << 8, F_FLAME_VALID = 1u << 9, F_TILT_VALID = 1u << 10, F_MAINS_VALID = 1u << 11,
  F_WATER_VALID = 1u << 12, F_ACCEL_VALID = 1u << 13, F_SOUND_VALID = 1u << 14,
  F_TIME_VALID = 1u << 16,  // epoch is real (NTP/RTC/mesh), not a guess
};

// Packed so all boards agree on the layout. Must stay <= 250 bytes (ESP-NOW limit).
struct __attribute__((packed)) MeshMsg {
  uint8_t  version;            // BOX_PROTOCOL_VERSION
  uint8_t  type;               // MeshType
  uint8_t  ttl;                // hops remaining
  uint8_t  hops;               // hops travelled so far
  char     origin[NODE_ID_LEN];// box that created the message
  char     dest[NODE_ID_LEN];  // ACK only: box the ACK is for
  char     via[NODE_ID_LEN];   // gateway that acknowledged (ACK) / announced (BEACON)
  uint32_t boot;               // origin's persisted boot counter: replays after reboot are rejected
  uint32_t seq;                // origin's per-boot sequence number
  uint32_t epoch;              // unix seconds observed (valid if F_TIME_VALID)
  uint32_t flags;
  uint16_t waterRaw, flameRaw, batteryMv, soundHits;
  int16_t  accelMilliG;
  char     event[24];          // MSG_EVENT name, e.g. "help.request"
};

static_assert(sizeof(MeshMsg) <= 250, "MeshMsg exceeds ESP-NOW payload limit");

inline bool boxMsgIsNewer(uint32_t boot, uint32_t seq, uint32_t lastBoot, uint32_t lastSeq) {
  return boot > lastBoot || (boot == lastBoot && seq > lastSeq);
}

// 32-bit FNV-1a over (type class, origin, boot, seq): identifies a message across hops.
inline uint32_t meshKey(char kind, const char *origin, uint32_t boot, uint32_t seq) {
  uint32_t h = 2166136261u;
  auto mix = [&](uint8_t b) { h ^= b; h *= 16777619u; };
  mix((uint8_t)kind);
  for (int i = 0; i < NODE_ID_LEN && origin[i]; i++) mix((uint8_t)origin[i]);
  for (int i = 0; i < 4; i++) mix((uint8_t)(boot >> (8 * i)));
  for (int i = 0; i < 4; i++) mix((uint8_t)(seq >> (8 * i)));
  return h;
}

inline bool parseMac(const char *s, uint8_t out[6]) {
  unsigned v[6];
  if (!s || sscanf(s, "%x:%x:%x:%x:%x:%x", &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]) != 6) return false;
  for (int i = 0; i < 6; i++) { if (v[i] > 255) return false; out[i] = (uint8_t)v[i]; }
  return true;
}

inline bool parseKey16(const char *hex, uint8_t out[16]) {
  if (!hex || strlen(hex) != 32) return false;
  for (int i = 0; i < 16; i++) { unsigned b; if (sscanf(hex + 2 * i, "%2x", &b) != 1) return false; out[i] = (uint8_t)b; }
  return true;
}

// One entry per box in the neighborhood (from secrets.h MESH_NODES).
struct MeshNodeCfg { const char *id; const char *mac; const char *deviceId; const char *deviceKey; };
