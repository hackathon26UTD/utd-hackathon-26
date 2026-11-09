#!/bin/sh
# HomeBeacon Uno Q agent installer (Debian/Linux side of the Arduino Uno Q). POSIX sh, run as root.
#
#   curl -fsSL https://utd-hackathon-26.pages.dev/downloads/unoq/install.sh | sudo sh
#   sudo sh install.sh --base https://utd-hackathon-26.pages.dev [--sha256 <pin>] [--pubkey key.pem]
#   sudo sh install.sh --file homebeacon-unoq-<version>.tar.gz --sha256 <hex>      (offline / staged by check-update)
#   sudo sh install.sh --uninstall                                              (keeps config and state)
#   Re-running it is an upgrade: the old release stays as `previous`, a boot guard is armed, and the new
#   release is rolled back automatically if it does not become healthy. Options: --channel stable|beta,
#   --force (reinstall the same version), --allow-downgrade.
#
# Layout: <prefix>/releases/<version>, <prefix>/current and <prefix>/previous (symlinks), the last 2 releases
# are kept. The agent updates itself the same way (see hbagent/updater.py), so <prefix> belongs to the
# service user `homebeacon`.
#
# What it checks: the tarball size and sha256 against the release manifest, and against --sha256 if you
# pin one (a pin protects against a compromised download host). With --pubkey it also verifies an
# Ed25519 signature using openssl 3. It never runs code from the download before verification, installs
# to /opt/homebeacon-unoq, runs the service as the unprivileged user `homebeacon`, and does not start it
# until a device id and device key exist. The device key is never an argument to this script.
set -eu

BASE="${HB_BASE:-https://utd-hackathon-26.pages.dev}"
PREFIX="${HB_PREFIX:-/opt/homebeacon-unoq}"
STATE=/var/lib/homebeacon-unoq
# Root-owned helpers live here, outside the install prefix. The prefix belongs to the unprivileged service
# user (the agent can rewrite its own releases), so root must never run code from it.
LIBEXEC=/usr/local/libexec/homebeacon-unoq
CONF=/etc/homebeacon
FILE=""; PIN=""; PUBKEY=""; UNINSTALL=0; NOSTART=0; CHANNEL="${HB_CHANNEL:-stable}"; FORCE=0; DOWNGRADE=0

die() { echo "install: $*" >&2; exit 1; }
say() { echo "install: $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2;;
    --file) FILE="$2"; shift 2;;
    --sha256) PIN="$2"; shift 2;;
    --pubkey) PUBKEY="$2"; shift 2;;
    --prefix) PREFIX="$2"; shift 2;;
    --channel) CHANNEL="$2"; shift 2;;
    --force) FORCE=1; shift;;
    --allow-downgrade) DOWNGRADE=1; shift;;
    --no-start) NOSTART=1; shift;;
    --uninstall) UNINSTALL=1; shift;;
    -h|--help) sed -n 2,22p "$0"; exit 0;;
    *) die "unknown option $1";;
  esac
done
case "$PREFIX" in /*) ;; *) die "--prefix must be an absolute path";; esac
case "$PREFIX" in *[!A-Za-z0-9/._-]*) die "--prefix may only contain letters, digits and / . _ -";; esac
printf '%s' "$CHANNEL" | grep -Eq '^[a-z][a-z0-9-]{0,15}$' || die "--channel must be lower case letters, digits or -"
if [ "$CHANNEL" = stable ]; then MANIFEST_NAME=manifest.json; else MANIFEST_NAME="manifest-$CHANNEL.json"; fi

[ "$(id -u)" = 0 ] || die "run as root (sudo)"

if [ "$UNINSTALL" = 1 ]; then
  systemctl disable --now homebeacon-unoq 2>/dev/null || true
  rm -rf /usr/local/libexec/homebeacon-unoq
  rm -f /etc/systemd/system/homebeacon-unoq.service /usr/local/bin/homebeacon-unoq
  systemctl daemon-reload 2>/dev/null || true
  say "service removed. Kept: $PREFIX, $CONF, $STATE (delete by hand if you want them gone)."
  exit 0
fi

command -v python3 >/dev/null || die "python3 is required"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || die "Python 3.11 or newer is required"
if command -v sha256sum >/dev/null; then SHA() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null; then SHA() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "sha256sum or shasum is required"; fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BASE="${BASE%/}"
# Only plain URL characters: no spaces, newlines, quotes, "@" or "?" can ride along (grep is line-based).
case "$BASE" in *[!A-Za-z0-9./:~_-]*) die "--base must be https:// (plain http only for 127.0.0.1 or localhost)";; esac
# https anywhere; plain http only for the exact loopback forms (http://127.0.0.1.evil.com must not pass).
if printf '%s' "$BASE" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'; then LOCALBASE=0
elif printf '%s' "$BASE" | grep -Eq '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'; then LOCALBASE=1
else die "--base must be https:// (plain http only for 127.0.0.1 or localhost)"; fi
# Remote bases are https only, and a redirect may never downgrade to http.
fetch() {
  if command -v curl >/dev/null; then
    if [ "$LOCALBASE" = 1 ]; then curl -fsSL --proto '=https,http' --proto-redir '=https' --max-time 60 --max-filesize 3000000 -o "$2" "$1"
    else curl -fsSL --proto '=https' --proto-redir '=https' --max-time 60 --max-filesize 3000000 -o "$2" "$1"; fi
  elif [ "$LOCALBASE" = 1 ]; then wget -q -T 60 -O "$2" "$1"
  else wget -q --https-only -T 60 -O "$2" "$1"; fi
}

if [ -z "$FILE" ]; then
  say "reading release manifest from $BASE"
  fetch "$BASE/downloads/unoq/$MANIFEST_NAME" "$TMP/manifest.json" || die "could not download the manifest"
  # No eval: Python validates every field, then prints one value per line for `read`.
  python3 - "$TMP/manifest.json" > "$TMP/fields" <<'PY' || die "manifest is malformed"
import json, re, sys
m = json.load(open(sys.argv[1]))
def text(k):
    v = m.get(k, "")
    return v if isinstance(v, str) else None
ok = (re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", text("version") or "")
      and re.fullmatch(r"homebeacon-unoq-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz", text("file") or "")
      and re.fullmatch(r"[0-9a-f]{64}", text("sha256") or "")
      and re.fullmatch(r"(homebeacon-unoq-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz\.sig)?", text("signature") if "signature" in m else "") is not None
      and isinstance(m.get("size"), int) and not isinstance(m.get("size"), bool) and 0 < m["size"] <= 2000000)
if not ok:
    sys.exit(1)
for v in (m["version"], m["file"], m["sha256"], str(m["size"]), m.get("signature", "")):
    print(v)
PY
  { IFS= read -r VERSION; IFS= read -r NAME; IFS= read -r WANT; IFS= read -r SIZE; IFS= read -r SIGNAME || true; } < "$TMP/fields"
  say "release $VERSION"
  fetch "$BASE/downloads/unoq/$NAME" "$TMP/$NAME" || die "could not download $NAME"
  FILE="$TMP/$NAME"
  [ "$(wc -c < "$FILE" | tr -d ' ')" = "$SIZE" ] || die "size does not match the manifest"
  [ "$(SHA "$FILE")" = "$WANT" ] || die "sha256 does not match the manifest; nothing was installed"
  if [ -n "$PUBKEY" ]; then
    [ -n "$SIGNAME" ] || die "a public key was given but the release has no signature"
    command -v openssl >/dev/null || die "openssl is required to check the signature"
    fetch "$BASE/downloads/unoq/$SIGNAME" "$TMP/sig.b64" || die "could not download the signature"
    python3 -c 'import base64,sys; sys.stdout.buffer.write(base64.b64decode(open(sys.argv[1]).read()))' "$TMP/sig.b64" > "$TMP/sig.bin"
    openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin -in "$FILE" -sigfile "$TMP/sig.bin" >/dev/null || die "signature check FAILED; nothing was installed"
    say "signature verified"
  else
    say "no --pubkey given: checksum verified, signature not checked"
  fi
else
  [ -f "$FILE" ] || die "no such file $FILE"
  NAME="$(basename "$FILE")"
  case "$NAME" in homebeacon-unoq-*.tar.gz) ;; *) die "unexpected file name";; esac
  VERSION="$(printf %s "$NAME" | sed 's/^homebeacon-unoq-//; s/\.tar\.gz$//')"
  [ -n "$PIN" ] || die "--file needs --sha256 <hex> so the staged file is verified"
  [ "$(SHA "$FILE")" = "$PIN" ] || die "sha256 does not match the pin; nothing was installed"
fi
if [ -n "$PIN" ] && [ "$(SHA "$FILE")" != "$PIN" ]; then die "sha256 does not match the pin; nothing was installed"; fi

# Refuse archives that could write outside their folder.
tar -tzf "$FILE" > "$TMP/list" || die "not a valid archive"
if grep -E '^/|(^|/)\.\.(/|$)' "$TMP/list" >/dev/null; then die "archive has unsafe paths"; fi
TOP="homebeacon-unoq-$VERSION"
grep -vE "^$TOP(/|$)" "$TMP/list" >/dev/null && die "archive has files outside $TOP"

id homebeacon >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin homebeacon
getent group dialout >/dev/null 2>&1 && usermod -aG dialout homebeacon || true
mkdir -p "$PREFIX/releases" "$CONF" "$STATE"
chown homebeacon:homebeacon "$STATE"; chmod 700 "$STATE"
chown root:homebeacon "$CONF"; chmod 750 "$CONF"
# The service user owns the prefix so the agent can update itself (it runs as that user either way).
chown homebeacon:homebeacon "$PREFIX" "$PREFIX/releases"; chmod 755 "$PREFIX" "$PREFIX/releases"

# One installer or self-update at a time (the agent takes the same flock on update.lock).
if command -v flock >/dev/null; then
  exec 9>"$STATE/update.lock"
  chown homebeacon:homebeacon "$STATE/update.lock"; chmod 600 "$STATE/update.lock"     # the service must be able to open the same lock
  flock -n 9 || die "an update is already running; try again in a minute"
fi
# Anything an earlier root run left in the state folder must belong to the service user before it is used as that user.
chown -R homebeacon:homebeacon "$STATE"

# Version rules: the same version is a no-op, an older one needs --allow-downgrade.
OLD=""
if [ -L "$PREFIX/current" ]; then OLD="$(basename "$(readlink "$PREFIX/current")")"; fi
printf '%s' "$OLD" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || OLD=""
if [ -n "$OLD" ]; then
  if [ "$OLD" = "$VERSION" ] && [ "$FORCE" = 0 ]; then say "$VERSION is already installed (use --force to reinstall)"; exit 0; fi
  NEWEST="$(printf '%s\n%s\n' "$OLD" "$VERSION" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)"
  if [ "$NEWEST" = "$OLD" ] && [ "$OLD" != "$VERSION" ] && [ "$DOWNGRADE" = 0 ]; then die "$VERSION is older than the installed $OLD (use --allow-downgrade)"; fi
fi

DEST="$PREFIX/releases/$VERSION"
rm -rf "$DEST.new"; mkdir -p "$DEST.new"
tar -xzf "$FILE" -C "$DEST.new" --strip-components=1 --no-same-owner
chmod -R go-w "$DEST.new"
# The new release must pass its own self test BEFORE it can become current; on failure nothing changes.
"/usr/bin/python3" -I -B "$DEST.new/run_agent.py" selftest >/dev/null || { rm -rf "$DEST.new"; die "new release failed its self test; kept $OLD"; }
# Root-owned copies of the helpers, taken from the verified tree BEFORE it is handed to the service user.
# Everything root runs from here on (arm, the setup command) comes from these copies, never from $PREFIX.
install -d -m 755 -o root -g root "$LIBEXEC"
# The unit file and example config root writes into /etc also come from the verified tree, not from the service user's copy.
for f in packaging/homebeacon-unoq.service packaging/unoq.example.toml; do
  [ -f "$DEST.new/$f" ] || die "release is missing $f"
  cp "$DEST.new/$f" "$TMP/$(basename "$f")"
done
for f in hbagent/bootguard.py packaging/setup_key.py; do
  [ -f "$DEST.new/$f" ] || die "release is missing $f"
  install -m 644 -o root -g root "$DEST.new/$f" "$LIBEXEC/$(basename "$f").new" && mv -f "$LIBEXEC/$(basename "$f").new" "$LIBEXEC/$(basename "$f")"
done
rm -rf "$DEST"; mv "$DEST.new" "$DEST"
chown -R homebeacon:homebeacon "$DEST"

# Run a command as the service user, never as root. Falls back to root only because the helper is a root-owned copy.
as_service() {
  if command -v setpriv >/dev/null 2>&1; then setpriv --reuid=homebeacon --regid=homebeacon --init-groups "$@"
  elif command -v runuser >/dev/null 2>&1; then runuser -u homebeacon -- "$@"
  else "$@"; fi
}

# Order matters so a crash between steps is recoverable: previous pointer, armed boot guard, then the switch.
if [ -n "$OLD" ] && [ "$OLD" != "$VERSION" ] && [ -d "$PREFIX/releases/$OLD" ]; then
  ln -sfn "$PREFIX/releases/$OLD" "$PREFIX/.previous.new" && mv -T "$PREFIX/.previous.new" "$PREFIX/previous"
  as_service /usr/bin/python3 -I -B "$LIBEXEC/bootguard.py" arm --prefix "$PREFIX" --state "$STATE" --from "$OLD" --to "$VERSION" || say "warning: could not arm the boot guard (no automatic rollback for this upgrade)"
fi
ln -sfn "$DEST" "$PREFIX/current.new" && mv -T "$PREFIX/current.new" "$PREFIX/current" 2>/dev/null || { rm -f "$PREFIX/current"; ln -s "$DEST" "$PREFIX/current"; }
# The boot guard lives outside every release (and outside the prefix) so a broken release cannot disable it.
chown -R homebeacon:homebeacon "$STATE"
# Keep the last 2 releases: the new one and the one before it.
for d in "$PREFIX"/releases/*; do
  [ -d "$d" ] || continue
  b="$(basename "$d")"
  [ "$b" = "$VERSION" ] || [ "$b" = "$OLD" ] || { rm -rf "$d"; say "removed old release $b"; }
done

[ -f "$CONF/unoq.toml" ] || { cp "$TMP/unoq.example.toml" "$CONF/unoq.toml"; chown root:homebeacon "$CONF/unoq.toml"; chmod 640 "$CONF/unoq.toml"; }
[ -f "$CONF/unoq.env" ] || printf '# HB_DEVICE_KEY=   (set with: sudo homebeacon-unoq setup)\n' > "$CONF/unoq.env"
# root:homebeacon 640: systemd (root) reads it for the service, and the CLI (run as the service user) can read it for doctor.
chown root:homebeacon "$CONF/unoq.env"; chmod 640 "$CONF/unoq.env"

cat > /usr/local/bin/homebeacon-unoq.new <<EOF
#!/bin/sh
# Root never runs code from $PREFIX: that folder belongs to the service user, who could have changed it.
#   setup   -> small root-owned script outside the prefix (writes the root-readable key file)
#   others  -> run as the service user, so state files keep the right owner (sudo is only for convenience)
if [ "\$(id -u)" = 0 ]; then
  if [ "\${1:-}" = setup ]; then
    exec /usr/bin/python3 -I -B $LIBEXEC/setup_key.py --env-file $CONF/unoq.env
  fi
  cd / || exit 1
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=homebeacon --regid=homebeacon --init-groups /usr/bin/python3 -I -B $PREFIX/current/run_agent.py --config $CONF/unoq.toml "\$@"
  elif command -v runuser >/dev/null 2>&1; then
    exec runuser -u homebeacon -- /usr/bin/python3 -I -B $PREFIX/current/run_agent.py --config $CONF/unoq.toml "\$@"
  fi
  echo "homebeacon-unoq: setpriv or runuser (util-linux) is needed to run this as the service user" >&2
  exit 1
fi
exec /usr/bin/python3 -I -B $PREFIX/current/run_agent.py --config $CONF/unoq.toml "\$@"
EOF
chmod 755 /usr/local/bin/homebeacon-unoq.new && mv -f /usr/local/bin/homebeacon-unoq.new /usr/local/bin/homebeacon-unoq
sed "s#/opt/homebeacon-unoq#$PREFIX#g" "$TMP/homebeacon-unoq.service" > /etc/systemd/system/homebeacon-unoq.service
chmod 644 /etc/systemd/system/homebeacon-unoq.service

# Self-update settings. A public key given to this installer is kept so the agent verifies later updates too.
if [ -n "$PUBKEY" ] && [ -f "$PUBKEY" ]; then
  install -m 644 "$PUBKEY" "$CONF/update-pubkey.pem"
fi
if [ ! -f "$CONF/update.toml" ]; then
  {
    echo "# Self-update settings (read by the agent). Safe to edit; restart the service after."
    echo "[update]"
    echo "channel = \"$CHANNEL\""
    echo "check_interval_s = 21600        # 6 hours, with jitter; minimum 900"
    echo "auto_apply = true               # false = only check and report"
    if [ -f "$CONF/update-pubkey.pem" ]; then echo "pubkey = \"$CONF/update-pubkey.pem\""; else echo "# pubkey = \"$CONF/update-pubkey.pem\"   # set to verify release signatures; without it updates are checksum only"; fi
    echo "require_signature = false"
  } > "$CONF/update.toml"
  chown root:homebeacon "$CONF/update.toml"; chmod 640 "$CONF/update.toml"
fi

say "installed $VERSION to $DEST (self test passed)${OLD:+, previous $OLD kept for rollback}"

if command -v systemctl >/dev/null; then
  systemctl daemon-reload
  systemctl enable homebeacon-unoq >/dev/null 2>&1 || true
  READY=0
  grep -Eq '^HB_DEVICE_KEY=.{8,}' "$CONF/unoq.env" && grep -Eq '^device_id *= *"[0-9a-fA-F]{24}"' "$CONF/unoq.toml" && READY=1
  if [ "$NOSTART" = 0 ] && [ "$READY" = 1 ]; then systemctl restart homebeacon-unoq && say "service started"
  else
    say "service enabled but not started yet. Next:"
    say "  1. edit $CONF/unoq.toml and set api.device_id (24 characters)"
    say "  2. sudo homebeacon-unoq setup        (paste the device key; it is stored mode 600)"
    say "  3. sudo systemctl start homebeacon-unoq && homebeacon-unoq live"
  fi
else
  say "systemd not found: start by hand with  homebeacon-unoq run"
fi
