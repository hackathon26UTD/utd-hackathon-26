#!/usr/bin/python3
"""Store the hub's device key. Standard library only.

install.sh copies this file to /usr/local/libexec/homebeacon-unoq/setup_key.py (root-owned, outside the
install folder) and the `sudo homebeacon-unoq setup` wrapper runs it as root. It has to live outside the
release folders: those belong to the unprivileged service user, and root must never run code that user can
rewrite.

The key is typed with hidden input. It is never a command line argument and is never printed. The file is
written root:homebeacon mode 640 (systemd reads it as root for the service; the CLI, which runs as the
service user, can read it for `doctor`). No other user can.
"""
import getpass
import grp
import os
import stat
import sys
import tempfile

DEFAULT_ENV = "/etc/homebeacon/unoq.env"
GROUP = "homebeacon"


def valid(key: str) -> bool:
    return 8 <= len(key) <= 256 and key.isascii() and key.isprintable() and not any(c.isspace() for c in key)


def write_env(path: str, key: str) -> None:
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=d)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(f"HB_DEVICE_KEY={key}\n")
            f.flush()
            os.fsync(f.fileno())
        mode = 0o600
        try:
            gid = grp.getgrnam(GROUP).gr_gid
            os.chown(tmp, 0 if os.geteuid() == 0 else -1, gid)
            mode = 0o640
        except (KeyError, PermissionError, OSError):
            pass
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    path = DEFAULT_ENV
    if args[:1] == ["--env-file"] and len(args) == 2:
        path = args[1]
    elif args:
        print("usage: setup_key.py [--env-file PATH]   (the key is typed, never an argument)", file=sys.stderr)
        return 2
    if os.geteuid() != 0:
        print("Run this as root: sudo homebeacon-unoq setup", file=sys.stderr)
        return 1
    key = getpass.getpass("Paste the device key (input hidden): ").strip()
    if not valid(key):
        print("No usable key entered (8 or more printable characters, no spaces).", file=sys.stderr)
        return 1
    write_env(path, key)
    print(f"Saved to {path} (mode {stat.S_IMODE(os.stat(path).st_mode):o}, readable by root and the {GROUP} service user only).")
    print("Restart the service: sudo systemctl restart homebeacon-unoq")
    return 0


if __name__ == "__main__":
    sys.exit(main())
