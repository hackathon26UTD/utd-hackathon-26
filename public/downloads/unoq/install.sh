#!/bin/sh
# HomeBeacon Uno Q agent installer (Debian/Linux side of the Arduino Uno Q). POSIX sh, run as root.
#
#   curl -fsSL https://utd-hackathon-26.pages.dev/downloads/unoq/install.sh | sudo sh
#   sudo sh install.sh --base https://utd-hackathon-26.pages.dev [--sha256 <pin>] [--pubkey key.pem]
#   sudo sh install.sh --file homebeacon-unoq-0.1.0.tar.gz --sha256 <hex>      (offline / staged by check-update)
#   sudo sh install.sh --uninstall                                              (keeps config and state)
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
CONF=/etc/homebeacon
FILE=""; PIN=""; PUBKEY=""; UNINSTALL=0; NOSTART=0

die() { echo "install: $*" >&2; exit 1; }
say() { echo "install: $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2;;
    --file) FILE="$2"; shift 2;;
    --sha256) PIN="$2"; shift 2;;
    --pubkey) PUBKEY="$2"; shift 2;;
    --prefix) PREFIX="$2"; shift 2;;
    --no-start) NOSTART=1; shift;;
    --uninstall) UNINSTALL=1; shift;;
    -h|--help) sed -n 2,14p "$0"; exit 0;;
    *) die "unknown option $1";;
  esac
done

[ "$(id -u)" = 0 ] || die "run as root (sudo)"

if [ "$UNINSTALL" = 1 ]; then
  systemctl disable --now homebeacon-unoq 2>/dev/null || true
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
  fetch "$BASE/downloads/unoq/manifest.json" "$TMP/manifest.json" || die "could not download the manifest"
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

DEST="$PREFIX/releases/$VERSION"
rm -rf "$DEST.new"; mkdir -p "$DEST.new"
tar -xzf "$FILE" -C "$DEST.new" --strip-components=1 --no-same-owner
chmod -R go-w "$DEST.new"
rm -rf "$DEST"; mv "$DEST.new" "$DEST"
ln -sfn "$DEST" "$PREFIX/current.new" && mv -T "$PREFIX/current.new" "$PREFIX/current" 2>/dev/null || { rm -f "$PREFIX/current"; ln -s "$DEST" "$PREFIX/current"; }

[ -f "$CONF/unoq.toml" ] || { cp "$DEST/packaging/unoq.example.toml" "$CONF/unoq.toml"; chown root:homebeacon "$CONF/unoq.toml"; chmod 640 "$CONF/unoq.toml"; }
[ -f "$CONF/unoq.env" ] || { printf '# HB_DEVICE_KEY=   (set with: sudo homebeacon-unoq setup)\n' > "$CONF/unoq.env"; chown root:root "$CONF/unoq.env"; chmod 600 "$CONF/unoq.env"; }

cat > /usr/local/bin/homebeacon-unoq <<EOF
#!/bin/sh
exec /usr/bin/python3 $PREFIX/current/run_agent.py --config $CONF/unoq.toml "\$@"
EOF
chmod 755 /usr/local/bin/homebeacon-unoq
cp "$DEST/packaging/homebeacon-unoq.service" /etc/systemd/system/homebeacon-unoq.service
chmod 644 /etc/systemd/system/homebeacon-unoq.service

"/usr/bin/python3" "$DEST/run_agent.py" selftest >/dev/null || die "installed agent failed its self test"
say "installed $VERSION to $DEST (self test passed)"

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
