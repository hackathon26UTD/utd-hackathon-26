"""Environment reader: what the hub can see about itself, safe to show locally and to upload.

Every collector is isolated: it has a time limit, never raises, and reports
{"value": <data or "unknown">, "source": <where it came from>, "ok": <bool>}.
Missing data is "unknown". Nothing here writes to the system and nothing here holds a secret:
the device key is never read, the Wi-Fi password is never asked for, the SSID and host name are
sent only as salted hashes (unless the config opts in to the SSID), and all text is masked.

Public pieces:
  collect_environment(cfg, status, store, ...)  richer local snapshot (status endpoint, `hbagent env`)
  build_environment_event(env)                  compact 'agent.environment' event, under 4 KB
  should_upload_environment(prev, cur, now)     boot / significant change / 6 hour rule
  render_environment_text(env)                  plain text for people
  mask_secrets(text)                            shared masker (also used on every string we emit)
  EnvReporter                                   cache + upload schedule for the agent loop
Standard library only. Light by design: the API probe is cached for 15 minutes, a full snapshot for 60 s.
"""
from __future__ import annotations

import glob
import hashlib
import http.client
import json
import os
import platform
import re
import shutil
import socket
import ssl
import subprocess
import threading
import time
import urllib.parse
from email.utils import parsedate_to_datetime
from typing import Callable, Optional

from . import VERSION

SCHEMA = 1
EVENT_TYPE = "agent.environment"
MAX_EVENT_BYTES = 4096
UPLOAD_EVERY_S = 6 * 3600       # at most one routine upload per 6 hours
MIN_CHANGE_GAP_S = 900          # a change uploads at most every 15 minutes
MIN_BOOT_GAP_S = 300            # a crash loop does not upload on every start
PROBE_EVERY_S = 900
SNAPSHOT_MAX_AGE_S = 60
SERVICE_UNIT = "homebeacon-unoq.service"
CMD_TIMEOUT_S = 2.0
CMD_MAX_BYTES = 16_384
MAX_IFACES, MAX_USB, MAX_SERIAL, MAX_ZONES, MAX_DNS = 8, 16, 8, 8, 3

# Roots are module variables so tests can point them at a temp folder.
PROC, SYS, ETC, DEV = "/proc", "/sys", "/etc", "/dev"

# ----------------------------------------------------------------------------- masking
_URL_CRED = re.compile(r"\b([a-zA-Z][a-zA-Z0-9+.-]{0,14}://)[^\s/@:]+(?::[^\s/@]*)?@")
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{6,}")
_NAMED = re.compile(r"(?i)\b(x-device-key|device[_-]?key|hb_device_key|api[_-]?key|authorization|token|secret|password|passwd|psk|passphrase)"
                    r"(\"?\s*[:=]\s*\"?)(?!\*\*\*)[^\s\"',;&]+")
_HEX = re.compile(r"\b[a-fA-F0-9]{32,}\b")
_LONG = re.compile(r"[A-Za-z0-9+_-]{40,}={0,2}")


def _long_token(m: "re.Match") -> str:
    s = m.group(0)
    return "[token-redacted]" if re.search(r"\d", s) and re.search(r"[A-Za-z]", s) else s


def mask_secrets(text, secrets: tuple = ()) -> str:
    """Mask credentials in text: URL user:pass, key/token/password assignments, Bearer headers, long hex
    and long base64-like tokens, plus any exact secret values given. Safe on any input."""
    try:
        s = str(text)
        for sec in secrets:
            if sec and len(str(sec)) >= 4:
                s = s.replace(str(sec), "***")
        s = _URL_CRED.sub(r"\1***@", s)
        s = _BEARER.sub("Bearer ***", s)
        s = _NAMED.sub(lambda m: m.group(1) + m.group(2) + "***", s)
        s = _HEX.sub("[hex-redacted]", s)
        s = _LONG.sub(_long_token, s)
        return s
    except Exception:
        return "[unprintable]"


def scrub(obj, secrets: tuple = (), depth: int = 0):
    """Mask every string inside a JSON-like structure."""
    if depth > 8:
        return None
    if isinstance(obj, str):
        return mask_secrets(obj[:300], secrets)
    if isinstance(obj, dict):
        return {str(k)[:60]: scrub(v, secrets, depth + 1) for k, v in list(obj.items())[:64]}
    if isinstance(obj, (list, tuple)):
        return [scrub(v, secrets, depth + 1) for v in list(obj)[:64]]
    return obj


# ----------------------------------------------------------------------------- helpers
def _leaf(value, source: str) -> dict:
    return {"value": "unknown" if value is None else value, "source": source, "ok": value is not None}


def _collect(source: str, fn: Callable, *args) -> dict:
    """Run one collector. Never raises."""
    try:
        return _leaf(fn(*args), source)
    except Exception as e:                      # a broken collector is 'unknown', not a crash
        return {"value": "unknown", "source": source, "ok": False, "error": type(e).__name__}


def _read(path: str, limit: int = 4096) -> Optional[str]:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read(limit).replace("\x00", "").strip()
    except OSError:
        return None


def _run(argv: list, timeout: float = CMD_TIMEOUT_S) -> Optional[str]:
    """Run a read-only command with a time limit and capped output. None when absent or failed."""
    exe = shutil.which(argv[0])
    if not exe:
        return None
    try:
        p = subprocess.run([exe] + argv[1:], capture_output=True, timeout=timeout, check=False,
                           env={"PATH": os.environ.get("PATH", "/usr/sbin:/usr/bin:/sbin:/bin"), "LC_ALL": "C"})
    except (subprocess.TimeoutExpired, OSError):
        return None
    if p.returncode != 0:
        return None
    return p.stdout[:CMD_MAX_BYTES].decode("utf-8", "replace")


def _hash(text: str, salt: str) -> str:
    return hashlib.sha256((salt + "|" + text).encode("utf-8", "replace")).hexdigest()[:10]


def _salt(cfg) -> str:
    return (getattr(cfg, "device_id", "") or "") + ":hb-env-v1"


# ----------------------------------------------------------------------------- collectors
def _agent_info() -> dict:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    real = os.path.realpath(here)
    build = None
    for name in ("BUILD", "GIT_SHA"):
        b = _read(os.path.join(here, name), 80)
        if b:
            build = mask_secrets(b)[:40]
            break
    return {"version": VERSION, "build": build, "release": os.path.basename(real), "release_dir": real,
            "via_current_link": os.path.islink(os.path.join(os.path.dirname(real), "current")) or "/current" in here}


def _self_usage() -> dict:
    out: dict = {}
    st = _read(f"{PROC}/self/status", 8192) or ""
    m = re.search(r"VmRSS:\s+(\d+)\s*kB", st)
    if m:
        out["rss_mb"] = round(int(m.group(1)) / 1024, 1)
    m = re.search(r"Threads:\s+(\d+)", st)
    if m:
        out["threads"] = int(m.group(1))
    try:
        out["open_fds"] = len(os.listdir(f"{PROC}/self/fd"))
    except OSError:
        pass
    return out or None


def _os_release() -> Optional[dict]:
    raw = _read(f"{ETC}/os-release")
    if not raw:
        return None
    kv = {}
    for line in raw.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            kv[k] = v.strip().strip('"')
    return {"name": kv.get("PRETTY_NAME") or kv.get("NAME"), "version_id": kv.get("VERSION_ID"), "id": kv.get("ID")}


def _board_model() -> Optional[str]:
    return _read(f"{PROC}/device-tree/model", 128) or _read(f"{SYS}/devices/virtual/dmi/id/product_name", 128)


def _cpu() -> Optional[dict]:
    raw = _read(f"{PROC}/cpuinfo", 16384) or ""
    model = None
    for key in ("model name", "Model", "Hardware", "Processor"):
        m = re.search(rf"^{key}\s*:\s*(.+)$", raw, re.M)
        if m:
            model = m.group(1).strip()[:80]
            break
    out = {"model": model, "cores": os.cpu_count()}
    try:
        out["load"] = [round(x, 2) for x in os.getloadavg()]
    except OSError:
        out["load"] = None
    return out


def _memory() -> Optional[dict]:
    raw = _read(f"{PROC}/meminfo", 4096)
    if not raw:
        return None
    kv = {}
    for line in raw.splitlines():
        m = re.match(r"(\w+):\s+(\d+)", line)
        if m:
            kv[m.group(1)] = int(m.group(2)) // 1024
    if "MemTotal" not in kv:
        return None
    return {"total_mb": kv.get("MemTotal"), "avail_mb": kv.get("MemAvailable"),
            "swap_total_mb": kv.get("SwapTotal"), "swap_free_mb": kv.get("SwapFree")}


def _disk(path: str) -> Optional[dict]:
    u = shutil.disk_usage(path)
    return {"path": path, "total_mb": u.total // 1048576, "free_mb": u.free // 1048576,
            "free_pct": round(100.0 * u.free / u.total, 1) if u.total else None}


def _uptime() -> Optional[dict]:
    raw = _read(f"{PROC}/uptime", 64)
    if not raw:
        return None
    up = int(float(raw.split()[0]))
    return {"uptime_s": up, "boot_epoch": int(time.time()) - up}


def _thermal() -> Optional[dict]:
    zones = []
    for p in sorted(glob.glob(f"{SYS}/class/thermal/thermal_zone*"))[:MAX_ZONES]:
        v = _read(p + "/temp", 32)
        if v and v.lstrip("-").isdigit():
            zones.append({"zone": _read(p + "/type", 32) or os.path.basename(p), "c": round(int(v) / 1000.0, 1)})
    if not zones:
        return None
    return {"max_c": max(z["c"] for z in zones), "zones": zones}


def _throttle() -> Optional[dict]:
    out = _run(["vcgencmd", "get_throttled"])       # Raspberry Pi only; absent on the Uno Q
    if not out:
        return None
    m = re.search(r"0x([0-9a-fA-F]+)", out)
    if not m:
        return None
    bits = int(m.group(1), 16)
    return {"undervoltage_now": bool(bits & 0x1), "freq_capped_now": bool(bits & 0x2), "throttled_now": bool(bits & 0x4),
            "undervoltage_seen": bool(bits & 0x10000), "throttled_seen": bool(bits & 0x40000)}


def _timesync() -> Optional[dict]:
    out = _run(["timedatectl", "show", "-p", "NTPSynchronized", "-p", "NTP", "-p", "Timezone"])
    if not out:
        return None
    kv = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
    if "NTPSynchronized" not in kv:
        return None
    return {"synchronized": kv["NTPSynchronized"] == "yes", "ntp_enabled": kv.get("NTP") == "yes", "timezone": kv.get("Timezone")}


def _interfaces() -> Optional[list]:
    out = _run(["ip", "-j", "addr", "show"])
    items = []
    if out:
        try:
            for it in json.loads(out)[:32]:
                name = str(it.get("ifname", ""))[:16]
                if name == "lo":
                    continue
                addrs = [a.get("local") for a in it.get("addr_info", []) if a.get("local") and not str(a.get("local")).startswith("fe80")]
                items.append({"name": name, "state": str(it.get("operstate", "unknown")).lower(), "addrs": addrs[:3]})
        except (ValueError, AttributeError, TypeError):
            items = []
    if not items:
        for p in sorted(glob.glob(f"{SYS}/class/net/*")):
            name = os.path.basename(p)
            if name != "lo":
                items.append({"name": name[:16], "state": (_read(p + "/operstate", 16) or "unknown").lower(), "addrs": None})
    return items[:MAX_IFACES] or None


def _default_route() -> Optional[dict]:
    raw = _read(f"{PROC}/net/route", 8192)
    if not raw:
        return None
    for line in raw.splitlines()[1:]:
        f = line.split()
        if len(f) >= 4 and f[1] == "00000000" and int(f[3], 16) & 2:
            gw = ".".join(str(int(f[2][i:i + 2], 16)) for i in (6, 4, 2, 0))
            return {"iface": f[0][:16], "gateway": gw}
    return {"iface": None, "gateway": None}        # table read fine: there is no default route


def _dns() -> Optional[list]:
    raw = _read(f"{ETC}/resolv.conf", 4096)
    if raw is None:
        return None
    return re.findall(r"^nameserver\s+(\S+)", raw, re.M)[:MAX_DNS]


def _wifi(salt: str, send_ssid: bool) -> Optional[dict]:
    """Signal from /proc/net/wireless; SSID from iw or nmcli (no secrets are requested). SSID goes out hashed."""
    info: dict = {}
    raw = _read(f"{PROC}/net/wireless", 4096)
    if raw:
        for line in raw.splitlines()[2:]:
            f = line.replace(":", " ").split()
            if len(f) >= 4:
                try:
                    info = {"iface": f[0][:16], "link_quality": int(float(f[2].rstrip("."))), "signal_dbm": int(float(f[3].rstrip(".")))}
                except ValueError:
                    info = {"iface": f[0][:16]}
                break
    ssid = None
    if info.get("iface"):
        out = _run(["iw", "dev", info["iface"], "link"])
        if out:
            m = re.search(r"SSID:\s*(.+)", out)
            ssid = m.group(1).strip() if m else None
            m = re.search(r"signal:\s*(-?\d+)\s*dBm", out)
            if m:
                info["signal_dbm"] = int(m.group(1))
    if ssid is None:
        out = _run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"])
        for line in (out or "").splitlines():
            if line.startswith("yes:"):
                parts = line.split(":")
                ssid = ":".join(parts[1:-1]) or None
                if parts[-1].isdigit():
                    info.setdefault("signal_pct", int(parts[-1]))
                break
    if not info and ssid is None:
        return None
    if ssid:
        info["ssid_hash"] = _hash(ssid, salt)
        if send_ssid:
            info["ssid"] = mask_secrets(ssid)[:32]
    return info


def _timeout_call(fn: Callable, timeout: float):
    box: list = []
    t = threading.Thread(target=lambda: box.append(_safe_call(fn)), daemon=True)
    t.start()
    t.join(timeout)
    return box[0] if box else None


def _safe_call(fn):
    try:
        return fn()
    except Exception:
        return None


def probe_api(base_url: str, timeout: float = 4.0) -> dict:
    """DNS, TLS and one GET /api/ready (public, no key sent). Reports timings and the server Date header skew."""
    u = urllib.parse.urlparse(base_url)
    host, https = u.hostname or "", u.scheme == "https"
    port = u.port or (443 if https else 80)
    out: dict = {"host": host, "dns_ok": False, "tls_ok": None if not https else False, "http_status": None}
    t0 = time.monotonic()
    ok = _timeout_call(lambda: socket.getaddrinfo(host, port, type=socket.SOCK_STREAM), timeout)
    out["dns_ms"] = int((time.monotonic() - t0) * 1000)
    out["dns_ok"] = bool(ok)
    if not ok:
        return out
    conn = None
    try:
        t1 = time.monotonic()
        conn = (http.client.HTTPSConnection(host, port, timeout=timeout, context=ssl.create_default_context()) if https
                else http.client.HTTPConnection(host, port, timeout=timeout))
        conn.connect()
        out["connect_ms"] = int((time.monotonic() - t1) * 1000)
        if https:
            out["tls_ok"] = True
        t2 = time.time()
        conn.request("GET", "/api/ready", headers={"User-Agent": "homebeacon-unoq-agent", "Accept": "application/json"})
        r = conn.getresponse()
        r.read(4096)
        t3 = time.time()
        out["http_status"] = r.status
        out["latency_ms"] = int((t3 - t2) * 1000)
        d = r.getheader("Date")
        if d:
            out["clock_skew_s"] = round((t2 + t3) / 2 - parsedate_to_datetime(d).timestamp(), 1)
    except ssl.SSLError as e:
        out["tls_ok"] = False
        out["error"] = "tls " + type(e).__name__ + " (a wrong clock also causes this)"
    except (OSError, http.client.HTTPException, ValueError, TypeError) as e:
        out["error"] = type(e).__name__
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    return out


def _usb() -> Optional[list]:
    devs = []
    for p in sorted(glob.glob(f"{SYS}/bus/usb/devices/*")):
        vid = _read(p + "/idVendor", 8)
        if not vid:
            continue
        devs.append({"id": f"{vid}:{_read(p + '/idProduct', 8) or '?'}", "product": mask_secrets(_read(p + "/product", 48) or "")[:40] or None})
        if len(devs) >= MAX_USB:
            break
    if not devs and not os.path.isdir(f"{SYS}/bus/usb/devices"):
        return None
    return devs


def _serial(cfg) -> Optional[list]:
    ports = sorted(set(glob.glob(f"{DEV}/ttyACM*") + glob.glob(f"{DEV}/ttyUSB*")))[:MAX_SERIAL]
    configured = getattr(cfg, "mcu_port", "") or ""
    out = []
    try:
        mine = set(os.getgroups()) | {os.getgid()}
    except OSError:
        mine = set()
    for p in ports:
        try:
            st = os.stat(p)
        except OSError:
            continue
        try:
            import grp
            group = grp.getgrgid(st.st_gid).gr_name
        except Exception:
            group = str(st.st_gid)
        can = os.access(p, os.R_OK | os.W_OK)
        out.append({"dev": os.path.basename(p), "mode": oct(st.st_mode & 0o777), "group": group, "agent_can_open": can,
                    "agent_in_group": st.st_gid in mine, "configured": bool(configured) and os.path.basename(configured) == os.path.basename(p)})
    if configured and not any(o["configured"] for o in out):
        out.append({"dev": os.path.basename(configured), "present": os.path.exists(configured), "configured": True})
    return out


def _service() -> Optional[dict]:
    under = bool(os.environ.get("INVOCATION_ID"))
    out = _run(["systemctl", "show", SERVICE_UNIT, "-p", "ActiveState", "-p", "SubState", "-p", "UnitFileState", "-p", "NRestarts"])
    if not out:
        return {"under_systemd": under, "active": None, "enabled": None, "restarts": None} if under else None
    kv = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
    n = kv.get("NRestarts", "")
    return {"under_systemd": under, "active": kv.get("ActiveState"), "sub": kv.get("SubState"),
            "enabled": kv.get("UnitFileState"), "restarts": int(n) if n.isdigit() else None}


def _mcu(status: dict, now_wall: float) -> Optional[dict]:
    if not status:
        return None
    m = status.get("mcu") or {}
    boxes = ((status.get("live") or {}).get("boxes")) or {}
    ages = [b.get("age_s") for b in boxes.values() if isinstance(b, dict) and isinstance(b.get("age_s"), (int, float))]
    return {"source": m.get("source"), "connected": bool(m.get("connected")), "error": mask_secrets(m.get("error") or "")[:80] or None,
            "last_message_age_s": int(min(ages)) if ages else None, "boxes_heard": len(boxes)}


def _queue(status: dict, store, now_wall: float) -> Optional[dict]:
    q = None
    try:
        q = store.stats() if store is not None else ((status or {}).get("uplink") or {}).get("queue")
    except Exception:
        q = ((status or {}).get("uplink") or {}).get("queue")
    if not q:
        return None
    oldest = q.get("oldest")
    return {"rows": q.get("rows"), "bytes": q.get("bytes"), "critical": q.get("critical"), "dropped": q.get("dropped"),
            "oldest_age_s": int(max(0, now_wall - oldest)) if isinstance(oldest, (int, float)) else None}


def _power(status: dict) -> Optional[dict]:
    p = (status or {}).get("power")
    if not p:
        return None
    h = p.get("hours_remaining")
    return {"mode": p.get("mode"), "server_mode": p.get("server_mode"),
            "runway_h": h if isinstance(h, (int, float)) else None,          # None = unknown, never a guess
            "confidence": p.get("confidence"), "load_basis": p.get("load_basis")}


# ----------------------------------------------------------------------------- full snapshot
def collect_environment(cfg=None, status: Optional[dict] = None, store=None, *, probe: bool = True,
                        api_probe: Optional[dict] = None, wall: Callable[[], float] = time.time) -> dict:
    """Bounded, secret-free snapshot. Never raises. `api_probe` lets the caller reuse a recent probe result."""
    now = wall()
    status = status or {}
    salt = _salt(cfg)
    send_ssid = bool(getattr(cfg, "env_send_ssid", False))
    state_dir = getattr(cfg, "state_dir", "") or "/var/lib/homebeacon-unoq"
    base = getattr(cfg, "base_url", "") or ""
    c = _collect
    env: dict = {
        "schema": SCHEMA, "at": int(now),
        "agent": c("package", _agent_info),
        "agent_usage": c("/proc/self", _self_usage),
        "python": c("platform", lambda: platform.python_version()),
        "os": c("/etc/os-release", _os_release),
        "kernel": c("platform", lambda: platform.release()),
        "arch": c("platform", lambda: platform.machine()),
        "board": c("device-tree", _board_model),
        "host": c("hostname hash", lambda: _hash(socket.gethostname(), salt)),
        "uptime": c("/proc/uptime", _uptime),
        "cpu": c("/proc/cpuinfo", _cpu),
        "memory": c("/proc/meminfo", _memory),
        "disk_state": c("statvfs", _disk, state_dir if os.path.isdir(state_dir) else "/"),
        "disk_root": c("statvfs", _disk, "/"),
        "temperature": c("thermal_zone", _thermal),
        "throttling": c("vcgencmd", _throttle),
        "time_sync": c("timedatectl", _timesync),
        "interfaces": c("ip addr / sysfs", _interfaces),
        "default_route": c("/proc/net/route", _default_route),
        "dns": c("/etc/resolv.conf", _dns),
        "wifi": c("proc/iw/nmcli", _wifi, salt, send_ssid),
        "usb": c("sysfs usb", _usb),
        "serial": c("/dev tty", _serial, cfg),
        "mcu": c("agent status", _mcu, status, now),
        "queue": c("store", _queue, status, store, now),
        "power": c("agent status", _power, status),
        "service": c("systemctl", _service),
    }
    if api_probe is None and probe and base:
        api_probe = probe_api(base)
    env["api"] = c("probe /api/ready", lambda: api_probe or None)
    skew = (api_probe or {}).get("clock_skew_s")
    ts = env["time_sync"]["value"] if env["time_sync"]["ok"] else None
    env["clock"] = c("API Date header", lambda: None if skew is None and ts is None else {
        "skew_s": skew, "state": None if skew is None else ("ok" if abs(skew) < 30 else "drift" if abs(skew) < 120 else "bad"),
        "ntp_synchronized": ts.get("synchronized") if isinstance(ts, dict) else None})
    return scrub(env)


# ----------------------------------------------------------------------------- compact event
def _v(env: dict, section: str, *path, default=None):
    cur = env.get(section)
    if not isinstance(cur, dict) or not cur.get("ok"):
        return default
    cur = cur.get("value")
    for p in path:
        if isinstance(cur, dict):
            cur = cur.get(p)
        else:
            return default
    return default if cur in ("unknown",) else cur


def _compact(env: dict) -> dict:
    ifs = _v(env, "interfaces") or []
    wifi = _v(env, "wifi") or {}
    api = _v(env, "api") or {}
    ser = _v(env, "serial")
    d = {
        "schema": SCHEMA, "version": _v(env, "agent", "version"), "build": _v(env, "agent", "build"), "release": _v(env, "agent", "release"),
        "python": _v(env, "python"), "os": _v(env, "os", "name"), "kernel": _v(env, "kernel"), "arch": _v(env, "arch"),
        "board": _v(env, "board"), "host": _v(env, "host"),
        "uptime_s": _v(env, "uptime", "uptime_s"), "cores": _v(env, "cpu", "cores"), "load1": (_v(env, "cpu", "load") or [None])[0],
        "mem_avail_mb": _v(env, "memory", "avail_mb"), "mem_total_mb": _v(env, "memory", "total_mb"),
        "disk_free_pct": _v(env, "disk_state", "free_pct"), "disk_free_mb": _v(env, "disk_state", "free_mb"),
        "root_free_pct": _v(env, "disk_root", "free_pct"),
        "temp_c": _v(env, "temperature", "max_c"),
        "throttled": None if _v(env, "throttling") is None else bool(_v(env, "throttling", "throttled_now") or _v(env, "throttling", "undervoltage_now")),
        "ntp_sync": _v(env, "clock", "ntp_synchronized"), "clock_skew_s": _v(env, "clock", "skew_s"),
        "ifaces": [{"n": i.get("name"), "s": i.get("state"), "ip": (i.get("addrs") or [None])[0]} for i in ifs[:MAX_IFACES]] if ifs else None,
        "gateway": None if _v(env, "default_route") is None else bool(_v(env, "default_route", "gateway")),
        "dns": len(_v(env, "dns") or []) if _v(env, "dns") is not None else None,
        "wifi": {k: wifi.get(k) for k in ("ssid_hash", "signal_dbm", "link_quality", "signal_pct") if wifi.get(k) is not None} or None,
        "api": {k: api.get(k) for k in ("dns_ok", "dns_ms", "tls_ok", "http_status", "latency_ms", "error") if api.get(k) is not None} or None,
        "usb": len(_v(env, "usb") or []) if _v(env, "usb") is not None else None,
        "serial": [{"dev": s.get("dev"), "open": s.get("agent_can_open")} for s in ser[:MAX_SERIAL]] if ser is not None else None,
        "mcu_connected": _v(env, "mcu", "connected"), "mcu_msg_age_s": _v(env, "mcu", "last_message_age_s"),
        "queue_rows": _v(env, "queue", "rows"), "queue_oldest_age_s": _v(env, "queue", "oldest_age_s"),
        "power_mode": _v(env, "power", "mode"), "runway_h": _v(env, "power", "runway_h"),
        "svc_active": _v(env, "service", "active"), "svc_enabled": _v(env, "service", "enabled"), "svc_restarts": _v(env, "service", "restarts"),
    }
    return d


_DROP_ORDER = ("ifaces", "usb", "wifi", "serial", "board", "os", "build", "release", "python", "kernel", "api")


def build_environment_event(env: dict) -> dict:
    """{"type": "agent.environment", "data": {...}} with data under 4 KB. Unknown values are null."""
    data = scrub(_compact(env if isinstance(env, dict) else {}))
    for k in _DROP_ORDER:
        if len(json.dumps(data, separators=(",", ":"))) <= MAX_EVENT_BYTES - 200:
            break
        data[k] = None
    data["truncated"] = len(json.dumps(data, separators=(",", ":"))) > MAX_EVENT_BYTES - 200 or None
    return {"type": EVENT_TYPE, "data": data}


def _signature(d: dict) -> dict:
    """The fields whose change is worth telling the cloud about."""
    wifi, api = d.get("wifi") or {}, d.get("api") or {}
    skew = d.get("clock_skew_s")
    disk = d.get("disk_free_pct")
    return {
        "version": d.get("version"), "kernel": d.get("kernel"),
        "ips": sorted(f"{i.get('n')}={i.get('ip')}" for i in d.get("ifaces") or []),
        "gateway": d.get("gateway"), "ssid": wifi.get("ssid_hash"),
        "api_ok": None if not api else bool(api.get("dns_ok") and api.get("tls_ok") is not False and (api.get("http_status") or 0) < 500 and api.get("http_status")),
        "ntp": d.get("ntp_sync"), "skew": None if skew is None else ("ok" if abs(skew) < 30 else "drift" if abs(skew) < 120 else "bad"),
        "disk": None if disk is None else ("low" if disk < 5 else "warn" if disk < 15 else "ok"),
        "serial": sorted(f"{s.get('dev')}={s.get('open')}" for s in d.get("serial") or []),
        "usb": d.get("usb"), "mcu": d.get("mcu_connected"), "throttled": d.get("throttled"),
        "hot": None if d.get("temp_c") is None else d["temp_c"] >= 80,
        "svc": (d.get("svc_active"), d.get("svc_restarts")),
    }


def should_upload_environment(prev: Optional[dict], cur: dict, now: float, boot: bool = False) -> bool:
    """prev = {"at": epoch, "data": <compact data>} of the last upload, or None.
    Upload when: nothing was ever uploaded; or on boot (at most every 5 minutes); or a significant field changed
    (at most every 15 minutes); or 6 hours passed. `cur` is the compact data dict (event["data"])."""
    if not prev or not isinstance(prev.get("data"), dict) or not isinstance(prev.get("at"), (int, float)):
        return True
    age = now - prev["at"]
    if age < 0:
        return True                        # clock went backwards: resend rather than wait forever
    if age >= UPLOAD_EVERY_S:
        return True
    if boot and age >= MIN_BOOT_GAP_S:
        return True
    if age >= MIN_CHANGE_GAP_S and _signature(prev["data"]) != _signature(cur):
        return True
    return False


# ----------------------------------------------------------------------------- text for people
def _fmt(leaf, fmt: Callable = str) -> str:
    if not isinstance(leaf, dict) or not leaf.get("ok"):
        return "unknown"
    try:
        return fmt(leaf["value"])
    except Exception:
        return "unknown"


def render_environment_text(env: dict, width: int = 78) -> str:
    g = lambda s: env.get(s, {})                                                  # noqa: E731
    L = ["HomeBeacon Uno Q environment" + (f"  ({time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(env['at']))})" if env.get("at") else ""), "-" * width]
    L.append("Agent: " + _fmt(g("agent"), lambda v: f"{v['version']} build {v.get('build') or 'unknown'}, release {v['release']}")
             + "   Python " + _fmt(g("python")))
    L.append("System: " + _fmt(g("os"), lambda v: v.get("name") or "unknown") + ", kernel " + _fmt(g("kernel")) + ", " + _fmt(g("arch"))
             + ", board " + _fmt(g("board")) + ", host id " + _fmt(g("host")))
    L.append("Up: " + _fmt(g("uptime"), lambda v: f"{v['uptime_s'] // 3600} h {v['uptime_s'] % 3600 // 60} min")
             + "   CPU: " + _fmt(g("cpu"), lambda v: f"{v.get('cores')} cores, load {v.get('load')}") + "   Temp: "
             + _fmt(g("temperature"), lambda v: f"{v['max_c']} C"))
    L.append("Memory: " + _fmt(g("memory"), lambda v: f"{v['avail_mb']} of {v['total_mb']} MB free")
             + "   Disk (state): " + _fmt(g("disk_state"), lambda v: f"{v['free_mb']} MB free ({v['free_pct']}%)")
             + "   Root: " + _fmt(g("disk_root"), lambda v: f"{v['free_pct']}% free"))
    L.append("Power flags: " + _fmt(g("throttling"), lambda v: ", ".join(k for k, x in v.items() if x) or "none") + "   Agent use: "
             + _fmt(g("agent_usage"), lambda v: f"{v.get('rss_mb')} MB, {v.get('threads')} threads, {v.get('open_fds')} files"))
    L.append("Clock: " + _fmt(g("clock"), lambda v: f"skew vs server {v.get('skew_s')} s ({v.get('state')}), NTP synced {v.get('ntp_synchronized')}"))
    L.append("Network: " + _fmt(g("interfaces"), lambda v: ", ".join(f"{i['name']} {i['state']} {','.join(i['addrs'] or [])}" for i in v))
             + "   route " + _fmt(g("default_route"), lambda v: v.get("gateway") or "none") + "   DNS " + _fmt(g("dns"), lambda v: ",".join(v) or "none"))
    L.append("Wi-Fi: " + _fmt(g("wifi"), lambda v: f"signal {v.get('signal_dbm', v.get('signal_pct'))}, quality {v.get('link_quality')}, network id {v.get('ssid_hash')}"))
    L.append("API: " + _fmt(g("api"), lambda v: f"DNS {'ok' if v.get('dns_ok') else 'FAILED'} {v.get('dns_ms')} ms, TLS {v.get('tls_ok')}, "
                                              f"HTTP {v.get('http_status')} in {v.get('latency_ms')} ms" + (f", {v['error']}" if v.get("error") else "")))
    L.append("USB: " + _fmt(g("usb"), lambda v: ", ".join(d["id"] for d in v) or "none"))
    L.append("Serial: " + _fmt(g("serial"), lambda v: "; ".join(f"{s['dev']} " + ("can open" if s.get("agent_can_open") else "CANNOT open (group "
                                                                    + str(s.get("group")) + ")" if "group" in s else "missing") for s in v) or "none found"))
    L.append("Box link: " + _fmt(g("mcu"), lambda v: f"{'connected' if v['connected'] else 'NOT connected'}, last message "
                                                      + ("unknown" if v['last_message_age_s'] is None else f"{v['last_message_age_s']} s ago")))
    L.append("Queue: " + _fmt(g("queue"), lambda v: f"{v['rows']} rows, oldest " + ("unknown" if v['oldest_age_s'] is None else f"{v['oldest_age_s']} s")))
    L.append("Power: " + _fmt(g("power"), lambda v: f"{v['mode']}, runway " + ("unknown" if v['runway_h'] is None else f"{v['runway_h']} h") + f" (confidence {v['confidence']})"))
    L.append("Service: " + _fmt(g("service"), lambda v: f"active {v.get('active')}, enabled {v.get('enabled')}, restarts {v.get('restarts')}"))
    return "\n".join(L)


# ----------------------------------------------------------------------------- agent integration
class EnvReporter:
    """Cache for the status endpoint plus the upload schedule. Thread-safe; a slow collection never blocks readers
    (they get the last snapshot). Wire-up: status()["env"] = reporter.snapshot(); each step: ev = reporter.tick(); enqueue it."""

    def __init__(self, cfg, store=None, status_fn: Optional[Callable[[], dict]] = None, wall: Callable[[], float] = time.time,
                 collector: Callable = collect_environment, probe_every_s: float = PROBE_EVERY_S):
        self.cfg, self.store, self.status_fn, self.wall, self.collector = cfg, store, status_fn, wall, collector
        self.probe_every_s = probe_every_s
        self._lock = threading.Lock()
        self._env: Optional[dict] = None
        self._env_at = -1e18
        self._probe: Optional[dict] = None
        self._probe_at = -1e18
        self._prev: Optional[dict] = None
        self._booted = True
        if store is not None:
            try:
                p = store.get("env_last_upload", None)
                if isinstance(p, dict):
                    self._prev = p
            except Exception:
                pass

    def snapshot(self, max_age_s: float = SNAPSHOT_MAX_AGE_S) -> dict:
        now = self.wall()
        if self._env is not None and now - self._env_at < max_age_s:
            return self._env
        if not self._lock.acquire(blocking=self._env is None):
            return self._env or {}
        try:
            do_probe = now - self._probe_at >= self.probe_every_s
            try:
                status = self.status_fn() if self.status_fn else {}
            except Exception:
                status = {}
            env = self.collector(self.cfg, status, self.store, probe=do_probe, api_probe=None if do_probe else self._probe, wall=self.wall)
            if do_probe:
                self._probe, self._probe_at = (env.get("api") or {}).get("value") if (env.get("api") or {}).get("ok") else None, now
            self._env, self._env_at = env, now
            return env
        finally:
            self._lock.release()

    def tick(self) -> Optional[dict]:
        """Return an 'agent.environment' event to enqueue now, or None. Call from the agent loop (cheap when not due)."""
        now = self.wall()
        if self._prev is not None and now - self._prev["at"] < MIN_CHANGE_GAP_S and not self._booted:
            return None                    # cheap exit: nothing can be due inside the minimum gap
        ev = build_environment_event(self.snapshot(max_age_s=300))
        if not should_upload_environment(self._prev, ev["data"], now, boot=self._booted):
            self._booted = False
            return None
        self._booted = False
        self._prev = {"at": now, "data": ev["data"]}
        if self.store is not None:
            try:
                self.store.put("env_last_upload", self._prev)
            except Exception:
                pass
        return ev


def main(argv: Optional[list] = None, cfg=None, out=None) -> int:
    """`hbagent env [--json] [--no-probe]`: print the snapshot. Works without the agent running."""
    import sys
    out = out or sys.stdout
    argv = list(argv or [])
    env = collect_environment(cfg, None, None, probe="--no-probe" not in argv)
    out.write((json.dumps(env, indent=1, sort_keys=True) if "--json" in argv else render_environment_text(env)) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(__import__("sys").argv[1:]))
