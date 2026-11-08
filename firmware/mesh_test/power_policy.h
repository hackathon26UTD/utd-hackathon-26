// Hardware-independent reference policy. Not wired into either sketch yet.
// Integrate only after checking power path and measuring loads. Keep ESP-NOW receive awake.
#pragma once
#include <stdint.h>

enum class BeaconPowerMode { Normal, Saver, Critical };
struct BeaconPowerPolicy {
  BeaconPowerMode mode;
  uint32_t sampleMs, reportMs, wifiRetryMs;
  bool camera, display;
};
inline BeaconPowerPolicy beaconPowerPolicy(bool mainsKnown, bool mainsPresent, bool criticalLatched) {
  if (criticalLatched) return {BeaconPowerMode::Critical, 2000, 30000, 60000, false, false};
  if (mainsKnown && mainsPresent) return {BeaconPowerMode::Normal, 2000, 30000, 60000, true, true};
  return {BeaconPowerMode::Saver, 2000, 120000, 300000, false, false};
}
