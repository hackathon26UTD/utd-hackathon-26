"""`homebeacon-unoq doctor`: ordered checks, each PASS / WARN / FAIL (or SKIP) with a plain cause and an exact fix.

Exit codes: 0 all good, 1 something needs a look (WARN), 2 something is broken (FAIL).
The device key is read only to test it and is never printed. Network checks send at most four small
requests (DNS, one TLS handshake, GET /api/ready, GET /api/device/settings); `--offline` skips them.
Everything the checks touch is injectable (class Probes) so the tests need no network and no root.
"""
from __future__ import annotations

import email.utils
import glob
import grp
import json
import os
import pwd
import re
import shutil
import socket
import sqlite3
import ssl
import stat
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Optional

from . import watchdog
from .support import mask

PASS, WARN, FAIL, SKIP = "PASS", "WARN", "FAIL", "SKIP"
UNIT = "homebeacon-unoq"
SERVICE_USER = "homebeacon"
DEFAULT_ENV_FILE = "/etc/homebeacon/unoq.env"

DISK_WARN_MB, DISK_FAIL_MB = 200, 50          # small eMMC: Argus uses 1 GiB / 200 MiB, far too high here
CLOCK_WARN_S, CLOCK_FAIL_S = 30, 120
QUEUE_WARN_ROWS_FRAC = 0.5
QUEUE_AGE_WARN_S, QUEUE_AGE_FAIL_S = 3600, 86400
UPLINK_WARN_S, UPLINK_FAIL_S = 1800, 21600
MCU_STALE_S = 300
MIN_YEAR = 2025


@dataclass
class Check:
    name: str
    level: str
    detail: str
    fix: str = ""

    def as_dict(self) -> dict:
        return {"name": self.name, "level": self.level, "detail": self.detail, "fix": self.fix}


# ------------------------------------------------------------------ probes (all the outside world)
def _run(cmd: list, timeout: float = 5.0) -> tuple:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()
    except (OSError, subprocess.SubprocessError):
        return 127, ""


def _resolve(host: str, timeout: float = 5.0) -> list:
    box: dict = {}

    def work():
        try:
            box["v"] = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})
        except OSError as e:
            box["e"] = e

    t = threading.Thread(target=work, daemon=True)
    t.start()
    t.join(timeout)
    if "v" in box:
        return box["v"]
    raise OSError(str(box.get("e") or "DNS lookup timed out"))


def _tls(host: str, port: int, timeout: float = 6.0) -> dict:
    ctx = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=timeout) as raw:
        with ctx.wrap_socket(raw, server_hostname=host) as s:
            cert = s.getpeercert() or {}
            left = None
            if cert.get("notAfter"):
                left = int((ssl.cert_time_to_seconds(cert["notAfter"]) - time.time()) // 86400)
            return {"version": s.version(), "days_left": left}


def _http_get(url: str, headers: Optional[dict] = None, timeout: float = 8.0) -> tuple:
    req = urllib.request.Request(url, headers={"User-Agent": "homebeacon-unoq-doctor", "Accept": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(4096)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read(4096)


def _local_status(port: int) -> Optional[dict]:
    if not port:
        return None
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=2.0) as r:
            v = json.loads(r.read(262144).decode("utf-8", "replace"))
        return v if isinstance(v, dict) else None
    except (OSError, ValueError):
        return None


@dataclass
class Probes:
    now: Callable[[], float] = time.time
    resolve: Callable = _resolve
    tls: Callable = _tls
    http_get: Callable = _http_get
    run: Callable = _run
    local_status: Callable = _local_status
    api_settings: Optional[Callable] = None      # () -> uplink.Result; default builds an Api without the guard


# ------------------------------------------------------------------ key discovery (never returned to a caller that prints)
def _group_is_service(gid: int) -> bool:
    """The key file is root:homebeacon mode 640 on purpose: the root-run `setup` writes it, systemd (root) reads it
    for the service, and the CLI runs as the service user (which already holds the key in its environment)."""
    try:
        import grp
        return grp.getgrgid(gid).gr_name == "homebeacon"
    except (ImportError, KeyError):
        return False


def find_key(cfg, env_file: str = DEFAULT_ENV_FILE) -> tuple:
    """(key, where, path_with_secret, problem). `problem` is a sentence when the key is stored badly or unreadable."""
    v = os.environ.get(cfg.key_env, "").strip()
    if v:
        return v, f"environment variable {cfg.key_env}", "", ""
    for path, kind in ((cfg.key_file, "file"), (env_file, "env")):
        if not path:
            continue
        try:
            st = os.stat(path)
        except FileNotFoundError:
            continue
        except OSError as e:
            return "", path, path, f"{path} cannot be inspected ({type(e).__name__})."
        problem = ""
        if (st.st_mode & stat.S_IRWXO) or (st.st_mode & (stat.S_IWGRP | stat.S_IXGRP)) or \
                ((st.st_mode & stat.S_IRGRP) and not _group_is_service(st.st_gid)):
            problem = f"{path} can be read by other users (mode {stat.S_IMODE(st.st_mode):04o})."
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read(4096)
        except PermissionError:
            return "", path, path, "unreadable as this user"
        except OSError as e:
            return "", path, path, f"{path} cannot be read ({type(e).__name__})."
        if kind == "env":
            m = re.search(r"^\s*HB_DEVICE_KEY\s*=\s*['\"]?([^'\"\s#]+)", text, re.M)
            val = m.group(1) if m else ""
        else:
            val = text.strip()
        if val:
            return val, path, path, problem
        if problem:
            return "", path, path, problem
    return "", "", "", ""


# ------------------------------------------------------------------ the checks
class Ctx:
    def __init__(self, cfg, probes: Probes, *, store, config_path, env_file, offline, uplink_state, update_status, queue_path):
        self.cfg, self.p, self.store = cfg, probes, store
        self.config_path, self.env_file, self.offline = config_path, env_file, offline
        self.uplink_state, self.update_status_arg, self.queue_path = uplink_state, update_status, queue_path
        self.key, self.key_where, self.key_path, self.key_problem = find_key(cfg, env_file)
        self.host = re.sub(r"^https?://", "", cfg.base_url).split("/")[0].split(":")[0]
        self.https = cfg.base_url.startswith("https://")
        self.port = urllib.parse.urlsplit(cfg.base_url).port or (443 if self.https else 80)
        self.dns_ok: Optional[bool] = None
        self.ready: Optional[tuple] = None          # (status, headers, body) or Exception
        self.key_status: Optional[int] = None
        self._status = None
        self._status_read = False
        self._qstats = None
        self._q_read = False

    @property
    def status(self) -> Optional[dict]:
        if not self._status_read:
            self._status_read = True
            try:
                self._status = self.p.local_status(self.cfg.status_port)
            except Exception:  # noqa: BLE001
                self._status = None
        return self._status

    def queue(self) -> Optional[dict]:
        if not self._q_read:
            self._q_read = True
            now = self.p.now()
            try:
                if self.store is not None:
                    self._qstats = self.store.stats(now)
                elif self.queue_path and os.path.exists(self.queue_path):
                    self._qstats = read_queue_stats(self.queue_path, now)
            except Exception:  # noqa: BLE001
                self._qstats = None
        return self._qstats


def read_queue_stats(path: str, now: float) -> dict:
    """Read-only look at the queue file (works while the agent runs; counts and ages only)."""
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
    try:
        rows, size = con.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM q").fetchone()
        oldest = con.execute("SELECT MIN(created) FROM q").fetchone()[0]
        crit = con.execute("SELECT COUNT(*) FROM q WHERE prio=0").fetchone()[0]
        attempts = con.execute("SELECT COALESCE(MAX(attempts),0) FROM q").fetchone()[0]
    finally:
        con.close()
    return {"rows": rows, "bytes": size, "critical": crit, "oldest": oldest, "max_attempts": attempts,
            "oldest_age_s": None if oldest is None else round(max(0.0, now - oldest), 1)}


def c_config(x: Ctx) -> Check:
    cfg, path = x.cfg, x.config_path
    if not path:
        return Check("config", WARN, "No config file was given, so built-in defaults are in use (device id and server may be wrong).",
                     "sudo homebeacon-unoq config-example | sudo tee /etc/homebeacon/unoq.toml, then edit it")
    try:
        st = os.stat(path)
    except OSError:
        return Check("config", FAIL, f"Config file {path} is missing.", "sudo homebeacon-unoq config-example | sudo tee " + path)
    if st.st_mode & stat.S_IWOTH:
        return Check("config", FAIL, f"{path} can be changed by any user on this machine.", f"sudo chmod 644 {path}")
    return Check("config", PASS, f"Config {path} is valid. Server {x.host}, state folder {cfg.state_dir}.")


def c_key_storage(x: Ctx) -> Check:
    if x.key_problem == "unreadable as this user":
        return Check("key_storage", WARN, f"The key file {x.key_path} exists but this user cannot read it (it should be readable by the {SERVICE_USER} group).",
                     f"sudo chown root:{SERVICE_USER} {x.key_path} && sudo chmod 640 {x.key_path}")
    if x.key_problem:
        kp = x.key_path or x.env_file
        return Check("key_storage", FAIL, x.key_problem, f"sudo chown root:{SERVICE_USER} {kp} && sudo chmod 640 {kp}")
    if not x.key:
        return Check("key_storage", FAIL, "No device key is stored for this hub, so nothing can be uploaded.", "sudo homebeacon-unoq setup")
    k = x.key
    if not k.startswith("dk_") or len(k) < 16:
        return Check("key_storage", WARN, f"A key is stored in {x.key_where}, but it does not look like a HomeBeacon device key (they start with dk_).",
                     "sudo homebeacon-unoq setup")
    return Check("key_storage", PASS, f"A device key is stored in {x.key_where} and only root and the {SERVICE_USER} service user can read it.")


def c_device_id(x: Ctx) -> Check:
    d = x.cfg.device_id
    if not d:
        return Check("device_id", FAIL, "No device id is set, so the hub cannot say who it is.",
                     "Set device_id in /etc/homebeacon/unoq.toml to the 24-character id from registration, then sudo systemctl restart " + UNIT)
    if not re.fullmatch(r"[a-fA-F0-9]{24}", d):
        return Check("device_id", FAIL, "The device id is not 24 hexadecimal characters (a board serial number will not work).",
                     "Copy the id shown when the device was registered into /etc/homebeacon/unoq.toml")
    return Check("device_id", PASS, f"Device id {d} has the right shape.")


def c_service(x: Ctx) -> Check:
    rc, out = x.p.run(["systemctl", "is-active", UNIT], 5.0)
    if rc == 127 or "not been booted" in out or "Failed to connect" in out:
        return Check("service", SKIP, "No systemd here, so the service state was not checked.")
    state = out.splitlines()[0].strip() if out else "unknown"
    rc2, en = x.p.run(["systemctl", "is-enabled", UNIT], 5.0)
    enabled = (en.splitlines()[0].strip() if en else "") == "enabled"
    if state == "active":
        if not enabled:
            return Check("service", WARN, "The agent is running now but will not start after a reboot.", f"sudo systemctl enable {UNIT}")
        return Check("service", PASS, "The agent service is running and starts at boot.")
    if state in ("activating", "reloading"):
        return Check("service", WARN, "The agent is starting or stuck in a restart loop.", f"journalctl -u {UNIT} -n 50 --no-pager")
    return Check("service", FAIL, f"The agent service is {state}, so nothing is being monitored or uploaded.",
                 f"sudo systemctl enable --now {UNIT}   (if it stops again: journalctl -u {UNIT} -n 50 --no-pager)")


def _can_open(port: str) -> tuple:
    """(ok, why). Checks as the service user when that user exists, else as the current user."""
    try:
        st = os.stat(port)
    except OSError:
        return False, "missing"
    try:
        pw = pwd.getpwnam(SERVICE_USER)
    except KeyError:
        ok = os.access(port, os.R_OK | os.W_OK)
        return ok, "" if ok else "this user has no access"
    gids = {pw.pw_gid}
    for g in grp.getgrall():
        if SERVICE_USER in g.gr_mem:
            gids.add(g.gr_gid)
    mode = st.st_mode
    if st.st_uid == pw.pw_uid:
        bits = (mode >> 6) & 6
    elif st.st_gid in gids:
        bits = (mode >> 3) & 6
    else:
        bits = mode & 6
    try:
        gname = grp.getgrgid(st.st_gid).gr_name
    except KeyError:
        gname = str(st.st_gid)
    return bits == 6, "" if bits == 6 else f"owned by group {gname}"


def c_serial(x: Ctx) -> Check:
    cfg = x.cfg
    if cfg.mcu_source != "serial":
        return Check("serial_port", SKIP, f"The box link source is {cfg.mcu_source}, not a USB serial port.")
    ports = [cfg.mcu_port] if cfg.mcu_port else sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    if not ports or not os.path.exists(ports[0]):
        return Check("serial_port", FAIL, "No USB serial device is present, so box A is not connected or not recognised.",
                     "Plug box A into the Uno Q with a data cable, then check: ls /dev/ttyACM* /dev/ttyUSB*   and   lsusb")
    ok, why = _can_open(ports[0])
    if not ok:
        return Check("serial_port", FAIL, f"{ports[0]} exists but the agent user ({SERVICE_USER}) cannot open it ({why}).",
                     f"sudo usermod -aG dialout {SERVICE_USER} && sudo systemctl restart {UNIT}")
    return Check("serial_port", PASS, f"{ports[0]} exists and the agent user can open it.")


def c_disk(x: Ctx) -> Check:
    path = x.cfg.state_dir
    while path and not os.path.exists(path):
        path = os.path.dirname(path)
    try:
        free = shutil.disk_usage(path or "/").free // 1_000_000
    except OSError as e:
        return Check("disk", WARN, f"Disk space could not be read ({type(e).__name__}).")
    if free < DISK_FAIL_MB:
        return Check("disk", FAIL, f"Only {free} MB free: the queue and logs can no longer be saved.", "sudo journalctl --vacuum-size=20M && sudo apt-get clean")
    if free < DISK_WARN_MB:
        return Check("disk", WARN, f"Only {free} MB free on the disk holding {x.cfg.state_dir}.", "sudo journalctl --vacuum-size=20M && sudo apt-get clean")
    return Check("disk", PASS, f"{free} MB free for the queue and logs.")


def c_time_sync(x: Ctx) -> Check:
    rc, out = x.p.run(["timedatectl", "show", "-p", "NTPSynchronized", "--value"], 4.0)
    if rc != 0 or not out:
        return Check("time_sync", SKIP, "Time sync state could not be read (no timedatectl).")
    if out.strip() == "yes":
        return Check("time_sync", PASS, "The system clock is synchronised with a time server.")
    return Check("time_sync", WARN, "The clock is not synchronised. This board has no battery clock, so times in alerts may be wrong.",
                 "sudo timedatectl set-ntp true   (needs Wi-Fi up; then: timedatectl status)")


def _net_skip(x: Ctx, name: str) -> Optional[Check]:
    if x.offline:
        return Check(name, SKIP, "Skipped (offline mode).")
    return None


def c_dns(x: Ctx) -> Check:
    s = _net_skip(x, "dns")
    if s:
        return s
    try:
        addrs = x.p.resolve(x.host)
        x.dns_ok = True
        return Check("dns", PASS, f"{x.host} resolves ({len(addrs)} address{'es' if len(addrs) != 1 else ''}).")
    except OSError:
        x.dns_ok = False
        return Check("dns", FAIL, f"The hub cannot look up {x.host}. Wi-Fi is down, behind a login page, or the DNS server is wrong.",
                     f"ping -c1 1.1.1.1   then   getent hosts {x.host}   (if ping works but the lookup fails, set a DNS server)")


def c_tls(x: Ctx) -> Check:
    s = _net_skip(x, "tls")
    if s:
        return s
    if not x.https:
        return Check("tls", SKIP, "The server is plain http (local development), so there is no certificate to check.")
    if x.dns_ok is False:
        return Check("tls", SKIP, "Skipped because DNS failed.")
    try:
        info = x.p.tls(x.host, x.port)
    except ssl.SSLCertVerificationError:
        return Check("tls", FAIL, "The server's certificate was not accepted. The clock is wrong or a Wi-Fi login page is intercepting traffic.",
                     "date -u   (compare with a phone), then: timedatectl status; open any web page on the same Wi-Fi to clear a login page")
    except OSError as e:
        return Check("tls", FAIL, f"A secure connection to {x.host} could not be made ({type(e).__name__}).", "Check Wi-Fi: nmcli device status   and   ping -c1 1.1.1.1")
    dl = info.get("days_left")
    if isinstance(dl, int) and dl < 0:
        return Check("tls", FAIL, "The server certificate has expired (or this hub's clock is far ahead).", "date -u   and tell the operator if the date is right")
    return Check("tls", PASS, f"Secure connection to {x.host} works ({info.get('version', 'TLS')}).")


def c_ready(x: Ctx) -> Check:
    s = _net_skip(x, "api_ready")
    if s:
        return s
    if x.dns_ok is False:
        return Check("api_ready", SKIP, "Skipped because DNS failed.")
    try:
        x.ready = x.p.http_get(x.cfg.base_url + "/api/ready", None, 8.0)
    except Exception as e:  # noqa: BLE001
        x.ready = None
        return Check("api_ready", FAIL, f"The API did not answer ({type(e).__name__}).", f"curl -sS -m 8 {x.cfg.base_url}/api/ready")
    status, _, body = x.ready
    if status == 200:
        try:
            ok = json.loads(body.decode("utf-8", "replace")).get("status") == "ready"
        except (ValueError, AttributeError):
            ok = False
        if not ok:
            return Check("api_ready", WARN, "Got a web page instead of the API's answer. A Wi-Fi login page may be in the way.",
                         f"curl -sS -m 8 {x.cfg.base_url}/api/ready")
        return Check("api_ready", PASS, "The API says it is ready.")
    if status == 503:
        return Check("api_ready", WARN, "The API is up but its database is not ready. This is on the cloud side, not this hub.", "Wait a few minutes; tell the operator if it persists.")
    return Check("api_ready", FAIL, f"The API answered with status {status}.", f"curl -sS -m 8 {x.cfg.base_url}/api/ready")


def c_clock(x: Ctx) -> Check:
    now = x.p.now()
    if time.gmtime(now).tm_year < MIN_YEAR:
        return Check("clock", FAIL, f"The clock says year {time.gmtime(now).tm_year}, which is wrong.", "sudo timedatectl set-ntp true   (needs Wi-Fi)")
    date = None
    if isinstance(x.ready, tuple):
        date = {k.lower(): v for k, v in x.ready[1].items()}.get("date")
    if not date:
        return Check("clock", SKIP if x.offline else WARN, "No server time was available to compare against." if not x.offline else "Skipped (offline mode).")
    try:
        server = email.utils.parsedate_to_datetime(date).timestamp()
    except (TypeError, ValueError):
        return Check("clock", WARN, "The server's time could not be read.")
    skew = now - server
    if abs(skew) >= CLOCK_FAIL_S:
        return Check("clock", FAIL, f"This hub's clock is {abs(int(skew))} s {'ahead of' if skew > 0 else 'behind'} the server. Alert times and TLS will go wrong.",
                     "sudo timedatectl set-ntp true   then   timedatectl status")
    if abs(skew) >= CLOCK_WARN_S:
        return Check("clock", WARN, f"This hub's clock is {abs(int(skew))} s {'ahead of' if skew > 0 else 'behind'} the server.", "sudo timedatectl set-ntp true")
    return Check("clock", PASS, f"Clock agrees with the server within {abs(int(skew))} s.")


def _api_settings(x: Ctx):
    if x.p.api_settings is not None:
        return x.p.api_settings()
    from .uplink import Api
    return Api(x.cfg.base_url, x.key, 8.0).settings()


def c_key_accepted(x: Ctx) -> Check:
    s = _net_skip(x, "key_accepted")
    if s:
        return s
    if not x.key:
        return Check("key_accepted", SKIP, "Skipped: no key could be read to test.")
    if x.dns_ok is False:
        return Check("key_accepted", SKIP, "Skipped because DNS failed.")
    res = _api_settings(x)
    x.key_status = res.status
    if res.ok:
        return Check("key_accepted", PASS, "The cloud accepted this hub's key.")
    if res.auth:
        return Check("key_accepted", FAIL, "The cloud said no: the key was rejected, or this device is not registered under that key.",
                     "sudo homebeacon-unoq setup   (paste the key shown when the device was registered), check device_id, then sudo systemctl restart " + UNIT)
    if res.status == 0:
        return Check("key_accepted", WARN, f"The key could not be tested because the API did not answer ({res.error or 'no connection'}).")
    return Check("key_accepted", WARN, f"The key test got an unexpected answer (status {res.status}).")


def c_cloud_visible(x: Ctx) -> Check:
    if x.offline:
        return Check("cloud_visible", SKIP, "Skipped (offline mode).")
    if x.key_status is None:
        return Check("cloud_visible", SKIP, "Skipped: the key was not tested.")
    if x.key_status in (401, 403):
        return Check("cloud_visible", FAIL, "The cloud does not recognise this hub, so it cannot appear in the Command Center.", "Fix the key first (see key_accepted).")
    ok_age = _last_ok_age(x)
    if ok_age is None:
        return Check("cloud_visible", WARN, "The cloud knows this hub, but this hub has no record of a successful upload yet. "
                     "The Command Center's own last-seen time cannot be read with the hub key, so check it there.")
    if ok_age > UPLINK_FAIL_S:
        return Check("cloud_visible", WARN, f"The cloud knows this hub, but our last accepted upload was {_dur(ok_age)} ago, so the Command Center may show it offline.")
    return Check("cloud_visible", PASS, f"The cloud knows this hub and accepted an upload {_dur(ok_age)} ago. "
                 "(The Command Center's own last-seen time cannot be read with the hub key.)")


def c_queue(x: Ctx) -> Check:
    q = x.queue()
    if q is None:
        if x.store is None and not (x.queue_path and os.path.exists(x.queue_path)):
            return Check("queue", SKIP, "No queue file yet: the agent has not run on this hub.")
        return Check("queue", WARN, "The upload queue exists but could not be read as this user.", "sudo homebeacon-unoq doctor")
    rows, age = q["rows"], q.get("oldest_age_s")
    cap = x.cfg.queue_rows
    if rows == 0:
        return Check("queue", PASS, "The upload queue is empty: everything was sent.")
    detail = f"{rows} item{'s' if rows != 1 else ''} waiting, oldest {_dur(age)} old."
    if rows >= cap * 0.95 or (age is not None and age > QUEUE_AGE_FAIL_S):
        return Check("queue", FAIL, detail + " The queue is full or very old, so the oldest readings are being dropped.",
                     "Fix the upload problem shown above (key_accepted, dns, tls), then: sudo systemctl restart " + UNIT)
    if rows >= cap * QUEUE_WARN_ROWS_FRAC or (age is not None and age > QUEUE_AGE_WARN_S):
        return Check("queue", WARN, detail + " Uploads are falling behind.", "Check the uplink line below, and Wi-Fi: nmcli device status")
    return Check("queue", PASS, detail + " This is normal between sends.")


def _last_ok_age(x: Ctx) -> Optional[float]:
    st = x.status
    if isinstance(st, dict):
        v = (st.get("uplink") or {}).get("last_ok_age_s")
        if isinstance(v, (int, float)):
            return float(v)
    g = x.uplink_state
    if isinstance(g, dict) and isinstance(g.get("last_ok_wall"), (int, float)):
        return max(0.0, x.p.now() - g["last_ok_wall"])
    return None


def c_uplink(x: Ctx) -> Check:
    g = x.uplink_state or {}
    st = x.status or {}
    up = st.get("uplink") if isinstance(st, dict) else None
    if g.get("key_rejected") or (isinstance(up, dict) and up.get("auth_failed")):
        return Check("uplink", FAIL, "device key rejected: the cloud refuses this hub's key. Uploads are paused and retried only every 15 minutes. Queued data is kept.",
                     "sudo homebeacon-unoq setup, then sudo systemctl restart " + UNIT)
    age = _last_ok_age(x)
    if g.get("state") == "open":
        return Check("uplink", WARN, f"Uploads keep failing, so the agent is resting before it tries again (retry in about {int(g.get('retry_in_s') or 0)} s).",
                     "Check Wi-Fi: nmcli device status   and   ping -c1 1.1.1.1")
    if age is None:
        return Check("uplink", WARN, "No successful upload on record yet (the agent may have just started, or it cannot reach the cloud).",
                     f"journalctl -u {UNIT} -n 30 --no-pager")
    heals = g.get("heals") or []
    note = f" The agent rebuilt its connection {len(heals)} time(s) after stalls." if heals else ""
    if age > UPLINK_FAIL_S:
        return Check("uplink", FAIL, f"The last accepted upload was {_dur(age)} ago.{note}", "Check Wi-Fi: nmcli device status   and   ping -c1 1.1.1.1")
    if age > UPLINK_WARN_S:
        return Check("uplink", WARN, f"The last accepted upload was {_dur(age)} ago (low-power modes send less often).{note}", "")
    return Check("uplink", PASS, f"The last accepted upload was {_dur(age)} ago.{note}")


def c_mcu(x: Ctx) -> Check:
    if x.cfg.mcu_source in ("fake", "none"):
        return Check("box_link", SKIP, f"The box link source is {x.cfg.mcu_source}.")
    st = x.status
    if not isinstance(st, dict):
        return Check("box_link", WARN, f"The agent did not answer on 127.0.0.1:{x.cfg.status_port}, so the box link could not be checked.",
                     f"systemctl status {UNIT} --no-pager")
    mcu = st.get("mcu") or {}
    if not mcu.get("connected"):
        return Check("box_link", FAIL, f"The agent is running but has no link to box A ({mcu.get('error') or 'not connected'}).",
                     "Replug box A, then: ls /dev/ttyACM*   (and see serial_port above)")
    boxes = ((st.get("live") or {}).get("boxes") or {})
    ages = [b.get("age_s") for b in boxes.values() if isinstance(b, dict) and isinstance(b.get("age_s"), (int, float))]
    if not ages:
        return Check("box_link", WARN, "Box A is connected but no box has reported yet, so sensor readings are unknown.", "Power box A and box B; wait one minute.")
    newest = min(ages)
    if newest > MCU_STALE_S:
        return Check("box_link", WARN, f"Box A is connected but the newest message is {_dur(newest)} old. Readings are unknown, not safe.", "Check box A and box B power and range.")
    return Check("box_link", PASS, f"Box A is connected; the newest message is {_dur(newest)} old.")


def get_update_status(cfg) -> tuple:
    """(status dict or None, problem text). Module A's updater.update_status when this build has it."""
    try:
        import inspect

        from . import updater
        fn = getattr(updater, "update_status", None)
        if fn is None:
            return None, "Update status is not available in this build."
        st = fn(cfg) if inspect.signature(fn).parameters else fn()
    except Exception as e:  # noqa: BLE001
        return None, f"Update status could not be read ({type(e).__name__})."
    return (st if isinstance(st, dict) else {"summary": str(st)}), ""


def c_update(x: Ctx) -> Check:
    st = x.update_status_arg
    if st is None:
        st, problem = get_update_status(x.cfg)
        if st is None:
            return Check("update", SKIP if "not available" in problem else WARN, problem)
    rb = st.get("last_rollback")
    recent_rb = isinstance(rb, dict) and isinstance(rb.get("at"), (int, float)) and x.p.now() - rb["at"] < 7 * 86400
    if st.get("rolled_back") or recent_rb:
        why = mask(str(rb.get("reason", "")))[:100] if isinstance(rb, dict) else ""
        return Check("update", WARN, "The agent went back to an older version recently because the new one did not run cleanly" + (f" ({why})." if why else "."),
                     "homebeacon-unoq update status")
    if st.get("error") or st.get("last_error"):
        return Check("update", WARN, f"The last update attempt had a problem: {mask(str(st.get('error') or st.get('last_error')))[:140]}", "homebeacon-unoq update check")
    if st.get("pending") or st.get("update_pending"):
        return Check("update", WARN, "An update is installed but not yet confirmed healthy.", "homebeacon-unoq update status")
    cur, latest = st.get("current"), st.get("latest")
    if st.get("update_available"):
        return Check("update", PASS, f"Version {cur} is running; {latest} is available.", "homebeacon-unoq update apply")
    return Check("update", PASS, f"Version {cur or 'unknown'} is running" + (", no update waiting." if latest else "."))


def c_restarts(x: Ctx) -> Check:
    rc, out = x.p.run(["systemctl", "show", "-p", "NRestarts", "--value", UNIT], 4.0)
    if rc != 0 or not out.strip().isdigit():
        return Check("restarts", SKIP, "Restart count not available (no systemd).")
    n = int(out.strip())
    fix = f"journalctl -u {UNIT} -n 80 --no-pager"
    if n >= 10:
        return Check("restarts", FAIL, f"The agent has restarted {n} times since the service was last started by hand. It is crashing.", fix)
    if n >= 3:
        return Check("restarts", WARN, f"The agent has restarted {n} times since the service was last started by hand.", fix)
    return Check("restarts", PASS, f"{n} automatic restart{'s' if n != 1 else ''} so far.")


CHECKS = (c_config, c_key_storage, c_device_id, c_service, c_serial, c_disk, c_time_sync, c_dns, c_tls, c_ready, c_clock,
          c_key_accepted, c_cloud_visible, c_queue, c_uplink, c_mcu, c_update, c_restarts)


def run_checks(cfg, *, store=None, config_path: Optional[str] = None, env_file: str = DEFAULT_ENV_FILE, probes: Optional[Probes] = None,
               offline: bool = False, uplink_state: Optional[dict] = None, update_status: Optional[dict] = None,
               queue_path: Optional[str] = None) -> list:
    p = probes or Probes()
    if uplink_state is None:
        uplink_state = watchdog.read_state(watchdog.state_path(cfg.state_dir))
    if queue_path is None:
        queue_path = os.path.join(cfg.state_dir, "agent.sqlite")
    x = Ctx(cfg, p, store=store, config_path=config_path, env_file=env_file, offline=offline, uplink_state=uplink_state,
            update_status=update_status, queue_path=queue_path)
    out = []
    for fn in CHECKS:
        try:
            c = fn(x)
        except Exception as e:  # noqa: BLE001
            c = Check(fn.__name__[2:], WARN, f"This check crashed ({type(e).__name__}); that is a bug in the doctor, not necessarily in the hub.")
        c.detail, c.fix = mask(c.detail, [x.key] if x.key else []), mask(c.fix, [x.key] if x.key else [])
        out.append(c)
    return out


def config_failure(message: str) -> list:
    return [Check("config", FAIL, mask(message), "Fix the config file, or start from: homebeacon-unoq config-example")]


def exit_code(checks: list) -> int:
    levels = {c.level for c in checks}
    return 2 if FAIL in levels else 1 if WARN in levels else 0


def summary(checks: list) -> str:
    n = {lv: sum(1 for c in checks if c.level == lv) for lv in (PASS, WARN, FAIL, SKIP)}
    verdict = "BROKEN" if n[FAIL] else "NEEDS A LOOK" if n[WARN] else "HEALTHY"
    return f"{verdict}: {n[PASS]} passed, {n[WARN]} warning{'s' if n[WARN] != 1 else ''}, {n[FAIL]} failed, {n[SKIP]} skipped"


def render(checks: list) -> str:
    lines = []
    for c in checks:
        lines.append(f"{c.level:<4} {c.name:<19} {c.detail}")
        if c.fix and c.level in (WARN, FAIL):
            lines.append(f"     {'':<19} fix: {c.fix}")
    lines.append("")
    lines.append(summary(checks))
    return "\n".join(lines)


def _dur(s: Optional[float]) -> str:
    if s is None:
        return "unknown"
    s = int(s)
    if s < 90:
        return f"{s} s"
    if s < 5400:
        return f"{s // 60} min"
    if s < 172800:
        return f"{s // 3600} h"
    return f"{s // 86400} days"
