"""Uplink hardening: circuit breaker, slow retry after a rejected key, stall detection, soft self-heal.

Patterned on Argus `send_watchdog` (act when the sent count stops moving, not on a flag) and
`stale_token_detector` (a rejected credential is a persistent, visible state, and we stop hammering).

UplinkGuard sits inside Api._call (see uplink.py) so every request path obeys the same gate:
  - Network trouble (no answer, 5xx, 429): after `trip_after` failures in a row the breaker opens and
    calls are answered locally, with no radio time, for a capped, jittered cooldown. After the cooldown
    ONE probe call goes out. Success closes the breaker, failure doubles the cooldown (cap 5 minutes).
    While a critical row (water, smoke, ...) is queued the breaker lets one attempt through every 15 s
    anyway: a hazard report must never wait out a cooldown.
  - 401/403: the key is dead, so hammering cannot help. One probe every `auth_retry_s` (15 minutes)
    until a call succeeds. The state is exposed as "device key rejected: re-run setup".
  - No accepted call for `stall_s` while rows wait and the network itself answers (a TCP connect to
    the API host works): rebuild the HTTP session once, at most every `heal_gap_s`, and record it.

State is mirrored to <state_dir>/uplink_health.json (mode 600, no secrets) so `doctor` and `status` can
read it while the agent runs or after it stopped. Standard library only, no threads, no timers: the
agent loop calls `UplinkWatchdog.before_step()` once per wake.
"""
from __future__ import annotations

import collections
import json
import logging
import os
import random
import socket
import threading
import time
from typing import Callable, Optional

from .uplink import Result

log = logging.getLogger("hbagent.watchdog")

KEY_REJECTED_MSG = "device key rejected: re-run setup (sudo homebeacon-unoq setup) and restart the service"
CRITICAL_GAP_S = 15.0
STATE_FILE = "uplink_health.json"


def state_path(state_dir: str) -> str:
    return os.path.join(state_dir, STATE_FILE)


def read_state(path: str) -> Optional[dict]:
    try:
        with open(path, encoding="utf-8") as f:
            raw = f.read(65536)
        v = json.loads(raw)
        return v if isinstance(v, dict) else None
    except (OSError, ValueError):
        return None


def tcp_probe(host: str, port: int, timeout: float = 5.0) -> bool:
    """Does the network answer at all? One TCP connect (resolves DNS too). No data is sent."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


class UplinkGuard:
    def __init__(self, *, clock: Callable[[], float] = time.monotonic, wall: Callable[[], float] = time.time,
                 rng: Optional[random.Random] = None, state_file: str = "",
                 on_event: Optional[Callable[[str, dict], None]] = None,
                 critical_pending: Optional[Callable[[], bool]] = None,
                 trip_after: int = 5, cooldown_base: float = 20.0, cooldown_cap: float = 300.0,
                 auth_retry_s: float = 900.0, key_event_every_s: float = 86400.0, heal_event_every_s: float = 3600.0):
        self.clock, self.wall = clock, wall
        self.rng = rng or random.Random()
        self.state_file = state_file
        self.on_event = on_event
        self.critical_pending = critical_pending
        self.trip_after, self.cooldown_base, self.cooldown_cap = trip_after, cooldown_base, cooldown_cap
        self.auth_retry_s = auth_retry_s
        self.key_event_every_s, self.heal_event_every_s = key_event_every_s, heal_event_every_s
        self._lock = threading.Lock()
        self.state = "closed"                     # closed | open | half_open
        self.consecutive = 0
        self.trips = 0
        self.cooldown_n = 0
        self.open_until = 0.0
        self.probing_since: Optional[float] = None
        self.last_attempt = -1e9
        self.auth_since_wall: Optional[float] = None
        self.auth_count = 0
        self.next_auth_probe = 0.0
        t0 = clock()
        self.started = t0
        self.last_ok_mono: Optional[float] = None
        self.last_reach_mono: Optional[float] = None     # last time the server ANSWERED (any status below 500, not auth)
        self.last_ok_wall: Optional[float] = None
        self.last_status: Optional[int] = None
        self.last_error = ""
        self.heals: collections.deque = collections.deque(maxlen=10)
        self.last_heal_mono = -1e9
        self._event_wall: dict = {}
        self._persist_sig: tuple = ()
        self._persist_at = -1e9
        prior = read_state(state_file) if state_file else None
        if prior:       # keep only what must survive a restart: the event throttle and the last good time
            ev = prior.get("event_wall")
            if isinstance(ev, dict):
                self._event_wall = {str(k): float(v) for k, v in ev.items() if isinstance(v, (int, float))}
            lw = prior.get("last_ok_wall")
            if isinstance(lw, (int, float)):
                self.last_ok_wall = float(lw)

    # ------------------------------------------------------------ gate (called before every request)
    def allow(self) -> Optional[Result]:
        now = self.clock()
        with self._lock:
            if self.auth_since_wall is not None:
                if now >= self.next_auth_probe:
                    self.next_auth_probe = now + self.auth_retry_s      # claim the probe slot
                    self.last_attempt = now
                    return None
                return Result(401, None, KEY_REJECTED_MSG)
            if self.state == "open":
                if now >= self.open_until:
                    self.state, self.probing_since = "half_open", None
                elif self.critical_pending is not None and now - self.last_attempt >= CRITICAL_GAP_S and self._critical():
                    self.last_attempt = now
                    return None
                else:
                    return Result(0, None, "circuit open")
            if self.state == "half_open":
                if self.probing_since is not None and now - self.probing_since < 120.0:
                    return Result(0, None, "circuit probing")
                self.probing_since = now
            self.last_attempt = now
            return None

    def _critical(self) -> bool:
        try:
            return bool(self.critical_pending())
        except Exception:  # noqa: BLE001
            return False

    # ------------------------------------------------------------ outcome (called after every request)
    def record(self, res: Result) -> None:
        now, wall = self.clock(), self.wall()
        emit: list = []
        with self._lock:
            self.last_status = res.status
            if res.ok or (res.status and not res.retry and not res.auth):
                self.last_reach_mono = now
            if res.ok:
                if self.auth_since_wall is not None:
                    emit.append(("agent.uplink_recovered", {"was": "key_rejected", "rejected_for_s": int(wall - self.auth_since_wall)},
                                 self.key_event_every_s))
                self.auth_since_wall, self.auth_count = None, 0
                self.state, self.consecutive, self.cooldown_n, self.probing_since = "closed", 0, 0, None
                self.last_ok_mono, self.last_ok_wall, self.last_error = now, wall, ""
            elif res.auth:
                if self.auth_since_wall is None:
                    self.auth_since_wall = wall
                    emit.append(("agent.key_rejected", {"status": res.status, "retry_every_s": int(self.auth_retry_s)}, self.key_event_every_s))
                self.auth_count += 1
                self.next_auth_probe = now + self.auth_retry_s
                self.probing_since = None
                self.last_error = KEY_REJECTED_MSG
            elif res.retry:
                self.consecutive += 1
                self.last_error = f"no good answer from the API ({res.status or res.error or 'no connection'})"
                if self.state == "half_open":
                    self._open(now)
                elif self.state == "closed" and self.consecutive >= self.trip_after:
                    self._open(now)
            else:       # 4xx other than auth: the server answered, so the network and key are fine
                self.consecutive, self.probing_since = 0, None
                if self.state == "half_open":
                    self.state, self.cooldown_n = "closed", 0
        for etype, data, every in emit:
            self._emit(etype, data, every)
        self._persist()

    def _open(self, now: float) -> None:
        self.cooldown_n += 1
        raw = min(self.cooldown_cap, self.cooldown_base * (2 ** (self.cooldown_n - 1)))
        self.open_until = now + min(self.cooldown_cap, raw * self.rng.uniform(0.75, 1.25))
        self.state, self.probing_since = "open", None
        self.trips += 1

    # ------------------------------------------------------------ views
    @property
    def key_rejected(self) -> bool:
        return self.auth_since_wall is not None

    def auth_probe_due(self) -> bool:
        return self.auth_since_wall is not None and self.clock() >= self.next_auth_probe

    def snapshot(self) -> dict:
        now, wall = self.clock(), self.wall()
        if self.auth_since_wall is not None:
            label, retry = "key_rejected", max(0.0, self.next_auth_probe - now)
        elif self.state == "open":
            label, retry = "open", max(0.0, self.open_until - now)
        else:
            label, retry = self.state, 0.0
        return {
            "state": label, "key_rejected": self.key_rejected,
            "message": KEY_REJECTED_MSG if self.key_rejected else self.last_error,
            "rejected_since_wall": self.auth_since_wall, "rejected_calls": self.auth_count,
            "consecutive_failures": self.consecutive, "trips": self.trips, "retry_in_s": round(retry, 1),
            "last_status": self.last_status,
            "last_ok_wall": self.last_ok_wall,
            "last_ok_age_s": None if self.last_ok_wall is None else round(max(0.0, wall - self.last_ok_wall), 1),
            "heals": list(self.heals), "event_wall": dict(self._event_wall), "written_wall": round(wall, 1),
        }

    # ------------------------------------------------------------ cloud-visible events (throttled)
    def _emit(self, etype: str, data: dict, every_s: float) -> None:
        if self.on_event is None:
            return
        wall = self.wall()
        last = self._event_wall.get(etype)
        if last is not None and 0 <= wall - last < every_s:
            return
        self._event_wall[etype] = wall
        try:
            self.on_event(etype, data)
        except Exception:  # noqa: BLE001
            log.debug("event hook failed", exc_info=True)

    # ------------------------------------------------------------ stall detection and self-heal
    def stalled(self, queue_depth: int, stall_s: float) -> bool:
        if queue_depth <= 0 or self.key_rejected:
            return False
        ref = self.last_reach_mono if self.last_reach_mono is not None else self.started
        return self.clock() - ref >= stall_s

    def note_heal(self, entry: dict) -> None:
        self.last_heal_mono = self.clock()
        self.heals.append(entry)
        if entry.get("action") == "rebuilt_session":
            self._emit("agent.uplink_selfheal", {k: entry[k] for k in ("at", "network", "action", "stalled_for_s") if k in entry},
                       self.heal_event_every_s)
        with self._lock:
            if self.state == "open":            # give the fresh session an immediate chance
                self.state, self.probing_since = "half_open", None
        self._persist(force=True)

    # ------------------------------------------------------------ persistence (atomic, mode 600, throttled)
    def _persist(self, force: bool = False) -> None:
        if not self.state_file:
            return
        now = self.clock()
        sig = (self.state, self.key_rejected, self.consecutive > 0, len(self.heals), self.trips)
        if not force and sig == self._persist_sig and now - self._persist_at < 60.0:
            return
        self._persist_sig, self._persist_at = sig, now
        tmp = self.state_file + ".tmp"
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self.snapshot(), f, separators=(",", ":"))
            os.replace(tmp, self.state_file)
        except OSError:
            log.debug("could not write %s", self.state_file, exc_info=True)

    def flush_state(self) -> None:
        self._persist(force=True)


class UplinkWatchdog:
    """Per-wake housekeeping the agent loop calls. Cheap: a few comparisons unless something is wrong."""

    def __init__(self, guard: UplinkGuard, api, depth: Callable[[], int], *, stall_s: float = 600.0, heal_gap_s: float = 1800.0,
                 net_probe: Optional[Callable[[str, int], bool]] = None):
        self.guard, self.api, self.depth = guard, api, depth
        self.stall_s, self.heal_gap_s = stall_s, heal_gap_s
        self.net_probe = net_probe or (lambda h, p: tcp_probe(h, p))

    def before_step(self, agent) -> None:
        g = self.guard
        now = agent.mono()
        if g.auth_probe_due():
            # Let one request through to learn whether the key works again (an operator may have fixed it).
            agent.auth_failed = False
            agent.next_net = min(agent.next_net, now)
            agent.next_poll = min(agent.next_poll, now)
        self.maybe_heal()

    def maybe_heal(self) -> Optional[dict]:
        g = self.guard
        if not g.stalled(self.depth(), self.stall_s) or g.clock() - g.last_heal_mono < self.heal_gap_s:
            return None
        net_ok = self.net_probe(self.api.host(), self.api.port())
        ref = g.last_reach_mono if g.last_reach_mono is not None else g.started
        entry = {"at": int(g.wall()), "network": "ok" if net_ok else "down", "stalled_for_s": int(g.clock() - ref),
                 "action": "rebuilt_session" if net_ok else "none_network_down"}
        if net_ok:
            self.api.rebuild_session()
        g.note_heal(entry)
        log.warning("uplink stalled for %ss; network %s; %s", entry["stalled_for_s"], entry["network"], entry["action"])
        return entry


def install(agent, wd: UplinkWatchdog) -> None:
    """Hook the watchdog into an Agent without editing it: wraps agent.step()."""
    inner = agent.step

    def step() -> float:
        try:
            wd.before_step(agent)
        except Exception:  # noqa: BLE001
            log.debug("watchdog step failed", exc_info=True)
        return inner()

    agent.step = step
