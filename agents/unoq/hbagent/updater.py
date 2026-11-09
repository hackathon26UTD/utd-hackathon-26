"""Update, install and rollback for the hub. Standard library only.

Flow of an automatic update (every step can stop it, nothing unverified ever runs):
    manifest (https) -> newer than what runs, not a version that was rolled back, channel matches
    -> hub is not in a hazard (unless the release is flagged critical)
    -> streamed download with a size cap and a free disk check -> sha256 must match the manifest
    -> optional Ed25519 signature check with the openssl program when a public key is configured
    -> safe unpack into releases/<version>.new (no links, no odd paths, size and count caps)
    -> the new release's own self test passes -> boot guard is armed -> `current` link swapped atomically
    -> an event is queued -> the agent exits 75 and systemd starts the new release.
The boot guard (bootguard.py) then confirms the update once it is healthy, or rolls back.

Trust, said plainly: without a configured public key the only protection is the sha256 in the manifest,
which comes from the same site as the file. That catches corruption and truncation, not a compromised site.
Status reports this as "checksum_only" (unsigned). With a key and a signed release it is "verified".

CLI entry points for hbagent: update_check(), update_apply(), update_rollback(), update_status() all return dicts.
The older check() and download() stay for `check-update`; download() still only stages, it installs nothing.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import time
import tomllib
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Optional

from . import VERSION
from . import bootguard as bg
from .bootguard import RESTART_EXIT_CODE, clean

MAX_MANIFEST = 16_384
MAX_TARBALL = 2_000_000
MAX_UNPACKED = 12_000_000
MAX_MEMBERS = 400
NAME_RE = re.compile(r"^homebeacon-unoq-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz$")
SIG_RE = re.compile(r"^homebeacon-unoq-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz\.sig$")
CHANNEL_RE = re.compile(r"^[a-z][a-z0-9-]{0,15}$")
DEFAULT_INTERVAL_S = 6 * 3600
MIN_INTERVAL_S = 900
MAX_INTERVAL_S = 7 * 86400
HAZARD_RETRY_S = 900
FAIL_RETRY_S = 1800
CONF_PATH = os.environ.get("HB_UPDATE_CONF", "/etc/homebeacon/update.toml")


class UpdateError(RuntimeError):
    pass


def vtuple(v: str) -> tuple:
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", v or "")
    if not m:
        raise UpdateError(f"Not a version number: {v!r}")
    return tuple(int(x) for x in m.groups())


# ---------------------------------------------------------------- network
class _HttpsOnlyRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect may never leave https (loopback http is allowed only for local development)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _url_ok(newurl):
            raise urllib.error.URLError("redirect to a non-https address refused")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _url_ok(url: str) -> bool:
    return url.startswith("https://") or bool(re.match(r"http://(127\.0\.0\.1|localhost)(:\d+)?/", url))


def _opener(opener=None):
    return opener or urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()),
                                                 _HttpsOnlyRedirect())


def _get(url: str, limit: int, timeout: float = 15.0, opener=None) -> bytes:
    if not _url_ok(url):
        raise UpdateError("Updates are fetched over https:// only.")
    try:
        with _opener(opener).open(urllib.request.Request(url, headers={"User-Agent": "homebeacon-unoq-agent"}), timeout=timeout) as r:
            data = r.read(limit + 1)
    except (urllib.error.URLError, OSError) as e:
        raise UpdateError(f"Could not reach the update server ({type(e).__name__}).")
    if len(data) > limit:
        raise UpdateError("The update server sent more data than expected; refusing.")
    return data


def _stream(url: str, dest: str, size: int, sha256: str, timeout: float = 30.0, opener=None) -> None:
    """Download to `dest` in chunks (never the whole file in memory). Leaves no file unless size and hash match."""
    if not _url_ok(url):
        raise UpdateError("Updates are fetched over https:// only.")
    tmp = dest + ".part"
    h, got = hashlib.sha256(), 0
    try:
        with _opener(opener).open(urllib.request.Request(url, headers={"User-Agent": "homebeacon-unoq-agent"}), timeout=timeout) as r, \
                open(tmp, "wb") as f:
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                got += len(chunk)
                if got > size:
                    raise UpdateError("The update server sent more data than the manifest says; discarded.")
                h.update(chunk)
                f.write(chunk)
            f.flush()
            os.fsync(f.fileno())
        if got != size or h.hexdigest() != sha256:
            raise UpdateError("Downloaded file does not match the manifest checksum; discarded.")
        os.replace(tmp, dest)
    except (urllib.error.URLError, OSError) as e:
        if isinstance(e, UpdateError):
            raise
        raise UpdateError(f"Download failed ({type(e).__name__}).")
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


# ---------------------------------------------------------------- manifest
def validate_manifest(m: dict) -> dict:
    if not isinstance(m, dict):
        raise UpdateError("Manifest is not an object.")
    vtuple(m.get("version", ""))
    if not NAME_RE.match(str(m.get("file", ""))):
        raise UpdateError("Manifest file name is not an expected release name.")
    if str(m["file"]) != f"homebeacon-unoq-{m['version']}.tar.gz":
        raise UpdateError("Manifest file name does not match its version.")
    if not re.fullmatch(r"[0-9a-f]{64}", str(m.get("sha256", ""))):
        raise UpdateError("Manifest has no valid sha256.")
    if not isinstance(m.get("size"), int) or isinstance(m.get("size"), bool) or not 0 < m["size"] <= MAX_TARBALL:
        raise UpdateError("Manifest size is missing or too large.")
    if "signature" in m and not (isinstance(m["signature"], str) and SIG_RE.match(m["signature"])):
        raise UpdateError("Manifest signature name is not expected.")
    if "critical" in m and not isinstance(m["critical"], bool):
        raise UpdateError("Manifest critical flag must be true or false.")
    if "channel" in m and not (isinstance(m["channel"], str) and CHANNEL_RE.match(m["channel"])):
        raise UpdateError("Manifest channel is not valid.")
    return m


def manifest_name(channel: str) -> str:
    return "manifest.json" if channel == "stable" else f"manifest-{channel}.json"


# ---------------------------------------------------------------- settings
@dataclass
class Settings:
    channel: str = "stable"
    interval_s: int = DEFAULT_INTERVAL_S
    auto_apply: bool = True
    pubkey: str = ""                  # path to an Ed25519 public key (PEM); empty = checksum only
    require_signature: bool = False   # refuse unsigned releases even with no key configured
    base: str = ""
    prefix: str = bg.DEFAULT_PREFIX
    state_dir: str = bg.DEFAULT_STATE
    port: int = 8765                  # loopback status port, used to see whether a hazard is active

    @classmethod
    def load(cls, cfg=None, prefix: Optional[str] = None, conf_path: Optional[str] = None) -> "Settings":
        s = cls()
        if cfg is not None:
            s.base = (getattr(cfg, "update_base", "") or getattr(cfg, "base_url", "")).rstrip("/")
            s.state_dir = getattr(cfg, "state_dir", s.state_dir)
            s.port = getattr(cfg, "status_port", s.port)
        raw: dict = {}
        try:
            with open(conf_path or CONF_PATH, "rb") as f:
                raw = tomllib.load(f)
        except (OSError, tomllib.TOMLDecodeError):
            pass
        raw = {**raw.get("update", {}), **{k: v for k, v in raw.items() if k != "update" and not isinstance(v, dict)}}
        env = os.environ
        ch = str(env.get("HB_UPDATE_CHANNEL") or getattr(cfg, "update_channel", "") or raw.get("channel") or s.channel)
        s.channel = ch if CHANNEL_RE.match(ch) else "stable"
        try:
            iv = int(env.get("HB_UPDATE_INTERVAL_S") or getattr(cfg, "update_interval_s", 0) or raw.get("check_interval_s") or s.interval_s)
        except (TypeError, ValueError):
            iv = s.interval_s
        s.interval_s = max(MIN_INTERVAL_S, min(MAX_INTERVAL_S, iv))
        aa = raw.get("auto_apply", getattr(cfg, "update_auto_apply", s.auto_apply))
        s.auto_apply = aa if isinstance(aa, bool) else True
        s.pubkey = str(env.get("HB_UPDATE_PUBKEY") or getattr(cfg, "update_pubkey", "") or raw.get("pubkey") or "")
        rs = raw.get("require_signature", getattr(cfg, "update_require_signature", False))
        s.require_signature = rs if isinstance(rs, bool) else False
        s.prefix = prefix or str(env.get("HB_PREFIX") or s.prefix)
        s.base = s.base or os.environ.get("HB_BASE", "").rstrip("/")
        return s


def _settings(cfg, settings: Optional[Settings], prefix: Optional[str]) -> Settings:
    s = settings or Settings.load(cfg, prefix)
    if prefix:
        s.prefix = prefix
    if not s.base:
        from .config import DEFAULT_BASE
        s.base = DEFAULT_BASE
    return s


# ---------------------------------------------------------------- signature (openssl, fail closed)
def verify_signature(data_path: str, sig_b64: bytes, pubkey_path: str) -> bool:
    """Ed25519 over the tarball bytes, checked with `openssl pkeyutl -verify -rawin` (OpenSSL 3). Any problem is False."""
    import base64
    import binascii
    import tempfile
    if not pubkey_path or not os.path.isfile(pubkey_path) or not shutil.which("openssl"):
        return False
    try:
        sig = base64.b64decode(sig_b64.strip(), validate=True)
    except (binascii.Error, ValueError):
        return False
    if not 32 <= len(sig) <= 128:
        return False
    with tempfile.NamedTemporaryFile(prefix="sig-", delete=True) as t:
        t.write(sig)
        t.flush()
        try:
            r = subprocess.run(["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", pubkey_path, "-rawin", "-in", data_path,
                                "-sigfile", t.name], capture_output=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            return False
    return r.returncode == 0


# ---------------------------------------------------------------- safe unpack
def _safe_name(name: str, top: str) -> Optional[str]:
    parts = name.split("/")
    if name.startswith("/") or ".." in parts or "\x00" in name or "\\" in name:
        raise UpdateError("Release archive has an unsafe path; refusing.")
    if parts[0] != top:
        raise UpdateError("Release archive has files outside its folder; refusing.")
    rel = "/".join(p for p in parts[1:] if p not in ("", "."))
    return rel or None


def unpack(tarball: str, dest: str, version: str) -> None:
    """Extract only regular files and folders into `dest` (must not exist). Caps on count and size."""
    top = f"homebeacon-unoq-{version}"
    total = 0
    os.makedirs(dest, mode=0o755)
    try:
        with tarfile.open(tarball, "r:gz") as tf:
            members = tf.getmembers()
            if len(members) > MAX_MEMBERS:
                raise UpdateError("Release archive has too many files; refusing.")
            for m in members:
                rel = _safe_name(m.name, top)
                if rel is None:
                    continue
                target = os.path.join(dest, rel)
                if m.isdir():
                    os.makedirs(target, mode=0o755, exist_ok=True)
                elif m.isfile():
                    total += m.size
                    if total > MAX_UNPACKED:
                        raise UpdateError("Release is larger than allowed when unpacked; refusing.")
                    os.makedirs(os.path.dirname(target), mode=0o755, exist_ok=True)
                    src = tf.extractfile(m)
                    with open(target, "wb") as out:
                        shutil.copyfileobj(src, out, 65536)
                    os.chmod(target, 0o755 if m.mode & 0o111 else 0o644)
                else:
                    raise UpdateError("Release archive contains links or special files; refusing.")
    except (tarfile.TarError, OSError, EOFError) as e:
        if isinstance(e, UpdateError):
            raise
        raise UpdateError(f"Release archive could not be unpacked ({type(e).__name__}).")
    try:
        with open(os.path.join(dest, "VERSION"), encoding="utf-8") as f:
            if f.read().strip() != version:
                raise UpdateError("Release VERSION file does not match the manifest; refusing.")
    except OSError:
        raise UpdateError("Release has no VERSION file; refusing.")
    for need in ("run_agent.py", "hbagent/agent.py", "hbagent/bootguard.py", "hbagent/updater.py"):
        if not os.path.isfile(os.path.join(dest, need)):
            raise UpdateError(f"Release is missing {need}; refusing.")


def _selftest(release_dir: str) -> None:
    """The new release must pass its own self test before it can become `current`."""
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONDONTWRITEBYTECODE": "1"}
    try:
        r = subprocess.run([sys.executable, "-I", "-B", os.path.join(release_dir, "run_agent.py"), "selftest"],
                           capture_output=True, timeout=60, env=env, cwd="/")
    except (OSError, subprocess.SubprocessError) as e:
        raise UpdateError(f"New release self test could not run ({type(e).__name__}).")
    if r.returncode != 0:
        raise UpdateError("New release failed its self test; not installed.")


def _chown_release(path: str) -> None:
    """When run as root (install, operator), hand the tree to the service user so later updates can replace it."""
    if os.geteuid() != 0:
        return
    try:
        import pwd
        u = pwd.getpwnam("homebeacon")
    except (ImportError, KeyError):
        return
    for root, dirs, files in os.walk(path):
        for n in [root] + [os.path.join(root, x) for x in dirs + files]:
            try:
                os.chown(n, u.pw_uid, u.pw_gid)
            except OSError:
                pass


# ---------------------------------------------------------------- hazard
def hazard_active(port: int = 8765, timeout: float = 1.0) -> Optional[bool]:
    """Ask the running agent (loopback) whether a hazard is active. None = could not tell (agent not running)."""
    if not port:
        return None
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=timeout) as r:
            return bool(json.loads(r.read(200_000)).get("hazard", {}).get("active"))
    except (OSError, ValueError, urllib.error.URLError):
        return None


# ---------------------------------------------------------------- state
def installed_version(prefix: str) -> str:
    return bg.current_version(prefix) or VERSION


def _remember(state_dir: str, **fields) -> None:
    try:
        bg.mutate_state(state_dir, lambda st: st.update(fields))
    except (OSError, TimeoutError):
        pass


def _fetch_manifest(s: Settings, opener=None) -> dict:
    m = validate_manifest(json.loads(_get(f"{s.base}/downloads/unoq/{manifest_name(s.channel)}", MAX_MANIFEST, opener=opener)))
    if m.get("channel", s.channel) != s.channel:
        raise UpdateError(f"Manifest is for channel {clean(m.get('channel'), 16)}, not {s.channel}.")
    return m


def _trust(s: Settings, m: dict) -> str:
    if s.pubkey and "signature" in m:
        return "signature_required"
    if s.pubkey:
        return "refused_unsigned"
    return "checksum_only"


# ---------------------------------------------------------------- public API
def update_check(cfg=None, *, opener=None, prefix: Optional[str] = None, settings: Optional[Settings] = None,
                 now: Optional[Callable[[], float]] = None) -> dict:
    """Read the manifest and say whether a newer, allowed release exists. Installs nothing. Never raises."""
    s = _settings(cfg, settings, prefix)
    clock = now or time.time
    cur = installed_version(s.prefix)
    out = {"ok": False, "channel": s.channel, "current": cur, "latest": None, "update_available": False, "critical": False,
           "trust": "checksum_only" if not s.pubkey else "signature_required", "blocked": None, "error": None}
    try:
        m = _fetch_manifest(s, opener)
    except (UpdateError, ValueError) as e:
        out["error"] = clean(e)
        _remember(s.state_dir, last_check={"at": int(clock()), "ok": False, "error": out["error"]})
        return out
    out.update(ok=True, latest=m["version"], critical=bool(m.get("critical", False)), manifest=m, trust=_trust(s, m))
    st = bg.load_state(s.state_dir)
    if vtuple(m["version"]) > vtuple(cur):
        out["update_available"] = True
        if m["version"] in st["bad"]:
            out["update_available"], out["blocked"] = False, "this version was rolled back earlier and is skipped"
        elif out["trust"] == "refused_unsigned":
            out["update_available"], out["blocked"] = False, "a public key is configured but the release is not signed"
        elif s.require_signature and "signature" not in m:
            out["update_available"], out["blocked"] = False, "signature required but the release is unsigned"
    _remember(s.state_dir, last_check={"at": int(clock()), "ok": True, "latest": m["version"], "available": out["update_available"],
                                       "trust": out["trust"], "blocked": out["blocked"]})
    return out


def update_status(cfg=None, *, prefix: Optional[str] = None, settings: Optional[Settings] = None) -> dict:
    s = _settings(cfg, settings, prefix)
    st = bg.load_state(s.state_dir)
    try:
        free_mb = round(shutil.disk_usage(s.prefix if os.path.isdir(s.prefix) else "/").free / 1e6)
    except OSError:
        free_mb = None
    lk = bg.Lock(os.path.join(s.state_dir, "update.lock"))
    busy = not lk.acquire()
    lk.release()
    return {
        "current": installed_version(s.prefix), "previous": bg.previous_version(s.prefix), "last_good": st.get("last_good"),
        "pending": st.get("pending"), "boot": {k: st["boot"].get(k) for k in ("version", "healthy", "fails", "last_start")},
        "bad_versions": st["bad"], "last_rollback": st.get("rollback"), "last_applied": st.get("last_applied"),
        "last_check": st.get("last_check"), "next_check_at": st.get("next_check"), "channel": s.channel,
        "check_interval_s": s.interval_s, "auto_apply": s.auto_apply,
        "signing": "ed25519 key configured" if s.pubkey else "unsigned: checksum only (no public key configured)",
        "last_signature": st.get("last_signature"), "releases": bg.list_releases(s.prefix),
        "update_running": busy, "free_disk_mb": free_mb, "restart_exit_code": RESTART_EXIT_CODE,
    }


def update_apply(cfg=None, *, opener=None, prefix: Optional[str] = None, settings: Optional[Settings] = None,
                 hazard: Optional[bool] = None, restart: bool = False, run_selftest: bool = True,
                 now: Optional[Callable[[], float]] = None) -> dict:
    """Check, then download, verify, unpack, self test and switch to a newer release. Never raises.

    hazard: True/False when the caller knows (the agent does); None asks the running agent over loopback.
    The result has "outcome": installed | none | deferred | failed, and "restart_required" after a switch: the caller
    exits RESTART_EXIT_CODE (or pass restart=True as root to ask systemd)."""
    s = _settings(cfg, settings, prefix)
    clock = now or time.time
    guard = bg.Guard(s.prefix, s.state_dir, clock=clock)
    lk = bg.Lock(os.path.join(s.state_dir, "update.lock"))
    if not lk.acquire():
        return {"ok": False, "outcome": "failed", "error": "another update is already running"}
    cur = installed_version(s.prefix)
    to_v: Optional[str] = None
    try:
        st = bg.load_state(s.state_dir)
        if isinstance(st.get("pending"), dict):
            return {"ok": False, "outcome": "deferred", "reason": "the previous update is still being verified", "current": cur}
        info = update_check(cfg, opener=opener, settings=s, now=clock)
        if not info["ok"]:
            return {"ok": False, "outcome": "failed", "error": info["error"], "current": cur}
        if not info["update_available"]:
            return {"ok": True, "outcome": "none", "current": cur, "latest": info["latest"], "blocked": info["blocked"]}
        m = info["manifest"]
        to_v = m["version"]
        if vtuple(to_v) <= vtuple(cur):
            return {"ok": True, "outcome": "none", "current": cur, "latest": to_v}      # never downgrade here
        active = hazard if hazard is not None else hazard_active(s.port)
        if active and not info["critical"]:
            bg.emit(s.state_dir, "deferred", clock(), from_version=cur, to_version=to_v, reason="hazard active")
            return {"ok": False, "outcome": "deferred", "reason": "a hazard is active; waiting", "current": cur, "latest": to_v}
        bg.emit(s.state_dir, "started", clock(), from_version=cur, to_version=to_v, channel=s.channel, critical=info["critical"])
        res = _install(s, m, cur, opener, guard, clock, run_selftest)
    except UpdateError as e:
        reason = clean(e)
        bg.emit(s.state_dir, "failed", clock(), from_version=cur, to_version=to_v, reason=reason)
        _remember(s.state_dir, last_apply_error={"at": int(clock()), "version": to_v, "error": reason})
        return {"ok": False, "outcome": "failed", "error": reason, "current": cur, "latest": to_v}
    except Exception as e:  # noqa: BLE001 - an update bug must not take the agent down
        reason = f"unexpected {type(e).__name__}"
        bg.emit(s.state_dir, "failed", clock(), from_version=cur, to_version=to_v, reason=reason)
        return {"ok": False, "outcome": "failed", "error": reason, "current": cur, "latest": to_v}
    finally:
        lk.release()
    if restart:
        res["restart_requested"] = _restart_service()
    return res


def _install(s: Settings, m: dict, cur: str, opener, guard: "bg.Guard", clock, run_selftest: bool) -> dict:
    ver = m["version"]
    updates = os.path.join(s.state_dir, "updates")
    os.makedirs(updates, mode=0o700, exist_ok=True)
    for old in os.listdir(updates):                       # leftovers from a crashed run
        try:
            os.unlink(os.path.join(updates, old))
        except OSError:
            pass
    os.makedirs(bg.releases_dir(s.prefix), exist_ok=True)
    need = max(8_000_000, m["size"] * 8)
    if shutil.disk_usage(s.prefix).free < need or shutil.disk_usage(updates).free < need:
        raise UpdateError(f"Not enough free disk space for an update (need about {need // 1_000_000} MB).")
    tar_path = os.path.join(updates, m["file"])
    _stream(f"{s.base}/downloads/unoq/{m['file']}", tar_path, m["size"], m["sha256"], opener=opener)
    signature = "unsigned"
    if s.pubkey:
        if "signature" not in m:
            raise UpdateError("A public key is configured but the release is not signed; refusing.")
        sig = _get(f"{s.base}/downloads/unoq/{m['signature']}", 4096, opener=opener)
        if not verify_signature(tar_path, sig, s.pubkey):
            _remember(s.state_dir, last_signature="failed")
            raise UpdateError("Release signature did not verify; refusing.")
        signature = "verified"
    elif s.require_signature:
        raise UpdateError("Signature required but no public key is configured; refusing.")
    _remember(s.state_dir, last_signature=signature)
    dest = bg.release_path(s.prefix, ver)
    stage = dest + ".new"
    shutil.rmtree(stage, ignore_errors=True)
    try:
        unpack(tar_path, stage, ver)
        if run_selftest:
            _selftest(stage)
        shutil.rmtree(dest, ignore_errors=True)           # an older half-installed copy of this very version
        os.replace(stage, dest)
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    finally:
        try:
            os.unlink(tar_path)
        except OSError:
            pass
    _chown_release(dest)
    # Order matters: previous pointer, then armed guard, then the switch. A crash between any two is recoverable.
    if cur and bg.release_ok(s.prefix, cur):
        bg.swap_link(s.prefix, "previous", cur)
    guard.arm(cur, ver)
    try:
        bg.swap_link(s.prefix, "current", ver)
    except OSError:
        guard.disarm()
        raise UpdateError("Could not switch to the new release.")
    return {"ok": True, "outcome": "installed", "from_version": cur, "to_version": ver, "signature": signature,
            "restart_required": True, "restart_exit_code": RESTART_EXIT_CODE,
            "note": "Health check pending: the new release must reach the cloud (or pass its self test) or it is rolled back."}


def _restart_service() -> bool:
    if os.geteuid() != 0 or not shutil.which("systemctl"):
        return False
    try:
        subprocess.Popen(["systemctl", "--no-block", "restart", "homebeacon-unoq"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except OSError:
        return False


def update_rollback(cfg=None, *, prefix: Optional[str] = None, settings: Optional[Settings] = None, reason: str = "rolled back by operator",
                    restart: bool = False, now: Optional[Callable[[], float]] = None) -> dict:
    """Go back to the previous release now. The release left is remembered as bad. Never raises."""
    s = _settings(cfg, settings, prefix)
    res = bg.Guard(s.prefix, s.state_dir, clock=now or time.time).rollback(reason, manual=True)
    if res.get("ok") and restart:
        res["restart_requested"] = _restart_service()
    if res.get("ok"):
        res["restart_exit_code"] = RESTART_EXIT_CODE
    return res


# ---------------------------------------------------------------- scheduling and health (called by the agent)
def next_check_delay(settings: Settings, rng: Optional[random.Random] = None) -> float:
    """Interval with plus or minus 20 percent jitter so a fleet does not call the site at the same second."""
    return settings.interval_s * (rng or random).uniform(0.8, 1.2)


def auto_update_tick(cfg=None, *, hazard: Optional[bool] = None, opener=None, prefix: Optional[str] = None,
                     settings: Optional[Settings] = None, now: Optional[Callable[[], float]] = None,
                     rng: Optional[random.Random] = None) -> Optional[dict]:
    """Cheap to call every loop. Does nothing until the next check is due; then checks, and applies when allowed.
    Blocks while it downloads: the agent should run it in a worker thread. Returns None when nothing was due."""
    s = _settings(cfg, settings, prefix)
    clock = now or time.time
    t = clock()
    st = bg.load_state(s.state_dir)
    if isinstance(st.get("pending"), dict):
        return None                                      # an update is being verified; do not stack another
    nxt = st.get("next_check")
    if nxt is None:                                      # first sight: spread the first check over 2 to 10 minutes
        _remember(s.state_dir, next_check=t + (rng or random).uniform(120, 600))
        return None
    if t < float(nxt):
        return None
    _remember(s.state_dir, next_check=t + next_check_delay(s, rng))
    info = update_check(cfg, opener=opener, settings=s, now=clock)
    if not info["ok"]:
        _remember(s.state_dir, next_check=t + (rng or random).uniform(FAIL_RETRY_S * 0.5, FAIL_RETRY_S))
        return info
    if not info["update_available"] or not s.auto_apply:
        return info
    if hazard and not info["critical"]:
        _remember(s.state_dir, next_check=t + HAZARD_RETRY_S)
        return {"ok": False, "outcome": "deferred", "reason": "a hazard is active; waiting", "latest": info["latest"]}
    res = update_apply(cfg, opener=opener, settings=s, hazard=bool(hazard), now=clock)
    if res.get("outcome") in ("failed", "deferred"):
        _remember(s.state_dir, next_check=t + (rng or random).uniform(FAIL_RETRY_S * 0.5, FAIL_RETRY_S))
    return res


_last_selftest = {"t": 0.0}


def network_is_down(probe: Optional[dict]) -> bool:
    """True only when an independent probe could not get an HTTP answer from the cloud API at all (no DNS, no
    connection, a broken TLS handshake) or the API itself answered 5xx. Then no release could have reached the
    cloud, so a missing uplink is not evidence against the new release. A missing or odd probe is NOT "down"."""
    if not isinstance(probe, dict):
        return False
    status = probe.get("http_status")
    if isinstance(status, int) and not isinstance(status, bool):
        return status >= 500
    return probe.get("dns_ok") is False or bool(probe.get("error"))


def _default_probe(cfg) -> Optional[Callable[[], dict]]:
    base = getattr(cfg, "base_url", "") or ""
    if not base:
        return None
    from . import envreport
    return lambda: envreport.probe_api(base)


def health_tick(cfg=None, status: Optional[dict] = None, *, prefix: Optional[str] = None, settings: Optional[Settings] = None,
                now: Optional[Callable[[], float]] = None, selftest_after_s: float = 180.0,
                selftest_fn: Optional[Callable[[str], None]] = None, probe_fn: Optional[Callable[[], dict]] = None,
                uplink_expected: bool = True) -> dict:
    """Call about every 30 s from the agent with Agent.status(). Healthy = the uplink has worked, or the local
    self test passes AND an independent probe shows the cloud cannot be reached from this hub anyway (Wi-Fi down,
    cloud down). If the network is up but the new release never got an upload through, the update stays pending
    and is rolled back at the deadline: a broken uplink is the most likely way for an update to be bad.
    A rejected device key counts as reached (the release did talk to the cloud; the key is an operator problem).
    uplink_expected=False (no cloud link configured) accepts the self test alone.
    Returns {"action": "none" | "restart"}: on "restart" a rollback was done, exit RESTART_EXIT_CODE."""
    s = _settings(cfg, settings, prefix)
    clock = now or time.time
    guard = bg.Guard(s.prefix, s.state_dir, clock=clock)
    st = bg.load_state(s.state_dir)
    if st["boot"].get("healthy") and not st.get("pending"):
        return {"action": "none", "healthy": True}       # steady state: no file writes, no work
    status = status or {}
    up = (status.get("uplink") or {})
    if up.get("last_ok_age_s") is not None and not up.get("auth_failed"):
        return guard.health_tick(True, "uplink")
    t = clock()
    last_start = float(st["boot"].get("last_start", 0) or 0)
    if t - last_start >= selftest_after_s and t - _last_selftest["t"] >= 120:
        _last_selftest["t"] = t
        if uplink_expected and not up.get("auth_failed"):
            fn = probe_fn or _default_probe(cfg)
            try:
                probe = fn() if fn else None
            except Exception:  # noqa: BLE001 - a probe bug must not confirm an update
                probe = None
            if not network_is_down(probe):
                return guard.health_tick(False)          # network looks fine or unknown: wait for a real upload, else roll back
        try:
            (selftest_fn or _selftest)(bg.release_path(s.prefix, guard.version) if bg.release_ok(s.prefix, guard.version)
                                       else os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            return guard.health_tick(True, "selftest")
        except UpdateError:
            pass
    return guard.health_tick(False)


def flush_events(cfg, push: Callable[[str, dict], None]) -> int:
    """Move queued update events into the uplink. `push` is for example lambda t, d: agent._event(t, d)."""
    return bg.flush_outbox(Settings.load(cfg).state_dir, push)


# ---------------------------------------------------------------- older entry points (check-update)
def check(base: str, opener=None, current: str = VERSION) -> dict:
    base = base.rstrip("/")
    m = validate_manifest(json.loads(_get(f"{base}/downloads/unoq/manifest.json", MAX_MANIFEST, opener=opener)))
    newer = vtuple(m["version"]) > vtuple(current)
    return {"current": current, "latest": m["version"], "update_available": newer, "manifest": m,
            "note": "Checksummed release." if newer else "Already on the latest release."}


def download(base: str, dest_dir: str, opener=None) -> dict:
    """Stage a verified tarball for a manual `install.sh --file`. Installs nothing."""
    info = check(base, opener)
    m = info["manifest"]
    os.makedirs(dest_dir, mode=0o700, exist_ok=True)
    path = os.path.join(dest_dir, m["file"])
    _stream(f"{base.rstrip('/')}/downloads/unoq/{m['file']}", path, m["size"], m["sha256"], opener=opener)
    info["staged"] = path
    info["install_command"] = f"sudo sh install.sh --file {path} --sha256 {m['sha256']}"
    return info
