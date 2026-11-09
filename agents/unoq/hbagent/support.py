"""Secret masking, log tails and the redacted support bundle.

The bundle is a local .tar.gz in <state_dir>/support/, mode 600, capped in size. It is never uploaded
by the agent: a person copies it off the hub when they choose to. It holds the doctor report, the
configuration with secrets removed, an environment snapshot, versions, queue statistics (counts and
ages, never payloads), uplink health, the last log lines, and update status. Every text member goes
through `mask()` and the finished bytes are checked once more against the known device key.
"""
from __future__ import annotations

import glob
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import time
from typing import Callable, Iterable, Optional

from . import VERSION

MASK = "[masked]"
MAX_MEMBER = 96_000           # bytes per file inside the bundle
MAX_BUNDLE = 400_000          # bytes for the finished .tar.gz
KEEP_BUNDLES = 5
LOG_LINES_DEFAULT = 300
MAX_LINE = 600

_URL_CRED = re.compile(r"\b([A-Za-z][A-Za-z0-9+.-]{0,14}://)[^/\s:@]+:[^/\s@]+@")
_HEADER = re.compile(r"(?i)\b(x-device-key|authorization|cookie|set-cookie|x-admin-key|idempotency-key)\b(\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\s,;]+")
_BEARER = re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}")
_ASSIGN = re.compile(r"""(?ix)\b([A-Za-z0-9_.-]*(?:key|token|secret|passw(?:or)?d|passwd|credential)[A-Za-z0-9_]*)\b(\s*[=:]\s*)["']?([^\s"',;&]{4,})""")
_DK = re.compile(r"\bdk_[A-Za-z0-9_-]{4,}")
_HEX = re.compile(r"\b[0-9a-fA-F]{32,}\b")
_B64 = re.compile(r"(?<![A-Za-z0-9/_-])[A-Za-z0-9_-]{40,}={0,2}(?![A-Za-z0-9/_-])")
_SAFE_ASSIGN_NAMES = ("key_env", "key_file", "key_source")     # names of where a key lives, not the key


def _hex_sub(m: "re.Match[str]") -> str:
    ctx = m.string[max(0, m.start() - 12):m.start()].lower()
    return m.group(0) if "sha256" in ctx or "checksum" in ctx else MASK


def _b64_sub(m: "re.Match[str]") -> str:
    s = m.group(0)
    if re.fullmatch(r"[0-9a-fA-F]+", s):
        return s                      # pure hex was already judged by _hex_sub (release checksums stay readable)
    return MASK if any(c.isdigit() for c in s) and any(c.isalpha() for c in s) else s


def _assign_sub(m: "re.Match[str]") -> str:
    name = m.group(1)
    if name.lower().split(".")[-1] in _SAFE_ASSIGN_NAMES or name.lower().endswith(("key_file", "key_env")):
        return m.group(0)
    return f"{name}{m.group(2)}{MASK}"


def mask(text: str, secrets: Iterable[str] = ()) -> str:
    """Remove anything that looks like a credential. Safe to run twice. Device ids (24 hex) are kept."""
    if not text:
        return text
    out = text
    for s in secrets:
        if s and len(s) >= 6:
            out = out.replace(s, MASK)
    out = _URL_CRED.sub(lambda m: m.group(1) + MASK + "@", out)
    out = _HEADER.sub(lambda m: f"{m.group(1)}{m.group(2)}{MASK}", out)
    out = _BEARER.sub(lambda m: f"{m.group(1)} {MASK}", out)
    out = _DK.sub("dk_" + MASK, out)
    out = _ASSIGN.sub(_assign_sub, out)
    out = _HEX.sub(_hex_sub, out)
    out = _B64.sub(_b64_sub, out)
    return out


def mask_obj(obj, secrets: Iterable[str] = ()):
    """Mask every string inside a JSON-like structure."""
    secrets = tuple(secrets)
    if isinstance(obj, str):
        return mask(obj, secrets)
    if isinstance(obj, dict):
        return {k: (MASK if re.search(r"(?i)(passw|secret|token|device_key|api_key)", str(k)) and isinstance(v, str) and v else mask_obj(v, secrets))
                for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [mask_obj(v, secrets) for v in obj]
    return obj


# ------------------------------------------------------------------ logs
def tail_file(path: str, lines: int, max_bytes: int = 200_000) -> list[str]:
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            f.seek(max(0, size - max_bytes))
            data = f.read(max_bytes)
    except OSError:
        return []
    out = data.decode("utf-8", "replace").splitlines()
    if size > max_bytes and out:
        out = out[1:]          # first line is probably cut in half
    return [ln[:MAX_LINE] for ln in out[-lines:]]


def journal_tail(unit: str, lines: int, run: Optional[Callable] = None) -> list[str]:
    runner = run or _run
    rc, out = runner(["journalctl", "-u", unit, "-n", str(int(lines)), "--no-pager", "-o", "short-iso"], 8.0)
    if rc != 0:
        return []
    return [ln[:MAX_LINE] for ln in out.splitlines()[-lines:]]


def log_lines(cfg, lines: int = LOG_LINES_DEFAULT, secrets: Iterable[str] = (), run: Optional[Callable] = None) -> tuple[str, list[str]]:
    """(source, masked lines). Log file if configured and readable, else the systemd journal."""
    src, raw = "none", []
    if cfg.log_file:
        raw = tail_file(cfg.log_file, lines)
        src = cfg.log_file if raw else "none"
    if not raw:
        raw = journal_tail("homebeacon-unoq", lines, run)
        src = "journal" if raw else src
    return src, [mask(ln, secrets) for ln in raw]


def _run(cmd: list, timeout: float = 5.0) -> tuple:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return p.returncode, (p.stdout or "") + ("" if p.returncode == 0 else (p.stderr or ""))
    except (OSError, subprocess.SubprocessError):
        return 127, ""


# ------------------------------------------------------------------ small environment fallback
def basic_environment(cfg) -> dict:
    """Minimal facts, used when the full environment reporter (envreport.py) is not available."""
    env: dict = {"agent_version": VERSION, "python": platform.python_version(), "platform": platform.platform(),
                 "machine": platform.machine(), "cpu_count": os.cpu_count()}
    try:
        with open("/etc/os-release", encoding="utf-8", errors="replace") as f:
            kv = dict(ln.strip().split("=", 1) for ln in f if "=" in ln)
        env["os"] = kv.get("PRETTY_NAME", "").strip('"') or None
    except OSError:
        env["os"] = None
    for name, path in (("state_dir", cfg.state_dir), ("root", "/")):
        try:
            u = shutil.disk_usage(path if os.path.exists(path) else "/")
            env[f"disk_{name}_free_mb"] = u.free // 1_000_000
        except OSError:
            env[f"disk_{name}_free_mb"] = None
    try:
        env["uptime_s"] = int(float(open("/proc/uptime", encoding="ascii").read().split()[0]))
    except (OSError, ValueError, IndexError):
        env["uptime_s"] = None
    env["serial_devices"] = sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    return env


def environment(cfg) -> dict:
    """Environment snapshot: module B's reporter when present, else the basics. Never raises."""
    try:
        from . import envreport
        fn = getattr(envreport, "collect_environment", None)
        if fn is not None:
            try:
                got = fn(cfg)
            except TypeError:
                got = fn()
            if isinstance(got, dict):
                return got
    except Exception:  # noqa: BLE001
        pass
    return basic_environment(cfg)


# ------------------------------------------------------------------ config without secrets
def redacted_config(cfg) -> dict:
    d = dict(cfg.__dict__)
    d["secret_configured"] = bool(os.environ.get(cfg.key_env)) or bool(cfg.key_file)
    return mask_obj(d)


# ------------------------------------------------------------------ bundle
def _add(tar: tarfile.TarFile, name: str, text: str, mtime: float) -> int:
    data = text.encode("utf-8", "replace")
    if len(data) > MAX_MEMBER:
        data = data[-MAX_MEMBER:]
        text_note = b"[truncated to the last part]\n"
        data = text_note + data
    ti = tarfile.TarInfo(name)
    ti.size, ti.mtime, ti.mode = len(data), int(mtime), 0o600
    tar.addfile(ti, io.BytesIO(data))
    return len(data)


def build_bundle(cfg, *, queue_stats: Optional[dict] = None, report: Optional[list] = None, update_status: Optional[dict] = None,
                 status: Optional[dict] = None, key: str = "", log_n: int = LOG_LINES_DEFAULT, out_dir: Optional[str] = None,
                 now: Optional[float] = None, run: Optional[Callable] = None, uplink_state: Optional[dict] = None) -> dict:
    """Write the bundle and return {"path", "bytes", "members", "log_source"}. Raises OSError if it cannot be written."""
    now = now or time.time()
    secrets = [key] if key else []
    out_dir = out_dir or os.path.join(cfg.state_dir, "support")
    os.makedirs(out_dir, mode=0o700, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime(now))
    path = os.path.join(out_dir, f"hb-support-{stamp}.tar.gz")

    def js(obj) -> str:
        return mask(json.dumps(mask_obj(obj, secrets), indent=2, sort_keys=True, default=str), secrets)

    src, lines = log_lines(cfg, log_n, secrets, run)
    qstats = queue_stats
    members: list[tuple[str, str]] = [
        ("README.txt", "HomeBeacon Uno Q support bundle.\nSecrets are masked and the device key is never included.\n"
                       "Nothing here was sent anywhere. Copy this file off the hub yourself if you want to share it.\n"
                       f"Created (UTC): {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(now))}\n"),
        ("versions.json", js({"agent": VERSION, "python": sys.version.split()[0], "platform": platform.platform(),
                              "machine": platform.machine()})),
        ("config.json", js(redacted_config(cfg))),
        ("environment.json", js(environment(cfg))),
        ("queue.json", js(qstats if qstats is not None else {"unavailable": "no queue file read"})),
        ("uplink_health.json", js(uplink_state if uplink_state is not None else {"unavailable": True})),
        ("update.json", js(update_status if update_status is not None else {"unavailable": True})),
        ("status.json", js(status if status is not None else {"unavailable": "agent status endpoint not answering"})),
    ]
    if report is not None:
        members.append(("doctor.json", js(report)))
        members.append(("doctor.txt", mask("\n".join(_render_line(c) for c in report) + "\n", secrets)))
    members.append(("log_tail.txt", f"# source: {src}\n" + "\n".join(lines) + ("\n" if lines else "")))

    def pack(ms) -> bytes:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=6) as tar:
            for name, text in ms:
                _add(tar, name, text, now)
        return buf.getvalue()

    blob = pack(members)
    while len(blob) > MAX_BUNDLE and lines:            # the log tail is the only elastic part
        lines = lines[len(lines) // 2:]
        members[-1] = ("log_tail.txt", f"# source: {src} (shortened to fit the size cap)\n" + "\n".join(lines) + "\n")
        blob = pack(members)
    if len(blob) > MAX_BUNDLE:
        raise OSError("support bundle is over the size cap even without logs")
    for s in secrets:                                  # last line of defence: the key must not appear in any form
        if s and len(s) >= 6 and (s.encode() in blob or s.encode() in _gunzip(blob)):
            raise OSError("refusing to write a bundle that contains the device key")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(blob)
    _prune(out_dir)
    return {"path": path, "bytes": len(blob), "members": [n for n, _ in members], "log_source": src}


def _gunzip(blob: bytes) -> bytes:
    import gzip
    try:
        return gzip.decompress(blob)
    except OSError:
        return b""


def _render_line(c: dict) -> str:
    return f"{c.get('level', '?'):<5} {c.get('name', '?')}  {c.get('detail', '')}" + (f"  FIX - {c['fix']}" if c.get("fix") else "")


def _prune(out_dir: str) -> None:
    files = sorted(glob.glob(os.path.join(out_dir, "hb-support-*.tar.gz")))
    for old in files[:-KEEP_BUNDLES]:
        try:
            os.unlink(old)
        except OSError:
            pass
