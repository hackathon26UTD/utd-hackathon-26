"""Boot guard: crash-loop detection and automatic rollback after an update. Standard library only.

This file is self-contained on purpose. install.sh copies it to <prefix>/bootguard.py (outside every
release) and systemd runs it as ExecStartPre, so a release that cannot even start Python code of its own
can still be rolled back.

Layout (prefix defaults to /opt/homebeacon-unoq):
    <prefix>/releases/<version>/   one folder per release
    <prefix>/current               symlink to the release that runs
    <prefix>/previous              symlink to the release to go back to (absent on a first install)
State (state dir, mode 700):
    update.json         schema, boot counters, pending update, last good version, bad versions, rollback record
    update.lock         held for the whole of an update or rollback (flock)
    update_events.json  small outbox of update outcomes waiting to be sent through the uplink

Rules:
    * A start counts as a failure when the previous start of the same version never reached "healthy" and
      never stopped cleanly. Healthy means the uplink worked or the local self test passed.
    * Only an update that has not been confirmed yet (pending) is rolled back, after FAIL_THRESHOLD failed
      starts, or when it is not healthy within HEALTHY_DEADLINE_S of the switch.
    * A rolled back version is remembered as bad and is never installed again by the auto updater.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import sys
import tempfile
import time
from typing import Callable, Optional

SCHEMA = 1
FAIL_THRESHOLD = 3            # failed starts of an unconfirmed update before it is rolled back
HEALTHY_DEADLINE_S = 600      # an unconfirmed update must be healthy within this many seconds of the switch
START_DEDUPE_S = 30           # a second record_start for the same version inside this window is the same start
KEEP_RELEASES = 2
RESTART_EXIT_CODE = 75        # same code as the allowlisted reboot-agent command; the unit restarts on it
DEFAULT_PREFIX = os.environ.get("HB_PREFIX", "/opt/homebeacon-unoq")
DEFAULT_STATE = os.environ.get("HB_STATE_DIR", "/var/lib/homebeacon-unoq")
OUTBOX_MAX = 20
VER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def vtuple(v: str) -> tuple:
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", v or "")
    if not m:
        raise ValueError(f"Not a version number: {v!r}")
    return tuple(int(x) for x in m.groups())


# ---------------------------------------------------------------- text safety
_CRED_URL = re.compile(r"[A-Za-z][A-Za-z0-9+.-]{0,14}://[^/\s:@]+:[^@\s]+@")
_TOKENS = re.compile(r"(?i)(bearer\s+[A-Za-z0-9._~+/=-]{8,}|x-device-key:?\s*\S+|\b(?:dk|ak)_[A-Za-z0-9]{8,}|\b[0-9a-f]{32,}\b)")


def clean(text, limit: int = 200) -> str:
    """Short, single-line and free of anything that looks like a credential. Used for every reason string
    that can leave the device in an event."""
    s = " ".join(str(text).split())
    s = _CRED_URL.sub("***@", s)
    s = _TOKENS.sub("***", s)
    return s[:limit]


# ---------------------------------------------------------------- files
def _match_dir_owner(fd: int, directory: str) -> None:
    """When running as root, give a file the same owner as the folder it lives in (the service user's state
    folder). A root-owned 0600 file there would be unreadable by the service, which would then silently lose
    the pending update and the bad-version list. A no-op for any other user."""
    if os.geteuid() != 0:
        return
    try:
        st = os.stat(directory)
        if st.st_uid != 0:
            os.fchown(fd, st.st_uid, st.st_gid)
    except OSError:
        pass


def atomic_write(path: str, data: bytes, mode: int = 0o600) -> None:
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=d)
    try:
        _match_dir_owner(fd, d)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, type(default)) else default
    except (OSError, ValueError):
        return default


class Lock:
    """flock on a file. Non-blocking unless wait_s is given: an update already running is reported, never waited on."""

    def __init__(self, path: str, wait_s: float = 0.0):
        self.path, self.wait_s, self.fd = path, wait_s, None

    def acquire(self) -> bool:
        """True when the lock is held. False when it is busy, and also when the lock file cannot be opened
        (for example it is owned by another user): callers treat both as "busy" and never see an exception."""
        try:
            os.makedirs(os.path.dirname(self.path) or ".", mode=0o700, exist_ok=True)
            # O_NOFOLLOW: a planted symlink in the state folder must not make a root run open some other file.
            self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        except OSError:
            self.fd = None
            return False
        _match_dir_owner(self.fd, os.path.dirname(self.path) or ".")
        end = time.monotonic() + self.wait_s
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except OSError:
                if time.monotonic() >= end:
                    os.close(self.fd)
                    self.fd = None
                    return False
                time.sleep(0.05)

    def release(self) -> None:
        if self.fd is not None:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_UN)
            finally:
                os.close(self.fd)
                self.fd = None


# ---------------------------------------------------------------- release layout
def releases_dir(prefix: str) -> str:
    return os.path.join(prefix, "releases")


def link_version(prefix: str, name: str) -> Optional[str]:
    """Version a symlink (current or previous) points at, or None when absent or not a release folder."""
    try:
        target = os.readlink(os.path.join(prefix, name))
    except OSError:
        return None
    v = os.path.basename(target.rstrip("/"))
    return v if VER_RE.match(v) else None


def current_version(prefix: str) -> Optional[str]:
    return link_version(prefix, "current")


def previous_version(prefix: str) -> Optional[str]:
    return link_version(prefix, "previous")


def release_path(prefix: str, version: str) -> str:
    return os.path.join(releases_dir(prefix), version)


def release_ok(prefix: str, version: str) -> bool:
    p = release_path(prefix, version)
    return os.path.isfile(os.path.join(p, "run_agent.py")) and os.path.isfile(os.path.join(p, "hbagent", "agent.py"))


def list_releases(prefix: str) -> list:
    try:
        names = [n for n in os.listdir(releases_dir(prefix)) if VER_RE.match(n) and os.path.isdir(release_path(prefix, n))]
    except OSError:
        return []
    return sorted(names, key=vtuple)


def swap_link(prefix: str, name: str, version: str) -> None:
    """Atomically point <prefix>/<name> at releases/<version> (symlink created beside it, then renamed over)."""
    tmp = os.path.join(prefix, f".{name}.new")
    try:
        os.unlink(tmp)
    except OSError:
        pass
    os.symlink(release_path(prefix, version), tmp)
    os.replace(tmp, os.path.join(prefix, name))


def prune_releases(prefix: str, keep: int = KEEP_RELEASES, protect=()) -> list:
    """Keep current, previous and anything protected, then the newest others up to `keep` folders. Returns removed."""
    import shutil
    have = list_releases(prefix)
    keepers = {v for v in (current_version(prefix), previous_version(prefix), *protect) if v}
    for v in reversed(have):
        if len(keepers) >= keep:
            break
        keepers.add(v)
    removed = []
    for v in have:
        if v not in keepers:
            shutil.rmtree(release_path(prefix, v), ignore_errors=True)
            removed.append(v)
    return removed


# ---------------------------------------------------------------- state file
def _state_path(state_dir: str) -> str:
    return os.path.join(state_dir, "update.json")


def load_state(state_dir: str) -> dict:
    st = load_json(_state_path(state_dir), {})
    st.setdefault("schema", SCHEMA)
    if not isinstance(st.get("boot"), dict):
        st["boot"] = {}
    if not isinstance(st.get("bad"), list):
        st["bad"] = []
    return st


def mutate_state(state_dir: str, fn: Callable[[dict], object]):
    """Read, change and atomically write update.json under a short lock (so the guard script and the agent
    never lose each other's writes)."""
    lk = Lock(os.path.join(state_dir, "update.state.lock"), wait_s=5.0)
    if not lk.acquire():
        raise TimeoutError("update state is busy")
    try:
        st = load_state(state_dir)
        out = fn(st)
        atomic_write(_state_path(state_dir), json.dumps(st, indent=1, sort_keys=True).encode())
        return out
    finally:
        lk.release()


# ---------------------------------------------------------------- outbox (events waiting for the uplink)
def emit(state_dir: str, outcome: str, now: Optional[float] = None, **data) -> None:
    """Queue one update event: outcome is started | succeeded | rolled_back | failed | deferred. Never raises."""
    try:
        body = {k: (clean(v) if isinstance(v, str) else v) for k, v in data.items()}
        body["outcome"] = outcome
        path = os.path.join(state_dir, "update_events.json")
        lk = Lock(path + ".lock", wait_s=2.0)
        if not lk.acquire():
            return
        try:
            box = load_json(path, [])
            box.append({"type": "agent.update", "data": body, "ts": int(now if now is not None else time.time())})
            atomic_write(path, json.dumps(box[-OUTBOX_MAX:]).encode())
        finally:
            lk.release()
    except Exception:  # noqa: BLE001 - reporting must never break an update or a start
        pass


def flush_outbox(state_dir: str, push: Callable[[str, dict], None]) -> int:
    """Hand queued events to `push(etype, data)` (for example the agent's own event queue). Returns how many were
    handed over. Events stay queued if push raises, so a crash in between does not lose them."""
    path = os.path.join(state_dir, "update_events.json")
    if not os.path.exists(path):
        return 0
    lk = Lock(path + ".lock", wait_s=2.0)
    if not lk.acquire():
        return 0
    try:
        box = load_json(path, [])
        sent = 0
        for ev in box:
            try:
                push(ev["type"], dict(ev["data"], at=ev.get("ts")))
            except Exception:  # noqa: BLE001
                break
            sent += 1
        if sent:
            atomic_write(path, json.dumps(box[sent:]).encode())
        return sent
    finally:
        lk.release()


# ---------------------------------------------------------------- the guard
class Guard:
    def __init__(self, prefix: str = DEFAULT_PREFIX, state_dir: str = DEFAULT_STATE, version: Optional[str] = None,
                 clock: Callable[[], float] = time.time, threshold: int = FAIL_THRESHOLD,
                 deadline_s: int = HEALTHY_DEADLINE_S):
        self.prefix, self.state_dir, self._version = prefix, state_dir, version
        self.clock, self.threshold, self.deadline_s = clock, threshold, deadline_s

    @property
    def version(self) -> str:
        return self._version or current_version(self.prefix) or "0.0.0"

    # -- start / stop / healthy
    def record_start(self) -> dict:
        """Call at every start (ExecStartPre does it; the agent may call it too, a repeat inside START_DEDUPE_S
        is the same start). Rolls back an unconfirmed update that keeps failing."""
        ver, now = self.version, self.clock()
        info = {"version": ver, "counted_failure": False, "rolled_back": False}

        def work(st):
            b = st["boot"]
            if b.get("version") == ver and now - float(b.get("last_start", 0)) < START_DEDUPE_S:
                return
            if b.get("version") == ver and b.get("healthy") is False and not b.get("clean_stop"):
                b["fails"] = int(b.get("fails", 0)) + 1
                info["counted_failure"] = True
            elif b.get("version") != ver:
                b["fails"] = 0
            b.update(version=ver, healthy=False, clean_stop=False, last_start=now)

        try:
            mutate_state(self.state_dir, work)
        except (OSError, TimeoutError):
            return info
        why = self.should_rollback()
        if why:
            res = self.rollback(why)
            info["rolled_back"] = bool(res.get("ok"))
            info["rollback"] = res
        return info

    def clean_stop(self) -> None:
        """Call on a deliberate exit (SIGTERM, restart request) so it is not counted as a crash."""
        try:
            mutate_state(self.state_dir, lambda st: st["boot"].update(clean_stop=True))
        except (OSError, TimeoutError):
            pass

    def record_healthy(self, reason: str = "uplink") -> Optional[dict]:
        """Mark this start healthy. Confirms a pending update and prunes old releases. Returns the
        from/to versions when an update was just confirmed."""
        ver, now = self.version, self.clock()
        done: dict = {}

        def work(st):
            st["boot"].update(version=ver, healthy=True, fails=0, healthy_at=now, healthy_reason=clean(reason, 40))
            p = st.get("pending")
            if isinstance(p, dict) and p.get("version") == ver:
                done.update(from_version=p.get("previous"), to_version=ver)
                st["pending"] = None
                st["last_applied"] = {"version": ver, "at": now}
            st["last_good"] = ver

        try:
            mutate_state(self.state_dir, work)
        except (OSError, TimeoutError):
            return None
        if done:
            emit(self.state_dir, "succeeded", now, reason=reason, **done)
            try:
                prune_releases(self.prefix)
            except OSError:
                pass
            return done
        return None

    # -- decisions
    def should_rollback(self) -> Optional[str]:
        """Reason to roll back right now, or None. Only an unconfirmed update, and only with somewhere to go."""
        st = load_state(self.state_dir)
        p, ver = st.get("pending"), self.version
        if not isinstance(p, dict) or p.get("version") != ver:
            return None
        if not (previous_version(self.prefix) or p.get("previous")):
            return None
        if int(st["boot"].get("fails", 0)) >= self.threshold:
            return f"{ver} failed to start {st['boot']['fails']} times in a row"
        return None

    def check_deadline(self) -> Optional[str]:
        """For the running agent: reason when an unconfirmed update has not become healthy in time."""
        st = load_state(self.state_dir)
        p = st.get("pending")
        if not isinstance(p, dict) or p.get("version") != self.version or st["boot"].get("healthy"):
            return None
        # Time counts from the later of the switch and this start, so a power cut after the switch is not blamed on the update.
        t0 = max(float(p.get("swapped_at", 0)), float(st["boot"].get("last_start", 0)))
        if t0 and self.clock() - t0 > self.deadline_s:
            return f"{self.version} was not healthy within {self.deadline_s} s"
        return None

    # -- actions
    def arm(self, from_version: Optional[str], to_version: str) -> None:
        """Mark an update as pending. Call BEFORE switching the current link so a crash right after is covered."""
        now = self.clock()

        def work(st):
            st["pending"] = {"version": to_version, "previous": from_version, "swapped_at": now}
            st["boot"] = {"version": to_version, "healthy": False, "fails": 0, "clean_stop": True, "last_start": 0}
            if from_version and not st.get("last_good"):
                st["last_good"] = from_version

        mutate_state(self.state_dir, work)

    def disarm(self) -> None:
        mutate_state(self.state_dir, lambda st: st.update(pending=None))

    def rollback(self, reason: str, manual: bool = False) -> dict:
        """Point current back at the previous release. The release rolled away from is remembered as bad.
        A running agent must then exit RESTART_EXIT_CODE; the ExecStartPre path needs nothing more."""
        lk = Lock(os.path.join(self.state_dir, "update.lock"))
        if not lk.acquire():
            return {"ok": False, "error": "an update is running; try again in a minute"}
        try:
            st = load_state(self.state_dir)
            cur = current_version(self.prefix)
            pend = st.get("pending") if isinstance(st.get("pending"), dict) else {}
            tgt = previous_version(self.prefix) or pend.get("previous")
            if not tgt or tgt == cur:
                return {"ok": False, "error": "there is no previous release to go back to"}
            if not VER_RE.match(str(tgt)) or not release_ok(self.prefix, tgt):
                return {"ok": False, "error": f"previous release {clean(tgt, 20)} is missing or damaged"}
            swap_link(self.prefix, "current", tgt)
            try:
                os.unlink(os.path.join(self.prefix, "previous"))
            except OSError:
                pass
            now = self.clock()

            def work(s):
                if cur and cur not in s["bad"]:
                    s["bad"] = (s["bad"] + [cur])[-10:]
                s["pending"] = None
                s["last_good"] = tgt
                s["boot"] = {"version": tgt, "healthy": False, "fails": 0, "clean_stop": True, "last_start": 0}
                s["rollback"] = {"from_version": cur, "to_version": tgt, "reason": clean(reason), "at": now, "manual": manual}

            mutate_state(self.state_dir, work)
            emit(self.state_dir, "rolled_back", now, from_version=cur, to_version=tgt, reason=reason, manual=manual)
            return {"ok": True, "from_version": cur, "to_version": tgt, "reason": clean(reason), "restart_required": True}
        finally:
            lk.release()

    def health_tick(self, healthy_now: bool, reason: str = "uplink") -> dict:
        """Periodic call from the running agent. healthy_now: the uplink worked, or the local self test passed.
        Returns {"action": "none" | "restart", ...}. "restart" means a rollback was done and the agent must exit
        RESTART_EXIT_CODE so systemd starts the previous release."""
        if healthy_now:
            self.record_healthy(reason)
            return {"action": "none", "confirmed": True}
        why = self.check_deadline()
        if why:
            res = self.rollback(why)
            if res.get("ok"):
                return {"action": "restart", **res}
            return {"action": "none", "error": res.get("error")}
        return {"action": "none"}


# ---------------------------------------------------------------- script entry (systemd ExecStartPre, install.sh)
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="bootguard", description="HomeBeacon Uno Q boot guard")
    ap.add_argument("action", choices=["pre-start", "arm", "status"])
    ap.add_argument("--prefix", default=DEFAULT_PREFIX)
    ap.add_argument("--state", default=DEFAULT_STATE)
    ap.add_argument("--from", dest="from_v", default="")
    ap.add_argument("--to", dest="to_v", default="")
    a = ap.parse_args(argv)
    g = Guard(a.prefix, a.state)
    if a.action == "pre-start":
        info = g.record_start()
        if info.get("rolled_back"):
            r = info["rollback"]
            print(f"bootguard: rolled back {r['from_version']} -> {r['to_version']}: {r['reason']}", file=sys.stderr)
        return 0
    if a.action == "arm":
        if not VER_RE.match(a.to_v) or (a.from_v and not VER_RE.match(a.from_v)):
            print("bootguard: --from/--to must be MAJOR.MINOR.PATCH", file=sys.stderr)
            return 2
        g.arm(a.from_v or None, a.to_v)
        emit(a.state, "started", from_version=a.from_v or None, to_version=a.to_v, via="install.sh")
        return 0
    st = load_state(a.state)
    print(json.dumps({"current": current_version(a.prefix), "previous": previous_version(a.prefix), "pending": st.get("pending"),
                      "boot": st.get("boot"), "bad": st.get("bad")}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
