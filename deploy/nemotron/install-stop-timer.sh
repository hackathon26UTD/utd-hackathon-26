#!/usr/bin/env bash
# Install on the Crusoe VM HOST, never inside the Brev development container.
# Caller supplies the fixed provisioned-at + 24 hours deadline; this script never
# derives a new deadline from its execution time. No Brev credentials are needed.
# Example: sudo env STOP_AT_UTC=2026-11-09T02:00:00Z bash install-stop-timer.sh
# Guest shutdown is documented to stop Crusoe on-demand compute. Verify Brev's
# observed state afterward; retained storage may still be charged. This timer is
# a safeguard, not a provider-enforced spending cap.
set -euo pipefail

fail() { printf 'Stop timer not installed: %s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || fail 'Run as root on the VM host, passing STOP_AT_UTC explicitly.'
[[ -n "${STOP_AT_UTC:-}" ]] || fail 'STOP_AT_UTC is required (YYYY-MM-DDTHH:MM:SSZ).'
[[ "$STOP_AT_UTC" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail 'Use an absolute UTC timestamp in YYYY-MM-DDTHH:MM:SSZ format.'

for command in systemd-detect-virt systemctl systemd-analyze date install flock; do
  command -v "$command" >/dev/null || fail "Missing required host command: $command"
done
if systemd-detect-virt --container --quiet; then
  fail 'A container was detected. Connect to the underlying Brev VM host.'
fi
[[ -r /proc/1/comm && "$(cat /proc/1/comm)" == systemd && -d /run/systemd/system ]] || fail 'PID 1 must be the host systemd manager.'
[[ -x /usr/sbin/shutdown ]] || fail 'Host /usr/sbin/shutdown was not found.'

deadline_epoch=$(date -u -d "$STOP_AT_UTC" +%s) || fail 'Invalid UTC deadline.'
[[ "$(date -u -d "@$deadline_epoch" '+%Y-%m-%dT%H:%M:%SZ')" == "$STOP_AT_UTC" ]] || fail 'Invalid UTC calendar date.'
calendar=$(date -u -d "@$deadline_epoch" '+%Y-%m-%d %H:%M:%S UTC')
systemd-analyze calendar "$calendar" >/dev/null || fail 'Host systemd rejected the deadline.'

state_dir=/var/lib/homebeacon-budget-stop
deadline_file="$state_dir/deadline.utc"
service_file=/etc/systemd/system/homebeacon-budget-stop.service
timer_file=/etc/systemd/system/homebeacon-budget-stop.timer
exec 9>/run/lock/homebeacon-budget-stop.lock
flock -x 9

if [[ -e "$deadline_file" ]]; then
  existing_deadline=$(cat "$deadline_file")
  [[ "$existing_deadline" == "$STOP_AT_UTC" ]] || fail "An existing fixed deadline ($existing_deadline) differs. It will not be extended or replaced."
elif [[ -e "$service_file" || -e "$timer_file" ]]; then
  fail 'Existing timer units have no recorded deadline. Inspect them before making changes.'
fi
[[ "$deadline_epoch" -gt "$(date -u +%s)" ]] || fail 'The fixed deadline has passed. Stop this instance through Brev and verify its stopped state.'

install -d -m 0700 "$state_dir"
if [[ ! -e "$deadline_file" ]]; then
  (umask 077; printf '%s\n' "$STOP_AT_UTC" > "$deadline_file")
fi

cat > "$service_file" <<'SERVICE'
[Unit]
Description=Stop HomeBeacon GPU at its fixed budget deadline

[Service]
Type=oneshot
ExecStart=/usr/sbin/shutdown -h now
SERVICE

cat > "$timer_file" <<TIMER
[Unit]
Description=Fixed HomeBeacon GPU shutdown deadline

[Timer]
OnCalendar=$calendar
Persistent=true
AccuracySec=1s
Unit=homebeacon-budget-stop.service

[Install]
WantedBy=timers.target
TIMER

chmod 0644 "$service_file" "$timer_file"
systemd-analyze verify "$service_file" "$timer_file"
systemctl daemon-reload
systemctl enable --now homebeacon-budget-stop.timer
systemctl is-active --quiet homebeacon-budget-stop.timer
systemctl list-timers --all --no-pager homebeacon-budget-stop.timer
printf 'Fixed shutdown deadline: %s\n' "$STOP_AT_UTC"
printf 'After shutdown, verify Brev reports STOPPED. Retained storage may still incur charges.\n'
