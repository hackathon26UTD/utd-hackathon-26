#!/bin/sh
# Optional, operator-run, root only. The agent never changes OS power settings itself.
# Usage: sudo sh apply-power-profile.sh <full|eco|survival|beacon> [--apply]
# Without --apply it only prints what it would do. UNVERIFIED on a real Uno Q: check each path exists.
set -eu
MODE="${1:-}"; APPLY="${2:-}"
case "$MODE" in full|eco|survival|beacon) ;; *) echo "usage: $0 <full|eco|survival|beacon> [--apply]" >&2; exit 2;; esac
GOV=powersave; WIFI_PS=on
if [ "$MODE" = full ]; then GOV=ondemand; WIFI_PS=off; fi
run() { if [ "$APPLY" = "--apply" ]; then "$@"; else echo "would run: $*"; fi; }
for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  [ -w "$g" ] || continue
  avail="$(dirname "$g")/scaling_available_governors"
  if [ -r "$avail" ] && grep -qw "$GOV" "$avail"; then run sh -c "echo $GOV > $g"; else echo "governor $GOV not offered for $g"; fi
done
if command -v iw >/dev/null 2>&1; then
  for w in $(iw dev 2>/dev/null | awk '/Interface/ {print $2}'); do run iw dev "$w" set power_save "$WIFI_PS"; done
else echo "iw not installed: Wi-Fi power save not changed"; fi
if [ "$MODE" != full ] && command -v rfkill >/dev/null 2>&1; then run rfkill block bluetooth; fi
echo "profile $MODE ${APPLY:-(dry run)}"
