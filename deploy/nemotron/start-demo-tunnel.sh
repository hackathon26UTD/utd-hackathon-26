#!/usr/bin/env bash
# Run as ubuntu on the Brev VM host. Uses sudo only for systemd unit installation.
set -euo pipefail
umask 077
cd -- "$(dirname -- "$0")"
deployment_dir=$(pwd -P)
readonly release='2026.10.7'
readonly expected_sha='1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872'
readonly gateway_unit='homebeacon-inference-gateway.service'
readonly tunnel_unit='homebeacon-inference-tunnel.service'

fail() { printf 'Demo tunnel not started: %s\n' "$*" >&2; exit 1; }
[[ "$(id -un)" == ubuntu ]] || fail 'Run as the ubuntu user on the VM host.'
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail 'This pinned binary requires Linux AMD64.'
[[ -d /run/systemd/system && -r /proc/1/comm && "$(cat /proc/1/comm)" == systemd ]] || fail 'The VM host systemd manager is required.'
for dependency in curl python3 sudo systemctl systemd-analyze systemd-detect-virt; do
  command -v "$dependency" >/dev/null || fail "Missing dependency: $dependency"
done
if systemd-detect-virt --container --quiet; then
  fail 'A container was detected. Connect to the underlying Brev VM host.'
fi
[[ -f gateway.py && -f .env.inference && ! -L .env.inference ]] || fail 'The sibling gateway.py and private .env.inference must exist.'
python3 - "$deployment_dir" <<'PY'
import sys
if any(c.isspace() or ord(c) < 32 or c in '\\"%' for c in sys.argv[1]):
    raise SystemExit('The deployment directory contains unsupported systemd path characters.')
PY
sudo -n true || fail 'Passwordless sudo is required to install the services.'

# Keep the current quick-tunnel hostname unchanged on repeated invocations.
if systemctl is-active --quiet "$tunnel_unit"; then
  systemctl is-active --quiet "$gateway_unit" || fail 'The tunnel is active but its gateway is not. Inspect service state.'
  printf 'Demo tunnel is already active; no service was restarted.\n'
  printf 'Read its current URL with: sudo journalctl -u %s --no-pager -n 40\n' "$tunnel_unit"
  exit 0
fi

mkdir -p bin
chmod 700 bin
temporary_dir=$(mktemp -d)
trap 'rm -rf -- "$temporary_dir"' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  "https://github.com/cloudflare/cloudflared/releases/download/$release/cloudflared-linux-amd64" \
  --output "$temporary_dir/cloudflared"
python3 - "$temporary_dir/cloudflared" "$expected_sha" <<'PY'
import hashlib
from pathlib import Path
import sys
if hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() != sys.argv[2]:
    raise SystemExit('Cloudflare binary checksum mismatch; no service was installed.')
PY
install -m 0755 "$temporary_dir/cloudflared" bin/cloudflared

cat > "$temporary_dir/$gateway_unit" <<UNIT
[Unit]
Description=HomeBeacon authenticated inference gateway
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=$deployment_dir
ExecStart=/usr/bin/python3 "$deployment_dir/gateway.py"
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

cat > "$temporary_dir/$tunnel_unit" <<UNIT
[Unit]
Description=HomeBeacon temporary authenticated demo tunnel
After=network-online.target $gateway_unit
Wants=network-online.target
Requires=$gateway_unit

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=$deployment_dir
ExecStart="$deployment_dir/bin/cloudflared" --no-autoupdate tunnel --metrics 127.0.0.1:49312 --url http://127.0.0.1:8080
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemd-analyze verify "$temporary_dir/$gateway_unit" "$temporary_dir/$tunnel_unit" || fail 'Generated systemd units failed validation; no unit was installed.'

for unit in "$gateway_unit" "$tunnel_unit"; do
  target="/etc/systemd/system/$unit"
  if [[ -e "$target" ]]; then
    cmp -s "$temporary_dir/$unit" "$target" || fail "Existing $unit differs. It was left unchanged for review."
  else
    sudo -n install -m 0644 "$temporary_dir/$unit" "$target"
  fi
done
sudo -n systemctl daemon-reload
sudo -n systemctl enable "$gateway_unit" "$tunnel_unit" >/dev/null
sudo -n systemctl start "$gateway_unit"
ready=false
for attempt in {1..10}; do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 http://127.0.0.1:8080/v1/models || true)
  if [[ "$status" == 401 ]]; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || fail 'Gateway did not reject an unauthenticated request with 401. Tunnel remains stopped.'
sudo -n systemctl start "$tunnel_unit"
for unit in "$gateway_unit" "$tunnel_unit"; do
  systemctl is-active --quiet "$unit" || fail "$unit did not become active; inspect its journal."
done
printf 'Gateway and temporary tunnel services are active. No credential was printed.\n'
printf 'Read the generated HTTPS URL with: sudo journalctl -u %s --no-pager -n 40\n' "$tunnel_unit"
printf 'A tunnel restart can change its hostname. Verify auth and the synthetic model probe before configuring HomeBeacon.\n'
