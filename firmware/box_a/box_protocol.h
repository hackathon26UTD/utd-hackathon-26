// Shared ESP-NOW message format between HomeBeacon boxes.
// Edit this file in firmware/common/, then run `npm run firmware:sync` to copy it into each sketch.
#pragma once
#include <stdint.h>
#include <string.h>
#include <stdio.h>

#define BOX_PROTOCOL_VERSION 1

enum BoxMsgType : uint8_t {
  MSG_READING = 1,  // periodic sensor snapshot
  MSG_EVENT   = 2,  // discrete event (button, alarm, power lost)
  MSG_ACK     = 3,  // gateway -> sender: highest (boot, seq) received
};

// Flag bits in BoxMsg.flags
enum : uint16_t {
  F_MOTION        = 1 << 0,
  F_FLAME         = 1 << 1,
  F_TILT          = 1 << 2,
  F_MAINS         = 1 << 3,   // external (wall/USB) power present
  F_MAINS_VALID   = 1 << 4,   // mains sense is wired and was read
  F_WATER         = 1 << 5,
  F_WATER_VALID   = 1 << 6,
  F_ACCEL_VALID   = 1 << 7,
  F_FLAME_VALID   = 1 << 8,
  F_MOTION_VALID  = 1 << 9,
  F_TIME_VALID    = 1 << 10,  // epoch came from NTP/RTC, not a guess
  F_TILT_VALID    = 1 << 11,
};

// Packed so both boards agree on layout. Must stay <= 250 bytes (ESP-NOW limit).
struct __attribute__((packed)) BoxMsg {
  uint8_t  version;      // BOX_PROTOCOL_VERSION
  uint8_t  type;         // BoxMsgType
  char     box[8];       // sender id, e.g. "boxB"
  uint32_t boot;         // sender boot counter (persisted), defeats replay after reboot
  uint32_t seq;          // per-boot sequence number
  uint32_t epoch;        // unix seconds when observed (valid if F_TIME_VALID)
  uint16_t flags;
  uint16_t flameRaw;     // 0-4095 analog flame level (lower = stronger IR on most modules)
  uint16_t waterRaw;     // 0-4095 analog water level
  int16_t  accelMilliG;  // max |accel| deviation from 1 g in milli-g over the interval
  uint16_t batteryMv;    // 0 if not measured
  char     event[24];    // MSG_EVENT name, e.g. "help.request"
};

static_assert(sizeof(BoxMsg) <= 250, "BoxMsg exceeds ESP-NOW payload limit");

// Replay check: accept only messages newer than the last one seen from this sender.
inline bool boxMsgIsNewer(uint32_t boot, uint32_t seq, uint32_t lastBoot, uint32_t lastSeq) {
  return boot > lastBoot || (boot == lastBoot && seq > lastSeq);
}

// Parse "AA:BB:CC:DD:EE:FF" into 6 bytes. Returns false on bad input.
inline bool parseMac(const char *s, uint8_t out[6]) {
  unsigned v[6];
  if (!s || sscanf(s, "%x:%x:%x:%x:%x:%x", &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]) != 6) return false;
  for (int i = 0; i < 6; i++) { if (v[i] > 255) return false; out[i] = (uint8_t)v[i]; }
  return true;
}

// Parse 32 hex chars into a 16-byte ESP-NOW key.
inline bool parseKey16(const char *hex, uint8_t out[16]) {
  if (!hex || strlen(hex) != 32) return false;
  for (int i = 0; i < 16; i++) {
    unsigned b;
    if (sscanf(hex + 2 * i, "%2x", &b) != 1) return false;
    out[i] = (uint8_t)b;
  }
  return true;
}
